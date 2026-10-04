// Is antagonist alternation a rhythm or a switching process? For every live
// leg of a screen, the autocorrelation of the z-scored flexor-minus-extensor
// trace in 10 ms bins (0.5-2 s) gives a rhythmicity index: the height of the
// first ACF peak after the first zero crossing (near 0 for a random telegraph
// signal, whose ACF decays without returning; near 1 for a clean periodic
// signal) and that peak's lag as the period. Its null is the same index on the
// leg's own difference trace after shuffling 50 ms blocks, which keeps the
// switching statistics within a block and destroys any longer period.
// Antagonist correlation is the zero-lag correlation of the 10 ms traces.
//
//   node scripts/cord_rhythm.mjs --screen x6 [--wiring real]
//
// Also reports, per member, whether its rhythmic legs agree on a period.
import fs from 'node:fs';

const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const SCREEN = arg('--screen', 'x6'), WIRING = arg('--wiring', 'real');
const DIR = `ext/${SCREEN}`, DT = 0.5, SKIP_MS = 500, MIN_HZ = 2, BIN = 10, BLOCK = 5, RI_MIN = 0.2;
const LEGS = ['T1_left', 'T2_left', 'T3_left', 'T1_right', 'T2_right', 'T3_right'];
const meta = JSON.parse(fs.readFileSync(`${DIR}/${SCREEN}.json`, 'utf8'));

const b = fs.readFileSync(`${DIR}/${WIRING}/${SCREEN}_search.bin`);
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const [, , STEPS, MEMBERS, CONDS, CH, RECS, RUNS] = new Uint32Array(ab, 0, 8);
const counts = new Uint16Array(ab, 32, (ab.byteLength - 32) / 2);

function chan(run, ch) {
  const x = [], base = run * RECS * CH;
  for (let t = 1 + SKIP_MS / DT; t + 1 < RECS; t += 2) x.push(counts[base + t * CH + ch] + counts[base + (t + 1) * CH + ch]);
  return x;
}
const z = x => { const m = x.reduce((a, v) => a + v, 0) / x.length; const sd = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / x.length) || 1; return x.map(v => (v - m) / sd); };
const bin = x => { const y = []; for (let i = 0; i + BIN <= x.length; i += BIN) { let s = 0; for (let j = i; j < i + BIN; j++) s += x[j]; y.push(s); } return y; };

// first ACF peak after the first zero crossing, lags 0-600 ms
function rhythmicity(x) {
  const n = x.length, maxLag = 60, acf = new Float64Array(maxLag + 1);
  for (let L = 0; L <= maxLag; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += x[i] * x[i + L]; acf[L] = s / n; }
  for (let L = 1; L <= maxLag; L++) acf[L] /= acf[0] || 1;
  let L = 1;
  while (L < maxLag && acf[L] > 0) L++;
  if (L >= maxLag) return { ri: 0, periodMs: null };
  let best = L;
  for (let k = L; k <= maxLag; k++) if (acf[k] > acf[best]) best = k;
  return { ri: Math.max(0, acf[best]), periodMs: best * BIN };
}

let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
function blockShuffle(x) {
  const blocks = [];
  for (let i = 0; i < x.length; i += BLOCK) blocks.push(x.slice(i, i + BLOCK));
  for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
  return blocks.flat();
}

const out = [];
for (let r = 0; r < RUNS; r++) {
  const m = r >> 1, c = r & 1;
  const legs = [];
  LEGS.forEach((leg, l) => {
    const f = chan(r, l), e = chan(r, 6 + l), secs = f.length / 1000;
    const hzF = f.reduce((a, v) => a + v, 0) / secs / meta.pools[leg].flex;
    const hzE = e.reduce((a, v) => a + v, 0) / secs / meta.pools[leg].ext;
    if (hzF < MIN_HZ || hzE < MIN_HZ) return;
    const zf = z(bin(f)), ze = z(bin(e));
    const d = zf.map((v, i) => v - ze[i]);
    const rr = rhythmicity(d), nul = rhythmicity(blockShuffle(d));
    let corr = 0; for (let i = 0; i < zf.length; i++) corr += zf[i] * ze[i]; corr /= zf.length;
    legs.push({ leg, corr: +corr.toFixed(3), ri: +rr.ri.toFixed(3), periodMs: rr.periodMs, riNull: +nul.ri.toFixed(3) });
  });
  out.push({ m, c, legs });
}

const live = out.filter(o => o.c === 0).flatMap(o => o.legs);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : null; };
const rhythmic = live.filter(l => l.ri >= RI_MIN && l.riNull < RI_MIN);
console.log(`${SCREEN}/${WIRING}: ${live.length} live legs (baseline). rhythmicity index p50 ${q(live.map(l => l.ri), .5)}, p90 ${q(live.map(l => l.ri), .9)}; block-shuffled null p50 ${q(live.map(l => l.riNull), .5)}, p90 ${q(live.map(l => l.riNull), .9)}`);
console.log(`legs with RI >= ${RI_MIN} and null below: ${rhythmic.length}; anticorrelated (r < -0.2) ${live.filter(l => l.corr < -0.2).length}; both ${rhythmic.filter(l => l.corr < -0.2).length}`);
// per member agreement of periods among its rhythmic legs
const agree = out.filter(o => o.c === 0).map(o => {
  const rl = o.legs.filter(l => l.ri >= RI_MIN && l.riNull < RI_MIN && l.corr < -0.2);
  const ps = rl.map(l => l.periodMs);
  return { m: o.m, n: rl.length, periods: ps, spread: ps.length > 1 ? Math.max(...ps) - Math.min(...ps) : null };
}).filter(a => a.n >= 2).sort((a, b) => b.n - a.n);
console.log(`members with >= 2 rhythmic alternating legs: ${agree.length}`);
for (const a of agree.slice(0, 15)) console.log(`  m=${a.m} legs ${a.n} periods ${a.periods.join(',')} ms (spread ${a.spread})`);
// the long-run candidates, by rule: the top eight members of each loop-gain group (members
// 0-63, 64-127) by rhythmic alternating legs, then by the screen's alternation calls
if (WIRING === 'real' && fs.existsSync(`${DIR}/${SCREEN}_search.json`)) {
  const sc = JSON.parse(fs.readFileSync(`${DIR}/${SCREEN}_search.json`, 'utf8'));
  const score = m => out.find(o => o.m === m && o.c === 0).legs.filter(l => l.ri >= RI_MIN && l.riNull < RI_MIN && l.corr < -0.2).length;
  const alt = m => sc.members[m].reads.real[0].legs.filter(l => l.alt).length;
  const picks = [0, 1].map(g => [...Array(64).keys()].map(k => g * 64 + k).sort((a, b) => score(b) - score(a) || alt(b) - alt(a) || a - b).slice(0, 8));
  fs.writeFileSync(`${DIR}/picks.json`, JSON.stringify({ rule: 'top 8 per loop-gain group by rhythmic alternating legs, then alternation calls, then member index', picks }, null, 1));
  console.log(`picks: ${JSON.stringify(picks)}`);
}
fs.writeFileSync(`${DIR}/${WIRING}/${SCREEN}_rhythm.json`, JSON.stringify({ screen: SCREEN, wiring: WIRING, riMin: RI_MIN, blockMs: BLOCK, runs: out }, null, 1));
