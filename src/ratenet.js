// Firing-rate network over the whole connectome, after Pugliese et al. 2025 (bioRxiv 2025.09.12.675944):
//   tau_i dr_i/dt = max(rmax_i * tanh((a_i / rmax_i) * (I_i + b * sum_j w_ij r_j - theta_i)), 0) - r_i
// w_ij = signed synapse count (ACh excitatory; GABA/Glu/histamine inhibitory), b = 0.03.
// Per-neuron gain a_i ~ N(1,0.1)/s_i and threshold theta_i ~ N(7.5,0.6)*s_i, with s_i = size_i / median(size)
// (bigger neurons need more input: lower input resistance). tau ~ N(20,2) ms, rmax ~ N(200,10) Hz.
// Implementation is event-driven: synaptic input is updated incrementally from rate changes, so the
// cost per step scales with the number of active neurons rather than the 10M edges.
export const NT_SIGN = [1, 1, -1, -1, 1, 1, 1, -1]; // unknown, ACh, GABA, Glu, DA, 5HT, OA, histamine
export const RATE_DEFAULTS = { dt: 1, b: 0.03, aMean: 1, aStd: 0.1, thMean: 7.5, thStd: 0.6, tauMean: 20, tauStd: 2,
  rmaxMean: 200, rmaxStd: 10, snap: 0.05, seed: 1, sizeNorm: true, modulatorySign: 1, maxSizeScale: 20,
  sizeRef: 7.13e8,
  adaptK: 0, adaptTau: 200, // spike-frequency adaptation: threshold * (1 + adaptK * A/rmax), tau_A dA/dt = r - A
  sensoryMask: null,
  minSyn: 5,
  depU: 0, depTau: 300 };    // short-term depression (Tsodyks-Markram rate form): du/dt=(1-u)/tau - U*u*r; output = r*u               // ignore connections with fewer synapses (Pugliese et al. used 5 for MANC/mCNS)      // Uint8Array: sensory neurons ignore central synaptic input (fire only from receptor drive) // reference volume (voxels) = median of VNC/DN/AN/MN neurons, matching Pugliese et al.'s VNC subset

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function truncNormal(rng, m, s) { for (;;) { const u = 1 - rng(), v = rng(); const x = m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); if (x > 0) return x; } }

// Region of each superclass, used for size normalisation: each neuron's size is expressed relative to the
// median neuron of its own region (optic lobe / central brain / nerve cord), so the calibration of
// Pugliese et al. (VNC) carries over to every region.
export const REGION_OF = (name) => /^(ol_|visual_projection|visual_centrifugal)/.test(name) ? 0 : /^(vnc_|descending|ascending|sensory_ascending|sensory_descending|efferent_)/.test(name) ? 2 : 1;
export function regionSizeRef(superclassNames, sc, size) {
  const N = sc.length, reg = new Uint8Array(N), buckets = [[], [], []];
  const regOfSc = superclassNames.map(REGION_OF);
  for (let i = 0; i < N; i++) { reg[i] = regOfSc[sc[i]]; if (size[i] > 0) buckets[reg[i]].push(size[i]); }
  const med = buckets.map(b => { b.sort((x, y) => x - y); return b[b.length >> 1] || 1; });
  const ref = new Float32Array(N); for (let i = 0; i < N; i++) ref[i] = med[reg[i]];
  return { ref, medians: med, region: reg };
}

