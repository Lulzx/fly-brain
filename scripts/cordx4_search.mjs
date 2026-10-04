// The alternation screen (cordx4.bend): run it on the real wiring and two
// degree-preserving scrambles, then score antagonist alternation per leg and
// the bilateral population mode, matched member for member across wirings.
//
//   python3 scripts/prep_cord_x4.py --meta <meta.feather>
//   bend cordx4.bend -o cordx4 && node scripts/cordx4_search.mjs run
//   node scripts/cordx4_search.mjs          # rescore saved runs only
//   node scripts/cordx4_search.mjs --screen x5 [run]   # the cell-type screen, cordx5.bend
//   node scripts/cordx4_search.mjs --screen x6 [run]   # the inhibitory half-centre, cordx6.bend
//   node scripts/cordx4_search.mjs --screen x7 [run]   # slow adaptation in that loop, cordx7.bend
//
// Member bits: 0-1 adaptation per spike {0.072, 0.5, 2, 5} mV, 2 adaptation
// tau {100, 400} ms, 3-4 rebound gain {0, 6, 15, 30} mV, 5 proprioceptive
// loop {open, split 20 ms}, 6 unilateral kick. Conditions: 0 baseline,
// 1 descending command silenced. Run j is member j >> 1, condition j & 1.
//
// Per leg the readout is the coxa-trochanter flexor pool against its extensor
// pool (channels leg and 6 + leg), each z-scored at 1 ms so the pool sizes do
// not weight the phase. With P+ and P- the spectra of their sum and
// difference, the in-phase fraction over 1-20 Hz is 1 for co-activation, 0.5
// for no relation and 0 for clean alternation. A leg alternates when both pools
// fire, the band fraction is at most ALT, and the difference spectrum is
// concentrated (CONC of its band power within one bin of its peak), so
// broadband anticorrelation from shared inhibition is not called a rhythm.
// A circular-shift surrogate (extensor trace rotated by 250 ms) gives the
// no-relation reference for every run.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fftPow, inPhase } from '../src/exp/spectrum.js';

const SCREEN = process.argv.includes('--screen') ? process.argv[process.argv.indexOf('--screen') + 1] : 'x4';
const WIRINGS = ['real', 'deg', 'side'];
const DT = 0.5, SKIP_MS = 500, BAND = [1, 20], POP_BAND = [2, 20];
const ALT = 0.35, CONC = 0.2, MIN_HZ = 2;
const LEGS = ['T1_left', 'T2_left', 'T3_left', 'T1_right', 'T2_right', 'T3_right'];
const COND = ['baseline', 'no_command'];
const AINC = [0.072, 0.5, 2, 5], ATAU = [100, 400], GH = [0, 6, 15, 30];
const RB5 = [0, 15, 30, 60], AI5 = [0.072, 1, 3, 6], TONIC = [0, 2, 4, 6];
const TAU7 = [100, 300, 600, 1000], INC7 = [0, 0.5, 1, 2];

