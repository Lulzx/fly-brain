// Pure LIF network core (no DOM, no worker) so it can run in a worker, in Node tests, or one-per-fly.
// Model after Shiu et al. 2024: each synapse adds a fixed PSP, sign by presynaptic neurotransmitter.
// sign of fast synaptic effect by predicted transmitter: unknown, ACh, GABA, Glu, DA, 5HT, OA, histamine
// (unknown = 0: no invented sign; monoamines excitatory as in Shiu et al. unless overridden via ntSign)
export const EXC_SIGN = [0, 1, -1, -1, 1, 1, 1, -1];
export const DEFAULTS = {
  dt: 0.5, vRest: -52, vThresh: -45, vReset: -52, tauM: 20, tauSyn: 5, tRef: 2.2, delay: 1.8,
  wSyn: 0.275, noise: 0, traceTau: 30,
  adaptInc: 2.0, adaptTau: 100,   // spike-frequency adaptation: threshold rises adaptInc mV per spike, decays with adaptTau ms
  depU: 0.2, depTau: 200,          // short-term synaptic depression (per presynaptic neuron): resource x -= depU*x per spike, recovers with depTau
  inScale: null, minSyn: 1, sensoryMask: null, ntSign: null, preSign: null,
  coba: false, eExc: 0, eInh: -70, inhGain: 1,   // conductance-based synapses: reversal potentials (mV); weights calibrated to wSyn PSP at rest
  // preSign: per-neuron graded sign (overrides nt table)
};
export class LIFNetwork {
  constructor(N, indptr, indices, weights, nt, params = {}) {
    this.N = N; this.indptr = indptr; this.indices = indices; this.nt = nt;
    this.p = { ...DEFAULTS, ...params };
    this.sensory = this.p.sensoryMask || new Uint8Array(N);
    // per-synapse PSP = wSyn * count / s_post  (s = neuron volume relative to its region's median; bigger neuron, lower input resistance)
    const inS = this.p.inScale;
    const w = new Float32Array(weights.length);
    for (let j = 0; j < N; j++) for (let k = indptr[j]; k < indptr[j + 1]; k++) { const q = indices[k]; const c = weights[k];
      w[k] = (c >= this.p.minSyn && !this.sensory[q]) ? c * (inS ? inS[q] : 1) : 0; }
    if (this.p.inhGain !== 1) { const PS = this.p.preSign, SG = this.p.ntSign || EXC_SIGN;
      for (let j = 0; j < N; j++) { const sg = PS ? PS[j] : SG[nt[j]]; if (sg < 0) for (let k = indptr[j]; k < indptr[j + 1]; k++) w[k] *= this.p.inhGain; } }
    this.weights = w;
    this.v = new Float32Array(N).fill(this.p.vRest);
    this.gE = new Float32Array(N); this.gI = new Float32Array(N);
    this.refr = new Float32Array(N); this.trace = new Float32Array(N);
    this.spikeCount = new Uint32Array(N); this.drive = new Float32Array(N);
    this.adapt = new Float32Array(N); this.res = new Float32Array(N).fill(1);
    this.bias = new Float32Array(N);   // constant depolarising current (mV at steady state), e.g. graded resting potential
    this.thr = new Float32Array(N);    // per-neuron extra spike threshold (mV), e.g. Kenyon cells
    // event-driven bookkeeping: only neurons away from rest (or driven/biased) are updated each step
    this.awake = new Uint8Array(N); this.awakeList = new Int32Array(N); this.nAwake = 0;
    this.t = 0; this._g2 = null;
    this._setupRing();
  }
  wake(i) { if (!this.awake[i]) { this.awake[i] = 1; this.awakeList[this.nAwake++] = i; } }
  _setupRing() { const d = Math.max(1, Math.round(this.p.delay / this.p.dt)); this.ring = Array.from({ length: d + 1 }, () => []); this.head = 0; }
  setParams(q) { const od = this.p.delay, odt = this.p.dt; Object.assign(this.p, q); if (this.p.delay !== od || this.p.dt !== odt) this._setupRing(); }
  reset() { this.v.fill(this.p.vRest); this.gE.fill(0); this.gI.fill(0); this.refr.fill(0); this.trace.fill(0); this.adapt.fill(0); this.res.fill(1); this.spikeCount.fill(0); this.ring.forEach(a => a.length = 0); this.t = 0;
    this.awake.fill(0); this.nAwake = 0; for (let i = 0; i < this.N; i++) if (this.drive[i] > 0 || this.bias[i] !== 0) this.wake(i); }
  setBias(ix, mv) { for (let k = 0; k < ix.length; k++) { this.bias[ix[k]] = mv; if (mv !== 0) this.wake(ix[k]); } }
  setDrive(ix, rate) { for (let k = 0; k < ix.length; k++) { this.drive[ix[k]] = rate; if (rate > 0) this.wake(ix[k]); } }
  setDriveOne(i, rate) { this.drive[i] = rate; if (rate > 0) this.wake(i); }
  setThr(i, mv) { this.thr[i] = mv; }
  addG(i, e, ii) { this.gE[i] += e; this.gI[i] += ii || 0; this.wake(i); }
  pulse(ix, mv) { for (let k = 0; k < ix.length; k++) { this.gE[ix[k]] += mv; this.wake(ix[k]); } }
  gauss() { if (this._g2 !== null) { const r = this._g2; this._g2 = null; return r; }
    let u, s, w; do { u = Math.random() * 2 - 1; s = Math.random() * 2 - 1; w = u * u + s * s; } while (w >= 1 || w === 0);
    const m = Math.sqrt(-2 * Math.log(w) / w); this._g2 = s * m; return u * m; }
  /** advance one step; returns array of neuron indices that fired */
  step() {
    const { dt, vRest, vThresh, vReset, tauM, tauSyn, tRef, wSyn, noise, traceTau, adaptInc, adaptTau, depU, depTau } = this.p;
    const { N, v, gE, gI, refr, trace, spikeCount, drive, indptr, indices, weights, nt, adapt, res, bias, thr } = this;
    const dA = Math.exp(-dt / adaptTau), kRec = dt / depTau;
    const coba = this.p.coba, eExc = this.p.eExc, eInh = this.p.eInh, cE = 1 / (eExc - vRest), cI = 1 / (vRest - eInh); const SIGN = this.p.ntSign || EXC_SIGN, PS = this.p.preSign;
    const dE = Math.exp(-dt / tauSyn), dTr = Math.exp(-dt / traceTau), dtS = dt / 1000, nA = noise * Math.sqrt(dt), kM = dt / tauM;
    const arriving = this.ring[this.head];
    const awake = this.awake, list = this.awakeList; let nA0 = this.nAwake;
    for (let k = 0; k < arriving.length; k++) {
      const pre = arriving[k], sign = (PS ? PS[pre] : SIGN[nt[pre]]) * wSyn * res[pre], a = indptr[pre], b = indptr[pre + 1];
      if (sign === 0) continue;
      res[pre] -= depU * res[pre];
      if (sign > 0) { for (let j = a; j < b; j++) { const q = indices[j], w = weights[j]; if (w === 0) continue; gE[q] += w * sign; if (!awake[q]) { awake[q] = 1; list[nA0++] = q; } } }
      else { for (let j = a; j < b; j++) { const q = indices[j], w = weights[j]; if (w === 0) continue; gI[q] += w * sign; if (!awake[q]) { awake[q] = 1; list[nA0++] = q; } } }
    }
    arriving.length = 0;
    const fired = [];
    const full = nA > 0;   // noise: every neuron must be integrated
    const count = full ? N : nA0; let keep = 0;
    for (let n = 0; n < count; n++) {
      const i = full ? n : list[n];
      let vi = v[i];
      if (refr[i] > 0) { refr[i] -= dt; vi = vReset; }
      else if (drive[i] > 0 && Math.random() < drive[i] * dtS) { vi = vReset; refr[i] = tRef; fired.push(i); spikeCount[i]++; trace[i] = 1; adapt[i] += adaptInc; }
      else {
        if (coba) vi += (vRest - vi + gE[i] * (eExc - vi) * cE + gI[i] * (vi - eInh) * cI + bias[i]) * kM;   // gI<0: inhibitory
        else vi += (vRest - vi + gE[i] + gI[i] + bias[i]) * kM;
        if (nA > 0) vi += nA * this.gauss();
        if (vi >= vThresh + adapt[i] + thr[i]) { vi = vReset; refr[i] = tRef; fired.push(i); spikeCount[i]++; trace[i] = 1; adapt[i] += adaptInc; }
      }
      const g1 = gE[i] * dE, g2 = gI[i] * dE, tr = trace[i] * dTr, ad = adapt[i] * dA, rs = res[i] + (1 - res[i]) * kRec;
      if (!full && refr[i] <= 0 && drive[i] === 0 && bias[i] === 0 && vi - vRest < 1e-3 && vRest - vi < 1e-3 && g1 < 1e-4 && -g2 < 1e-4 && tr < 2e-3 && ad < 1e-3 && rs > 0.999) {
        v[i] = vRest; gE[i] = 0; gI[i] = 0; trace[i] = 0; adapt[i] = 0; res[i] = 1; awake[i] = 0;   // back to rest: sleep
      } else { v[i] = vi; gE[i] = g1; gI[i] = g2; trace[i] = tr; adapt[i] = ad; res[i] = rs; if (!full) list[keep++] = i; }
    }
    if (!full) this.nAwake = keep; else { this.nAwake = 0; for (let i = 0; i < N; i++) if (awake[i]) list[this.nAwake++] = i; }
    const slot = (this.head + this.ring.length - 1) % this.ring.length;
    this.ring[slot] = fired; this.head = (this.head + 1) % this.ring.length;
    this.t += dt;
    return fired;
  }
}
