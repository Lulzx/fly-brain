// Experiment spec: which octopamine operator explains hunger-modulated locomotion? (spec S5.)
//
// status: pending — the OA operator family (threshold field, gain field, typed targets) and its
// rival-operators backend land with S5. Until then the compiler writes the pre-registered
// observables table with no measurements, so the experiment is on record and cannot quietly
// change shape before the machinery exists.
export default {
  id: 'oa-split',
  backend: 'arena',
  status: 'pending',
  question: 'Which octopamine operator — threshold field, gain field, or typed targets — explains hunger-modulated locomotion?',
  operators: ['oa.thrField', 'oa.gainField', 'oa.thrTyped'],
  ensemble: {
    params: ['oaLevel'],
    n: 32, seed: 5,
    axes: { oaLevel: [0, 0.25, 0.5, 0.75, 1.0] },
  },
  perturbations: [
    { id: 'oa_silence', kind: 'ablateType', target: 'OA' },
    { id: 'oa_gain_half', kind: 'scaleGain', target: 'oa', args: { param: 'oa', factor: 0.5 } },
  ],
  observables: [
    { id: 'starveDist', where: 'arena', measure: 'starveDist' },
    { id: 'walk', where: 'arena', measure: 'walkDist' },
  ],
  // the split S5 must produce: a rival that removes starvation-walk modulation while sparing
  // baseline gait is dead
  splitRule: 'starveDist < 0.5 * baseline.starveDist && walk > 0.5 * baseline.walk',
};
