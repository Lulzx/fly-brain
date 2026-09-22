// Scoring the mechanism-screen ensemble (cordx2.bend): same readouts as
// cordx_search.mjs, plus the marginal effect of each mechanism axis on the
// bilateral in-phase statistic.
//
//   ./cordx2 && node scripts/cordx2_search.mjs
//
// Member bits: 0 commissural x3, 1 13A x2, 2 13B x2, 3 inhibitory x0.6,
// 4-5 proprioceptive loop {open, shared 20 ms, split 20 ms, split 80 ms},
// 6 per-cell delay classes, 7 synaptic depression (depU 0.2), 8 unilateral
// kick for the first 200 ms.
//
// For each mechanism bit the readout is the matched difference in in-phase
// fraction at the population peak, baseline condition, members differing in
// that bit alone. The headline question is whether any member drops toward
// the ~0.5 no-structure floor or, better, produces a qualifying gait.
import fs from 'node:fs';
import { poolMetrics, traceFromCounts, LEG_ORDER, BANDS, classifyGait } from '../src/exp/pools.js';

const IN = 'ext/cord2_search.bin', OUT = 'ext/cord2_search';
const DT = 0.5;
const BIN = 4;
const COHERENCE = 0.3;
const COND = ['baseline', 'ablate_13A', 'ablate_13B', 'ablate_19B', 'no_commissural', 'no_command'];
const AXES = ['commissural x3', '13A gain x2', '13B gain x2', 'inhibitory x0.6'];
const PMODE = ['open', 'shared 20 ms', 'split 20 ms', 'split 80 ms'];
const MECH = [
  { bit: 6, name: 'delay classes' },
  { bit: 7, name: 'depression depU 0.2' },
  { bit: 8, name: 'kick' },
  { bit: 3, name: 'inhibitory x0.6' },
];
const BAND = [2, 20];
const SKIP_MS = 500;

const b = fs.readFileSync(IN);
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const hdr = new Uint32Array(ab, 0, 8);
if (hdr[0] !== 0x48435553) throw new Error(`bad magic ${hdr[0].toString(16)}`);
const STEPS = hdr[2], MEMBERS = hdr[3], CONDS = hdr[4], CH = hdr[5], RECS = hdr[6], RUNS = hdr[7];
const counts = new Uint16Array(ab, 32, (ab.byteLength - 32) / 2);
const perRun = RECS * CH;
if (counts.length !== RUNS * perRun) throw new Error(`expected ${RUNS * perRun} counts, got ${counts.length}`);

// the order cordx2.bend writes: commissural group 0, then 1, then 2
const runAt = [];
for (const grp of [0, 1, 2]) {
  const n = grp === 2 ? MEMBERS : (MEMBERS / 2) * 5;
  for (let j = 0; j < n; j++) {
    runAt.push({ m: grp === 2 ? j : 2 * Math.floor(j / 5) + (grp & 1), c: grp === 2 ? 4 : (j % 5 < 4 ? j % 5 : 5) });
  }
}
if (runAt.length !== RUNS) throw new Error(`run map has ${runAt.length} entries, expected ${RUNS}`);

// ---------------------------------------------------------------- spectra
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
  return { p, df: 1000 / n };
}

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

const pmodeOf = m => (m >> 4) & 3;
const axesOf = m => [...AXES.filter((_, i) => (m >> i) & 1), PMODE[pmodeOf(m)],
  ...MECH.filter(me => me.bit > 3 && (m >> me.bit) & 1).map(me => me.name)];
const median = xs => { const s = [...xs].sort((a, b2) => a - b2); return s[s.length >> 1]; };

const rhythmic = g => g.gait.bestStrength >= COHERENCE && g.gait.bestF >= BANDS.cadence[0]
  && g.gait.bestF <= BANDS.cadence[1] && g.gait.bestStrengthLegs.filter(v => v >= COHERENCE).length >= 3;

