// Experiment spec: does the escape gate suppress self-motion false alarms without blunting the
// real loom response? (spec S3's question, encoded ahead of the learned operator.)
//
// The escapeGate plugin vetoes loom triggers near walls, pivots and grooming by rule. Its two
// window parameters are the unmeasured gains: too short and self-motion looms through, too long
// and real looms are suppressed too. The ensemble sweeps the windows; the perturbations remove
// the gate, the reafference channel, and the jump program itself; the split rule wants a kill
// that removes the loom escape while sparing the gait — that is what separates a self-motion
// mechanism from locomotion machinery.
export default {
  id: 'loom-vs-gait',
  backend: 'arena',
  question: 'Does the escape gate suppress self-motion false alarms without blunting the real loom response?',
  operators: ['gate.ruleVeto', 's3.selfMotionCancel'],
  ensemble: {
    params: ['scaffold.escapeGate.touchMs', 'scaffold.escapeGate.pivotMs'],
    n: 9, seed: 5,
    axes: { 'scaffold.escapeGate.touchMs': [200, 500, 1000], 'scaffold.escapeGate.pivotMs': [100, 300, 600] },
  },
  // loom_disk escapes are binary per seed — of the ledger's four seeds only 1000 produces a
  // jump at all (scaffold_ledger.json, loomEscape 0.25). The experiment is conditional on the
  // pathway firing: it asks what a perturbation does to an escape that exists. That is a
  // documented limitation, not a calibration — more seeds belong here once they exist.
  seeds: [1000],
  perturbations: [
    { id: 'gate_off', kind: 'offPlugin', target: 'escapeGate' },
    { id: 'reafference_off', kind: 'offPlugin', target: 'reafference' },
    { id: 'jump_off', kind: 'offPlugin', target: 'escapeJump' },
  ],
  observables: [
    { id: 'loomEscape', where: 'arena', measure: 'loomEscape' },
    { id: 'walk', where: 'arena', measure: 'walkDist' },
    // the false-alarm read: jumps with no loom present. gate_off should raise this if the gate
    // is really suppressing self-motion triggers rather than the loom pathway itself
    { id: 'forageJumps', where: 'arena', measure: 'forageJumps' },
  ],
  // a self-motion operator is dead when the loom escape collapses while walking survives
  splitRule: 'loomEscape < 0.5 * baseline.loomEscape && walk > 0.5 * baseline.walk',
};
