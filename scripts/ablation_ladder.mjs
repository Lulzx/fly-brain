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
import { RUNGS } from './rungs.mjs';

const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();


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
