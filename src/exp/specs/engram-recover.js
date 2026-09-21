// Experiment spec: the engram harness — write a memory trace, lesion, and measure recovery.
// (spec S6.)
//
// status: pending — the engram harness backend (write/lesion/recover protocol on the mushroom
// body engram) lands with S6. Committed now so the experiment is pre-registered.
export default {
  id: 'engram-recover',
  backend: 'engram',
  status: 'pending',
  question: 'Does the engram recover learned odour-valence behaviour after partial lesion?',
  operators: ['engram.write', 'engram.lesion', 'engram.recover'],
  ensemble: {
    params: ['engramGain'],
    n: 16, seed: 8,
    axes: { engramGain: [0.5, 1.0, 1.5] },
  },
  perturbations: [
    { id: 'lesion_25', kind: 'ablateType', target: 'KC.25pct' },
    { id: 'lesion_50', kind: 'ablateType', target: 'KC.50pct' },
  ],
  observables: [
    { id: 'engramRecall', where: 'circuit', measure: 'engramRecall' },
    { id: 'approachFrac', where: 'arena', measure: 'approachFrac' },
  ],
  splitRule: 'engramRecall < 0.5 * baseline.engramRecall',
};
