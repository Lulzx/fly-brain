// Differentiable whole-CNS LIF: the same dynamics as src/lif.js, with an adjoint.
//
// The calibrated model (docs/07-calibration.md) is fitted by cross-entropy search over nine global
// parameters. That works because nine is small. It cannot reach the parameters a connectome-constrained
// model actually has -- a gain per neuron, a time constant per cell type -- because a
// population search does not scale to 10^5 dimensions. Gradients do, which is how the optic-lobe
// model this project depends on was fitted (Lappalainen et al. 2024). This module supplies them for
// the rest of the nervous system.
//
// Spikes are not differentiable, so the backward pass substitutes a surrogate derivative for the
// threshold (Zenke & Ganguli 2018): the forward pass spikes exactly as src/lif.js does, and only the
// gradient pretends the threshold is soft. The surrogate is the fast-sigmoid derivative
// 1 / (1 + |u - thr| / beta)^2, scaled by 1/beta.
//
// What is differentiable, and what is not, is a property of the model rather than of this code:
//
//   differentiable   wSyn, sizeAlpha, inhGain, eInh, vThresh, kcThreshold, laminaBias, adaptInc,
//                    depU, and a per-neuron log-gain on outgoing weights (N parameters)
//   not              minSyn (a discrete gate on the graph), tRef and delay (integer step counts),
//                    and the Poisson drive, whose spikes are exogenous
//
// Two of the nine fitted global parameters therefore have no gradient, which is worth stating plainly:
// a differentiable whole-brain simulator is differentiable in most of its parameters, not all of them.
//
// Memory. Reverse-mode needs the forward trajectory. Storing every state at every step is 3 MB per
// step at this size, so the forward pass checkpoints every CHECKPOINT steps and the backward pass
// recomputes one segment at a time.
import { EXC_SIGN } from './lif.js';

const CHECKPOINT = 64;

/** Parameters the adjoint produces gradients for, in the order used by grad vectors. */
export const DIFF_PARAMS = ['wSyn', 'sizeAlpha', 'inhGain', 'eInh', 'vThresh', 'kcThreshold', 'laminaBias', 'adaptInc', 'depU'];

export class LIFDiff {
  /**
   * @param data   {N, indptr, indices, weights, nt}
   * @param opts   model parameters; `sizeLog` is log(s_i) per neuron, the quantity sizeAlpha scales
   *               (inScale = min(boostCap, exp(-sizeAlpha * sizeLog))), `thrMask` marks the neurons
   *               kcThreshold applies to and `biasMask` the ones laminaBias applies to.
   */
  constructor(data, opts = {}) {
    const p = this.p = {
      dt: 0.5, vRest: -52, vThresh: -45, vReset: -52, tauM: 20, tauSyn: 5, tRef: 2.2, delay: 1.8,
      wSyn: 0.3, adaptInc: 0, adaptTau: 100, depU: 0, depTau: 200, minSyn: 1,
      coba: true, eExc: 0, eInh: -70, inhGain: 1, sizeAlpha: 0, maxSizeScale: 20, boostCap: 1,
      kcThreshold: 0, laminaBias: 0, surrogateBeta: 2.0,
      // soft: replace the hard threshold in the FORWARD pass too, so the model is genuinely smooth
      // and the adjoint can be checked against finite differences. The gradient code is identical
      // either way; only the spike amplitude changes from {0,1} to a logistic in (0,1).
      soft: false, ...opts,
    };
    this.N = data.N; this.indptr = data.indptr; this.indices = data.indices;
    this.counts = data.weights;                                  // raw synapse counts, never mutated
    this.sign = opts.preSign ? Float32Array.from(opts.preSign)
      : Float32Array.from({ length: data.N }, (_, i) => EXC_SIGN[data.nt[i]]);
    this.sizeLog = opts.sizeLog || new Float32Array(data.N);      // log of relative neuron volume
    this.thrMask = opts.thrMask || new Uint8Array(data.N);
    this.biasMask = opts.biasMask || new Uint8Array(data.N);
    this.sensory = opts.sensoryMask || new Uint8Array(data.N);
    this.logGain = opts.logGain || new Float32Array(data.N);      // per-neuron parameter, zero = off
    this.nslots = Math.max(1, Math.round(p.delay / p.dt)) + 1;
    this.drive = new Float32Array(data.N);
    this._alloc();
  }

