// Scoring cordx8L.bend's 10 s runs (docs/54). Criteria fixed before the runs:
//
//   run statistic  in each window (0.5-5 s, 5-10 s), the median over live legs (both pools
//                  >= 2 Hz per cell, at least two legs) of the flexor/extensor correlation of
//                  200 ms bin counts
//   effect         for each of the eight lower-bit settings, seed and window, the run statistic
//                  under a weakened row-set minus the same setting's under row-set 0 (x1)
//   pass           the median effect over the eight settings is <= -0.2 in both windows and on
//                  both seeds on the real wiring, the real weakened statistic's median is below
//                  0, and on the degree scramble the median effect is above -0.1 everywhere
//
// Row-set 3 (within-hemilineage inhibition x0) is the primary test, row-set 7 (own-half
// inhibition x0) the secondary. The screen-seed runs' first 2 s must equal the screen's runs.
//
//   node scripts/cord_scale_long.mjs [run]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { BINS, corrAt, legsOf, median } from './cord_scale.mjs';

const DIR = 'ext/x8', WIRINGS = ['real', 'deg'], WINDOWS = [[500, 5000], [5000, 10000]];
const EFFECT = -0.2, NULL_MAX = -0.1, B = 200;
const P = JSON.parse(fs.readFileSync(`${DIR}/picks.json`, 'utf8'));
const pools = JSON.parse(fs.readFileSync(`${DIR}/x8.json`, 'utf8')).pools;

if (process.argv.includes('run')) {
  for (const w of WIRINGS) {
    fs.rmSync(`${DIR}/cur`, { force: true });
    fs.symlinkSync(w, `${DIR}/cur`);
    execFileSync('./cordx8L', { stdio: 'inherit' });
  }
}

function load(path) {
  const b = fs.readFileSync(path);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const [, , STEPS, MEMBERS, CONDS, CH, RECS, RUNS] = new Uint32Array(ab, 0, 8);
  return { STEPS, MEMBERS, CONDS, CH, RECS, RUNS, counts: new Uint16Array(ab, 32, (ab.byteLength - 32) / 2) };
}

const out = { criteria: { binMs: B, effect: EFFECT, nullMax: NULL_MAX, windows: WINDOWS }, picks: P, wirings: {} };
for (const w of WIRINGS) {
  const L = load(`${DIR}/${w}/x8_long.bin`), S = load(`${DIR}/${w}/x8_search.bin`);
  const runs = [];
  let same = 0;
  P.rowsets.forEach((rs, g) => P.picks[g].forEach((m, k) => [0, 1].forEach(seed => {
    const r = g * 16 + 2 * k + seed;
    if (seed === 0) {
      const n = S.RECS * S.CH, a = L.counts.subarray(r * L.RECS * L.CH, r * L.RECS * L.CH + n);
      const b = S.counts.subarray(2 * m * S.RECS * S.CH, 2 * m * S.RECS * S.CH + n);
      if (a.every((v, i) => v === b[i])) same++;
    }
    const win = WINDOWS.map(([t0, t1]) => {
      const legs = legsOf(L, pools, r, t0, t1);
      const rs_ = BINS.map(Bn => median(legs.map(l => corrAt(l.f, l.e, Bn))));
      return { live: legs.length, r: Object.fromEntries(BINS.map((Bn, i) => [Bn, rs_[i] == null ? null : +rs_[i].toFixed(3)])),
        stat: legs.length >= 2 ? median(legs.map(l => corrAt(l.f, l.e, B))) : null };
    });
    runs.push({ rowset: rs, member: m, lower: m % 32, seed, win });
  })));
  const stat = (rs, lo, seed, wi) => runs.find(x => x.rowset === rs && x.lower === lo && x.seed === seed).win[wi].stat;
  const lows = P.picks[0].map(m => m % 32);
  const tests = {};
  for (const rs of [3, 7]) {
    const cells = [];
    for (const seed of [0, 1]) for (let wi = 0; wi < 2; wi++) {
      const d = lows.map(lo => [stat(rs, lo, seed, wi), stat(0, lo, seed, wi)]).filter(([a, b]) => a != null && b != null);
      cells.push({ seed, window: wi, n: d.length, effect: median(d.map(([a, b]) => a - b)), weak: median(d.map(([a]) => a)), base: median(d.map(([, b]) => b)) });
    }
    tests[rs] = cells;
  }
  out.wirings[w] = { prefixIdentical: `${same}/24`, tests, runs };
  console.log(`\n${w}: screen-seed prefixes identical ${same}/24`);
  for (const rs of [3, 7]) for (const c of tests[rs])
    console.log(`  row-set ${rs} seed ${c.seed} window ${c.window}: n ${c.n}, median r200 x1 ${c.base?.toFixed(3)}, weakened ${c.weak?.toFixed(3)}, effect ${c.effect?.toFixed(3)}`);
  for (const rs of [0, 3, 7]) {
    const rr = runs.filter(x => x.rowset === rs).flatMap(x => x.win);
    console.log(`  row-set ${rs}: live legs per window ${median(rr.map(x => x.live))}; median r ` + BINS.map(Bn => `${Bn} ms ${median(rr.map(x => x.r[Bn]).filter(v => v != null))?.toFixed(3)}`).join(', '));
  }
}
const verdict = rs => {
  const R = out.wirings.real.tests[rs], D = out.wirings.deg.tests[rs];
  return R.every(c => c.n >= 4 && c.effect <= EFFECT && c.weak < 0) && D.every(c => c.n < 4 || c.effect > NULL_MAX);
};
out.pass = { rowset3: verdict(3), rowset7: verdict(7) };
console.log(`\nverdict: row-set 3 (within-hemilineage x0) ${out.pass.rowset3 ? 'PASSES' : 'fails'}; row-set 7 (own half x0) ${out.pass.rowset7 ? 'PASSES' : 'fails'}`);
fs.writeFileSync(`${DIR}/x8_long.json`, JSON.stringify(out, null, 1));