// ---------------------------------------------------------------- mechanism screen
// matched pairs: members differing only in the mechanism bit, baseline condition
const mech = MECH.map(me => {
  const on = [], off = [], diffs = [], dHz = [], dRate = [];
  for (let m = 0; m < MEMBERS; m++) if ((m >> me.bit) & 1) {
    const t = m & ~(1 << me.bit);
    on.push(G[m][0]); off.push(G[t][0]);
    diffs.push(G[m][0].pop.inPhase - G[t][0].pop.inPhase);
    dHz.push(G[m][0].pop.peakHz - G[t][0].pop.peakHz);
    dRate.push(G[m][0].gait.meanHz - G[t][0].gait.meanHz);
  }
  return {
    mechanism: me.name, pairs: diffs.length,
    medianInPhaseOff: +median(off.map(g => g.pop.inPhase)).toFixed(3),
    medianInPhaseOn: +median(on.map(g => g.pop.inPhase)).toFixed(3),
    medianDeltaInPhase: +median(diffs).toFixed(3),
    medianDeltaPeakHz: +median(dHz).toFixed(2),
    medianDeltaPoolHz: +median(dRate).toFixed(1),
    minInPhaseOn: +Math.min(...on.map(g => g.pop.inPhase)).toFixed(3),
    rhythmsOn: on.filter(rhythmic).length,
  };
});

// the delay x depression cell is the dynamical-DOF combination of interest
const combo = [];
for (let m = 0; m < MEMBERS; m++) if (((m >> 6) & 3) === 3) {
  const t = m & ~192;
  combo.push({
    m, twin: t,
    inPhase: G[m][0].pop.inPhase, inPhaseTwin: G[t][0].pop.inPhase,
    peakHz: G[m][0].pop.peakHz, poolHz: G[m][0].gait.meanHz,
    pmode: pmodeOf(m), kick: (m >> 8) & 1,
  });
}
const comboSummary = {
  n: combo.length,
  medianInPhase: +median(combo.map(c => c.inPhase)).toFixed(3),
  medianInPhaseTwin: +median(combo.map(c => c.inPhaseTwin)).toFixed(3),
  medianPeakHz: +median(combo.map(c => c.peakHz)).toFixed(2),
  medianPoolHz: +median(combo.map(c => c.poolHz)).toFixed(1),
  minInPhase: +Math.min(...combo.map(c => c.inPhase)).toFixed(3),
};