  _alloc() {
    const N = this.N;
    this.v = new Float32Array(N); this.gE = new Float32Array(N); this.gI = new Float32Array(N);
    this.adapt = new Float32Array(N); this.res = new Float32Array(N); this.refr = new Float32Array(N);
    this.spikeCount = new Float32Array(N);
    this.inScale = new Float32Array(N);
    this.ring = Array.from({ length: this.nslots }, () => ({ idx: new Int32Array(0), amp: new Float32Array(0) }));
  }

  /** inScale and the effective per-edge weight depend on sizeAlpha, inhGain and minSyn. */
  _prepare() {
    const p = this.p, N = this.N;
    for (let i = 0; i < N; i++) {
      const s = Math.exp(-p.sizeAlpha * this.sizeLog[i]);
      this.inScale[i] = Math.min(p.boostCap, Math.max(1 / p.maxSizeScale, s));
    }
    // gate: a connection under minSyn, or one landing on a neuron driven from outside, carries nothing
    if (!this.gate || this.gateMin !== p.minSyn) {
      this.gate = new Uint8Array(this.counts.length); this.gateMin = p.minSyn;
      for (let j = 0; j < this.counts.length; j++) {
        this.gate[j] = (this.counts[j] >= p.minSyn && !this.sensory[this.indices[j]]) ? 1 : 0;
      }
    }
  }

  reset() {
    const p = this.p;
    this.v.fill(p.vRest); this.gE.fill(0); this.gI.fill(0);
    this.adapt.fill(0); this.res.fill(1); this.refr.fill(0); this.spikeCount.fill(0);
    this.ring = Array.from({ length: this.nslots }, () => ({ idx: new Int32Array(0), amp: new Float32Array(0) }));
    this.head = 0; this.t = 0;
    this._prepare();
  }

  setDrive(ix, rate) { for (const i of ix) this.drive[i] = rate; }
  setDriveOne(i, rate) { this.drive[i] = rate; }

  /** random number source; deterministic so the forward pass can be replayed exactly */
  _rand() { let s = this._seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this._seed = s >>> 0; return (s >>> 0) / 4294967296; }

  // ------------------------------------------------------------------ forward
  /**
   * Run `steps` steps, recording what the adjoint needs.
   * Returns { spikes, tape } where tape holds checkpoints and the per-step spike lists.
   */
  forward(steps, { seed = 1, record = true } = {}) {
    const p = this.p, N = this.N;
    this._seed = (seed * 2654435761) >>> 0 || 1;
    this.reset();
    const dE = Math.exp(-p.dt / p.tauSyn), dA = Math.exp(-p.dt / p.adaptTau), kRec = p.dt / p.depTau;
    const kM = p.dt / p.tauM, dtS = p.dt / 1000;
    const cE = 1 / (p.eExc - p.vRest), cI = 1 / (p.vRest - p.eInh);
    const { v, gE, gI, adapt, res, refr, spikeCount, indptr, indices, counts, gate, inScale, sign, logGain, drive } = this;

    const tape = record ? { spikes: [], arrivals: [], checkpoints: new Map(), steps, seed } : null;
    if (record) tape.checkpoints.set(0, this._snapshot());

    for (let t = 0; t < steps; t++) {
      const arriving = this.ring[this.head];
      if (record) tape.arrivals.push({ idx: arriving.idx.slice(), amp: arriving.amp.slice() });
      // --- deliver arriving spikes
      for (let k = 0; k < arriving.idx.length; k++) {
        const pre = arriving.idx[k], sg = sign[pre], amp = arriving.amp[k];
        if (sg === 0) continue;
        const eff = sg * p.wSyn * Math.exp(logGain[pre]) * res[pre] * amp;
        res[pre] -= p.depU * res[pre];
        const a = indptr[pre], b = indptr[pre + 1];
        if (eff > 0) { for (let j = a; j < b; j++) if (gate[j]) gE[indices[j]] += counts[j] * inScale[indices[j]] * eff; }
        else { const ig = p.inhGain; for (let j = a; j < b; j++) if (gate[j]) gI[indices[j]] += counts[j] * inScale[indices[j]] * ig * eff; }
      }

      // --- integrate and spike
      const fIdx = [], fAmp = [];
      for (let i = 0; i < N; i++) {
        let vi = v[i], s = 0;
        if (refr[i] > 0) { refr[i] -= p.dt; vi = p.vReset; }
        else if (drive[i] > 0 && this._rand() < drive[i] * dtS) {
          vi = p.vReset; refr[i] = p.tRef; s = 1;
        } else {
          vi += (p.vRest - vi + gE[i] * (p.eExc - vi) * cE + gI[i] * (vi - p.eInh) * cI
            + (this.biasMask[i] ? p.laminaBias : 0)) * kM;
          const thr = p.vThresh + adapt[i] + (this.thrMask[i] ? p.kcThreshold : 0);
          s = p.soft ? 1 / (1 + Math.exp(-(vi - thr) / p.surrogateBeta)) : (vi >= thr ? 1 : 0);
          if (s > 0) { vi = s * p.vReset + (1 - s) * vi; if (!p.soft) refr[i] = p.tRef; }
        }
        if (s > (p.soft ? 1e-4 : 0.5)) { fIdx.push(i); fAmp.push(s); }
        spikeCount[i] += s;
        adapt[i] += s * p.adaptInc;
        v[i] = vi; gE[i] *= dE; gI[i] *= dE; adapt[i] *= dA; res[i] += (1 - res[i]) * kRec;
      }
      const fired = { idx: Int32Array.from(fIdx), amp: Float32Array.from(fAmp) };
      if (record) tape.spikes.push(fired);
      const slot = (this.head + this.nslots - 1) % this.nslots;
      this.ring[slot] = fired; this.head = (this.head + 1) % this.nslots;
      this.t += p.dt;
      if (record && (t + 1) % CHECKPOINT === 0) tape.checkpoints.set(t + 1, this._snapshot());
    }
    return tape;
  }

