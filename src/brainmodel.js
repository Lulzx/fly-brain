// Calibrated whole-CNS spiking model (see PLAN.md "Brain model calibration").
// LIF (Shiu et al. 2024) + per-neuron PSP scaling by (volume / regional median volume)^-0.5,
// connections >= 5 synapses (Pugliese et al. 2025), sensory neurons driven only by their receptors.
import { LIFNetwork, EXC_SIGN } from './lif.js';
import { regionSizeRef } from './ratenet.js';
import { isOctopaminergic } from './sim/neuromod.js';
export const BRAIN_DEFAULTS = { laminaBias: 9, kcThreshold: 0, wSyn: 0.3, sizeAlpha: 0.5, minSyn: 5, adaptInc: 0, depU: 0, maxSizeScale: 20, boostCap: 1 };
export function brainScales(data, size, opts = {}) {
  const o = { ...BRAIN_DEFAULTS, ...opts };
  const { ref, region } = regionSizeRef(data.meta.superclasses, data.superclass ?? data.sc, size);
  const N = data.N, inScale = new Float32Array(N), sensoryMask = new Uint8Array(N);
  const sc = data.superclass ?? data.sc, names = data.meta.superclasses;
  for (let i = 0; i < N; i++) {
    const s = size[i] > 0 ? Math.min(o.maxSizeScale, Math.max(1 / o.maxSizeScale, size[i] / ref[i])) : 1;
    inScale[i] = Math.min(o.boostCap, Math.pow(s, -o.sizeAlpha)) * (o.vncGain && region[i] === 2 ? o.vncGain : 1);
    sensoryMask[i] = /sensory/.test(names[sc[i]]) ? 1 : 0;
  }
  return { inScale, sensoryMask, region };
}
// Cell-class physiology that the uniform LIF misses (documented in PLAN.md):
//  Kenyon cells need coincident input from several PNs (high spike threshold; Turner et al. 2008, Gruntman & Turner 2013).
export function applyClassPhysiology(net, data, o) {
  const cls = data.cls, classes = data.meta.classes;
  //  Lamina monopolar cells (L1-L5) are graded neurons with a depolarised resting potential; histaminergic
  //  photoreceptor input hyperpolarises them (light) and releases them (dark), modelled as a tonic bias.
  const types = data.meta.types; const lam = [];
  for (let i = 0; i < data.N; i++) { if (classes[cls[i]] === 'Kenyon_Cell') net.setThr(i, o.kcThreshold); if (/^L[1-5]$/.test(types[i])) lam.push(i); }
  net.setBias(lam, o.laminaBias);
  return net;
}
// With neuromodulation on, octopaminergic neurons act only through slow release (src/sim/neuromod.js), so their
// fast synapses leave the graph. Returns a copy of the per-neuron sign array (or of the transmitter table's signs).
export function modulatorySign(data, preSign, o) {
  if (!o.neuromod) return preSign;
  // oaMode 'synFast' (spec S5): the OA neurons' fast synapses stay in the graph -- that operator's
  // postsynaptic action IS the chemical synapse, so there is no field to protect the graph from.
  if (o.oaMode === 'synFast') return preSign || Float32Array.from(data.nt, n => EXC_SIGN[n]);
  const types = data.meta.types, s = preSign ? Float32Array.from(preSign) : Float32Array.from(data.nt, n => EXC_SIGN[n]);
  for (let i = 0; i < data.N; i++) if (isOctopaminergic(types[i])) s[i] = 0;
  return s;
}
export function createBrain(data, size, opts = {}, preSign = null) {
  const o = { ...BRAIN_DEFAULTS, ...opts }; preSign = modulatorySign(data, o.gradedSign === false ? null : preSign, o);
  const { inScale, sensoryMask } = brainScales(data, size, o);
  return applyClassPhysiology(createLIF(data, o, inScale, sensoryMask, preSign), data, o);
}
function createLIF(data, o, inScale, sensoryMask, preSign) {
  return new LIFNetwork(data.N, data.indptr, data.indices, data.weights, data.nt, { ...o, inScale, sensoryMask, preSign, outScale: typeGains(data, o) });
}
// Pathway-specific synaptic scale factors: one multiplier per named cell type, applied to every outgoing
// synapse of the matching neurons (scripts/pathway_fit.mjs, doc 07). The optic-lobe model was fitted this
// way -- a parameter per cell type and per synapse class -- and the rest of the CNS had no equivalent.
// Key may be an exact type name or a regular expression source; a missing or empty table returns null so
// the graph build skips the multiply entirely.
export const PATHWAY_TYPES = {
  escape: ['T4a|T4b|T4c|T4d', 'T5a|T5b|T5c|T5d', 'LPLC2', 'LC4', 'DNp01', 'DNp02', 'DNp04'],
  feeding: ['LB3b|LB3c', 'GNG232', 'DNge080', 'MN9'],
};
// `classGain` is the same multiplier keyed on the annotated *class* rather than the cell type, for
// populations the release names collectively and that have no small set of type names -- the 420
// antennal-lobe local neurons are the case this exists for (docs/20-roadmap.md M3), where the
// quantity of interest is the strength of the lobe's lateral inhibition as a whole.
export function typeGains(data, o = {}) {
  const spec = o.typeGain, cspec = o.classGain;
  const keys = spec ? Object.keys(spec).filter(k => spec[k] !== 1) : [];
  const ckeys = cspec ? Object.keys(cspec).filter(k => cspec[k] !== 1) : [];
  // `neuronGainTable` deploys a fitted per-neuron readout (the stand_fit's logGain list, keyed by
  // connectome index) into the shipped kernel: outScale[i] *= exp(logGain_i). Named and killable --
  // the ledger entry is the artifact path, and removing the table removes the mechanism.
  const table = o.neuronGainTable;                    // { [origIdx]: logGain } or Float32Array
  if (!keys.length && !ckeys.length && !(o.neuronGain && o.neuronGain.sigma) && !table) return null;
  const types = data.meta.types, g = new Float32Array(data.N).fill(1);
  for (const k of keys) {
    const re = /[\\^$*+?()[\]{}|]/.test(k) ? new RegExp(`^(?:${k})$`) : null;
    for (let i = 0; i < data.N; i++) if (re ? re.test(types[i]) : types[i] === k) g[i] *= spec[k];
  }
  // `neuronGain` is an individual: a lognormal multiplier on every neuron's output, drawn from a seed.
  // It is the same quantity the per-neuron adjoint fit of doc 33 adjusts, and doc 34's C1 varies
  // between animals, so roadmap item M6 uses it to make simulated individuals that differ in exactly
  // the way the real experiment would have them differ. Given as {sigma, seed} rather than as an array
  // because it has to cross a fork boundary.
  if (o.neuronGain && o.neuronGain.sigma) {
    const { sigma, seed = 1 } = o.neuronGain;
    let a = (seed * 2654435761) | 0;
    const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < data.N; i++) {
      let u = rnd(); const v = rnd(); if (u <= 0) u = 1e-9;
      g[i] *= Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    }
  }
  if (ckeys.length) {
    const cls = data.cls, classes = data.meta.classes;
    for (let i = 0; i < data.N; i++) { const v = cspec[classes[cls[i]]]; if (v !== undefined) g[i] *= v; }
  }
  if (table) {
    if (ArrayBuffer.isView(table) || Array.isArray(table)) { for (let i = 0; i < data.N; i++) if (table[i]) g[i] *= Math.exp(table[i]); }
    else for (const k of Object.keys(table)) g[+k] *= Math.exp(table[k]);
  }
  return g;
}