export class RateNetwork {
  constructor(N, indptr, indices, weights, nt, size, params = {}) {
    this.N = N; this.indptr = indptr; this.indices = indices; this.nt = nt;
    this.p = { ...RATE_DEFAULTS, ...params };
    if (this.p.minSyn > 1) { const w = new Uint16Array(weights.length); for (let k = 0; k < w.length; k++) w[k] = weights[k] >= this.p.minSyn ? weights[k] : 0; this.weights = w; } else this.weights = weights;
    const p = this.p, rng = mulberry32(p.seed);
    // size normalisation
    const s = new Float32Array(N).fill(1);
    if (size && p.sizeNorm) {
      const refArr = p.sizeRefArray; let med = p.sizeRef; if (!med && !refArr) { const sorted = Float64Array.from(size).filter(x => x > 0).sort(); med = sorted[sorted.length >> 1]; }
      for (let i = 0; i < N; i++) { const ref = refArr ? refArr[i] : med; s[i] = size[i] > 0 ? Math.min(p.maxSizeScale, Math.max(1 / p.maxSizeScale, size[i] / ref)) : 1; }
    }
    this.sizeScale = s;
    this.a = new Float32Array(N); this.theta = new Float32Array(N); this.tau = new Float32Array(N); this.rmax = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.a[i] = truncNormal(rng, p.aMean, p.aStd) / s[i]; this.theta[i] = truncNormal(rng, p.thMean, p.thStd) * s[i];
      this.tau[i] = truncNormal(rng, p.tauMean, p.tauStd); this.rmax[i] = truncNormal(rng, p.rmaxMean, p.rmaxStd);
    }
    this.preFactor = new Float32Array(N);
    this.setSigns();
    this.r = new Float32Array(N); this.inp = new Float32Array(N); this.ext = new Float32Array(N);
    this.trace = new Float32Array(N); this.spikeCount = new Float32Array(N); // integrated rate (expected spikes)
    this.silenced = new Uint8Array(N); this.A = new Float32Array(N); this.u = new Float32Array(N).fill(1); this.out = new Float32Array(N);
    this.sensory = p.sensoryMask || new Uint8Array(N);
    this.t = 0; this._changed = new Int32Array(N); this._delta = new Float32Array(N); this._steps = 0;
  }
  setSigns() {
    const { N, nt, p } = this;
    for (let i = 0; i < N; i++) { const k = nt[i]; const sg = (k >= 4 && k <= 6) ? p.modulatorySign : NT_SIGN[k]; this.preFactor[i] = sg * p.b; }
  }
  setParams(q) { const old = this.p.modulatorySign; Object.assign(this.p, q); if (q.b !== undefined || this.p.modulatorySign !== old) { this.setSigns(); this.recomputeInput(); } }
  reset() { this.r.fill(0); this.inp.fill(0); this.A.fill(0); this.u.fill(1); this.out.fill(0); this.trace.fill(0); this.spikeCount.fill(0); this.t = 0; }
  setDrive(ix, amount) { for (let k = 0; k < ix.length; k++) this.ext[ix[k]] = amount; }  // external input current (model units)
  addDrive(ix, amount) { for (let k = 0; k < ix.length; k++) this.ext[ix[k]] += amount; }
  /** drive neurons so that, in isolation, they fire at `hz` (sensory transduction output) */
  setRate(ix, hz) { for (let k = 0; k < ix.length; k++) { const i = ix[k]; const m = this.rmax[i]; const f = Math.min(0.999, Math.max(0, hz) / m);
    this.ext[i] = f > 0 ? this.theta[i] + Math.atanh(f) * m / this.a[i] : 0; } }
  pulse(ix, amount) { for (let k = 0; k < ix.length; k++) { const i = ix[k]; this.r[i] = Math.min(this.rmax[i], this.r[i] + amount); this.out[i] = this.r[i] * this.u[i]; } this.recomputeInput(); }
  recomputeInput() {
    const { N, out, inp, indptr, indices, weights, preFactor } = this; inp.fill(0);
    for (let j = 0; j < N; j++) { const oj = out[j]; if (oj === 0) continue; const f = preFactor[j] * oj;
      for (let k = indptr[j], e = indptr[j + 1]; k < e; k++) inp[indices[k]] += f * weights[k]; }
  }
  /** advance one step; returns number of neurons with nonzero rate */
  step() {
    const { N, r, inp, ext, a, theta, tau, rmax, trace, spikeCount, silenced, indptr, indices, weights, preFactor, _changed, _delta, A, sensory, u, out } = this;
    const dU = this.p.depU, dTau = this.p.depTau;
    const dt = this.p.dt, snap = this.p.snap, dts = dt / 1000, aK = this.p.adaptK, aD = dt / this.p.adaptTau;
    let nch = 0, nactive = 0;
    for (let i = 0; i < N; i++) {
      const ri = r[i];
      let Ai = A[i];
      if (Ai !== 0) { Ai += aD * (ri - Ai); if (Ai < 1e-3 && ri === 0) Ai = 0; A[i] = Ai; }
      else if (ri !== 0) { Ai = aD * ri; A[i] = Ai; }
      const x = ext[i] + (sensory[i] ? 0 : inp[i]) - theta[i] * (1 + aK * Ai / rmax[i]);
      if (x <= 0 && ri === 0) { trace[i] *= 0.97; continue; }
      let act = 0;
      if (x > 0 && !silenced[i]) { const m = rmax[i]; act = m * Math.tanh(a[i] / m * x); }
      let rn = ri + dt / tau[i] * (act - ri);
      if (act === 0 && rn < snap) rn = 0;
      r[i] = rn;
      let ui = u[i];
      if (dU > 0 && (ui < 1 || rn > 0)) { ui += dt * ((1 - ui) / dTau - dU * ui * rn / 1000); if (ui > 0.9999 && rn === 0) ui = 1; u[i] = ui; }
      const on = rn * ui, dOut = on - out[i];
      if (dOut !== 0) { _changed[nch] = i; _delta[nch] = dOut; nch++; out[i] = on; }
      if (rn > 0) { nactive++; spikeCount[i] += rn * dts; }
      const tr = rn / rmax[i]; trace[i] = tr > trace[i] ? tr : trace[i] * 0.97 + tr * 0.03;
    }
    for (let c = 0; c < nch; c++) {
      const j = _changed[c]; const f = preFactor[j] * _delta[c];
      for (let k = indptr[j], e = indptr[j + 1]; k < e; k++) inp[indices[k]] += f * weights[k];
    }
    this.t += dt;
    if (++this._steps % 2000 === 0) this.recomputeInput(); // remove float drift
    return nactive;
  }
}
