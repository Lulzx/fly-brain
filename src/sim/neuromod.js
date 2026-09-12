// Neuromodulation: hunger reaches the brain as hormones in the haemolymph and as octopamine released by
// identified neurons, instead of as a number read by the behaviour rules.
//
//   haemolymph sugar (FlyAgent.energy)
//     -> AKH, the glucagon-like hormone of the corpora cardiaca (outside the CNS, so modelled here), rises as
//        sugar falls
//     -> insulin-producing cells (IPC, 16 neurons in the connectome) are glucose-sensing: sugar depolarises
//        them and their spiking sets the insulin (DILP) level
//     -> AKH receptor excites, and insulin receptor inhibits, a subset of octopaminergic neurons. Starved flies
//        become hyperactive through these neurons (Yang et al. 2015, PNAS 112:5219; Yu et al. 2016,
//        eLife 5:e15693). Which OA types carry AKHR is not resolved; the ventral SEZ clusters (OA-VUMa,
//        OA-VPM) are assumed.
//     -> each OA neuron's release is its firing rate low-pass filtered over seconds. It acts through
//        G-protein receptors, not fast synapses: it lowers the spike threshold of the neurons it synapses onto
//        (Octβ receptors raise cAMP and excitability; receptor types per cell are not in the connectome, so
//        all targets are treated alike).
//
// The OA neurons' fast synapses are removed from the LIF graph (see modulatorySign in brainmodel.js). The OA
// neurons and IPCs get a slow afterhyperpolarisation (threshold rising with their recent rate), as monoaminergic
// and neurosecretory cells have; without it they switch between silence and 100 Hz with small changes in
// network input. Their resting thresholds are set so a fed fly's cells fire tonically at a few Hz
// (public/data/neuromod.json, from scripts/neuromod_calib.mjs); the uncalibrated network drives OA neurons to
// 100 to 200 Hz.
//
// `arousal` (0 fed .. 1 starved) is the mean octopamine level of the AKHR neurons. The endogenous behaviour
// module uses it where it used to use hunger for locomotion (Intrinsic.update, ctx.arousal).
export const NEUROMOD = {
  akhHalf: 0.4, akhWidth: 0.15, akhTau: 5000,   // AKH secretion vs haemolymph sugar (sigmoid), ms time constant (compressed like energy)
  ipcHalf: 0.4, ipcWidth: 0.15, ipcDrive: 4,    // glucose depolarises the IPCs: excitatory conductance per ms at full drive
  ipcFed: 5, dilpTau: 10000,                    // IPC rate when fed (calibration; insulin 1), and insulin time constant (ms)
  akhDrive: 3, insDrive: 1,                     // conductance per ms onto AKHR OA neurons at AKH 1 / insulin 1
  oaTau: 2000,                                  // octopamine release and the slow AHP follow firing (ms)
  sfa: 0.5,                                     // slow AHP: threshold rise (mV) per Hz of recent firing, OA neurons and IPCs
  oaFed: 2, oaStarved: 12,                      // Hz: tonic rate targeted when fed (calibration), and the level that counts as fully aroused
  targetShift: 2, targetHalf: 400,              // max threshold decrease (mV) on OA targets; half-saturation in synapses x Hz
  locoDrive: 6,                                 // locomotion excites the optic-lobe OA cells (corollary discharge; Suver et al. 2012)
};
export const AKHR_TYPES = /^OA-(VUMa|VPM)/;
export const OPTIC_OA_TYPES = /^OA-(AL2i|ASM)/;   // octopamine neurons whose arbours are in the optic lobes
export const isOctopaminergic = t => /^OA-/.test(t);
const sig = (x, half, w) => 1 / (1 + Math.exp(-(x - half) / w));

