// Antagonist correlation against bin width: the timescale of the cord's
// flexor/extensor switch. docs/54 found the 10 ms dwell measure at its
// counting-noise floor (a time-shifted extensor gives the same 20 ms dwells),
// so the switch's duration is read instead from how the zero-lag correlation of
// a leg's flexor and extensor pool counts changes as the bins widen: states that
// last T ms anticorrelate the pools out to bins of about T.
//
//   node scripts/cord_scale.mjs --screen x8 [--wiring real] [--group 32]
import fs from 'node:fs';

const DT = 0.5, SKIP_MS = 500, MIN_HZ = 2;
export const BINS = [5, 10, 20, 50, 100, 200];
const LEGS = ['T1_left', 'T2_left', 'T3_left', 'T1_right', 'T2_right', 'T3_right'];
const cache = {};

function load(path) {
  if (cache[path]) return cache[path];
  const b = fs.readFileSync(path);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const [, , STEPS, MEMBERS, CONDS, CH, RECS, RUNS] = new Uint32Array(ab, 0, 8);
  return (cache[path] = { STEPS, MEMBERS, CONDS, CH, RECS, RUNS, counts: new Uint16Array(ab, 32, (ab.byteLength - 32) / 2) });
}

// 1 ms counts of one channel of run r, from t0 to t1 ms
export function chan(D, r, ch, t0 = SKIP_MS, t1 = null) {
  const x = [], base = r * D.RECS * D.CH, end = t1 == null ? D.RECS : Math.min(D.RECS, 1 + t1 / DT);
  for (let t = 1 + t0 / DT; t + 1 < end; t += 2) x.push(D.counts[base + t * D.CH + ch] + D.counts[base + (t + 1) * D.CH + ch]);
  return x;
}
const bin = (x, B) => { const y = []; for (let i = 0; i + B <= x.length; i += B) { let s = 0; for (let j = i; j < i + B; j++) s += x[j]; y.push(s); } return y; };
export function corrAt(f, e, B) {
  const a = bin(f, B), b = bin(e, B), n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}
// live legs of a run: both coxa-trochanter pools >= 2 Hz per cell
export function legsOf(D, pools, r, t0, t1) {
  const out = [];
  LEGS.forEach((leg, l) => {
    const f = chan(D, r, l, t0, t1), e = chan(D, r, 6 + l, t0, t1), secs = f.length / 1000;
    if (f.reduce((a, v) => a + v, 0) / secs / pools[leg].flex < MIN_HZ) return;
    if (e.reduce((a, v) => a + v, 0) / secs / pools[leg].ext < MIN_HZ) return;
    out.push({ leg, f, e });
  });
  return out;
}
export function liveLegs(screen, wiring, m) {
  const D = load(`ext/${screen}/${wiring}/${screen}_search.bin`);
  const pools = JSON.parse(fs.readFileSync(`ext/${screen}/${screen}.json`, 'utf8')).pools;
  return legsOf(D, pools, 2 * m, SKIP_MS, null);
}
export const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
  const SCREEN = arg('--screen', 'x8'), WIRING = arg('--wiring', 'real'), G = +arg('--group', '0');
  const D = load(`ext/${SCREEN}/${WIRING}/${SCREEN}_search.bin`);
  const groups = {};
  for (let m = 0; m < D.MEMBERS; m++) {
    const g = G ? Math.floor(m / G) : 0;
    groups[g] ??= BINS.map(() => []);
    for (const l of liveLegs(SCREEN, WIRING, m)) BINS.forEach((B, k) => groups[g][k].push(corrAt(l.f, l.e, B)));
  }
  for (const [g, rs] of Object.entries(groups))
    console.log(`${SCREEN}/${WIRING}${G ? ` group ${g}` : ''} legs ${rs[0].length}: median r ` + BINS.map((B, k) => `${B} ms ${median(rs[k]).toFixed(3)}`).join(', '));
}
