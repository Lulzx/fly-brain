// Arm two of the behavioural substitution ladder (docs/35-behaviour-ladder.md, roadmap item A1).
//
// scripts/behavior_ladder.mjs removes one level of description and re-scores the fly at the fitted
// operating point. That measures sensitivity, not necessity: a mechanism whose removal costs 0.2 may be
// entirely compensable by the eight global parameters the fit leaves free. Here each rung is refitted by
// the same cross-entropy search the physiological ladder uses (scripts/ablation_refit.mjs) and the
// recovered score is compared against the baseline refitted the same way.
//
// The search is deliberately smaller than the physiological one. An embodied evaluation costs ~335 s
// against 3.3 s, so twelve generations of twenty across all twenty rungs would be about ninety hours.
// Two reductions bring it to something runnable, both written into the output so a reader knows what
// bought the time: the rungs are restricted to those arm one shows break something, and the search is
// shortened to five generations of twelve. The winner is re-scored on all twelve of arm one's seeds,
// which costs nothing extra because the re-score is one wave of twelve workers either way.
//
//   node scripts/behavior_refit.mjs [gens] [pop] [rung-regex]
//
// With no filter the rung set is read from public/data/behavior_ladder.json: every rung whose paired
// score drop is at least MIN_COST or that breaks at least one term. Writes public/data/behavior_refit.json.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { RUNGS } from './rungs.mjs';

const SPACE = {   // identical to scripts/calib_search.mjs
  wSyn: [0.2, 1.2, 'log'], sizeAlpha: [0, 1, 'lin'], kcThreshold: [0, 30, 'lin'], inhGain: [0.5, 5, 'log'],
  eInh: [-85, -55, 'lin'], minSyn: [3, 10, 'int'], adaptInc: [0, 3, 'lin'], tRef: [2, 6, 'lin'], laminaBias: [0, 25, 'lin'],
};
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();

const GENS = +(process.argv[2] || 5), POP = +(process.argv[3] || 8);
const FILTER = process.argv[4] ? new RegExp(process.argv[4]) : null;
const NW = +(process.env.NW || 12), FIT_SEED = 1000;
const SIG = 3;                  // same criterion as arm one: a rung worth refitting is one that resolved
const SEEDS = [...Array(12)].map((_, i) => 1000 + i * 7919);   // exactly arm one's seeds

const file = 'public/data/behavior_ladder.json';
function pickRungs() {
  if (FILTER) return RUNGS.filter(r => FILTER.test(r.key));
  if (!fs.existsSync(file)) { console.error(`no ${file}: run scripts/behavior_ladder.mjs first, or pass a rung filter`); process.exit(1); }
  const arm1 = JSON.parse(fs.readFileSync(file));
  // A rung is worth refitting when arm one resolved it: the paired drop is at least three standard
  // errors, or some term broke. Anything else cost less than seed noise, so a refit could not be told
  // from a redraw.
  const worth = new Set(arm1.rungs.filter(r => r.key !== 'baseline' &&
    ((r.dScore && r.dScore.d <= -SIG * Math.max(r.dScore.se, 1e-9)) || (r.broke && r.broke.length))).map(r => r.key));
  const chosen = RUNGS.filter(r => r.key !== 'baseline' && worth.has(r.key));
  console.log(`chosen from arm one (paired drop >= ${SIG} sem, or any term broken): ${chosen.map(r => r.key).join(', ')}`);
  return chosen;
}
const rungs = pickRungs();
const prevFile = fs.existsSync('public/data/behavior_refit.json') ? JSON.parse(fs.readFileSync('public/data/behavior_refit.json')) : null;
const baseRow = prevFile?.rungs?.find(r => r.key === 'baseline');
const needBase = !baseRow || FILTER?.test('baseline');

const workers = [...Array(NW)].map(() => fork('scripts/behavior_eval.mjs'));
const evalAll = cfgs => new Promise(res => { const out = new Array(cfgs.length); let next = 0, done = 0;
  const give = w => { if (next >= cfgs.length) return; const id = next++;
    w.once('message', m => { out[id] = m; done++;
      if (m.error) console.error(`\nFAIL: ${m.error.split('\n')[0]}`);
      done === cfgs.length ? res(out) : give(w); });
    w.send({ id, cfg: cfgs[id], seeds: cfgs[id].seeds }); };
  workers.forEach(give); });
