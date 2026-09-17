// The substitution ladder as a measurement (docs/31-ablation-ladder.md, roadmap item 8).
//
// The calibrated whole-CNS model is the top of the ladder. Each rung below removes one level of
// description -- graded synaptic efficacy, the size-scaling of postsynaptic input, conductance-based
// synapses, short-term depression, axonal delay, neuromodulatory tone -- and re-scores the same
// 17-assay physiological benchmark (scripts/calib_eval.mjs). The question the table answers is not
// "does the score drop" but "which assays break, and is the drop larger than run-to-run noise".
//
// Comparisons are paired: every rung sees the same list of brain seeds as the baseline, and the
// statistic reported is the mean per-seed difference with its standard error, so a rung that moves
// the benchmark less than the seed noise is visible as such.
//
//   node scripts/ablation_ladder.mjs [seeds] [rung-regex]
//
// Writes public/data/ablation_ladder.json.
import { fork } from 'node:child_process';
import fs from 'node:fs';

const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();

// level: which rung of the ladder the removed quantity sits on. dir: 'drop' removes detail the fit
// uses, 'add' switches on detail the fit chose to leave off, 'control' is a manipulation that should
// break the benchmark (a floor) or leave it alone (a ceiling).
const RUNGS = [
  { key: 'baseline', level: 'calibrated', dir: '-', patch: {}, note: 'the fitted model of docs/07-calibration.md' },

  { key: 'w_binary', level: 'efficacy', dir: 'drop', patch: { wBinary: true },
    note: 'graded synapse counts replaced by their mean over retained edges: topology only' },
  { key: 'w_shuffle', level: 'efficacy', dir: 'control', patch: { wShuffle: true },
    note: 'same count distribution, permuted across retained edges: efficacy present but uninformative' },
  { key: 'minsyn_1', level: 'efficacy', dir: 'drop', patch: { minSyn: 1 },
    note: 'reconstruction threshold removed; every detected connection kept' },
  { key: 'minsyn_12', level: 'efficacy', dir: 'drop', patch: { minSyn: 12 },
    note: 'threshold doubled from the fitted 6 contacts' },
  { key: 'w_eb', level: 'efficacy', dir: 'swap', patch: { wEB: true, minSyn: 1 },
    note: 'empirical-Bayes weights from bilateral replicates (scripts/synapse_confidence.py), no threshold at all' },
  { key: 'w_eb_gated', level: 'efficacy', dir: 'swap', patch: { wEB: true, minSyn: 3 },
    note: 'empirical-Bayes weights with a light threshold, for comparison with the fitted 6-contact cut' },

  { key: 'no_size_scaling', level: 'cellular', dir: 'drop', patch: { sizeAlpha: 0 },
    note: 'per-neuron PSP scaling by relative volume removed' },
  { key: 'no_kc_threshold', level: 'cellular', dir: 'drop', patch: { kcThreshold: 0 },
    note: 'raised Kenyon-cell spike threshold removed' },
  { key: 'no_lamina_bias', level: 'cellular', dir: 'drop', patch: { laminaBias: 0 },
    note: 'tonic depolarisation of the graded lamina monopolar cells removed' },
  { key: 'lamina_bias_max', level: 'cellular', dir: 'control', patch: { laminaBias: 25 },
    note: 'lamina bias at the top of its search range: shows the parameter is not inert, only flat near the fit' },
  { key: 'cuba', level: 'cellular', dir: 'drop', patch: { coba: false },
    note: 'conductance-based synapses replaced by current-based ones' },
  { key: 'nominal_einh', level: 'cellular', dir: 'drop', patch: { eInh: -70 },
    note: 'fitted inhibitory reversal potential replaced by the nominal -70 mV' },
  { key: 'no_inh_gain', level: 'cellular', dir: 'drop', patch: { inhGain: 1 },
    note: 'fitted inhibitory weight scaling removed' },
  { key: 'no_refractory', level: 'cellular', dir: 'drop', patch: { tRef: 0.5 },
    note: 'refractory period reduced from the fitted 3.8 ms to one time step' },
  { key: 'add_depression', level: 'cellular', dir: 'add', patch: { depU: 0.2 },
    note: 'short-term presynaptic depression switched on at the model default; the fit chose to leave it off' },
  { key: 'no_delay', level: 'cellular', dir: 'drop', patch: { delay: 0.5 },
    note: 'axonal delay reduced from 1.8 ms to one time step' },
  { key: 'add_adaptation', level: 'cellular', dir: 'add', patch: { adaptInc: 2 },
    note: 'spike-frequency adaptation switched on; the fit chose to leave it off' },

  { key: 'no_neuromod', level: 'modulatory', dir: 'drop', patch: { neuromod: false },
    note: 'fed octopamine tone and the modulatory-synapse split removed' },

  { key: 'sign_free', level: 'control', dir: 'control', patch: { signFree: true },
    note: 'every neuron excitatory: the floor the benchmark must be able to detect' },
];

