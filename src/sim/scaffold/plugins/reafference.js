// Scaffold plugin: reafference cancellation of self-generated sensation.
//
// Two channels, one claim: what the animal feels because it moved is predicted and removed.
//
//   1. footfall (pre-S3): the stepping generator's efference copy presynaptically inhibits tarsal
//      afferents during self-generated steps, so footfalls are not mistaken for external touch
//      (docs/10-senses.md). A scalar gain where the tactile burst is written, via cancel().
//   2. visual (spec S3): a learned forward model predicts the reafferent drive of the loom pathway
//      (LC4, LPLC2, DNp02, DNp04, DNp01) from descending readouts and leg proprioception, and
//      subtracts it through the membrane's bias channel (src/vision/cancel.js). Fitted by
//      scripts/reafference_fit.mjs; the weights arrive as params.model (public/data/reafference.json).
//      With no model loaded the channel is inert -- an unfitted forward model predicts nothing.
//
// Off: footfalls arrive at full strength mid-step, and self-motion optic flow reaches the loom
// pathway uncancelled -- the false-alarm regime escapeGate papers over.
import { SelfMotionCancel } from '../../../vision/cancel.js';
export function create() {
  return {
    id: 'reafference',
    title: 'Reafference cancel: footfall gain + learned self-motion visual subtract',
    claim: 'Without it, every step reports its own footfall as external touch, and self-motion optic flow reaches the loom pathway unattenuated.',
    files: ['src/sim/senses.js', 'src/vision/cancel.js'],
    defaultOn: true,
    params: { reafference: 0.85,   // fraction of the footfall touch signal cancelled while stepping
      model: null },               // fitted forward model (public/data/reafference.json), null = inert
    setup() { this._cancel = this.params.model ? new SelfMotionCancel(this.params.model) : null; },
    step() {},
    /** tactile burst attenuation: returns the signal after reafference cancellation */
    cancel(burst, stepping) { return burst * (1 - this.params.reafference * stepping); },
    /** visual reafference: subtract predicted self-motion drive from the loom pathway's membrane */
    visual(fly, st) { this._cancel?.apply(fly, st, 1); },
    readout() { return { reafference: this.params.reafference, model: !!this._cancel }; },
  };
}