const gauss = () => { const u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

async function refit(rung) {
  const keys = Object.keys(SPACE).filter(k => !(rung.frozen || []).includes(k));
  const toU = (k, v) => { const [lo, hi, sc] = SPACE[k]; return sc === 'log' ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo); };
  const fromU = (k, u) => { const [lo, hi, sc] = SPACE[k]; u = Math.min(1, Math.max(0, u));
    const v = sc === 'log' ? lo * Math.pow(hi / lo, u) : lo + u * (hi - lo); return sc === 'int' ? Math.round(v) : +v.toFixed(3); };
  const start = { ...BASE, ...rung.patch };
  let mu = keys.map(k => toU(k, start[k] ?? { adaptInc: 0, laminaBias: 9, kcThreshold: 10, minSyn: 5, tRef: 3, wSyn: 0.5, sizeAlpha: 0.4, inhGain: 1.2, eInh: -70 }[k]));
  let sd = keys.map(() => 0.25), best = null;
  const build = u => ({ ...BASE, ...Object.fromEntries(keys.map((k, i) => [k, fromU(k, u[i])])), ...rung.patch, seed: FIT_SEED });
  for (let g = 0; g < GENS; g++) {
    const U = [...Array(POP)].map((_, n) => n === 0 ? (best ? best.u : mu.slice()) : mu.map((m, i) => m + sd[i] * gauss()));
    const res = await evalAll(U.map(u => ({ ...build(u), seeds: [FIT_SEED] })));
    const scored = res.map((r, i) => ({ u: U[i].map(x => Math.min(1, Math.max(0, x))), s: r.error || !r.out ? -1 : r.out.score, cfg: r.cfg }))
      .sort((a, b) => b.s - a.s);
    if (!best || scored[0].s > best.s) best = scored[0];
    const elite = scored.slice(0, Math.max(3, POP >> 2));
    mu = keys.map((_, i) => elite.reduce((a, e) => a + e.u[i], 0) / elite.length);
    sd = keys.map((_, i) => Math.max(0.04, Math.sqrt(elite.reduce((a, e) => a + (e.u[i] - mu[i]) ** 2, 0) / elite.length)));
    process.stdout.write(`\r  ${rung.key} gen ${g + 1}/${GENS} best ${best.s.toFixed(3)}   `);
  }
  const cfg = { ...best.cfg }; delete cfg.seed; delete cfg.seeds;
  const runs = (await evalAll(SEEDS.map(seed => ({ ...cfg, seed, seeds: [seed] })))).filter(m => m.out).map(m => m.out);
  return { cfg, fitSeedScore: best.s, runs };
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sem = a => a.length < 2 ? 0 : Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / (a.length - 1) / a.length);

console.log(`refitting ${rungs.length} rungs${needBase ? ' + baseline' : ''}: CEM ${GENS} gens x ${POP}, then ${SEEDS.length}-seed re-score on ${NW} workers`);
const results = {};
for (const r of (needBase ? [{ key: 'baseline', patch: {}, frozen: [] }, ...rungs] : rungs)) {
  const t0 = Date.now(); results[r.key] = await refit(r);
  console.log(`\r  ${r.key.padEnd(18)} refit ${mean(results[r.key].runs.map(o => o.score)).toFixed(3)}  (${((Date.now() - t0) / 1000).toFixed(0)}s)          `);
}
workers.forEach(w => w.kill());

// `recovered` uses arm one's numbers, which are the same twelve seeds measured here, so the two arms
// can be compared seed for seed. It is reported because doc 31 does, with doc 31's caveat: the ratio is
// degenerate for a rung whose un-refitted loss is small, and the absolute gap is the quantity to read.
const arm1 = JSON.parse(fs.readFileSync(file));
const baseRefit = results.baseline ? +mean(results.baseline.runs.map(o => o.score)).toFixed(4) : baseRow.refit;
const TERMS = Object.keys((results.baseline ? results.baseline.runs[0] : baseRow).terms);
const rows = (needBase ? [{ key: 'baseline', patch: {}, frozen: [] }, ...rungs] : rungs).map(r => {
  const runs = results[r.key].runs, scores = runs.map(o => o.score);
  const before = arm1.rungs.find(x => x.key === r.key);
  const refit = +mean(scores).toFixed(4);
  return { key: r.key, frozen: r.frozen || [], cfg: results[r.key].cfg, search: { gens: GENS, pop: POP, fitSeed: FIT_SEED },
    refit, refitSem: +sem(scores).toFixed(4), fitSeedScore: +results[r.key].fitSeedScore.toFixed(4),
    noRefit: before ? before.score : null, dScoreArm1: before?.dScore ?? null,
    recovered: (() => { if (!before || r.key === 'baseline') return null;
      const lossNoRefit = arm1.rungs[0].score - before.score, lossRefit = baseRefit - refit;
      return Math.abs(lossNoRefit) < 1e-6 ? null : +(1 - lossRefit / lossNoRefit).toFixed(3); })(),
    gapToBaseline: +(refit - baseRefit).toFixed(4),
    terms: Object.fromEntries(TERMS.map(t => [t, +mean(runs.map(o => o.terms[t])).toFixed(3)])),
    obs: Object.fromEntries(Object.keys(runs[0].obs).filter(k => typeof runs[0].obs[k] === 'number').map(k => [k, +mean(runs.map(o => o.obs[k])).toFixed(4)])) };
});
const kept = (prevFile?.rungs || []).filter(p => !rows.some(r => r.key === p.key));
const merged = [...rows, ...kept];
const order = arm1.rungs.map(r => r.key);
merged.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
fs.writeFileSync('public/data/behavior_refit.json', JSON.stringify({
  _source: 'scripts/behavior_refit.mjs', generated: new Date().toISOString().slice(0, 10),
  search: { gens: GENS, pop: POP, fitSeed: FIT_SEED, space: SPACE, note: 'reduced from 12x20: an embodied evaluation is ~335 s' },
  seeds: SEEDS, baseParams: BASE, refitBaseline: merged.find(r => r.key === 'baseline')?.refit ?? baseRefit,
  rungs: merged,
}, null, 1));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('rung', 18)} ${pad('no refit', 10)} ${pad('refit', 10)} ${pad('vs refit baseline', 18)} recovered`);
for (const r of rows) console.log(pad(r.key, 18), pad(r.noRefit?.toFixed(3) ?? '-', 10), pad(r.refit.toFixed(3), 10),
  pad(`${r.gapToBaseline >= 0 ? '+' : ''}${r.gapToBaseline.toFixed(3)}`, 18), r.recovered === null ? '-' : `${(r.recovered * 100).toFixed(0)}%`);
console.log('\nwrote public/data/behavior_refit.json');
