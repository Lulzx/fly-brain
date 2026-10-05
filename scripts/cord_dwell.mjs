// Dwell times of the antagonist switch: doc 53's pre-registered criterion for
// the within-half inhibition screen. For every live leg (both coxa-trochanter
// pools >= 2 Hz per cell) of a baseline run, the 10 ms flexor-minus-extensor
// trace (each pool z-scored, as in cord_rhythm.mjs) is read as a two-state
// signal: the state is its sign, a zero bin keeps the previous state. A dwell
// is a run of one state; the first and last runs are cut off by the window
// and dropped. A leg is scored when it has at least MIN_DWELLS interior dwells.
//
// A leg holds when its median dwell is >= 100 ms and the dwells' coefficient
// of variation is below 0.5. A member passes when a leg holds on the real
// wiring and that member holds on no leg of the degree scramble.
//
//   node scripts/cord_dwell.mjs --screen x8 [--wirings real,deg]
import fs from 'node:fs';

const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const SCREEN = arg('--screen', 'x8'), WIRINGS = arg('--wirings', 'real,deg').split(',');
const DIR = `ext/${SCREEN}`, DT = 0.5, SKIP_MS = 500, MIN_HZ = 2, BIN = 10;
const HOLD_MS = 100, CV_MAX = 0.5, MIN_DWELLS = 3;
const LEGS = ['T1_left', 'T2_left', 'T3_left', 'T1_right', 'T2_right', 'T3_right'];
const meta = JSON.parse(fs.readFileSync(`${DIR}/${SCREEN}.json`, 'utf8'));

const z = x => { const m = x.reduce((a, v) => a + v, 0) / x.length; const sd = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / x.length) || 1; return x.map(v => (v - m) / sd); };
const bin = x => { const y = []; for (let i = 0; i + BIN <= x.length; i += BIN) { let s = 0; for (let j = i; j < i + BIN; j++) s += x[j]; y.push(s); } return y; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : null; };

export function dwells(d) {
  let st = 0, run = 0;
  const out = [];
  for (const v of d) {
    const s = v > 0 ? 1 : v < 0 ? -1 : st;
    if (s === st) run++;
    else { if (st !== 0) out.push(run); st = s; run = 1; }
  }
  return out.slice(1).map(n => n * BIN);   // the first run is cut by the window; the last is never pushed
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  function score(w) {
    const b = fs.readFileSync(`${DIR}/${w}/${SCREEN}_search.bin`);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const [, , , MEMBERS, , CH, RECS, RUNS] = new Uint32Array(ab, 0, 8);
    const counts = new Uint16Array(ab, 32, (ab.byteLength - 32) / 2);
    const chan = (run, ch) => {
      const x = [], base = run * RECS * CH;
      for (let t = 1 + SKIP_MS / DT; t + 1 < RECS; t += 2) x.push(counts[base + t * CH + ch] + counts[base + (t + 1) * CH + ch]);
      return x;
    };
    const members = [];
    for (let m = 0; m < MEMBERS; m++) {
      const r = 2 * m, legs = [];
      LEGS.forEach((leg, l) => {
        const f = chan(r, l), e = chan(r, 6 + l), secs = f.length / 1000;
        const hzF = f.reduce((a, v) => a + v, 0) / secs / meta.pools[leg].flex;
        const hzE = e.reduce((a, v) => a + v, 0) / secs / meta.pools[leg].ext;
        if (hzF < MIN_HZ || hzE < MIN_HZ) return;
        const zf = z(bin(f)), ze = z(bin(e));
        const dw = dwells(zf.map((v, i) => v - ze[i]));
        if (dw.length < MIN_DWELLS) { legs.push({ leg, n: dw.length, median: null, cv: null, holds: false }); return; }
        const mu = dw.reduce((a, v) => a + v, 0) / dw.length;
        const cv = Math.sqrt(dw.reduce((a, v) => a + (v - mu) ** 2, 0) / dw.length) / mu;
        const median = q(dw, 0.5);
        legs.push({ leg, n: dw.length, median, cv: +cv.toFixed(3), holds: median >= HOLD_MS && cv < CV_MAX });
      });
      members.push({ m, legs });
    }
    return { RUNS, members };
  }

  const R = Object.fromEntries(WIRINGS.map(w => [w, score(w)]));
  for (const w of WIRINGS) {
    const legs = R[w].members.flatMap(x => x.legs);
    const sc = legs.filter(l => l.median != null);
    console.log(`${SCREEN}/${w}: live legs ${legs.length}, scored ${sc.length}; median dwell p10/p50/p90 ` +
      `${q(sc.map(l => l.median), .1)}/${q(sc.map(l => l.median), .5)}/${q(sc.map(l => l.median), .9)} ms; ` +
      `CV p50 ${q(sc.map(l => l.cv), .5)}; legs holding ${legs.filter(l => l.holds).length}`);
  }
  const real = R.real.members, deg = R.deg?.members;
  const pass = real.filter(x => x.legs.some(l => l.holds) && !(deg && deg[x.m].legs.some(l => l.holds)));
  console.log(`members with a holding leg on real and none on deg: ${pass.length}`);
  for (const p of pass.slice(0, 20)) console.log(`  m=${p.m} ` + p.legs.filter(l => l.holds).map(l => `${l.leg} ${l.median} ms cv ${l.cv}`).join('; '));
  // the longest-dwelling real legs, whether or not they hold
  const top = real.flatMap(x => x.legs.filter(l => l.median != null).map(l => ({ m: x.m, ...l }))).sort((a, b) => b.median - a.median || a.cv - b.cv).slice(0, 10);
  console.log('longest real dwells: ' + top.map(t => `m${t.m} ${t.leg} ${t.median}ms/cv${t.cv}`).join(', '));
  fs.writeFileSync(`${DIR}/${SCREEN}_dwell.json`, JSON.stringify({
    screen: SCREEN, holdMs: HOLD_MS, cvMax: CV_MAX, minDwells: MIN_DWELLS, binMs: BIN,
    pass: pass.map(p => p.m), wirings: Object.fromEntries(WIRINGS.map(w => [w, R[w].members])),
  }, null, 1));
}
