// Differentiable flyvis: the same optic-lobe dynamics as fv_step in src/wasm/lif.c, with an adjoint.
//
// src/flyvis.js runs the trained optic-lobe model (Lappalainen et al. 2024) in the shared wasm kernel.
// It is a rate network, not a spiking one, and it is already smooth, so unlike the LIF adjoint in
// src/lifdiff.js nothing here needs a surrogate: the only nonlinearity is the rectification in the
// fan-out loop, which is a ReLU and differentiable almost everywhere.
//
//   acc[i] = sum over j, k in indptr[j]..indptr[j+1] of  weight[k] * max(0, v[j])   where target[k] == i
//   v[i]  += kdt[i] * (-v[i] + bias[i] + acc[i] + x[i])
//
// The arithmetic is kept bit-identical to fv_step: Float32 accumulators, `j` ascending in the outer
// loop and `k` ascending in the inner one, so a trajectory recorded here matches the one the wasm
// kernel produces and the adjoint is the adjoint of the model that actually runs. Bit-identical needs
// the Math.fround calls below, and they are not decoration. wasm rounds to f32 after every operation;
// JavaScript evaluates `weight[k] * r` in double precision and only rounds when it is stored, which is
// one rounding fewer. Without the frounds the two implementations agree to about 1e-6 and disagree on
// 60% of node-steps (scripts/vis_equiv.mjs measured exactly that), and the deadband in the coupling
// turns some of those 1e-6 disagreements into a 5 Hz difference in what the CNS is told it saw.
//
// Memory. The whole trajectory is stored rather than checkpointed. At N = 45,669 a state is 183 kB and
// a visual assay is ~35 optic-lobe steps (dt = 20 ms), so the tape is about 13 MB -- three orders of
// magnitude smaller than the LIF tape at the same wall-clock, because the optic lobe runs at 50 Hz
// and the LIF at 2 kHz. There is no reason to recompute what costs 13 MB to keep.
//
// The two eyes share every parameter (src/flyvis.js builds the second instance from
// `e0.sharedParts`), so gradients from both eyes accumulate into one parameter set. That is a property
// of the model as shipped, not a simplification here.

/** Parameters the adjoint produces gradients for. `kdt` is dt/max(tau,dt), the quantity fv_step uses. */
export const FV_PARAMS = ['weight', 'bias', 'kdt'];

export class FlyVisDiff {
  /**
   * @param model  parsed flyvis model from parseFlyVis(): { N, E, bias, tau, indptr, target, weight, dt }
   * @param shared optional: another FlyVisDiff's `sharedParts`, to build the second eye on the first
   *               eye's parameters (which is what the shipped model does)
   */
  constructor(model, shared = null) {
    const N = this.N = model.N, E = this.E = model.E;
    this.dt = model.dt || 0.02;
    if (shared) {
      this.bias = shared.bias; this.kdt = shared.kdt; this.indptr = shared.indptr;
      this.target = shared.target; this.weight = shared.weight;
    } else {
      this.bias = Float32Array.from(model.bias);
      // kdt is normally derived from the time constants, but can be supplied directly, which is what
      // a finite-difference check of the kdt gradient needs.
      this.kdt = model.kdt ? Float32Array.from(model.kdt)
        : Float32Array.from(model.tau, t => this.dt / Math.max(t, this.dt));
      this.indptr = Int32Array.from(model.indptr);
      this.target = Int32Array.from(model.target);
      this.weight = Float32Array.from(model.weight);
    }
    this.inputIdx = model.inputIdx;
    this.v = new Float32Array(N); this.acc = new Float32Array(N); this.x = new Float32Array(N);
    this.v.set(this.bias);
    // flattened input map: every photoreceptor node and the hex column it reads
    const ix = [], col = [];
    for (const t in this.inputIdx) { const a = this.inputIdx[t];
      for (let k = 0; k < a.length; k++) { ix.push(a[k]); col.push(k); } }
    this.inNode = Int32Array.from(ix); this.inCol = Int32Array.from(col);
    this.nCol = Math.max(...col) + 1;
    void E;
  }

  get sharedParts() { return { bias: this.bias, kdt: this.kdt, indptr: this.indptr, target: this.target, weight: this.weight }; }

  reset() { this.v.set(this.bias); }

  /** lum: Float32Array(nCol) luminance per hex column, the same for R1-R8 */
  setInput(lum) { const x = this.x, n = this.inNode, c = this.inCol;
    for (let k = 0; k < n.length; k++) x[n[k]] = lum[c[k]]; }