export class Neuromod {
  /** data: connectome ({ N, indptr, indices, weights, meta.types }); calib: parsed neuromod.json; block: 'OA' | 'AKHR' | 'InR' | null */
  constructor(data, brain, { calib = null, block = null, minSyn = 5, params = {} } = {}) {
    this.P = { ...NEUROMOD, ...params }; this.block = block; this.brain = brain;
    const types = data.meta.types, N = data.N, oa = [], ipc = [];
    for (let i = 0; i < N; i++) { if (isOctopaminergic(types[i])) oa.push(i); if (types[i] === 'IPC') ipc.push(i); }
    // modulatory cells: OA neurons then IPCs, each with a resting threshold and a low-pass firing rate (Hz)
    this.cells = Int32Array.from([...oa, ...ipc]); this.nOA = oa.length; this.oa = this.cells.subarray(0, this.nOA); this.ipc = this.cells.subarray(this.nOA);
    this.akhrPos = Int32Array.from(oa.flatMap((i, n) => AKHR_TYPES.test(types[i]) ? [n] : [])); this.akhr = Int32Array.from(this.akhrPos, n => oa[n]);
    this.opticPos = Int32Array.from(oa.flatMap((i, n) => OPTIC_OA_TYPES.test(types[i]) ? [n] : [])); this.optic = Int32Array.from(this.opticPos, n => oa[n]);
    const cal = calib ? { ...calib.oaThr, ...calib.ipcThr } : {};
    this.base = Float32Array.from(this.cells, i => cal[i] ?? brain.thr[i]);
    this.r = Float32Array.from(this.cells, (i, n) => n < this.nOA ? this.P.oaFed : this.P.ipcFed);
    this.c = this.r.subarray(0, this.nOA);   // octopamine release per OA neuron
    this.last = Uint32Array.from(this.cells, i => brain.spikeCount[i]);
    // octopamine targets: synapse counts from each OA neuron (same minimum as the fast graph)
    const tIx = new Map(), rows = [];
    for (const j of oa) { const r = [];
      for (let k = data.indptr[j]; k < data.indptr[j + 1]; k++) { const w = data.weights[k]; if (w < minSyn) continue; const q = data.indices[k];
        if (!tIx.has(q)) tIx.set(q, tIx.size); r.push(tIx.get(q), w); }
      rows.push(Int32Array.from(r)); }
    this.rows = rows; this.targets = Int32Array.from(tIx.keys()); this.x = new Float32Array(this.targets.length); this.shift = new Float32Array(this.targets.length);
    this.thr0 = Float32Array.from(this.targets, q => brain.thr[q]);   // resting thresholds of the targets (class physiology, e.g. Kenyon cells)
    const cellSet = new Set(this.cells); this.isCell = Uint8Array.from(this.targets, q => cellSet.has(q) ? 1 : 0);
    this.cellTarget = Int32Array.from(this.cells, i => tIx.get(i) ?? -1);
    this.akh = 0; this.dilp = 1; this.t = 0;
    this.adapt = null;   // calibration: { eta } moves the cells' resting thresholds toward their fed rates
    this.setCellThr();
  }
  /** after brain.reset() (spike counts cleared): back to the fed steady state */
  reset() { this.last.set(Array.from(this.cells, i => this.brain.spikeCount[i])); this.r.fill(this.P.oaFed, 0, this.nOA).fill(this.P.ipcFed, this.nOA); this.akh = 0; this.dilp = 1; this.t = 0; this.setCellThr(); }
  /** one ms; sugar = haemolymph sugar (energy 0..1); loco = locomotor state 0..1 (walking or flying) */
  update(dtMs, sugar, loco = 0) {
    const P = this.P, B = this.brain; const t = this.t += dtMs;
    this.akh += (sig(-sugar, -P.akhHalf, P.akhWidth) - this.akh) * dtMs / P.akhTau;
    const gIPC = P.ipcDrive * sig(sugar, P.ipcHalf, P.ipcWidth) * dtMs; for (const i of this.ipc) B.addG(i, gIPC);
    const akh = this.block === 'AKHR' ? 0 : this.akh, ins = this.block === 'InR' ? 0 : this.dilp;
    const gA = P.akhDrive * akh * dtMs, gI = P.insDrive * ins * dtMs;
    for (const i of this.akhr) B.addG(i, gA, -gI);
    // locomotor corollary discharge onto the optic-lobe OA cells (Suver et al. 2012): their release then
    // raises visual gain on their targets (visual projection neurons and optic-lobe interneurons)
    if (loco > 0) { const gL = P.locoDrive * loco * dtMs; for (const i of this.optic) B.addG(i, gL); }
    if (t % 10 === 0) this.release(10);
    if (t % 50 === 0 && this.block !== 'OA') this.modulate();
  }
  release(ms) {
    const P = this.P, B = this.brain, k = ms / P.oaTau, nC = this.cells.length;
    for (let n = 0; n < nC; n++) { const s = B.spikeCount[this.cells[n]]; this.r[n] += ((s - this.last[n]) * 1000 / ms - this.r[n]) * k; this.last[n] = s; }
    let ipc = 0; for (let n = this.nOA; n < nC; n++) ipc += this.r[n];
    this.dilp += (Math.min(1.5, ipc / this.ipc.length / P.ipcFed) - this.dilp) * ms / P.dilpTau;
    if (this.adapt) { const e = this.adapt.eta * ms / 1000;   // calibration only (log rate error, so silent and saturated cells both converge)
      for (let n = 0; n < nC; n++) this.base[n] += e * Math.log((this.r[n] + 0.5) / ((n < this.nOA ? P.oaFed : P.ipcFed) + 0.5)); }
    this.setCellThr();
  }
  setCellThr() { for (let n = 0; n < this.cells.length; n++) { const m = this.cellTarget[n]; this.brain.setThr(this.cells[n], this.base[n] + this.P.sfa * this.r[n] - (m < 0 ? 0 : this.shift[m])); } }
  /** octopamine lowers the spike threshold of its synaptic targets, saturating */
  modulate() {
    const P = this.P, B = this.brain, x = this.x; x.fill(0);
    for (let n = 0; n < this.rows.length; n++) { const r = this.rows[n], c = this.c[n]; if (c <= 0) continue; for (let m = 0; m < r.length; m += 2) x[r[m]] += r[m + 1] * c; }
    for (let m = 0; m < x.length; m++) { this.shift[m] = P.targetShift * x[m] / (x[m] + P.targetHalf); if (!this.isCell[m]) B.setThr(this.targets[m], this.thr0[m] - this.shift[m]); }
  }
  /** mean octopamine release of the AKH-sensitive OA neurons (Hz) */
  get oaTone() { let s = 0; for (const n of this.akhrPos) s += this.c[n]; return s / this.akhrPos.length; }
  get arousal() { const oa = this.block === 'OA' ? this.P.oaFed : this.oaTone; return Math.max(0, Math.min(1, (oa - this.P.oaFed) / (this.P.oaStarved - this.P.oaFed))); }
  readout() { return { akh: this.akh, dilp: this.dilp, oa: this.oaTone, arousal: this.arousal }; }
  /** resting thresholds of the modulatory cells, for neuromod.json */
  thresholds() { const o = { oaThr: {}, ipcThr: {} }; this.cells.forEach((i, n) => (n < this.nOA ? o.oaThr : o.ipcThr)[i] = +this.base[n].toFixed(3)); return o; }
}
