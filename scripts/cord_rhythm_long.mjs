// Scoring cordx6L.bend's 10 s runs: is any candidate's antagonist alternation a
// sustained rhythm? Criteria are fixed before looking (docs/51-cord-drive.md):
//
//   leg   both pools >= 2 Hz per cell; flexor/extensor 10 ms correlation < -0.2;
//         rhythmicity index (first ACF peak after the first zero crossing of the
//         10 ms difference trace) >= 0.2 and above all 20 block-shuffled copies
//         (50 ms blocks); all of it in BOTH windows, 0.5-5 s and 5-10 s, with the
//         two windows' periods within 20% of each other
//   member  >= 2 such legs whose periods agree within 20%, on the screen's seed
//         AND on the fresh seed, with the two seeds' median periods within 20%
//
//   bend cordx6L.bend -o cordx6L && node scripts/cord_rhythm_long.mjs run
//   node scripts/cord_rhythm_long.mjs          # rescore
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const DIR = 'ext/x6', WIRINGS = ['real', 'deg'];
const DT = 0.5, BIN = 10, BLOCK = 5, NULLS = 20, RI_MIN = 0.2, R_MAX = -0.2, MIN_HZ = 2, TOL = 0.2;
const WINDOWS = [[500, 5000], [5000, 10000]];
const LEGS = ['T1_left', 'T2_left', 'T3_left', 'T1_right', 'T2_right', 'T3_right'];
const PICK = [[40, 57, 42, 44, 56, 58, 60, 62], [116, 118, 106, 121, 102, 117, 119, 115]];
const meta = JSON.parse(fs.readFileSync(`${DIR}/x6.json`, 'utf8'));

if (process.argv.includes('run')) {
  for (const w of WIRINGS) {
    fs.rmSync(`${DIR}/cur`, { force: true });
    fs.symlinkSync(w, `${DIR}/cur`);
    execFileSync('./cordx6L', { stdio: 'inherit' });
  }
}

function load(path) {
  const b = fs.readFileSync(path);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const [, , STEPS, MEMBERS, CONDS, CH, RECS, RUNS] = new Uint32Array(ab, 0, 8);
  return { STEPS, MEMBERS, CONDS, CH, RECS, RUNS, counts: new Uint16Array(ab, 32, (ab.byteLength - 32) / 2) };
}
function chan(D, run, ch, [a, b]) {
  const x = [], base = run * D.RECS * D.CH;
  for (let t = 1 + a / DT; t + 1 < Math.min(D.RECS, 1 + b / DT + 1); t += 2) x.push(D.counts[base + t * D.CH + ch] + D.counts[base + (t + 1) * D.CH + ch]);
  return x;
}
const bin = x => { const y = []; for (let i = 0; i + BIN <= x.length; i += BIN) { let s = 0; for (let j = i; j < i + BIN; j++) s += x[j]; y.push(s); } return y; };
const z = x => { const m = x.reduce((a, v) => a + v, 0) / x.length; const sd = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / x.length) || 1; return x.map(v => (v - m) / sd); };
function rhythmicity(x) {
  const n = x.length, maxLag = 60, acf = new Float64Array(maxLag + 1);
  for (let L = 0; L <= maxLag; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += x[i] * x[i + L]; acf[L] = s / n; }
  for (let L = 1; L <= maxLag; L++) acf[L] /= acf[0] || 1;
  let L = 1;
  while (L < maxLag && acf[L] > 0) L++;
  if (L >= maxLag) return { ri: 0, period: null };
  let best = L;
  for (let k = L; k <= maxLag; k++) if (acf[k] > acf[best]) best = k;
  return { ri: Math.max(0, acf[best]), period: best * BIN };
}
let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
function shuffled(x) {
  const bl = [];
  for (let i = 0; i < x.length; i += BLOCK) bl.push(x.slice(i, i + BLOCK));
  for (let i = bl.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bl[i], bl[j]] = [bl[j], bl[i]]; }
  return bl.flat();
}
const close = (a, b) => a != null && b != null && Math.abs(a - b) <= TOL * Math.max(a, b);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

