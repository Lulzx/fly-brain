// Second arm of the substitution ladder: does the benchmark recover if the model is refitted?
//
// scripts/ablation_ladder.mjs removes one level of description and re-scores at the fitted operating
// point. That measures sensitivity, not sufficiency: a mechanism whose removal costs 0.2 may be fully
// compensable by the other eight global parameters. Here each ablation is refitted -- the same
// cross-entropy search as scripts/calib_search.mjs, over the parameters the ablation leaves free --
// and the recovered score is reported against the baseline refitted the same way.
//
// A rung is *necessary* only if the refit fails to recover it. A rung that recovers was never
// load-bearing; it was a coordinate the fit happened to be using.
//
// Search is run at a single fixed seed so the objective is deterministic (CEM on a noisy score
// chases lucky seeds). The winner is then re-scored across the ladder's 12 seeds, and that averaged
// score is what the table reports.
//
//   node scripts/ablation_refit.mjs [gens] [pop] [rung-regex]
//
// Writes public/data/ablation_refit.json.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { RUNGS } from './rungs.mjs';

const SPACE = {   // identical to scripts/calib_search.mjs
  wSyn: [0.2, 1.2, 'log'], sizeAlpha: [0, 1, 'lin'], kcThreshold: [0, 30, 'lin'], inhGain: [0.5, 5, 'log'],
  eInh: [-85, -55, 'lin'], minSyn: [3, 10, 'int'], adaptInc: [0, 3, 'lin'], tRef: [2, 6, 'lin'], laminaBias: [0, 25, 'lin'],
};
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();

const GENS = +(process.argv[2] || 10), POP = +(process.argv[3] || 16);
const FILTER = process.argv[4] ? new RegExp(process.argv[4]) : null;
const NW = +(process.env.NW || 12), FIT_SEED = 1000;
const SEEDS = [...Array(12)].map((_, i) => 1000 + i * 7919);   // same seeds as ablation_ladder.mjs
// A filter restricts the run to the rungs it matches. Baseline is only forced in for a full run: a
// filtered run re-uses the baseline already in the file, so that adding rungs later cannot shift every
// gap in the table by re-drawing one number from `Math.random`.
const rungs = FILTER ? RUNGS.filter(r => FILTER.test(r.key)) : RUNGS;

const workers = [...Array(NW)].map(() => fork('scripts/calib_eval.mjs'));
const evalAll = cfgs => new Promise(res => { const out = new Array(cfgs.length); let next = 0, done = 0;
  const give = w => { if (next >= cfgs.length) return; const id = next++;
    w.once('message', m => { out[id] = m; done++; done === cfgs.length ? res(out) : give(w); });
    w.send({ id, cfg: cfgs[id] }); };
  workers.forEach(give); });
const gauss = () => { const u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

async function refit(rung) {
  const keys = Object.keys(SPACE).filter(k => !rung.frozen.includes(k));
  const toU = (k, v) => { const [lo, hi, sc] = SPACE[k]; return sc === 'log' ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo); };
  const fromU = (k, u) => { const [lo, hi, sc] = SPACE[k]; u = Math.min(1, Math.max(0, u));
    const v = sc === 'log' ? lo * Math.pow(hi / lo, u) : lo + u * (hi - lo); return sc === 'int' ? Math.round(v) : +v.toFixed(3); };
  const start = { ...BASE, ...rung.patch };
  let mu = keys.map(k => toU(k, start[k] ?? { adaptInc: 0, laminaBias: 9, kcThreshold: 10, minSyn: 5, tRef: 3, wSyn: 0.5, sizeAlpha: 0.4, inhGain: 1.2, eInh: -70 }[k]));
  let sd = keys.map(() => 0.25), best = null;
  const build = u => ({ ...BASE, ...Object.fromEntries(keys.map((k, i) => [k, fromU(k, u[i])])), ...rung.patch, seed: FIT_SEED });
  for (let g = 0; g < GENS; g++) {
    const U = [...Array(POP)].map((_, n) => n === 0 ? (best ? best.u : mu.slice()) : mu.map((m, i) => m + sd[i] * gauss()));
    const res = await evalAll(U.map(build));
    const scored = res.map((r, i) => ({ u: U[i].map(x => Math.min(1, Math.max(0, x))), s: r.error ? -1 : r.out.score, cfg: r.cfg }))
      .sort((a, b) => b.s - a.s);
    if (!best || scored[0].s > best.s) best = scored[0];
    const elite = scored.slice(0, Math.max(4, POP >> 2));
    mu = keys.map((_, i) => elite.reduce((a, e) => a + e.u[i], 0) / elite.length);
    sd = keys.map((_, i) => Math.max(0.04, Math.sqrt(elite.reduce((a, e) => a + (e.u[i] - mu[i]) ** 2, 0) / elite.length)));
    process.stdout.write(`\r  ${rung.key} gen ${g + 1}/${GENS} best ${best.s.toFixed(3)}   `);
  }
  // honest score: the winner re-run across every ladder seed, not the single seed it was selected on
  const cfg = { ...best.cfg }; delete cfg.seed;
  const runs = (await evalAll(SEEDS.map(seed => ({ ...cfg, seed })))).filter(m => m.out).map(m => m.out);
  return { cfg, fitSeedScore: best.s, runs };
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sem = a => a.length < 2 ? 0 : Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / (a.length - 1) / a.length);

