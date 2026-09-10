// Calibrated whole-CNS spiking model (see PLAN.md "Brain model calibration").
// LIF (Shiu et al. 2024) + per-neuron PSP scaling by (volume / regional median volume)^-0.5,
// connections >= 5 synapses (Pugliese et al. 2025), sensory neurons driven only by their receptors.
import { LIFNetwork } from './lif.js';
import { regionSizeRef } from './ratenet.js';
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
  for (let i = 0; i < data.N; i++) { if (classes[cls[i]] === 'Kenyon_Cell') net.thr[i] = o.kcThreshold; if (/^L[1-5]$/.test(types[i])) lam.push(i); }
  net.setBias(lam, o.laminaBias);
  return net;
}
export function createBrain(data, size, opts = {}, preSign = null) {
  const o = { ...BRAIN_DEFAULTS, ...opts };
  const { inScale, sensoryMask } = brainScales(data, size, o);
  return applyClassPhysiology(createLIF(data, o, inScale, sensoryMask, preSign), data, o);
}
function createLIF(data, o, inScale, sensoryMask, preSign) {
  return new LIFNetwork(data.N, data.indptr, data.indices, data.weights, data.nt, { ...o, inScale, sensoryMask, preSign: o.gradedSign === false ? null : preSign });
}
