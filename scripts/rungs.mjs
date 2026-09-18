// The substitution ladder's rungs, shared by the physiological sweep (scripts/ablation_ladder.mjs)
// and the behavioural one (scripts/behavior_ladder.mjs) so the two tables describe the same
// substitutions and can be read against each other.
//
// level: which rung of the ladder the removed quantity sits on. dir: 'drop' removes detail the fit
// uses, 'add' switches on detail the fit chose to leave off, 'control' is a manipulation that should
// break the benchmark (a floor) or leave it alone (a ceiling).
//
// frozen: the search parameters the substitution itself pins, which the refit (scripts/ablation_refit.mjs)
// must therefore drop from its search space -- otherwise it would simply restore the removed quantity and
// measure nothing. Any rung that pins a parameter needs an entry here.
export const RUNGS = [
  { key: 'baseline', level: 'calibrated', dir: '-', patch: {}, frozen: [], note: 'the fitted model of docs/07-calibration.md' },

  { key: 'w_binary', level: 'efficacy', dir: 'drop', patch: { wBinary: true }, frozen: [],
    note: 'graded synapse counts replaced by their mean over retained edges: topology only' },
  { key: 'w_shuffle', level: 'efficacy', dir: 'control', patch: { wShuffle: true }, frozen: [],
    note: 'same count distribution, permuted across retained edges: efficacy present but uninformative' },
  { key: 'minsyn_1', level: 'efficacy', dir: 'drop', patch: { minSyn: 1 }, frozen: ['minSyn'],
    note: 'reconstruction threshold removed; every detected connection kept' },
  { key: 'minsyn_12', level: 'efficacy', dir: 'drop', patch: { minSyn: 12 }, frozen: ['minSyn'],
    note: 'threshold doubled from the fitted 6 contacts' },
  { key: 'w_eb', level: 'efficacy', dir: 'swap', patch: { wEB: true, minSyn: 1 }, frozen: ['minSyn'],
    note: 'empirical-Bayes weights from bilateral replicates (scripts/synapse_confidence.py), no threshold at all' },
  { key: 'w_eb_gated', level: 'efficacy', dir: 'swap', patch: { wEB: true, minSyn: 3 }, frozen: ['minSyn'],
    note: 'empirical-Bayes weights with a light threshold, for comparison with the fitted 6-contact cut' },

  { key: 'no_size_scaling', level: 'cellular', dir: 'drop', patch: { sizeAlpha: 0 }, frozen: ['sizeAlpha'],
    note: 'per-neuron PSP scaling by relative volume removed' },
  { key: 'no_kc_threshold', level: 'cellular', dir: 'drop', patch: { kcThreshold: 0 }, frozen: ['kcThreshold'],
    note: 'raised Kenyon-cell spike threshold removed' },
  { key: 'no_lamina_bias', level: 'cellular', dir: 'drop', patch: { laminaBias: 0 }, frozen: ['laminaBias'],
    note: 'tonic depolarisation of the graded lamina monopolar cells removed' },
  { key: 'lamina_bias_max', level: 'cellular', dir: 'control', patch: { laminaBias: 25 }, frozen: ['laminaBias'],
    note: 'lamina bias at the top of its search range: shows the parameter is not inert, only flat near the fit' },
  { key: 'cuba', level: 'cellular', dir: 'drop', patch: { coba: false }, frozen: [],
    note: 'conductance-based synapses replaced by current-based ones' },
  { key: 'nominal_einh', level: 'cellular', dir: 'drop', patch: { eInh: -70 }, frozen: ['eInh'],
    note: 'fitted inhibitory reversal potential replaced by the nominal -70 mV' },
  { key: 'no_inh_gain', level: 'cellular', dir: 'drop', patch: { inhGain: 1 }, frozen: ['inhGain'],
    note: 'fitted inhibitory weight scaling removed' },
  { key: 'no_refractory', level: 'cellular', dir: 'drop', patch: { tRef: 0.5 }, frozen: ['tRef'],
    note: 'refractory period reduced from the fitted 3.8 ms to one time step' },
  { key: 'add_depression', level: 'cellular', dir: 'add', patch: { depU: 0.2 }, frozen: [],
    note: 'short-term presynaptic depression switched on at the model default; the fit chose to leave it off' },
  { key: 'no_delay', level: 'cellular', dir: 'drop', patch: { delay: 0.5 }, frozen: [],
    note: 'axonal delay reduced from 1.8 ms to one time step' },
  { key: 'add_adaptation', level: 'cellular', dir: 'add', patch: { adaptInc: 2 }, frozen: ['adaptInc'],
    note: 'spike-frequency adaptation switched on; the fit chose to leave it off' },

  { key: 'no_neuromod', level: 'modulatory', dir: 'drop', patch: { neuromod: false }, frozen: [],
    note: 'fed octopamine tone and the modulatory-synapse split removed' },

  { key: 'sign_free', level: 'control', dir: 'control', patch: { signFree: true }, frozen: [],
    note: 'every neuron excitatory: the floor the benchmark must be able to detect' },
];
