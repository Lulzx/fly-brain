// Arm one of the substitution ladder, measured on behaviour instead of physiology (roadmap item A1).
//
// scripts/ablation_ladder.mjs replays every rung through the 17-assay physiological benchmark. The
// substitutions doc 16 treats as most informative -- posture, stepping, bout structure -- cannot break
// there, because they are supplied by machinery outside the connectome (docs/19-limitations.md). This
// runs the same rungs through the embodied arena instead, where those quantities are produced by a
// body reacting to a brain, and reports how much of the graph's contribution survives the scaffolding.
//
// The rung set is scripts/rungs.mjs, shared with the physiological ladder, so the two tables can be
// read against each other rung by rung. Comparisons are paired: every rung sees the same seeds as the
// baseline and the statistic is the mean per-seed difference with its standard error.
//
//   node scripts/behavior_ladder.mjs [seeds] [rung-regex]
//
// Writes public/data/behavior_ladder.json.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { RUNGS } from './rungs.mjs';

const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();

const N = +(process.argv[2] || 4), FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const NW = +(process.env.NW || 10);
const rungs = RUNGS.filter(r => r.key === 'baseline' || !FILTER || FILTER.test(r.key));
const SEEDS = [...Array(N)].map((_, i) => 1000 + i * 7919);

const jobs = rungs.flatMap(r => SEEDS.map(seed => ({ rung: r.key, seed, cfg: { ...BASE, ...r.patch, seed }, seeds: [seed] })));
console.log(`${rungs.length} rungs x ${N} seeds = ${jobs.length} embodied evaluations on ${NW} workers`);

const workers = [...Array(NW)].map(() => fork('scripts/behavior_eval.mjs'));
const out = new Array(jobs.length);
let next = 0, done = 0, failed = 0; const t0 = Date.now();
await new Promise(res => {
  const give = w => { if (next >= jobs.length) return; const id = next++;
    const onMsg = m => {
      out[id] = m; done++;
      if (m.error) { failed++; console.error(`\nFAIL ${jobs[id].rung} seed ${jobs[id].seed}: ${m.error.split('\n')[0]}`); }
      process.stdout.write(`\r${done}/${jobs.length} (${((Date.now() - t0) / 1000).toFixed(0)}s, eta ${(((Date.now() - t0) / Math.max(1, done)) * (jobs.length - done) / 1000).toFixed(0)}s)   `);
      done === jobs.length ? res() : give(w);
    };
    w.once('message', onMsg);
    w.send({ id, cfg: jobs[id].cfg, seeds: jobs[id].seeds }); };
  workers.forEach(give);
});
workers.forEach(w => w.kill());
console.log();

// ---- paired statistics -------------------------------------------------------------------------
const byRung = {};
out.forEach((m, i) => { if (m?.out) (byRung[jobs[i].rung] ||= {})[jobs[i].seed] = m.out; });
const TERMS = ['alive', 'flips', 'food', 'feed', 'bout', 'escape'];
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sem = a => a.length < 2 ? 0 : Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / (a.length - 1) / a.length);
const paired = (rung, pick) => { const d = [];
  for (const s of SEEDS) { const a = byRung[rung]?.[s], b = byRung.baseline[s]; if (a && b) d.push(pick(a) - pick(b)); }
  return d.length ? { d: +mean(d).toFixed(4), se: +sem(d).toFixed(4), n: d.length } : null; };

const BREAK = 0.1, SIG = 3;
const rows = rungs.map(r => {
  const runs = Object.values(byRung[r.key] || {});
  const scores = runs.map(o => o.score);
  const row = { ...r, n: runs.length, score: +mean(scores).toFixed(4), scoreSem: +sem(scores).toFixed(4) };
  if (runs.length) row.obs = Object.fromEntries(Object.keys(runs[0].obs).map(k => [k, +mean(runs.map(o => o.obs[k])).toFixed(4)]));
  if (r.key !== 'baseline' && runs.length) {
    row.dScore = paired(r.key, o => o.score);
    row.terms = Object.fromEntries(TERMS.map(t => [t, paired(r.key, o => o.terms[t])]));
    row.broke = TERMS.filter(t => { const p = row.terms[t]; return p && p.d <= -BREAK && -p.d >= SIG * Math.max(p.se, 1e-6); });
    row.improved = TERMS.filter(t => { const p = row.terms[t]; return p && p.d >= BREAK && p.d >= SIG * Math.max(p.se, 1e-6); });
  }
  return row;
});

// A filtered run measures only the rungs it was given. The rest are carried over from the previous file
// rather than dropped, so re-measuring one rung does not discard the table.
const prevFile = fs.existsSync('public/data/behavior_ladder.json') ? JSON.parse(fs.readFileSync('public/data/behavior_ladder.json')) : null;
const merged = [...rows, ...(prevFile?.rungs || []).filter(p => !rows.some(r => r.key === p.key))];
merged.sort((a, b) => RUNGS.findIndex(r => r.key === a.key) - RUNGS.findIndex(r => r.key === b.key));

const res = {
  _source: 'scripts/behavior_ladder.mjs (arm one, sensitivity at the fitted point)',
  generated: new Date().toISOString().slice(0, 10),
  baseParams: BASE, seeds: SEEDS, criterion: { break: BREAK, sigmas: SIG, statistic: 'paired per-seed difference vs baseline' },
  terms: TERMS, rungs: merged,
};
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/behavior_ladder.json', JSON.stringify(res, null, 1));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nbaseline score ${rows[0].score.toFixed(3)} +- ${rows[0].scoreSem.toFixed(3)} (n=${rows[0].n})\n`);
console.log(pad('rung', 18), pad('level', 11), pad('score', 8), pad('dScore', 16), 'behavioural terms that break');
for (const r of rows.slice(1)) {
  const d = r.dScore;
  console.log(pad(r.key, 18), pad(r.level, 11), pad(r.score.toFixed(3), 8),
    pad(d ? `${d.d >= 0 ? '+' : ''}${d.d.toFixed(3)} +- ${d.se.toFixed(3)}` : '-', 16),
    r.broke?.length ? r.broke.join(', ') : '(none)',
    r.improved?.length ? `[up: ${r.improved.join(', ')}]` : '');
}
console.log('\nwrote public/data/behavior_ladder.json');
if (failed) { console.error(`${failed} of ${jobs.length} evaluations failed and are missing from the table`); process.exit(1); }