// x5 member bits: 0-1 rebound gain on excitatory premotor cells, 2-3 their
// adaptation per spike, 4 graded release in inhibitory premotor cells, 5-6
// tonic depolarisation of both premotor classes
const SCREENS = {
  x4: {
    dir: 'ext/x4', bin: './cordx4', shippedMask: 31, title: 'Alternation screen: real wiring against scrambles',
    axesOf: m => ({ ainc: AINC[m & 3], atau: ATAU[(m >> 2) & 1], gh: GH[(m >> 3) & 3],
      loop: (m >> 5) & 1 ? 'split 20 ms' : 'open', kick: (m >> 6) & 1 }),
    axes: [
      { name: 'adaptation per spike', of: m => AINC[m & 3] },
      { name: 'adaptation tau ms', of: m => ATAU[(m >> 2) & 1] },
      { name: 'rebound gain mV', of: m => GH[(m >> 3) & 3] },
      { name: 'proprio loop', of: m => (m >> 5) & 1 ? 'split 20 ms' : 'open' },
      { name: 'kick', of: m => (m >> 6) & 1 },
    ],
  },
  x5: {
    dir: 'ext/x5', bin: './cordx5', shippedMask: 127, title: 'Cell-type screen: real wiring against scrambles',
    axesOf: m => ({ rebound: RB5[m & 3], adapt: AI5[(m >> 2) & 3], graded: (m >> 4) & 1, tonic: TONIC[(m >> 5) & 3] }),
    axes: [
      { name: 'rebound gain mV, exc premotor', of: m => RB5[m & 3] },
      { name: 'adaptation mV, exc premotor', of: m => AI5[(m >> 2) & 3] },
      { name: 'graded release, inh premotor', of: m => (m >> 4) & 1 },
      { name: 'tonic depolarisation mV', of: m => TONIC[(m >> 5) & 3] },
    ],
  },
  x6: {
    dir: 'ext/x6', bin: './cordx6', shippedMask: 127, title: 'Inhibitory half-centre screen: real wiring against scrambles',
    axesOf: m => ({ rebound: RB5[m & 3], adapt: AI5[(m >> 2) & 3], tonic: TONIC[(m >> 4) & 3], loopGain: (m >> 6) & 1 ? 3 : 1 }),
    axes: [
      { name: 'rebound gain mV, inh premotor', of: m => RB5[m & 3] },
      { name: 'adaptation mV, inh premotor', of: m => AI5[(m >> 2) & 3] },
      { name: 'tonic depolarisation mV', of: m => TONIC[(m >> 4) & 3] },
      { name: 'inh premotor loop gain', of: m => (m >> 6) & 1 ? 3 : 1 },
    ],
  },
  x7: {
    dir: 'ext/x7', bin: './cordx7', shippedMask: 127, title: 'Slow-adaptation screen: real wiring against scrambles',
    axesOf: m => ({ tauMs: TAU7[m & 3], incr: INC7[(m >> 2) & 3], tonic: TONIC[(m >> 4) & 3], loopGain: (m >> 6) & 1 ? 3 : 1 }),
    axes: [
      { name: 'slow adaptation tau ms, inh premotor', of: m => TAU7[m & 3] },
      { name: 'slow adaptation mV per spike', of: m => INC7[(m >> 2) & 3] },
      { name: 'tonic depolarisation mV', of: m => TONIC[(m >> 4) & 3] },
      { name: 'inh premotor loop gain', of: m => (m >> 6) & 1 ? 3 : 1 },
    ],
  },
};
const S = SCREENS[SCREEN];
if (!S) throw new Error(`unknown screen ${SCREEN}`);
const DIR = S.dir;

if (process.argv.slice(2).includes('run')) {
  for (const w of WIRINGS) {
    fs.rmSync(`${DIR}/cur`, { force: true });
    fs.symlinkSync(w, `${DIR}/cur`);
    console.log(`--- ${w}`);
    execFileSync(S.bin, { stdio: 'inherit' });
  }
}

const meta = JSON.parse(fs.readFileSync(`${DIR}/${SCREEN}.json`, 'utf8'));
const size = leg => [meta.pools[LEGS[leg]].flex, meta.pools[LEGS[leg]].ext];
const axesOf = S.axesOf;
const median = xs => { const s = xs.filter(v => v != null && !Number.isNaN(v)).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const r3 = x => x == null ? null : +x.toFixed(3);

function load(w) {
  const b = fs.readFileSync(`${DIR}/${w}/${SCREEN}_search.bin`);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const hdr = new Uint32Array(ab, 0, 8);
  if (hdr[0] !== 0x48435553 || hdr[1] !== 4) throw new Error(`${w}: bad header`);
  const [, , STEPS, MEMBERS, CONDS, CH, RECS, RUNS] = hdr;
  const counts = new Uint16Array(ab, 32, (ab.byteLength - 32) / 2);
  if (counts.length !== RUNS * RECS * CH) throw new Error(`${w}: size mismatch`);
  return { STEPS, MEMBERS, CONDS, CH, RECS, RUNS, counts };
}

// one channel at 1 ms after the transient (record 0 is the empty pre-step tally)
function chan(D, run, ch) {
  const x = [], base = run * D.RECS * D.CH;
  for (let t = 1 + SKIP_MS / DT; t + 1 < D.RECS; t += 2)
    x.push(D.counts[base + t * D.CH + ch] + D.counts[base + (t + 1) * D.CH + ch]);
  return x;
}

const zscore = x => {
  const m = x.reduce((a, v) => a + v, 0) / x.length;
  const sd = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / x.length) || 1;
  return x.map(v => (v - m) / sd);
};