function legWindow(D, run, l, win) {
  const leg = LEGS[l], f = chan(D, run, l, win), e = chan(D, run, 6 + l, win), secs = f.length / 1000;
  const hzF = f.reduce((a, v) => a + v, 0) / secs / meta.pools[leg].flex;
  const hzE = e.reduce((a, v) => a + v, 0) / secs / meta.pools[leg].ext;
  if (hzF < MIN_HZ || hzE < MIN_HZ) return { live: false, hzF, hzE };
  const zf = z(bin(f)), ze = z(bin(e));
  let r = 0; for (let i = 0; i < zf.length; i++) r += zf[i] * ze[i]; r /= zf.length;
  const d = zf.map((v, i) => v - ze[i]);
  const rr = rhythmicity(d);
  let nullMax = 0;
  for (let k = 0; k < NULLS; k++) nullMax = Math.max(nullMax, rhythmicity(shuffled(d)).ri);
  return { live: true, hzF: +hzF.toFixed(2), hzE: +hzE.toFixed(2), r: +r.toFixed(3), ri: +rr.ri.toFixed(3), period: rr.period, nullMax: +nullMax.toFixed(3),
    pass: r < R_MAX && rr.ri >= RI_MIN && rr.ri > nullMax };
}

const report = { criteria: { BIN, BLOCK, NULLS, RI_MIN, R_MAX, MIN_HZ, TOL, WINDOWS }, wirings: {} };
for (const w of WIRINGS) {
  const D = load(`${DIR}/${w}/x6_long.bin`);
  const S = w === 'real' || fs.existsSync(`${DIR}/${w}/x6_search.bin`) ? load(`${DIR}/${w}/x6_search.bin`) : null;
  const members = [];
  let prefixOk = 0, prefixN = 0;
  for (let g = 0; g < 2; g++) for (let k = 0; k < 8; k++) {
    const m = PICK[g][k], seeds = [];
    for (let sd = 0; sd < 2; sd++) {
      const run = g * 16 + 2 * k + sd;
      if (sd === 0 && S) {
        prefixN++;
        const a = D.counts.subarray(run * D.RECS * D.CH, run * D.RECS * D.CH + S.RECS * S.CH);
        const b = S.counts.subarray(2 * m * S.RECS * S.CH, (2 * m + 1) * S.RECS * S.CH);
        if (a.every((v, i) => v === b[i])) prefixOk++;
      }
      const legs = LEGS.map((leg, l) => {
        const ws = WINDOWS.map(win => legWindow(D, run, l, win));
        const sustained = ws.every(x => x.live && x.pass) && close(ws[0].period, ws[1].period);
        return { leg, windows: ws, sustained, period: sustained ? (ws[0].period + ws[1].period) / 2 : null };
      });
      const ps = legs.filter(l => l.sustained).map(l => l.period);
      const agree = ps.length >= 2 && ps.every(p => close(p, median(ps)));
      seeds.push({ seed: sd === 0 ? 'screen' : 'fresh', sustainedLegs: ps.length, periods: ps, agree, medianPeriod: median(ps), legs });
    }
    const pass = seeds.every(s => s.agree) && close(seeds[0].medianPeriod, seeds[1].medianPeriod);
    members.push({ member: m, loopGain: g ? 3 : 1, pass, seeds });
  }
  report.wirings[w] = { prefix: `${prefixOk}/${prefixN}`, members };
  console.log(`\n${w}: 10 s prefix equals the screen's run in ${prefixOk}/${prefixN}`);
  const all = members.flatMap(m => m.seeds.flatMap(s => s.legs.flatMap(l => l.windows)));
  console.log(`  windows live ${all.filter(x => x.live).length}/${all.length}, anticorrelated ${all.filter(x => x.live && x.r < R_MAX).length}, rhythmic (RI >= ${RI_MIN} and above nulls) ${all.filter(x => x.live && x.ri >= RI_MIN && x.ri > x.nullMax).length}, both ${all.filter(x => x.live && x.pass).length}`);
  for (const m of members) console.log(`  m=${m.member} gain x${m.loopGain}: ${m.seeds.map(s => `${s.seed} ${s.sustainedLegs} legs [${s.periods.join(',')}] ms${s.agree ? ' agree' : ''}`).join(' | ')}${m.pass ? '  PASS' : ''}`);
}
fs.writeFileSync(`${DIR}/x6_long.json`, JSON.stringify(report, null, 1));