console.log(`refitting ${rungs.length} rungs: CEM ${GENS} gens x ${POP}, then 12-seed re-score`);
const results = {};
for (const r of rungs) { const t0 = Date.now(); results[r.key] = await refit(r);
  console.log(`\r  ${r.key.padEnd(18)} refit ${mean(results[r.key].runs.map(o => o.score)).toFixed(3)}  (${((Date.now() - t0) / 1000).toFixed(0)}s)          `); }
workers.forEach(w => w.kill());

const ladder = fs.existsSync('public/data/ablation_ladder.json') ? JSON.parse(fs.readFileSync('public/data/ablation_ladder.json')) : null;
const prevFile = fs.existsSync('public/data/ablation_refit.json') ? JSON.parse(fs.readFileSync('public/data/ablation_refit.json')) : null;
const prev = new Map((prevFile?.rungs || []).map(r => [r.key, r]));
// A filtered run does not re-measure the baseline; it carries the one already in the file, so that
// adding rungs later cannot shift every gap in the table by re-drawing a single random number.
const baseRow = results.baseline || prev.get('baseline');
if (!baseRow) { console.error('no baseline in this run and none in public/data/ablation_refit.json'); process.exit(1); }
const baseRefit = mean(results.baseline ? results.baseline.runs.map(o => o.score) : [baseRow.refit]);
const TERMS = Object.keys(results.baseline ? results.baseline.runs[0].terms : baseRow.terms);
const rows = rungs.map(r => {
  const runs = results[r.key].runs, scores = runs.map(o => o.score);
  const before = ladder?.rungs.find(x => x.key === r.key);
  return { key: r.key, frozen: r.frozen, cfg: results[r.key].cfg, search: { gens: GENS, pop: POP, fitSeed: FIT_SEED },
    refit: +mean(scores).toFixed(4), refitSem: +sem(scores).toFixed(4),
    noRefit: before ? before.score : null,
    // fraction of the un-refitted loss that refitting buys back: 1 means fully compensable
    // (the mechanism was a coordinate, not a requirement), 0 means the loss survives the refit.
    recovered: (() => { if (!before || r.key === 'baseline') return null;
      const lossNoRefit = ladder.rungs[0].score - before.score, lossRefit = baseRefit - mean(scores);
      return Math.abs(lossNoRefit) < 1e-6 ? null : +(1 - lossRefit / lossNoRefit).toFixed(3); })(),
    gapToBaseline: +(mean(scores) - baseRefit).toFixed(4),
    terms: Object.fromEntries(TERMS.map(t => [t, +mean(runs.map(o => o.terms[t])).toFixed(3)])) };
});
// A filtered run measures only the rungs it was given; the rest of the table is carried over from the
// previous file rather than dropped, so a single-rung top-up does not destroy the full measurement.
const merged = [...prev.values()].filter(p => !rows.some(r => r.key === p.key)).concat(rows);
const order = (ladder?.rungs || []).map(r => r.key);
merged.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
const keptBase = merged.find(r => r.key === 'baseline');
fs.writeFileSync('public/data/ablation_refit.json', JSON.stringify({
  _source: 'scripts/ablation_refit.mjs', generated: new Date().toISOString().slice(0, 10),
  search: { gens: GENS, pop: POP, fitSeed: FIT_SEED, space: SPACE }, seeds: SEEDS, baseParams: BASE,
  refitBaseline: keptBase ? keptBase.refit : +baseRefit.toFixed(4),
  rungs: merged,
}, null, 1));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('rung', 18)} ${pad('no refit', 10)} ${pad('refit', 10)} ${pad('vs refit baseline', 18)} recovered`);
for (const r of rows) console.log(pad(r.key, 18), pad(r.noRefit?.toFixed(3) ?? '-', 10), pad(r.refit.toFixed(3), 10),
  pad(`${r.gapToBaseline >= 0 ? '+' : ''}${r.gapToBaseline.toFixed(3)}`, 18), r.recovered === null ? '-' : `${(r.recovered * 100).toFixed(0)}%`);
console.log('\nwrote public/data/ablation_refit.json');
