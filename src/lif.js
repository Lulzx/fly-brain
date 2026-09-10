// Pure LIF network core (no DOM, no worker) so it can run in a worker, in Node tests, or one-per-fly.
// Model after Shiu et al. 2024: each synapse adds a fixed PSP, sign by presynaptic neurotransmitter.
export const EXC_SIGN = [1, 1, -1, -1, 1, 1, 1, -1]; // unknown, ach, gaba, glu, da, 5ht, oa, his
export const DEFAULTS = {
  dt: 0.5, vRest: -52, vThresh: -45, vReset: -52, tauM: 20, tauSyn: 5, tRef: 2.2, delay: 1.8,
  wSyn: 0.275, noise: 0, traceTau: 30,
  adaptInc: 2.0, adaptTau: 100,   // spike-frequency adaptation: threshold rises adaptInc mV per spike, decays with adaptTau ms
  depU: 0.2, depTau: 200,          // short-term synaptic depression (per presynaptic neuron): resource x -= depU*x per spike, recovers with depTau
};
export class LIFNetwork {
  constructor(N, indptr, indices, weights, nt, params = {}) {
    this.N = N; this.indptr = indptr; this.indices = indices; this.weights = weights; this.nt = nt;
    this.p = { ...DEFAULTS, ...params };
    this.v = new Float32Array(N).fill(this.p.vRest);
    this.gE = new Float32Array(N); this.gI = new Float32Array(N);
    this.refr = new Float32Array(N); this.trace = new Float32Array(N);
    this.spikeCount = new Uint32Array(N); this.drive = new Float32Array(N);
    this.adapt = new Float32Array(N); this.res = new Float32Array(N).fill(1);
    this.t = 0; this._g2 = null;
    this._setupRing();
  }
  _setupRing() { const d = Math.max(1, Math.round(this.p.delay / this.p.dt)); this.ring = Array.from({ length: d + 1 }, () => []); this.head = 0; }
  setParams(q) { const od = this.p.delay, odt = this.p.dt; Object.assign(this.p, q); if (this.p.delay !== od || this.p.dt !== odt) this._setupRing(); }
  reset() { this.v.fill(this.p.vRest); this.gE.fill(0); this.gI.fill(0); this.refr.fill(0); this.trace.fill(0); this.adapt.fill(0); this.res.fill(1); this.spikeCount.fill(0); this.ring.forEach(a => a.length = 0); this.t = 0; }
  setDrive(ix, rate) { for (let k = 0; k < ix.length; k++) this.drive[ix[k]] = rate; }
  pulse(ix, mv) { for (let k = 0; k < ix.length; k++) this.gE[ix[k]] += mv; }
  gauss() { if (this._g2 !== null) { const r = this._g2; this._g2 = null; return r; }
    let u, s, w; do { u = Math.random() * 2 - 1; s = Math.random() * 2 - 1; w = u * u + s * s; } while (w >= 1 || w === 0);
    const m = Math.sqrt(-2 * Math.log(w) / w); this._g2 = s * m; return u * m; }
  /** advance one step; returns array of neuron indices that fired */
  step() {
    const { dt, vRest, vThresh, vReset, tauM, tauSyn, tRef, wSyn, noise, traceTau, adaptInc, adaptTau, depU, depTau } = this.p;
    const { N, v, gE, gI, refr, trace, spikeCount, drive, indptr, indices, weights, nt, adapt, res } = this;
    const dA = Math.exp(-dt / adaptTau), kRec = dt / depTau;
    const dE = Math.exp(-dt / tauSyn), dTr = Math.exp(-dt / traceTau), dtS = dt / 1000, nA = noise * Math.sqrt(dt), kM = dt / tauM;
    const arriving = this.ring[this.head];
    for (let k = 0; k < arriving.length; k++) {
      const pre = arriving[k], sign = EXC_SIGN[nt[pre]] * wSyn * res[pre], a = indptr[pre], b = indptr[pre + 1];
      res[pre] -= depU * res[pre];
      if (sign > 0) for (let j = a; j < b; j++) gE[indices[j]] += weights[j] * sign;
      else for (let j = a; j < b; j++) gI[indices[j]] += weights[j] * sign;
    }
    arriving.length = 0;
    const fired = [];
    for (let i = 0; i < N; i++) {
      let vi = v[i];
      if (refr[i] > 0) { refr[i] -= dt; vi = vReset; }
      else if (drive[i] > 0 && Math.random() < drive[i] * dtS) { vi = vReset; refr[i] = tRef; fired.push(i); spikeCount[i]++; trace[i] = 1; adapt[i] += adaptInc; }
      else {
        vi += (vRest - vi + gE[i] + gI[i]) * kM;
        if (nA > 0) vi += nA * this.gauss();
        if (vi >= vThresh + adapt[i]) { vi = vReset; refr[i] = tRef; fired.push(i); spikeCount[i]++; trace[i] = 1; adapt[i] += adaptInc; }
      }
      v[i] = vi; gE[i] *= dE; gI[i] *= dE; trace[i] *= dTr; adapt[i] *= dA; res[i] += (1 - res[i]) * kRec;
    }
    const slot = (this.head + this.ring.length - 1) % this.ring.length;
    this.ring[slot] = fired; this.head = (this.head + 1) % this.ring.length;
    this.t += dt;
    return fired;
  }
}
