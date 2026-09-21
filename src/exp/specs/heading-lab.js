// Experiment spec: the heading-circuit hypothesis lab, encoded for the compiler (spec S7.3).
// This is scripts/hypothesis_lab.mjs as data — the ensemble axes, perturbations, observables and
// split rule are declarative; the circuit backend (src/exp/backends/heading.js) shares its
// machinery with the script so the two cannot drift apart.
export default {
  id: 'heading-lab',
  backend: 'heading',
  question: 'Which dynamical model does the heading-circuit wiring actually support?',
  operators: ['epg.recurrence', 'd7.kernel', 'epg.tonic', 'pen.push'],
  ensemble: {
    // the unmeasured gains: recurrence strength, kernel gain, tonic excitability, push gain
    params: ['epgRecur', 'd7Gain', 'epgTonic', 'penGain'],
    n: 48, seed: 20260704,
    axes: { epgRecur: [1, 3, 4, 6], d7Gain: [0.5, 1.0, 1.3], epgTonic: [0, 3, 5, 7], penGain: [1] },
  },
  perturbations: [
    { id: 'd7_silence', kind: 'ablateType', target: 'Delta7' },
    { id: 'peg_lesion', kind: 'ablateType', target: 'PEG' },
  ],
  observables: [
    { id: 'persistence', where: 'circuit', measure: 'bumpPersistence' },
    { id: 'kernel', where: 'circuit', measure: 'd7Kernel' },
    { id: 'rotL', where: 'circuit', measure: 'penRotation:L' },
    { id: 'rotR', where: 'circuit', measure: 'penRotation:R' },
  ],
  // an operator that holds the bump up is dead if persistence collapses under the perturbation
  splitRule: 'persistence.concentration < 0.5 * baseline.persistence.concentration',
};