  /** One step, matching fv_step exactly -- see the note on Math.fround at the top of the file. */
  step() {
    const { N, indptr, target, weight, v, acc, x, kdt, bias } = this;
    const fr = Math.fround;
    acc.fill(0);
    for (let j = 0; j < N; j++) { const r = v[j]; if (r <= 0) continue;
      for (let k = indptr[j], e = indptr[j + 1]; k < e; k++) acc[target[k]] += fr(weight[k] * r); }
    for (let i = 0; i < N; i++) {
      const u = fr(fr(fr(-v[i] + bias[i]) + acc[i]) + x[i]);
      v[i] += fr(kdt[i] * u);
    }
  }

  /** Settle to a static field without taping, the way src/flyvis.js does before an assay. */
  settle(lum, steps = 150) { this.reset(); this.setInput(lum); for (let k = 0; k < steps; k++) this.step(); }

  /**
   * Begin recording. The tape holds, per step, the pre-update state and the accumulated input, which
   * is what the adjoint needs: `vPre` gives both the ReLU mask on the fan-out and the -v term, and
   * `acc` gives d/d(kdt) without a replay.
   */
  startTape(steps) {
    const N = this.N;
    this.tape = { steps, n: 0, vPre: new Float32Array(steps * N), acc: new Float32Array(steps * N),
      xAt: new Float32Array(steps * N) };
    return this.tape;
  }

  /** One step, taped. */
  stepTaped() {
    const { N, indptr, target, weight, v, acc, x, kdt, bias, tape } = this;
    const fr = Math.fround;
    const off = tape.n * N;
    tape.vPre.set(v, off); tape.xAt.set(x, off);
    acc.fill(0);
    for (let j = 0; j < N; j++) { const r = v[j]; if (r <= 0) continue;
      for (let k = indptr[j], e = indptr[j + 1]; k < e; k++) acc[target[k]] += fr(weight[k] * r); }
    tape.acc.set(acc, off);
    for (let i = 0; i < N; i++) {
      const u = fr(fr(fr(-v[i] + bias[i]) + acc[i]) + x[i]);
      v[i] += fr(kdt[i] * u);
    }
    tape.n++;
  }

  /**
   * Reverse-mode gradient over the taped trajectory.
   *
   * @param dLdV  Float32Array(steps * N): dLoss / d(v[i] after the update at step t), which is the
   *              quantity the coupling in src/visdiff.js produces. Sparse in practice -- only the
   *              nodes the CNS reads are nonzero -- but dense here, because it is 183 kB a step.
   * @param g     accumulator { weight, bias, kdt } to add into, so two eyes sharing parameters can
   *              share one gradient. Created if absent.
   * @param dLdLum  optional Float32Array(steps * nCol): accumulates the gradient with respect to the
   *              luminance input, which is what makes a stimulus-optimisation experiment possible.
   */
  backward(dLdV, g = null, dLdLum = null) {
    const { N, indptr, target, weight, kdt, tape } = this;
    const steps = tape.n;
    g = g || { weight: new Float32Array(this.E), bias: new Float32Array(N), kdt: new Float32Array(N) };
    const gw = g.weight, gb = g.bias, gk = g.kdt;
    const fr = Math.fround;
    const lv = new Float32Array(N);        // adjoint of v entering step t from the future
    const lacc = new Float32Array(N);
    const { vPre, acc: accAt, xAt } = tape;
    for (let t = steps - 1; t >= 0; t--) {
      const off = t * N;
      // v_new[i] = v[i] + kdt[i] * (-v[i] + bias[i] + acc[i] + x[i])
      for (let i = 0; i < N; i++) {
        const l = lv[i] + dLdV[off + i];
        if (l === 0) { lacc[i] = 0; lv[i] = 0; continue; }
        const k = kdt[i];
        // the same fround chain the forward pass used, so d/d(kdt) is taken at the value that ran
        const u = fr(fr(fr(-vPre[off + i] + this.bias[i]) + accAt[off + i]) + xAt[off + i]);
        gk[i] += l * u;
        gb[i] += l * k;
        lacc[i] = l * k;
        lv[i] = l * (1 - k);
      }
      if (dLdLum) { const n = this.inNode, c = this.inCol, lo = t * this.nCol;
        for (let q = 0; q < n.length; q++) dLdLum[lo + c[q]] += lacc[n[q]]; }
      // acc[i] = sum_{j: vPre[j] > 0} sum_k weight[k] * vPre[j]   (target[k] == i)
      for (let j = 0; j < N; j++) {
        const r = vPre[off + j]; if (r <= 0) continue;
        let s = 0;
        for (let k = indptr[j], e = indptr[j + 1]; k < e; k++) {
          const la = lacc[target[k]];
          if (la === 0) continue;
          s += la * weight[k];
          gw[k] += la * r;
        }
        lv[j] += s;
      }
    }
    return g;
  }
}