// share of the difference spectrum's band power within one bin of its peak
function concentration(d) {
  const { p, df } = fftPow(d);
  const lo = Math.ceil(BAND[0] / df), hi = Math.floor(BAND[1] / df);
  let pk = lo, tot = 0;
  for (let k = lo; k <= hi; k++) { tot += p[k]; if (p[k] > p[pk]) pk = k; }
  return { conc: tot ? (p[pk - 1] + p[pk] + (p[pk + 1] || 0)) / tot : 0, hz: pk * df };
}

function legRead(D, run, leg) {
  const f = chan(D, run, leg), e = chan(D, run, 6 + leg);
  const secs = f.length / 1000, [nf, ne] = size(leg);
  const hzF = f.reduce((a, v) => a + v, 0) / secs / Math.max(nf, 1);
  const hzE = e.reduce((a, v) => a + v, 0) / secs / Math.max(ne, 1);
  const live = hzF >= MIN_HZ && hzE >= MIN_HZ;
  if (!live) return { hzF: r3(hzF), hzE: r3(hzE), live, alt: false };
  const zf = zscore(f), ze = zscore(e);
  const ip = inPhase(zf, ze, BAND);
  const c = concentration(zf.map((v, i) => v - ze[i]));
  const sh = 250, zs = ze.map((_, i) => ze[(i + sh) % ze.length]);
  const sur = inPhase(zf, zs, BAND);
  const sc = concentration(zf.map((v, i) => v - zs[i]));
  return {
    hzF: r3(hzF), hzE: r3(hzE), live,
    inPhase: ip.inPhase, inPhaseBand: ip.inPhaseBand, peakHz: ip.peakHz,
    conc: r3(c.conc), diffHz: +c.hz.toFixed(2), surrogate: sur.inPhaseBand,
    alt: ip.inPhaseBand <= ALT && c.conc >= CONC,
    altSurrogate: sur.inPhaseBand <= ALT && sc.conc >= CONC,
  };
}

const R = {};
for (const w of WIRINGS) {
  const D = load(w);
  const runs = [];
  for (let j = 0; j < D.RUNS; j++) {
    const legs = LEGS.map((_, l) => legRead(D, j, l));
    const pop = inPhase(chan(D, j, 12), chan(D, j, 13), POP_BAND);
    const mnHz = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15]
      .reduce((a, ch) => a + chan(D, j, ch).reduce((s, v) => s + v, 0), 0) / 1.5;
    runs.push({ m: j >> 1, c: j & 1, legs, pop, mnHz });
  }
  R[w] = { D, runs, at: (m, c) => runs[2 * m + c] };
}
const M = R.real.D.MEMBERS;

// ---------------------------------------------------------------- summaries
const legStat = (w, c, pick, sel = () => true) => median(R[w].runs
  .filter(r => r.c === c && sel(r.m)).flatMap(r => r.legs.filter(l => l.live).map(pick)));
const altLegs = (w, m, c = 0) => R[w].at(m, c).legs.filter(l => l.alt).length;

