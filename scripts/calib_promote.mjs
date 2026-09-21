// Promote a search winner into public/data/brain_params.json.
//
// A CEM fit selects on one seed, so the score a search reports is not the score the model has. This
// re-scores the winner across N seeds and writes the honest mean alongside the selected score, plus
// the per-benchmark and per-term values averaged over the same seeds, and a provenance line. The
// audit block is derived here rather than typed by hand, which is what it was before: the previous
// file carried a `_benchmarks.score` that disagreed with its own `_score`, and a `kcJaccard` of 1
// that was the signature of the aliasing bug in doc 20 A7.
//
//   node scripts/calib_promote.mjs data/calib_best.json 12 1000
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const src = process.argv[2] || 'data/calib_best.json';
const N = +(process.argv[3] || 12), S0 = +(process.argv[4] || 1000);
const note = process.argv[5] || '';

const raw = JSON.parse(fs.readFileSync(src));
const selected = raw.s ?? raw.score;
const cfg = { ...(raw.cfg || raw) };
for (const k of Object.keys(cfg)) if (k[0] === '_') delete cfg[k];

const rows = [];
for (let i = 0; i < N; i++) {
  const txt = execFileSync('node', ['scripts/calib_eval.mjs', JSON.stringify({ ...cfg, seed: S0 + i })], { maxBuffer: 1e8 }).toString();
  const o = JSON.parse(txt.slice(0, txt.lastIndexOf('}') + 1));
  rows.push(o);
  console.log(`${S0 + i}  ${o.score.toFixed(4)}`);
}
if (rows.length === 0) throw new Error('no evaluations');
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const scores = rows.map(r => r.score);
const m = mean(scores);
const sd = Math.sqrt(scores.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1));
const round = x => typeof x === 'number' ? +x.toFixed(4) : x;

// Every numeric field the evaluator reports, except `terms`, is a benchmark; average it.
const bench = { score: round(m) };
for (const k of Object.keys(rows[0])) {
  if (k === 'terms' || k === 'score') continue;
  if (typeof rows[0][k] === 'number') bench[k] = round(mean(rows.map(r => r[k])));
}
const terms = {};
for (const k of Object.keys(rows[0].terms)) terms[k] = round(mean(rows.map(r => r.terms[k])));

const pinned = Object.keys(rows[0].terms).filter(k => rows.every(r => r.terms[k] === 0));
const prev = fs.existsSync('public/data/brain_params.json') ? JSON.parse(fs.readFileSync('public/data/brain_params.json')) : null;
const out = {
  ...cfg,
  _score: +selected.toFixed(4),
  _rescore: { mean: round(m), sem: round(sd / Math.sqrt(N)), n: N, note: `seeds ${S0}-${S0 + N - 1}; _score is selected on one seed and is not the model's score` },
  _benchmarks: bench,
  _terms: terms,
  _source: `scripts/calib_search.mjs: CEM, 20 gens x 24, neuromodulation on (fed OA tone); promoted by scripts/calib_promote.mjs${note ? '; ' + note : ''}`,
  // the scaffold switches are not a searched parameter; keep whatever the previous file had
  scaffolds: cfg.scaffolds ?? prev?.scaffolds ?? {},
};
fs.writeFileSync('public/data/brain_params.json', JSON.stringify(out, null, 1) + '\n');
console.log(`\nselected ${out._score}  honest ${out._rescore.mean} +- ${out._rescore.sem}  (n=${N})`);
if (prev?._rescore) console.log(`previous   ${prev._score}  honest ${prev._rescore.mean} +- ${prev._rescore.sem}`);
console.log('terms pinned at exactly 0 in every seed:', pinned.join(' ') || '(none)');
console.log('wrote public/data/brain_params.json');
