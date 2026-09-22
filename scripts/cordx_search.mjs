// Scoring the external-cord ensemble (cordx.bend): gait metrics on the six leg
// pools plus the bilateral phase statistic on the cord population channels.
//
//   ./cordx && node scripts/cordx_search.mjs
//
// Reads ext/cord_search.bin -- eight channels of spike counts per 0.5 ms step:
// channels 0-5 are the leg motor pools (the IR's legOrder), 6 and 7 are the left
// and right halves of the cord population. For every run it computes:
//
//   * the pool gait metrics of src/exp/pools.js (as scripts/cord_search.mjs)
//   * the in-phase fraction at the population spectral peak: with xL, xR the two
//     population traces at 1 ms, P+ the power of xL+xR and P- the power of
//     xL-xR, the statistic is P+(f*)/(P+(f*)+P-(f*)) at the band peak f* of P+.
//     1.0 means the left and right populations fluctuate perfectly together at
//     the dominant frequency; 0.5 is the no-structure floor; near 0 would mean
//     an alternating (anti-phase) mode.
//
// The battery row is the command condition: silencing the descending command
// must abolish a walking rhythm for the rhythm to count.
import fs from 'node:fs';
import { poolMetrics, traceFromCounts, LEG_ORDER, BANDS, classifyGait } from '../src/exp/pools.js';

const IN = 'ext/cord_search.bin', OUT = 'ext/cord_search';
const DT = 0.5;                        // ms per step
const BIN = 4;                         // 2 ms bins for the gait instrument
const COHERENCE = 0.3;
const COND = ['baseline', 'ablate_13A', 'ablate_13B', 'ablate_19B', 'no_commissural', 'no_command'];
const AXES = ['commissural x3', '13A gain x2', '13B gain x2', '19B gain x2', 'tonic 4 mV'];
const PMODE = ['proprio open', 'proprio 5 ms', 'proprio 20 ms', 'proprio 80 ms'];
const BAND = [2, 20];                  // Hz: the band the population peak is read in
const SKIP_MS = 500;                   // transient dropped before the spectra

const b = fs.readFileSync(IN);
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const hdr = new Uint32Array(ab, 0, 8);
if (hdr[0] !== 0x48435553) throw new Error(`bad magic ${hdr[0].toString(16)}`);
const STEPS = hdr[2], MEMBERS = hdr[3], CONDS = hdr[4], CH = hdr[5], RECS = hdr[6], RUNS = hdr[7];
const counts = new Uint16Array(ab, 32, (ab.byteLength - 32) / 2);
const perRun = RECS * CH;
if (counts.length !== RUNS * perRun) throw new Error(`expected ${RUNS * perRun} counts, got ${counts.length}`);

// the order cordx.bend writes: commissural group 0, then 1, then 2
const runAt = [];
for (const grp of [0, 1, 2]) {
  const n = grp === 2 ? MEMBERS : (MEMBERS / 2) * 5;
  for (let j = 0; j < n; j++) {
    runAt.push({ m: grp === 2 ? j : 2 * Math.floor(j / 5) + (grp & 1), c: grp === 2 ? 4 : (j % 5 < 4 ? j % 5 : 5) });
  }
}
if (runAt.length !== RUNS) throw new Error(`run map has ${runAt.length} entries, expected ${RUNS}`);