  _snapshot() {
    return { v: this.v.slice(), gE: this.gE.slice(), gI: this.gI.slice(), adapt: this.adapt.slice(),
      res: this.res.slice(), refr: this.refr.slice(), ring: this.ring.map(a => ({ idx: a.idx.slice(), amp: a.amp.slice() })), head: this.head,
      seed: this._seed };
  }

  _restore(c) {
    this.v.set(c.v); this.gE.set(c.gE); this.gI.set(c.gI); this.adapt.set(c.adapt);
    this.res.set(c.res); this.refr.set(c.refr);
    this.ring = c.ring.map(a => ({ idx: a.idx.slice(), amp: a.amp.slice() })); this.head = c.head; this._seed = c.seed;
  }

  /**
   * Replay one segment from a checkpoint, saving the per-step pre-spike quantities the adjoint
   * needs: the membrane potential before the reset, and the conductances and adapt/res that fed it.
   */
  _replay(from, to) {
    const p = this.p, N = this.N;
    this._restore(this.tape.checkpoints.get(from));
    const dE = Math.exp(-p.dt / p.tauSyn), dA = Math.exp(-p.dt / p.adaptTau), kRec = p.dt / p.depTau;
    const kM = p.dt / p.tauM, dtS = p.dt / 1000;
    const cE = 1 / (p.eExc - p.vRest), cI = 1 / (p.vRest - p.eInh);
    const { v, gE, gI, adapt, res, refr, indptr, indices, counts, gate, inScale, sign, logGain, drive } = this;
    const rec = [];
    for (let t = from; t < to; t++) {
      const arriving = this.tape.arrivals[t];
      const resAtDelivery = new Float32Array(arriving.idx.length);
      for (let k = 0; k < arriving.idx.length; k++) {
        const pre = arriving.idx[k], sg = sign[pre], amp = arriving.amp[k];
        if (sg === 0) continue;
        resAtDelivery[k] = res[pre];
        const eff = sg * p.wSyn * Math.exp(logGain[pre]) * res[pre] * amp;
        res[pre] -= p.depU * res[pre];
        const a = indptr[pre], b = indptr[pre + 1];
        if (eff > 0) { for (let j = a; j < b; j++) if (gate[j]) gE[indices[j]] += counts[j] * inScale[indices[j]] * eff; }
        else { const ig = p.inhGain; for (let j = a; j < b; j++) if (gate[j]) gI[indices[j]] += counts[j] * inScale[indices[j]] * ig * eff; }
      }
      const st = { vPre: new Float32Array(N), gE: gE.slice(), gI: gI.slice(), adapt: adapt.slice(),
        u: new Float32Array(N), sp: new Float32Array(N), mode: new Uint8Array(N), resAtDelivery };
      for (let i = 0; i < N; i++) {
        let vi = v[i], sv = 0, mode = 0;       // mode: 0 integrated, 1 refractory, 2 exogenous spike
        st.vPre[i] = vi;
        if (refr[i] > 0) { refr[i] -= p.dt; vi = p.vReset; mode = 1; }
        else if (drive[i] > 0 && this._rand() < drive[i] * dtS) { vi = p.vReset; refr[i] = p.tRef; sv = 1; mode = 2; }
        else {
          vi += (p.vRest - vi + gE[i] * (p.eExc - vi) * cE + gI[i] * (vi - p.eInh) * cI
            + (this.biasMask[i] ? p.laminaBias : 0)) * kM;
          st.u[i] = vi;
          const thr = p.vThresh + adapt[i] + (this.thrMask[i] ? p.kcThreshold : 0);
          sv = p.soft ? 1 / (1 + Math.exp(-(vi - thr) / p.surrogateBeta)) : (vi >= thr ? 1 : 0);
          if (sv > 0) { vi = sv * p.vReset + (1 - sv) * vi; if (!p.soft) refr[i] = p.tRef; }
        }
        st.mode[i] = mode; st.sp[i] = sv;
        adapt[i] += sv * p.adaptInc;
        v[i] = vi; gE[i] *= dE; gI[i] *= dE; adapt[i] *= dA; res[i] += (1 - res[i]) * kRec;
      }
      rec.push(st);
      const slot = (this.head + this.nslots - 1) % this.nslots;
      const f = this.tape.spikes[t];
      this.ring[slot] = { idx: f.idx.slice(), amp: f.amp.slice() }; this.head = (this.head + 1) % this.nslots;
    }
    return rec;
  }