const N = +(process.argv[2] || 12), FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const NW = +(process.env.NW || 12);
const rungs = RUNGS.filter(r => r.key === 'baseline' || !FILTER || FILTER.test(r.key));
const SEEDS = [...Array(N)].map((_, i) => 1000 + i * 7919);

const jobs = rungs.flatMap(r => SEEDS.map(seed => ({ rung: r.key, seed, cfg: { ...BASE, ...r.patch, seed } })));
console.log(`${rungs.length} rungs x ${N} seeds = ${jobs.length} evaluations on ${NW} workers`);

const workers = [...Array(NW)].map(() => fork('scripts/calib_eval.mjs'));
const out = new Array(jobs.length);
let next = 0, done = 0, t0 = Date.now();
await new Promise(res => {
  const give = w => { if (next >= jobs.length) return; const id = next++;
    w.once('message', m => { out[id] = m; done++;
      if (m.error) console.error(`FAIL ${jobs[id].rung} seed ${jobs[id].seed}: ${m.error.split('\n')[0]}`);
      if (done % 10 === 0 || done === jobs.length) process.stdout.write(`\r${done}/${jobs.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)   `);
      done === jobs.length ? res() : give(w); });
    w.send({ id, cfg: jobs[id].cfg }); };
  workers.forEach(give);
});
workers.forEach(w => w.kill());
console.log();

// ---- paired statistics -------------------------------------------------------------------------
const byRung = {};
out.forEach((m, i) => { if (m?.out) (byRung[jobs[i].rung] ||= {})[jobs[i].seed] = m.out; });
const TERMS = Object.keys(byRung.baseline[SEEDS[0]].terms);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sem = a => a.length < 2 ? 0 : Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / (a.length - 1) / a.length);
const paired = (rung, pick) => { const d = [];
  for (const s of SEEDS) { const a = byRung[rung]?.[s], b = byRung.baseline[s]; if (a && b) d.push(pick(a) - pick(b)); }
  return d.length ? { d: +mean(d).toFixed(4), se: +sem(d).toFixed(4), n: d.length } : null; };

// A term counts as broken when the paired drop is at least 0.1 of its [0,1] range and at least
// three standard errors clear of zero -- large enough to matter, and not seed noise.
const BREAK = 0.1, SIG = 3;
const rows = rungs.map(r => {
  const runs = Object.values(byRung[r.key] || {});
  const scores = runs.map(o => o.score);
  const row = { ...r, n: runs.length, score: +mean(scores).toFixed(4), scoreSem: +sem(scores).toFixed(4) };
  if (r.key !== 'baseline') {
    row.dScore = paired(r.key, o => o.score);
    row.terms = Object.fromEntries(TERMS.map(t => [t, paired(r.key, o => o.terms[t])]));
    row.broke = TERMS.filter(t => { const p = row.terms[t]; return p && p.d <= -BREAK && -p.d >= SIG * Math.max(p.se, 1e-6); });
    row.improved = TERMS.filter(t => { const p = row.terms[t]; return p && p.d >= BREAK && p.d >= SIG * Math.max(p.se, 1e-6); });
  }
  return row;
});

const res = {
  _source: 'scripts/ablation_ladder.mjs',
  generated: new Date().toISOString().slice(0, 10),
  baseParams: BASE, seeds: SEEDS, criterion: { break: BREAK, sigmas: SIG, statistic: 'paired per-seed difference vs baseline' },
  terms: TERMS, rungs: rows,
};
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/ablation_ladder.json', JSON.stringify(res, null, 1));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nbaseline score ${rows[0].score.toFixed(3)} +- ${rows[0].scoreSem.toFixed(3)} (n=${rows[0].n})\n`);
console.log(pad('rung', 18), pad('level', 11), pad('score', 8), pad('dScore', 16), 'assays that break');
for (const r of rows.slice(1)) {
  const d = r.dScore;
  console.log(pad(r.key, 18), pad(r.level, 11), pad(r.score.toFixed(3), 8),
    pad(`${d.d >= 0 ? '+' : ''}${d.d.toFixed(3)} +- ${d.se.toFixed(3)}`, 16),
    r.broke.length ? r.broke.join(', ') : '(none)',
    r.improved.length ? `[up: ${r.improved.join(', ')}]` : '');
}
console.log('\nwrote public/data/ablation_ladder.json');