const byWiring = WIRINGS.map(w => ({
  wiring: w,
  popInPhase: r3(median(R[w].runs.filter(r => r.c === 0).map(r => r.pop.inPhase))),
  popInPhaseBand: r3(median(R[w].runs.filter(r => r.c === 0).map(r => r.pop.inPhaseBand))),
  popPeakHz: median(R[w].runs.filter(r => r.c === 0).map(r => r.pop.peakHz)),
  popInPhaseShipped: r3(median(R[w].runs.filter(r => r.c === 0 && (r.m & S.shippedMask) === 0).map(r => r.pop.inPhaseBand))),
  liveLegs: R[w].runs.filter(r => r.c === 0).reduce((a, r) => a + r.legs.filter(l => l.live).length, 0),
  antagonistBand: r3(legStat(w, 0, l => l.inPhaseBand)),
  surrogateBand: r3(legStat(w, 0, l => l.surrogate)),
  altLegs: R[w].runs.filter(r => r.c === 0).reduce((a, r) => a + r.legs.filter(l => l.alt).length, 0),
  altLegsSurrogate: R[w].runs.filter(r => r.c === 0).reduce((a, r) => a + r.legs.filter(l => l.altSurrogate).length, 0),
  altPeakHz: R[w].runs.filter(r => r.c === 0).flatMap(r => r.legs.filter(l => l.alt).map(l => l.diffHz)).sort((a, b) => a - b),
  altLegsNoCommand: R[w].runs.filter(r => r.c === 1).reduce((a, r) => a + r.legs.filter(l => l.alt).length, 0),
  membersWith2Alt: [...Array(M).keys()].filter(m => altLegs(w, m) >= 2).length,
  motorHz: r3(median(R[w].runs.filter(r => r.c === 0).map(r => r.mnHz))),
}));

// marginal effect of each mechanism on the antagonist band fraction, real wiring
const AX = S.axes;
const marginals = AX.map(ax => {
  const levels = [...new Set([...Array(M).keys()].map(ax.of))];
  return {
    axis: ax.name,
    levels: levels.map(v => {
      const sel = m => ax.of(m) === v;
      const o = { level: v };
      for (const w of WIRINGS) {
        o[w] = {
          antagonistBand: r3(legStat(w, 0, l => l.inPhaseBand, sel)),
          liveLegs: R[w].runs.filter(r => r.c === 0 && sel(r.m)).reduce((a, r) => a + r.legs.filter(l => l.live).length, 0),
          altLegs: R[w].runs.filter(r => r.c === 0 && sel(r.m)).reduce((a, r) => a + r.legs.filter(l => l.alt).length, 0),
          motorHz: r3(median(R[w].runs.filter(r => r.c === 0 && sel(r.m)).map(r => r.mnHz))),
        };
      }
      return o;
    }),
  };
});

// matched comparison: per member, the real wiring's mean antagonist band
// fraction over live legs minus each scramble's
const meanLive = (w, m) => {
  const ls = R[w].at(m, 0).legs.filter(l => l.live);
  return ls.length ? ls.reduce((a, l) => a + l.inPhaseBand, 0) / ls.length : null;
};
const matched = ['deg', 'side'].map(s => {
  const d = [...Array(M).keys()].map(m => {
    const a = meanLive('real', m), b = meanLive(s, m);
    return a == null || b == null ? null : a - b;
  }).filter(v => v != null);
  return { vs: s, pairs: d.length, medianDelta: r3(median(d)), realLower: d.filter(v => v < 0).length };
});

const top = [...Array(M).keys()].map(m => ({
  m, axes: axesOf(m),
  real: altLegs('real', m), deg: altLegs('deg', m), side: altLegs('side', m),
  realNoCmd: altLegs('real', m, 1),
  meanBand: r3(meanLive('real', m)),
  legs: R.real.at(m, 0).legs,
})).sort((a, b) => b.real - a.real || (a.meanBand ?? 1) - (b.meanBand ?? 1)).slice(0, 12);

