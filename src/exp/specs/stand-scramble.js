// Experiment spec: what does standing actually need? (spec S2's scramble, encoded ahead of the
// premotor fitter.)
//
// The graph-only animal "stands" perfectly because nothing drives it to move — the upright
// fraction alone cannot split mechanisms. The ensemble therefore varies the two motor gains the
// stand assay plausibly depends on (leg pivot amplitude, steering leak), and the perturbations
// kill the pattern generator, the righting reflex, and the steering adaptation — the named
// scaffolds — plus the future premotor-scramble operator (recorded as unimplemented until S2's
// subgraph exists; the ledger keeps it visible instead of silently dropping it).
export default {
  id: 'stand-scramble',
  backend: 'arena',
  question: 'Which scaffolds does standing need — and does scrambling the premotor graph destroy what the CPG supplies?',
  operators: ['vnc.posture', 'cpg.pattern'],
  ensemble: {
    params: ['scaffold.cpg.pivotAmp', 'scaffold.steeringAdapt.turnAdaptTau'],
    n: 9, seed: 2,
    axes: { 'scaffold.cpg.pivotAmp': [0.05, 0.1, 0.2], 'scaffold.steeringAdapt.turnAdaptTau': [0.3, 1.0, 3.0] },
  },
  // seed 7 is the seed the behavioural ladder calibrates on — the fly actually forages there.
  // A quiescent seed makes the stand assay degenerate (passive uprightness, nothing to kill).
  seeds: [7],
  perturbations: [
    { id: 'cpg_off', kind: 'offPlugin', target: 'cpg' },
    { id: 'righting_off', kind: 'offPlugin', target: 'rightingReflex' },
    { id: 'steering_off', kind: 'offPlugin', target: 'steeringAdapt' },
    { id: 'premotor_scramble', kind: 'swapCompartment', target: 'vnc_premotor' },
  ],
  observables: [
    { id: 'standUpright', where: 'arena', measure: 'standUpright' },
    { id: 'walk', where: 'arena', measure: 'walkDist' },
  ],
  // a posture operator is dead when uprightness collapses; walking is the spare check
  splitRule: 'standUpright < 0.5 * baseline.standUpright',
};