  // ------------------------------------------------------------------ backward
  /**
   * Reverse-mode gradient of a loss expressed through per-neuron spike counts.
   * @param tape   from forward()
   * @param dLdSpike  Float32Array(N): dLoss / d(spike count of neuron i)
   * @param truncate  window length for truncated BPTT. A recurrent spiking network of this size
   *                  diverges if the adjoint is carried over hundreds of steps -- the products of
   *                  Jacobians grow without bound and overflow Float32 -- so the adjoint state is
   *                  cleared every `truncate` steps. The gradient then accounts for influences up to
   *                  truncate * dt milliseconds back, which is a bias, and a deliberate one: it is
   *                  the same truncation used to train recurrent networks everywhere else.
   * @returns { params: {name: grad}, logGain: Float32Array(N), truncate }
   */
  backward(tape, dLdSpike, { truncate = 40 } = {}) {
    this.tape = tape;
    const p = this.p, N = this.N, steps = tape.steps;
    const dE = Math.exp(-p.dt / p.tauSyn), dA = Math.exp(-p.dt / p.adaptTau), kRec = p.dt / p.depTau;
    const kM = p.dt / p.tauM;
    const cE = 1 / (p.eExc - p.vRest), cI = 1 / (p.vRest - p.eInh);
    const { indptr, indices, counts, gate, inScale, sign, logGain, sizeLog } = this;
    const beta = p.surrogateBeta;

    const lv = new Float32Array(N), lgE = new Float32Array(N), lgI = new Float32Array(N);
    const lad = new Float32Array(N), lres = new Float32Array(N);
    const gInScale = new Float32Array(N), gLogGain = new Float32Array(N);
    const g = Object.fromEntries(DIFF_PARAMS.map(k => [k, 0]));

    // adjoint of each step's spike vector, held in a ring: a spike at step t is delivered at t+delay
    const lsRing = Array.from({ length: this.nslots }, () => new Float32Array(N));

    const bounds = [];
    for (let s = 0; s < steps; s += CHECKPOINT) bounds.push([s, Math.min(steps, s + CHECKPOINT)]);

    for (let b = bounds.length - 1; b >= 0; b--) {
      const [from, to] = bounds[b];
      const rec = this._replay(from, to);
      for (let t = to - 1; t >= from; t--) {
        if (truncate > 0 && (t + 1) % truncate === 0) {      // start of a fresh truncation window
          lv.fill(0); lgE.fill(0); lgI.fill(0); lad.fill(0); lres.fill(0);
          for (const r of lsRing) r.fill(0);
        }
        const st = rec[t - from];
        const fired = tape.spikes[t].fired;
        const ls = lsRing[t % this.nslots];

        // --- reverse the post-step decays
        for (let i = 0; i < N; i++) { lgE[i] *= dE; lgI[i] *= dE; lad[i] *= dA; lres[i] *= (1 - kRec); }

        // --- reverse integrate-and-spike
        for (let i = 0; i < N; i++) {
          const mode = st.mode[i];
          if (mode === 1) { lv[i] = 0; continue; }                 // clamped to vReset while refractory
          if (mode === 2) { g.adaptInc += lad[i]; lv[i] = 0; ls[i] = 0; continue; }   // exogenous: only adapt
          const u = st.u[i];
          const thr = p.vThresh + st.adapt[i] + (this.thrMask[i] ? p.kcThreshold : 0);
          const d = u - thr;
          const s = st.sp[i];
          // exact derivative when the forward pass is smooth; the fast-sigmoid surrogate when it is not
          const sg = p.soft ? s * (1 - s) / beta : 1 / (beta * (1 + Math.abs(d) / beta) ** 2);
          const lspike = ls[i] + dLdSpike[i];                      // downstream + direct loss term
          // v_new = s * vReset + (1-s) * u ; adapt_new = adapt + s * adaptInc
          const lvNew = lv[i];
          const lu = lvNew * ((1 - s) + (p.vReset - u) * sg) + lad[i] * p.adaptInc * sg + lspike * sg;
          const lthr = -(lvNew * (p.vReset - u) * sg + lad[i] * p.adaptInc * sg + lspike * sg);
          g.adaptInc += lad[i] * s;
          g.vThresh += lthr;
          if (this.thrMask[i]) g.kcThreshold += lthr;
          lad[i] += lthr;                                          // adapt enters through the threshold

          // u = v + (vRest - v + gE (eExc - v) cE + gI (v - eInh) cI + bias) kM
          const vv = st.vPre[i];
          lv[i] = lu * (1 + kM * (-1 - st.gE[i] * cE + st.gI[i] * cI));
          lgE[i] += lu * kM * (p.eExc - vv) * cE;
          lgI[i] += lu * kM * (vv - p.eInh) * cI;
          if (this.biasMask[i]) g.laminaBias += lu * kM;
          g.eInh += lu * kM * st.gI[i] * cI * (-1 + (vv - p.eInh) * cI);
          ls[i] = 0;
        }

        // --- reverse the synaptic delivery that happened at the top of this step.
        // Delivery is additive in gE/gI, so the adjoint passes through unchanged; what it produces
        // is the gradient with respect to everything the delivered amount was built from, and the
        // adjoint of the presynaptic spike itself, which belongs to the step that emitted it.
        const arriving = tape.arrivals[t];
        const emit = t - (this.nslots - 1);
        const target = emit >= 0 ? lsRing[emit % this.nslots] : null;
        for (let k = 0; k < arriving.idx.length; k++) {
          const pre = arriving.idx[k], sgn = sign[pre], amp = arriving.amp[k];
          if (sgn === 0) continue;
          const resAt = st.resAtDelivery[k];
          const gain = Math.exp(logGain[pre]);
          const base = sgn * p.wSyn * gain * resAt;       // delivered amount before the spike amplitude
          const eff = base * amp;
          const a = indptr[pre], b2 = indptr[pre + 1];
          let lRaw = 0;                                   // d(loss) / d(eff), summed over the fan-out
          if (eff > 0) {
            for (let j = a; j < b2; j++) { if (!gate[j]) continue; const q = indices[j], cw = counts[j];
              lRaw += lgE[q] * cw * inScale[q]; gInScale[q] += lgE[q] * cw * eff; }
          } else {
            const ig = p.inhGain;
            for (let j = a; j < b2; j++) { if (!gate[j]) continue; const q = indices[j], cw = counts[j];
              lRaw += lgI[q] * cw * inScale[q] * ig; gInScale[q] += lgI[q] * cw * ig * eff;
              g.inhGain += lgI[q] * cw * inScale[q] * eff; }
          }
          g.wSyn += lRaw * sgn * gain * resAt * amp;
          gLogGain[pre] += lRaw * eff;                    // d(eff) / d(logGain) = eff
          if (target) target[pre] += lRaw * base;         // d(delivered) / d(the spike amplitude)
          // res[pre] was read here and then depressed: res_after = res * (1 - depU)
          const lresAfter = lres[pre];
          g.depU += -lresAfter * resAt;
          lres[pre] = lresAfter * (1 - p.depU) + lRaw * sgn * p.wSyn * gain * amp;
        }
      }
    }
    // sizeAlpha reaches the loss through inScale = min(boostCap, exp(-sizeAlpha * sizeLog))
    for (let i = 0; i < N; i++) {
      const raw = Math.exp(-p.sizeAlpha * sizeLog[i]);
      if (raw < p.boostCap && raw > 1 / p.maxSizeScale) g.sizeAlpha += gInScale[i] * (-sizeLog[i]) * raw;
    }
    for (const k of DIFF_PARAMS) if (!Number.isFinite(g[k])) g[k] = 0;
    for (let i = 0; i < N; i++) if (!Number.isFinite(gLogGain[i])) gLogGain[i] = 0;
    return { params: g, logGain: gLogGain, truncate };
  }
}
