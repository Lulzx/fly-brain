// Experiment spec: does the animal respond to real perturbations the way the fly did? (spec S9,
// docs/44-walking-compiler.md.)
//
// The objective here is not "walk" but the response battery (src/exp/responses.js): for each real
// experiment with a measured behavioural change, a perturbation that stands in for it, an
// observable that reads the behaviour, and the battery row's comparator. A member that matches
// every animal row shares the animal's causal structure on those experiments, whether or not
// anyone has named the mechanism.
//
// Site. The bindings run on the generator site (walk_cpg, rest_cpg): the descending readout decides
// whether and how fast to walk and the supplied tripod generator executes it. That tests the
// connectome's *decision* -- the part it supplies today (docs/guide/what-the-wiring-gives.md) --
// not the cord's stepping. The same bindings apply to walk_cx once the cord stands (doc 44); on
// the generator site the decapitation row is satisfied by construction and says so in the battery.
//
// Bindings are homology hypotheses and are recorded as such:
//   MDN            the four annotated MDN cells, driven tonically at 40 mV bias
//   DNg100 dose    the two BDN2/DNg100 cells at 40, 80, 160 mV, on top of the scheduler's own walking
//                  drive to the same cells (the scheduler holds a walking bout on walk_cpg). The
//                  embodied DNs sit in a high-conductance state (docs/23): the first run's 10/20/40
//                  mV reached 2.5/4.5/28 Hz on the real wiring, no dose at all; driveHz is the check
//   13B            the whole 13B hemilineage (439 cells, both sides) at 20 mV, tonic for the whole
//                  assay; Agrawal's driver covers a 13B subset and pulses 720 ms
//   decapitation   every head superclass silenced (group:brain), the cord and its afferents live, on
//                  the rest site: a decapitated fly has no scheduler either
//   no command     the two forward command types (DNg100, DNg97) silenced under the scheduler's
//                  walking bout: the command is delivered and cannot leave
//   DNg93, DNge036 the sibling programme's two predictions, driven on the rest site at 80 mV (DNg93,
//                  GABA-predicted, reached 1 Hz at 40 mV on the real wiring)
//
// Ensemble: wiring (real, weight-shuffled) x inhGain (calibrated, 1.0). The shuffle arm is the
// control the objective is meant to defeat: a wiring with the same topology and permuted counts
// should not reproduce the animal's responses. One assay seed; a nomination.
export default {
  id: 'respond-like-the-fly',
  backend: 'arena',
  question: 'Which ensemble members respond to the real perturbation experiments the way the animal did, and does the real wiring match rows the weight-shuffled wiring does not?',
  operators: ['readout.descending', 'cord.premotorInhibition', 'cmd.MDN', 'cmd.BDN2'],
  ensemble: {
    params: ['wiring', 'inhGain'],
    n: 4, seed: 9,
    axes: { wiring: ['real', 'weightShuffle'], inhGain: [0.577, 1.0] },
  },
  seeds: [7],
  perturbations: [
    { id: 'mdn_on',      kind: 'driveType', target: 'type:MDN',          args: { mv: 40 } },
    { id: 'dng100_40',   kind: 'driveType', target: 'type:DNg100',       args: { mv: 40 } },
    { id: 'dng100_80',   kind: 'driveType', target: 'type:DNg100',       args: { mv: 80 } },
    { id: 'dng100_160',  kind: 'driveType', target: 'type:DNg100',       args: { mv: 160 } },
    { id: 'b13_on',      kind: 'driveType', target: 'hemilineage:13B',   args: { mv: 20 } },
    { id: 'headless',    kind: 'ablateType', target: 'group:brain' },
    { id: 'cmd_silenced',kind: 'ablateType', target: 'regex:^DNg(100|97)$' },
    { id: 'dng93_on',    kind: 'driveType', target: 'type:DNg93',        args: { mv: 80 } },
    { id: 'dnge036_on',  kind: 'driveType', target: 'type:DNge036',      args: { mv: 80 } },
  ],
  observables: [
    // the walking site
    { id: 'forward',      where: 'arena', measure: 'gait.forward' },
    { id: 'speed',        where: 'arena', measure: 'gait.speed' },
    { id: 'cadence',      where: 'arena', measure: 'gait.cadence' },
    { id: 'backFrac',     where: 'arena', measure: 'gait.backFrac' },
    { id: 'upright',      where: 'arena', measure: 'gait.upright' },
    { id: 'displacement', where: 'arena', measure: 'gait.displacement' },
    { id: 'driveHz',      where: 'arena', measure: 'driveHz' },
    // the rest site: no scheduler, the descending neurons get only senses and the spec's drive
    { id: 'restSpeed',    where: 'arena', measure: 'gait.speed',   args: { assay: 'rest_cpg' } },
    { id: 'restUpright',  where: 'arena', measure: 'gait.upright', args: { assay: 'rest_cpg' } },
    { id: 'restDisplacement', where: 'arena', measure: 'gait.displacement', args: { assay: 'rest_cpg' } },
    { id: 'restDriveHz',  where: 'arena', measure: 'driveHz',      args: { assay: 'rest_cpg' } },
  ].map(o => o.args ? o : { ...o, args: { assay: 'walk_cpg' } }),
  responses: [
    { id: 'mdn_backward',       row: 'mdn_backward',       observable: 'forward',      perturbations: ['mdn_on'] },
    { id: 'dng100_dose',        row: 'dng100_dose',        observable: 'speed',        perturbations: ['dng100_40', 'dng100_80', 'dng100_160'] },
    { id: 'b13_slowdown',       row: 'b13_slowdown',       observable: 'speed',        perturbations: ['b13_on'] },
    { id: 'decapitated_stands', row: 'decapitated_stands', observable: 'restDisplacement', perturbations: ['headless'] },
    { id: 'no_command_stands',  row: 'no_command_stands',  observable: 'speed',        perturbations: ['cmd_silenced'] },
    { id: 'dng93_stop',         row: 'dng93_stop',         observable: 'speed',        perturbations: ['dng93_on'] },
    { id: 'dnge036_walks',      row: 'dnge036_walks',      observable: 'restSpeed',    perturbations: ['dnge036_on'] },
  ],
  // a member is "split" when the walking command's own read collapses: kept so the ranking still
  // carries the perturbations as experiments beside the response rows
  splitRule: 'speed < 0.5 * baseline.speed',
};
