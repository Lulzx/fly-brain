// The per-neuron structure the calibrated model has, in the form src/lifdiff.js takes.
//
// scripts/calib_eval.mjs does not hand a bare connectome to the kernel. `makeBrain` builds it through
// four functions, and a differentiable model that skips them differentiates something else:
//
//   brainScales           size-based PSP scaling, and the sensory mask that gates driven neurons' inputs
//   applyClassPhysiology  Kenyon-cell spike threshold, lamina monopolar tonic bias
//   modulatorySign        with `neuromod` on, octopaminergic neurons lose their fast synapses (sign 0)
//   Neuromod(...)         and gain a static octopamine tone: OA cells and IPCs sit at a raised threshold
//                         for their fed firing rate, and every OA target sits at a lowered one
//
// This module calls those same four and returns what LIFDiff needs. Calling them rather than
// reimplementing them is the point: the two models cannot drift, because there is one definition.
//
// What each output is for, and whether it is fitted:
//
//   sizeLog     log of relative neuron volume; `sizeAlpha` scales it and IS fitted
//   thrMask     the Kenyon cells; `kcThreshold` applies to them and IS fitted
//   biasMask    the lamina monopolar cells; `laminaBias` applies to them and IS fitted
//   thrOffset   every other per-neuron threshold shift, in mV -- the octopamine tone, and the part of
//               the class physiology the two masks above do not carry. NOT fitted, and the kcThreshold
//               contribution is subtracted out of it so that parameter is not counted twice.
//   outScale    per-neuron multiplier on outgoing synapses, from `typeGain`. NOT fitted here, though
//               it is exactly what scripts/pathway_fit.mjs fits and what LIFDiff's per-neuron
//               `logGain` is the learnable version of: the two multiply.
//   sensoryMask neurons driven from outside, whose incoming connections carry nothing
//   preSign     per-neuron transmitter sign, with octopaminergic neurons zeroed when `neuromod` is on
//
// The one thing deliberately not carried over is Neuromod's *dynamics*. `Neuromod.update()` runs a
// hunger loop over seconds -- AKH, insulin, octopamine release following firing rate -- and makeBrain
// does not run it either: scripts/calib_eval.mjs calls `.modulate()` once, which freezes the fed
// steady state into the thresholds. That static tone is what `thrOffset` reproduces. A model fitted
// against a starved animal would need the loop, and the loop is differentiable in principle, but
// pretending the static version is the whole of neuromodulation would be the wrong claim to make here.
import { brainScales, applyClassPhysiology, modulatorySign, typeGains, BRAIN_DEFAULTS } from './brainmodel.js';
import { regionSizeRef } from './ratenet.js';
import { Neuromod } from './sim/neuromod.js';
import { EXC_SIGN } from './lif.js';

/**
 * @param data  connectome, as loadAll() returns it (needs N, indptr, indices, weights, nt, meta, sc, cls)
 * @param size  per-neuron volume (public/data/neuron_size.bin)
 * @param opts  the model parameters, e.g. brain_params.json over BRAIN_DEFAULTS
 * @param preSign optional per-neuron transmitter sign (public/data/ntsign.bin); the table is used if absent
 * @returns options to spread into `new LIFDiff(data, { ...opts, ...diffOptions(...) })`
 */
export function diffOptions(data, size, opts = {}, preSign = null) {
  const o = { ...BRAIN_DEFAULTS, ...opts };
  const N = data.N;
  const sc = data.superclass ?? data.sc, types = data.meta.types, classes = data.meta.classes;

  // --- size scaling. LIFDiff wants log(s), where brainScales wants s; both then raise it to -sizeAlpha,
  // so this is the same quantity expressed for a parameter that is going to be differentiated.
  const { ref } = regionSizeRef(data.meta.superclasses, sc, size);
  const sizeLog = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = size[i] > 0 ? Math.min(o.maxSizeScale, Math.max(1 / o.maxSizeScale, size[i] / ref[i])) : 1;
    sizeLog[i] = Math.log(s);
  }
  const { sensoryMask } = brainScales(data, size, o);

  // --- the two fitted masks
  const thrMask = new Uint8Array(N), biasMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (classes[data.cls[i]] === 'Kenyon_Cell') thrMask[i] = 1;
    if (/^L[1-5]$/.test(types[i])) biasMask[i] = 1;
  }

  // --- thresholds. A shim standing in for the LIFWasm network, so applyClassPhysiology and Neuromod
  // can write into it exactly as they write into the real one. Neuromod reads `thr` and `spikeCount`
  // and writes through `setThr`; the build-time call touches nothing else.
  const shim = {
    thr: new Float32Array(N), bias: new Float32Array(N), spikeCount: new Uint32Array(N),
    setThr(i, mv) { this.thr[i] = mv; },
    setBias(ix, mv) { for (const i of ix) this.bias[i] = mv; },
    addG() {},
  };
  applyClassPhysiology(shim, data, o);
  if (o.neuromod) new Neuromod(data, shim, { minSyn: o.minSyn }).modulate();
  // thrOffset carries everything except the fitted kcThreshold, which thrMask already applies. A Kenyon
  // cell that is also an octopamine target ends up at kcThreshold - shift either way.
  const thrOffset = new Float32Array(N);
  for (let i = 0; i < N; i++) thrOffset[i] = shim.thr[i] - (thrMask[i] ? o.kcThreshold : 0);

  // --- outgoing gains, and the sign removal that `neuromod` implies
  const outScale = typeGains(data, o);
  const sign = modulatorySign(data, preSign || Float32Array.from(data.nt, n => EXC_SIGN[n]), o);

  return { sizeLog, thrMask, biasMask, thrOffset, outScale, sensoryMask, preSign: sign };
}

/** What the setup changed, for a script that wants to say so out loud. */
export function diffSummary(d) {
  let thr = 0, gains = 0, silenced = 0;
  for (let i = 0; i < d.thrOffset.length; i++) if (d.thrOffset[i] !== 0) thr++;
  if (d.outScale) for (let i = 0; i < d.outScale.length; i++) if (d.outScale[i] !== 1) gains++;
  for (let i = 0; i < d.preSign.length; i++) if (d.preSign[i] === 0) silenced++;
  return { thrShifted: thr, typeGained: gains, signZeroed: silenced,
    sensory: d.sensoryMask.reduce((a, b) => a + b, 0) };
}