const report = {
  spec: 'alternation screen: adaptation x rebound x proprio loop x kick, real wiring against degree-preserving scrambles',
  sizes: { members: M, conditions: R.real.D.CONDS, steps: R.real.D.STEPS, dtMs: DT, channels: R.real.D.CH },
  scoring: { skipMs: SKIP_MS, band: BAND, popBand: POP_BAND, altMax: ALT, concMin: CONC, minHz: MIN_HZ, surrogateShiftMs: 250 },
  prep: meta, byWiring, matched, marginals, top,
  members: [...Array(M).keys()].map(m => ({
    member: m, axes: axesOf(m),
    reads: Object.fromEntries(WIRINGS.map(w => [w, COND.map((cn, c) => ({
      condition: cn, pop: R[w].at(m, c).pop, motorHz: r3(R[w].at(m, c).mnHz), legs: R[w].at(m, c).legs,
    }))])),
  })),
};
// x5 and x6 with every axis at its first level are x4's member 0: same seed, same cells, same arithmetic
let identity = null;
if (SCREEN !== 'x4' && fs.existsSync('ext/x4/real/x4_search.bin')) {
  const a = R.real.D, b4 = load4();
  const n = 2 * a.RECS * a.CH;
  identity = b4.length >= n && a.counts.subarray(0, n).every((v, i) => v === b4[i]);
  console.log(`${SCREEN} member 0 against x4 member 0, real wiring: ${identity ? 'byte-identical' : 'DIFFERENT'}`);
}
function load4() {
  const b = fs.readFileSync('ext/x4/real/x4_search.bin');
  return new Uint16Array(b.buffer.slice(b.byteOffset + 32, b.byteOffset + b.byteLength));
}
report.identityWithX4 = identity;
fs.writeFileSync(`${DIR}/${SCREEN}_search.json`, JSON.stringify(report, null, 1));

const L = [];
L.push(`# ${S.title}\n`);
L.push(`${M} members x ${R.real.D.CONDS} conditions x ${WIRINGS.length} wirings, ${R.real.D.STEPS} steps at ${DT} ms, scored ${SKIP_MS} ms on.\n`);
L.push(`| wiring | pop in-phase (peak / band) | pop peak Hz | pop band, shipped cells | live legs | antagonist band | surrogate | alternating legs | same call on surrogate | no command | members >= 2 | motor Hz |`);
L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of byWiring) L.push(`| ${r.wiring} | ${r.popInPhase} / ${r.popInPhaseBand} | ${r.popPeakHz} | ${r.popInPhaseShipped} | ${r.liveLegs} | ${r.antagonistBand} | ${r.surrogateBand} | ${r.altLegs} | ${r.altLegsSurrogate} | ${r.altLegsNoCommand} | ${r.membersWith2Alt} | ${r.motorHz} |`);
L.push(``);
L.push(`Peak frequencies of the alternating calls, real wiring: ${byWiring[0].altPeakHz.join(', ')} Hz.\n`);
L.push(`Matched (real minus scramble, mean antagonist band over live legs): ${matched.map(x => `${x.vs}: median ${x.medianDelta}, real lower in ${x.realLower}/${x.pairs}`).join('; ')}.\n`);
L.push(`## Mechanism marginals\n`);
L.push(`| axis | level | real band / live / alt | deg band / live / alt | side band / live / alt |`);
L.push(`|---|---|---|---|---|`);
for (const a of marginals) for (const v of a.levels)
  L.push(`| ${a.axis} | ${v.level} | ${WIRINGS.map(w => `${v[w].antagonistBand} / ${v[w].liveLegs} / ${v[w].altLegs}`).join(' | ')} |`);
L.push(``);
L.push(`## Members with the most alternating legs, real wiring\n`);
for (const t of top) L.push(`- m=${t.m} ${JSON.stringify(t.axes)}: real ${t.real}, deg ${t.deg}, side ${t.side}, no-command ${t.realNoCmd}; mean band ${t.meanBand}`);
if (identity != null) L.push(`\nAll axes off against cordx4 member 0, real wiring: ${identity ? 'byte-identical' : 'DIFFERENT'}.`);
fs.writeFileSync(`${DIR}/${SCREEN}_search.md`, L.join('\n') + '\n');
console.log(L.join('\n'));
