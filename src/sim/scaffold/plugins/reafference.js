// Scaffold plugin: reafference cancellation of self-generated touch.
//
// The stepping generator's efference copy presynaptically inhibits tarsal afferents during
// self-generated steps, so footfalls are not mistaken for external touch (docs/10-senses.md).
// It is a scalar gain applied where the tactile burst is written, not a circuit: the real
// mechanism is an identified forward model, which is roadmap item S3 and this plugin's stated
// upgrade path. Off: tarsal bristle bursts reach the brain at full strength even mid-step.
//
// Registered on the Senses host; the domain hook is cancel(), called per leg inside
// Senses.update. step() exists to satisfy the interface.
export function create() {
  return {
    id: 'reafference',
    title: 'Footfall reafference gain',
    claim: 'Without it, every step reports its own footfall as external touch.',
    files: ['src/sim/senses.js'],
    defaultOn: true,
    params: { reafference: 0.85 },   // fraction of the footfall touch signal cancelled while stepping
    setup() {},
    step() {},
    /** tactile burst attenuation: returns the signal after reafference cancellation */
    cancel(burst, stepping) { return burst * (1 - this.params.reafference * stepping); },
    readout() { return { reafference: this.params.reafference }; },
  };
}
