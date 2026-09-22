// Experiment spec: what the nerve cord does with the legs when its motor neurons drive them directly.
// (spec S8, docs/44-walking-compiler.md.)
//
// The fact this starts from: in connectome motor mode the 328 leg motor neurons fire, their rates
// become muscle activation, and the fly falls (doc 36). The gait instrument (src/exp/gait.js) now
// turns that fall into six numbers -- lift rate, stance fraction, left-right phase, tripod index,
// upright fraction, body height -- read off the same claws on the same body, and the same read on
// the supplied tripod generator (walk_cpg) is the positive control the instrument is calibrated on.
//
// The ensemble is the unmeasured part: which wiring (real, or its synapse counts permuted over the
// same topology -- the null arm doc 39's scramble result says must always run alongside), how
// strong premotor inhibition is (inhGain, the calibrated 0.577 against a stronger 1.0), and how
// strong the midline-crossing cord connections are (edges.commissural), which is the lever the
// sibling walking programme found first moves left-right phase.
//
// The perturbations remove one named cord mechanism each: the two GABAergic premotor hemilineages
// through which all leg antagonism runs in this animal (13A, 13B: Drosophila has no inhibitory leg
// motor neurons), the 19B hemilineage the sibling programme's alternation route acts through, the
// commissural class itself, and the footfall reafference cancel. The split rule asks whether the
// leg rhythm the cord produces dies with the mechanism while the legs that were stepping stop: a
// perturbation that kills is one the cord's rhythm depends on, and one that kills on the real
// wiring but not on the shuffled wiring is one the *wiring* carries.
//
// One assay seed (the ledger's calibrated seed 7) and a 2 x 2 x 2 grid: this is a BUILD-phase
// nomination, not an assertion. More seeds belong here once the standing baseline improves.
export default {
  id: 'walk-from-cord',
  backend: 'arena',
  question: 'Which cord mechanism carries the leg rhythm the motor neurons produce when they drive the legs directly, and does the real wiring carry it where a weight-shuffled wiring does not?',
  operators: ['cord.premotorInhibition', 'cord.commissural', 'reflex.footfallCancel'],
  ensemble: {
    params: ['wiring', 'inhGain', 'edges.commissural'],
    n: 8, seed: 8,
    axes: { wiring: ['real', 'weightShuffle'], inhGain: [0.577, 1.0], 'edges.commissural': [1, 3] },
  },
  edgeRules: {
    // every midline-crossing synapse between VNC intrinsic neurons (soma sides from the release)
    commissural: { pre: 'superclass:vnc_intrinsic', post: 'superclass:vnc_intrinsic', cross: 'contra' },
  },
  seeds: [7],
  perturbations: [
    { id: 'no_13A', kind: 'ablateType', target: 'hemilineage:13A' },
    { id: 'no_13B', kind: 'ablateType', target: 'hemilineage:13B' },
    { id: 'no_19B', kind: 'ablateType', target: 'hemilineage:19B' },
    { id: 'no_commissural', kind: 'scaleEdges', target: 'commissural', args: { factor: 0 } },
    { id: 'no_reafference', kind: 'offPlugin', target: 'reafference' },
  ],
  observables: [
    { id: 'cadence',      where: 'arena', measure: 'gait.cadence' },
    { id: 'legsStepping', where: 'arena', measure: 'gait.legsStepping' },
    { id: 'duty',         where: 'arena', measure: 'gait.duty' },
    { id: 'contraPhase',  where: 'arena', measure: 'gait.contraPhase' },
    { id: 'tripod',       where: 'arena', measure: 'gait.tripod' },
    { id: 'upright',      where: 'arena', measure: 'gait.upright' },
    { id: 'bodyHeightRel',where: 'arena', measure: 'gait.bodyHeightRel' },
    { id: 'speed',        where: 'arena', measure: 'gait.speed' },
    { id: 'loadRhythm',   where: 'arena', measure: 'gait.loadRhythm' },
    // the positive control: the same instrument on the supplied generator, under the same member
    { id: 'cpgCadence',   where: 'arena', measure: 'gait.cadence', args: { assay: 'walk_cpg' } },
    { id: 'cpgContra',    where: 'arena', measure: 'gait.contraPhase', args: { assay: 'walk_cpg' } },
  ],
  // the cord's leg rhythm dies with the mechanism: lift rate halves and fewer legs step
  splitRule: 'cadence < 0.5 * baseline.cadence && legsStepping < baseline.legsStepping',
};