// ---------------------------------------------------------------- spectra
// one-sided power spectrum of a 1 ms-sampled signal on a Hann window, via a
// radix-2 FFT on the next power of two
function fftPow(x) {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  const mean = x.reduce((a, v) => a + v, 0) / x.length;
  for (let i = 0; i < x.length; i++) re[i] = (x[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (x.length - 1)));
  for (let s = 2; s <= n; s <<= 1) {
    const h = s >> 1, wr = Math.cos(-2 * Math.PI / s), wi = Math.sin(-2 * Math.PI / s);
    for (let k = 0; k < n; k += s) {
      let ar = 1, ai = 0;
      for (let j = 0; j < h; j++) {
        const tr = re[k + j + h] * ar - im[k + j + h] * ai, ti = re[k + j + h] * ai + im[k + j + h] * ar;
        re[k + j + h] = re[k + j] - tr; im[k + j + h] = im[k + j] - ti;
        re[k + j] += tr; im[k + j] += ti;
        const t = ar * wr - ai * wi; ai = ar * wi + ai * wr; ar = t;
      }
    }
  }
  const p = new Float64Array(n >> 1);
  for (let k = 1; k < (n >> 1); k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return { p, df: 1000 / n };           // Hz per bin at 1 ms sampling
}

// in-phase statistic for a pair of equal-length traces
function inPhase(xL, xR) {
  const plus = fftPow(xL.map((v, i) => v + xR[i]));
  const minus = fftPow(xL.map((v, i) => v - xR[i]));
  const { p: Pp, df } = plus, Pm = minus.p;
  const kLo = Math.ceil(BAND[0] / df), kHi = Math.floor(BAND[1] / df);
  let kStar = kLo;
  for (let k = kLo; k <= kHi; k++) if (Pp[k] > Pp[kStar]) kStar = k;
  let bp = 0, bm = 0;
  for (let k = kLo; k <= kHi; k++) { bp += Pp[k]; bm += Pm[k]; }
  return {
    peakHz: +(kStar * df).toFixed(2),
    inPhase: +(Pp[kStar] / (Pp[kStar] + Pm[kStar] || 1)).toFixed(3),
    inPhaseBand: +(bp / (bp + bm || 1)).toFixed(3),
    peakPower: Pp[kStar],
  };
}

// steps -> 1 ms samples for one channel of one run, transient dropped
function chan1ms(run, ch) {
  const x = [];
  const s0 = 1 + Math.round(SKIP_MS / DT);
  for (let t = s0; t + 1 < RECS; t += 2)
    x.push(counts[run * perRun + t * CH + ch] + counts[run * perRun + (t + 1) * CH + ch]);
  return x;
}

// ---------------------------------------------------------------- read runs
const G = Array.from({ length: MEMBERS }, () => new Array(CONDS).fill(null));
runAt.forEach((r, k) => {
  const raw = counts.subarray(k * perRun, (k + 1) * perRun);
  const pool = new Uint16Array((RECS - 1) * 6);
  for (let t = 1; t < RECS; t++) for (let c = 0; c < 6; c++) pool[(t - 1) * 6 + c] = raw[t * CH + c];
  const gait = poolMetrics(traceFromCounts(pool, RECS - 1, DT, BIN), { startMs: 100 });
  const pop = inPhase(chan1ms(k, 6), chan1ms(k, 7));
  const pair = [0, 1, 2].map(seg => inPhase(chan1ms(k, seg), chan1ms(k, seg + 3)));
  const totSpikes = raw.slice(CH).reduce((a, v) => a + v, 0);
  G[r.m][r.c] = { gait, pop, pair, totSpikes };
});
for (let m = 0; m < MEMBERS; m++) for (let c = 0; c < CONDS; c++) if (!G[m][c]) throw new Error(`missing run m=${m} c=${c}`);

const pmodeOf = m => (m >> 5) & 3;
const axesOf = m => [...AXES.filter((_, i) => (m >> i) & 1), PMODE[pmodeOf(m)]];
const median = xs => { const s = [...xs].sort((a, b2) => a - b2); return s[s.length >> 1]; };

const rhythmic = g => g.gait.bestStrength >= COHERENCE && g.gait.bestF >= BANDS.cadence[0]
  && g.gait.bestF <= BANDS.cadence[1] && g.gait.bestStrengthLegs.filter(v => v >= COHERENCE).length >= 3;

// ---------------------------------------------------------------- report
const byPmode = PMODE.map((name, p) => {
  const ms = [...Array(MEMBERS).keys()].filter(m => pmodeOf(m) === p);
  const base = ms.map(m => G[m][0]);
  return {
    mode: name,
    members: ms.length,
    medianInPhase: +median(base.map(g => g.pop.inPhase)).toFixed(3),
    medianInPhaseBand: +median(base.map(g => g.pop.inPhaseBand)).toFixed(3),
    medianPeakHz: +median(base.map(g => g.pop.peakHz)).toFixed(2),
    medianPoolHz: +median(base.map(g => g.gait.meanHz)).toFixed(1),
    liveRhythms: base.filter(rhythmic).length,
  };
});

const perCond = COND.map((name, c) => ({
  condition: name,
  medianInPhase: +median(G.map(r => r[c].pop.inPhase)).toFixed(3),
  medianInPhaseBand: +median(G.map(r => r[c].pop.inPhaseBand)).toFixed(3),
  medianPeakHz: +median(G.map(r => r[c].pop.peakHz)).toFixed(2),
  medianPoolHz: +median(G.map(r => r[c].gait.meanHz)).toFixed(1),
  medianPeriodicity: +median(G.map(r => r[c].gait.bestStrength)).toFixed(3),
  medianSpikes: Math.round(median(G.map(r => r[c].totSpikes))),
  liveRhythms: G.filter(r => rhythmic(r[c])).length,
}));

// does the proprioceptive loop matter? compare matched members: the mode bits
// differ only in bits 5-6, so pair each closed-mode member with its open twin
const loopEffect = [1, 2, 3].map(p => {
  const diffs = [];
  for (let m = 0; m < MEMBERS; m++) if (pmodeOf(m) === p) {
    const twin = m & ~96;              // clear bits 5-6 -> the open twin
    diffs.push(G[m][0].pop.inPhase - G[twin][0].pop.inPhase);
  }
  return { vs: PMODE[p], medianDeltaInPhase: +median(diffs).toFixed(3), n: diffs.length };
});

const live = [...Array(MEMBERS).keys()].filter(m => rhythmic(G[m][0]));
const pairMedians = [0, 1, 2].map(seg => ({
  pair: `${LEG_ORDER[seg]} vs ${LEG_ORDER[seg + 3]}`,
  inPhase: +median(G.map(r => r[0].pair[seg].inPhase)).toFixed(3),
  peakHz: +median(G.map(r => r[0].pair[seg].peakHz)).toFixed(2),
}));
const report = {
  spec: 'cord ensemble on an externally packed cord IR: gain axes x named perturbations x proprioceptive loop {open, 5, 20, 80 ms}',
  sizes: { members: MEMBERS, conditions: CONDS, steps: STEPS, runs: RUNS, dtMs: DT, channels: CH },
  axes: [...AXES, 'proprio mode (2 bits: open/5/20/80 ms)'], conditions: COND,
  bandHz: BAND, skipMs: SKIP_MS,
  baselineMedian: {
    inPhaseAtPeak: +median(G.map(r => r[0].pop.inPhase)).toFixed(3),
    inPhaseBand: +median(G.map(r => r[0].pop.inPhaseBand)).toFixed(3),
    peakHz: +median(G.map(r => r[0].pop.peakHz)).toFixed(2),
    poolHz: +median(G.map(r => r[0].gait.meanHz)).toFixed(1),
    poolPeriodicity: +median(G.map(r => r[0].gait.bestStrength)).toFixed(3),
  },
  perCondition: perCond,
  byProprioMode: byPmode,
  legPairInPhase: pairMedians,
  loopEffect,
  liveRhythms: live.length,
  members: G.map((row, m) => ({
    member: m, axes: axesOf(m), rhythmic: rhythmic(row[0]),
    reads: row.map((g, c) => ({
      condition: COND[c], inPhase: g.pop.inPhase, inPhaseBand: g.pop.inPhaseBand, peakHz: g.pop.peakHz,
      poolHz: +g.gait.meanHz.toFixed(1), periodicity: +g.gait.bestStrength.toFixed(3),
      bestF: +g.gait.bestF.toFixed(2), legsStepping: g.gait.legsStepping,
    })),
  })),
};
fs.writeFileSync(`${OUT}.json`, JSON.stringify(report, null, 1));

const L = [];
L.push(`# Cord ensemble, external IR\n`);
L.push(`${MEMBERS} members over 7 axes x ${CONDS} perturbations, ${STEPS} steps of the cord at ${DT} ms. The in-phase fraction is the even-component share of bilateral population power at the ${BAND[0]}-${BAND[1]} Hz peak: 1.0 is a fully in-phase mode, ~0.5 is no bilateral structure.\n`);
L.push(`## Baseline\n`);
L.push(`median in-phase fraction at peak: **${report.baselineMedian.inPhaseAtPeak}** (band-integrated ${report.baselineMedian.inPhaseBand}), peak at ${report.baselineMedian.peakHz} Hz, median pool rate ${report.baselineMedian.poolHz} Hz, live leg rhythms ${live.length}/${MEMBERS}.\n`);
L.push(`## Proprioceptive loop\n`);
L.push(`| mode | members | median in-phase | band | peak Hz | pool Hz | rhythms |`);
L.push(`|---|---|---|---|---|---|---|`);
for (const r of byPmode) L.push(`| ${r.mode} | ${r.members} | ${r.medianInPhase} | ${r.medianInPhaseBand} | ${r.medianPeakHz} | ${r.medianPoolHz} | ${r.liveRhythms} |`);
L.push(``);
L.push(`Closed-minus-open on matched members: ${loopEffect.map(e => `${e.vs}: ${e.medianDeltaInPhase > 0 ? '+' : ''}${e.medianDeltaInPhase}`).join(', ')}.\n`);
L.push(`## Leg pairs\n`);
L.push(`| pair | median in-phase at peak | peak Hz |`);
L.push(`|---|---|---|`);
for (const r of pairMedians) L.push(`| ${r.pair} | ${r.inPhase} | ${r.peakHz} |`);
L.push(``);
L.push(`## Every condition, ensemble median\n`);
L.push(`| condition | in-phase | band | peak Hz | pool Hz | periodicity | spikes | rhythms |`);
L.push(`|---|---|---|---|---|---|---|---|`);
for (const r of perCond) L.push(`| \`${r.condition}\` | ${r.medianInPhase} | ${r.medianInPhaseBand} | ${r.medianPeakHz} | ${r.medianPoolHz} | ${r.medianPeriodicity} | ${r.medianSpikes} | ${r.liveRhythms} |`);
L.push(``);
fs.writeFileSync(`${OUT}.md`, L.join('\n') + '\n');

console.log(`${OUT}.{json,md}: ${MEMBERS} members x ${CONDS} perturbations, ${RUNS} runs`);
console.log(`baseline: in-phase ${report.baselineMedian.inPhaseAtPeak} (band ${report.baselineMedian.inPhaseBand}) at ${report.baselineMedian.peakHz} Hz, pool ${report.baselineMedian.poolHz} Hz, rhythms ${live.length}/${MEMBERS}`);
for (const r of byPmode) console.log(`  ${r.mode.padEnd(16)} in-phase ${r.medianInPhase}  peak ${r.medianPeakHz} Hz  pool ${r.medianPoolHz} Hz  rhythms ${r.liveRhythms}`);
for (const e of loopEffect) console.log(`  loop ${e.vs}: closed-minus-open in-phase ${e.medianDeltaInPhase > 0 ? '+' : ''}${e.medianDeltaInPhase}`);
for (const r of perCond) console.log(`  ${r.condition.padEnd(16)} in-phase ${r.medianInPhase}  pool ${r.medianPoolHz} Hz  spikes ${r.medianSpikes}`);