const byPmode = PMODE.map((name, p) => {
  const ms = [...Array(MEMBERS).keys()].filter(m => pmodeOf(m) === p);
  const base = ms.map(m => G[m][0]);
  return {
    mode: name, members: ms.length,
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

const loopEffect = [1, 2, 3].map(p => {
  const diffs = [];
  for (let m = 0; m < MEMBERS; m++) if (pmodeOf(m) === p) {
    const twin = m & ~48;
    diffs.push(G[m][0].pop.inPhase - G[twin][0].pop.inPhase);
  }
  return { vs: PMODE[p], medianDeltaInPhase: +median(diffs).toFixed(3), n: diffs.length };
});

const live = [...Array(MEMBERS).keys()].filter(m => rhythmic(G[m][0]));
const lowPhase = [...Array(MEMBERS).keys()]
  .map(m => ({ m, ip: G[m][0].pop.inPhase })).sort((a, b2) => a.ip - b2.ip).slice(0, 12);
const pairMedians = [0, 1, 2].map(seg => ({
  pair: `${LEG_ORDER[seg]} vs ${LEG_ORDER[seg + 3]}`,
  inPhase: +median(G.map(r => r[0].pair[seg].inPhase)).toFixed(3),
  peakHz: +median(G.map(r => r[0].pair[seg].peakHz)).toFixed(2),
}));
const report = {
  spec: 'mechanism screen on the external cord IR: gain axes x perturbations x {delays, depression, split feedback, kick, inhibitory gain}',
  sizes: { members: MEMBERS, conditions: CONDS, steps: STEPS, runs: RUNS, dtMs: DT, channels: CH },
  axes: [...AXES, 'proprio mode (bits 4-5: open/shared/split20/split80)', ...MECH.map(m2 => m2.name)],
  conditions: COND, bandHz: BAND, skipMs: SKIP_MS,
  baselineMedian: {
    inPhaseAtPeak: +median(G.map(r => r[0].pop.inPhase)).toFixed(3),
    inPhaseBand: +median(G.map(r => r[0].pop.inPhaseBand)).toFixed(3),
    peakHz: +median(G.map(r => r[0].pop.peakHz)).toFixed(2),
    poolHz: +median(G.map(r => r[0].gait.meanHz)).toFixed(1),
    poolPeriodicity: +median(G.map(r => r[0].gait.bestStrength)).toFixed(3),
  },
  mechanisms: mech,
  delayAndDepression: comboSummary,
  perCondition: perCond,
  byProprioMode: byPmode,
  legPairInPhase: pairMedians,
  loopEffect,
  liveRhythms: live.length,
  lowestInPhase: lowPhase.map(x => ({ member: x.m, inPhase: x.ip, axes: axesOf(x.m) })),
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
L.push(`# Cord mechanism screen, external IR\n`);
L.push(`${MEMBERS} members over 9 axes x ${CONDS} perturbations, ${STEPS} steps at ${DT} ms. Mechanism deltas are matched pairs differing in that bit alone, baseline condition.\n`);
L.push(`## Baseline\n`);
L.push(`median in-phase fraction at peak: **${report.baselineMedian.inPhaseAtPeak}** (band-integrated ${report.baselineMedian.inPhaseBand}), peak at ${report.baselineMedian.peakHz} Hz, median pool rate ${report.baselineMedian.poolHz} Hz, live leg rhythms ${live.length}/${MEMBERS}.\n`);
L.push(`## Mechanisms\n`);
L.push(`| mechanism | pairs | in-phase off | in-phase on | delta | delta peak Hz | delta pool Hz | min on | rhythms on |`);
L.push(`|---|---|---|---|---|---|---|---|---|`);
for (const r of mech) L.push(`| ${r.mechanism} | ${r.pairs} | ${r.medianInPhaseOff} | ${r.medianInPhaseOn} | ${r.medianDeltaInPhase > 0 ? '+' : ''}${r.medianDeltaInPhase} | ${r.medianDeltaPeakHz > 0 ? '+' : ''}${r.medianDeltaPeakHz} | ${r.medianDeltaPoolHz > 0 ? '+' : ''}${r.medianDeltaPoolHz} | ${r.minInPhaseOn} | ${r.rhythmsOn} |`);
L.push(``);
L.push(`Delay classes x depression together (bits 6-7 set, n=${comboSummary.n}): median in-phase ${comboSummary.medianInPhase} vs ${comboSummary.medianInPhaseTwin} without either; peak ${comboSummary.medianPeakHz} Hz; min ${comboSummary.minInPhase}.\n`);
L.push(`## Proprioceptive loop\n`);
L.push(`| mode | members | median in-phase | band | peak Hz | pool Hz | rhythms |`);
L.push(`|---|---|---|---|---|---|---|`);
for (const r of byPmode) L.push(`| ${r.mode} | ${r.members} | ${r.medianInPhase} | ${r.medianInPhaseBand} | ${r.medianPeakHz} | ${r.medianPoolHz} | ${r.liveRhythms} |`);
L.push(``);
L.push(`Closed-minus-open on matched members: ${loopEffect.map(e => `${e.vs}: ${e.medianDeltaInPhase > 0 ? '+' : ''}${e.medianDeltaInPhase}`).join(', ')}.\n`);
L.push(`## Lowest in-phase members, baseline\n`);
for (const x of lowPhase) L.push(`- m=${x.m} in-phase ${x.ip} — ${axesOf(x.m).join(', ')}`);
L.push(``);
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
for (const r of mech) console.log(`  ${r.mechanism.padEnd(20)} delta in-phase ${r.medianDeltaInPhase > 0 ? '+' : ''}${r.medianDeltaInPhase}  on ${r.medianInPhaseOn}  min ${r.minInPhaseOn}  rhythms ${r.rhythmsOn}`);
console.log(`  delays+depression     median in-phase ${comboSummary.medianInPhase} vs ${comboSummary.medianInPhaseTwin} off, min ${comboSummary.minInPhase}`);
for (const r of byPmode) console.log(`  ${r.mode.padEnd(16)} in-phase ${r.medianInPhase}  peak ${r.medianPeakHz} Hz  pool ${r.medianPoolHz} Hz  rhythms ${r.liveRhythms}`);
for (const x of lowPhase.slice(0, 6)) console.log(`  lowest m=${x.m} in-phase ${x.ip} — ${axesOf(x.m).join(', ')}`);
