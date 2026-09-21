// Experiment ranking (spec S7): which perturbation splits the ensemble hardest.
//
// rankExperiments scores each experiment by the fraction of member pairs it places in different
// outcome classes — the measurement that would most inform the biology ranks first. The function
// itself lives in scripts/lif_ensemble.mjs alongside the ensemble machinery it was built for; this
// is the import surface the compiler uses, so the scoring rule has exactly one implementation.
export { rankExperiments } from '../../scripts/lif_ensemble.mjs';
