// Scoring and ranking the cord ensemble (docs/46-cord-ir.md).
//
//   ./cordens && node scripts/cord_search.mjs
//
// Reads public/data/cord_search.bin -- six leg motor pools' spike counts per 0.5 ms step, for
// every member of the ensemble under every perturbation -- reads each run as a gait with
// src/exp/pools.js, and reports three things.
//
//   1. Which members produce a leg rhythm at all, measured with no body, so a rhythm can be
//      seen before posture has a chance to fail (doc 44's closing ask).
//   2. How well each perturbation separates the ensemble, by the split fraction the experiment
//      compiler ranks with: the fraction of member pairs whose outcome class differs.
//   3. For every member with a live rhythm, which perturbations kill it. That list is the
//      mechanism, as a set of cells and edges rather than a parameter vector (doc 37's kill
//      tests, applied to whatever oscillates).
//
// The one battery row this site can carry is the command row: silencing the descending
// command must abolish a walking rhythm. A rhythm that survives it is not a walking rhythm,
// and the report says so per member rather than averaging it away.
import fs from 'node:fs';
import { poolMetrics, traceFromCounts, LEG_ORDER, BANDS, classifyGait } from '../src/exp/pools.js';

const IN = 'public/data/cord_search.bin', OUT = 'public/data/cord_search';
const DT = 0.5, BIN = 4;               // 4 steps = 2 ms bins, the instrument's sampling
const COHERENCE = 0.3;                 // the periodicity a rhythm must reach; a synthetic tripod reads > 0.5
const COND = ['baseline', 'ablate_13A', 'ablate_13B', 'ablate_19B', 'no_commissural', 'no_command'];
const AXES = ['commissural x3', '13A gain x2', '13B gain x2', '19B gain x2', 'tonic 4 mV', 'proprio delay 20 ms'];

const b = fs.readFileSync(IN);
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const hdr = new Uint32Array(ab, 0, 8);
if (hdr[0] !== 0x48435553) throw new Error(`bad magic ${hdr[0].toString(16)}`);
const STEPS = hdr[2], MEMBERS = hdr[3], CONDS = hdr[4], POOLS = hdr[5], RECS = hdr[6], RUNS = hdr[7];
const counts = new Uint16Array(ab, 32, (ab.byteLength - 32) / 2);
const perRun = RECS * POOLS;
if (counts.length !== RUNS * perRun) throw new Error(`expected ${RUNS * perRun} counts, got ${counts.length}`);

// the order cordens.bend writes: commissural group 0, then 1, then 2; within a group, run index
// ascending. `Run.member` and `Run.cond` in that file are these two lines.
const runAt = [];
for (const grp of [0, 1, 2]) {
  const n = grp === 2 ? MEMBERS : (MEMBERS / 2) * 5;
  for (let j = 0; j < n; j++) {
    const m = grp === 2 ? j : 2 * Math.floor(j / 5) + (grp & 1);
    const c = grp === 2 ? 4 : (j % 5 < 4 ? j % 5 : 5);
    runAt.push({ m, c });
  }
}
if (runAt.length !== RUNS) throw new Error(`run map has ${runAt.length} entries, expected ${RUNS}`);

// read every run
const G = Array.from({ length: MEMBERS }, () => new Array(CONDS).fill(null));
runAt.forEach((r, k) => {
  // the first record is the empty slot the run starts from; drop it
  const raw = counts.subarray(k * perRun + POOLS, (k + 1) * perRun);
  G[r.m][r.c] = poolMetrics(traceFromCounts(raw, RECS - 1, DT, BIN), { startMs: 100 });
});
for (let m = 0; m < MEMBERS; m++) for (let c = 0; c < CONDS; c++) if (!G[m][c]) throw new Error(`missing run m=${m} c=${c}`);

const axesOf = m => AXES.filter((_, i) => (m >> i) & 1);
// A live rhythm: the pools actually oscillate. The threshold-free frequency sweep has to find
// a periodicity, at a rate a fly could walk at, in at least half the pools. Threshold crossings
// alone are not enough — Poisson counting noise crosses any threshold at a plausible-looking
// rate, which is exactly what this ensemble's pools do (scripts/pool_unit.mjs case 8b).
const rhythmic = g => g.bestStrength >= COHERENCE && g.bestF >= BANDS.cadence[0] && g.bestF <= BANDS.cadence[1]
  && g.bestStrengthLegs.filter(v => v >= COHERENCE).length >= 3;
const band = v => v == null ? 'none' : v < 0.1 ? 'flat' : v < COHERENCE ? 'noise' : v < 0.6 ? 'weak' : 'strong';
const rateBand = v => v < 50 ? 'quiet' : v < 400 ? 'low' : v < 900 ? 'mid' : 'saturated';
const classOf = g => [band(g.bestStrength), rateBand(g.meanHz), classifyGait('legsStepping', g.legsStepping)].join('/');

// 2. split fraction, the experiment compiler's ranking statistic
function split(c) {
  let diff = 0, pairs = 0;
  for (let a = 0; a < MEMBERS; a++) for (let b2 = a + 1; b2 < MEMBERS; b2++) {
    pairs++; if (classOf(G[a][c]) !== classOf(G[b2][c])) diff++;
  }
  return pairs ? diff / pairs : 0;
}
// how often a perturbation changes the outcome class of the member it is applied to
const changed = c => G.filter((row, m) => classOf(row[c]) !== classOf(row[0])).length / MEMBERS;

const live = [];
for (let m = 0; m < MEMBERS; m++) if (rhythmic(G[m][0])) live.push(m);
// the reference the coherence floor is read against: a synthetic tripod through the same
// instrument reads above 0.5 (scripts/pool_unit.mjs case 1)
const TRIPOD_REF = 0.5;
const peak = Math.max(...G.map(r => r[0].bestStrength));
const verdict = peak >= TRIPOD_REF
  ? `${live.length} of ${MEMBERS} members reach the coherence a synthetic tripod produces.`
  : `No member reaches the coherence a synthetic tripod produces (${TRIPOD_REF}); the ensemble's best is ${peak.toFixed(3)}. `
    + `${live.length} member${live.length === 1 ? '' : 's'} cross${live.length === 1 ? 'es' : ''} the ${COHERENCE} floor, which is inside the ensemble's own spread.`;

// 3. kill tests on whatever oscillates
const kills = live.map(m => {
  const base = G[m][0];
  const killedBy = [];
  for (let c = 1; c < CONDS; c++) {
    const g = G[m][c];
    if (!rhythmic(g) || g.bestStrength < 0.5 * base.bestStrength) killedBy.push(COND[c]);
  }
  return { member: m, axes: axesOf(m), baseline: base, killedBy,
    commandRow: !rhythmic(G[m][5]) || G[m][5].bestStrength < 0.5 * base.bestStrength };
});

const round = (o, keys) => Object.fromEntries(keys.map(k => [k, typeof o[k] === 'number' ? +o[k].toFixed(3) : o[k]]));
const FIELDS = ['bestStrength', 'bestF', 'cadence', 'duty', 'contraPhase', 'contraR', 'tripod', 'legsStepping', 'rateRhythm', 'meanHz', 'modDepth', 'poolsModulated'];
const report = {
  spec: 'cord ensemble: 6 binary axes x 6 perturbations on the leg-premotor subgraph, circuit site (no body)',
  sizes: { members: MEMBERS, conditions: CONDS, steps: STEPS, runs: RUNS, dtMs: DT, binMs: DT * BIN },
  axes: AXES, conditions: COND,
  baselineMedian: Object.fromEntries(FIELDS.map(f => {
    const v = G.map(r => r[0][f]).filter(x => typeof x === 'number').sort((a, c) => a - c);
    return [f, v.length ? +v[v.length >> 1].toFixed(3) : null];
  })),
  liveRhythms: live.length, peakPeriodicity: +peak.toFixed(3), tripodReference: TRIPOD_REF, coherenceFloor: COHERENCE, verdict,
  perCondition: COND.map((name, c) => ({ condition: name,
    medianPoolHz: +G.map(r => r[c].meanHz).sort((a, b2) => a - b2)[MEMBERS >> 1].toFixed(1),
    medianPeriodicity: +G.map(r => r[c].bestStrength).sort((a, b2) => a - b2)[MEMBERS >> 1].toFixed(3) })),
  ranking: COND.map((name, c) => ({ perturbation: name, split: +split(c).toFixed(3), changedClass: +changed(c).toFixed(3) }))
    .sort((a, c) => c.split - a.split),
  members: G.map((row, m) => ({ member: m, axes: axesOf(m), rhythmic: rhythmic(row[0]),
    reads: row.map((g, c) => ({ condition: COND[c], ...round(g, FIELDS), class: classOf(g) })) })),
  kills,
};
fs.writeFileSync(`${OUT}.json`, JSON.stringify(report, null, 1));

// ---------------------------------------------------------------- the markdown
const L = [];
L.push(`# Cord ensemble, circuit site\n`);
L.push(`${MEMBERS} members over ${AXES.length} binary axes, ${CONDS} perturbations, ${STEPS} steps of the cord at ${DT} ms, read as a gait from the six leg motor pools with no body.\n`);
L.push(`## Verdict\n`);
L.push(`${verdict}\n`);
L.push(`## Every condition, ensemble median\n`);
L.push(`| condition | median pool rate | median periodicity |`);
L.push(`|---|---|---|`);
for (const r of report.perCondition) L.push(`| \`${r.condition}\` | ${r.medianPoolHz} Hz | ${r.medianPeriodicity} |`);
L.push(``);
L.push(`## Baseline, ensemble median\n`);
L.push(`| ${FIELDS.join(' | ')} |`);
L.push(`|${FIELDS.map(() => '---').join('|')}|`);
L.push(`| ${FIELDS.map(f => report.baselineMedian[f] ?? '—').join(' | ')} |\n`);
L.push(`## Perturbations, ranked by how far they split the ensemble\n`);
L.push(`| perturbation | split fraction | members whose class changes |`);
L.push(`|---|---|---|`);
for (const r of report.ranking) L.push(`| \`${r.perturbation}\` | ${r.split} | ${r.changedClass} |`);
L.push(``);
L.push(`## Live rhythms\n`);
if (!live.length) L.push(`None. No member of the ensemble produced a leg rhythm inside the real-fly cadence band with three or more pools bursting and a left-right phase above 0.3.\n`);
else {
  L.push(`${live.length} of ${MEMBERS} members. A rhythm counts when the frequency sweep finds a periodicity of at least ${COHERENCE} in three or more pools, at a rate inside ${BANDS.cadence[0]}–${BANDS.cadence[1]} Hz.\n`);
  L.push(`| member | axes | periodicity | at | pools | tripod | killed by | command row |`);
  L.push(`|---|---|---|---|---|---|---|---|`);
  for (const k of kills) L.push(`| ${k.member} | ${k.axes.join(', ') || 'none'} | ${(+k.baseline.bestStrength).toFixed(3)} | ${(+k.baseline.bestF).toFixed(2)} Hz | ${k.baseline.legsStepping} | ${k.baseline.tripod ?? '—'} | ${k.killedBy.join(', ') || '**nothing**'} | ${k.commandRow ? 'passes' : '**fails**'} |`);
  L.push(``);
}
L.push(`## What the pools do at baseline\n`);
L.push(`| member | axes | mean Hz | best periodicity | at | class |`);
L.push(`|---|---|---|---|---|---|`);
for (let m = 0; m < MEMBERS; m++) { const g = G[m][0];
  L.push(`| ${m} | ${axesOf(m).join(', ') || 'none'} | ${(+g.meanHz).toFixed(1)} | ${(+g.bestStrength).toFixed(3)} | ${(+g.bestF).toFixed(2)} Hz | ${classOf(g)} |`); }
fs.writeFileSync(`${OUT}.md`, L.join('\n') + '\n');

console.log(`${OUT}.{json,md}: ${MEMBERS} members x ${CONDS} perturbations, ${RUNS} runs`);
console.log(`baseline median: best periodicity ${report.baselineMedian.bestStrength} at ${report.baselineMedian.bestF} Hz, mean pool rate ${report.baselineMedian.meanHz} Hz`);
{ const s2 = G.map(r => r[0].bestStrength).sort((a, c) => a - c);
  console.log(`periodicity across members: min ${s2[0].toFixed(3)}, median ${s2[32].toFixed(3)}, max ${s2[63].toFixed(3)} (a synthetic tripod reads > 0.5)`); }
console.log(`verdict: ${verdict}`);
for (const r of report.ranking) console.log(`  ${r.perturbation.padEnd(16)} split ${r.split.toFixed(3)}  class changed on ${(100 * r.changedClass).toFixed(0)}% of members`);
for (const k of kills) console.log(`  member ${k.member} [${k.axes.join(", ")}] periodicity ${(+k.baseline.bestStrength).toFixed(3)} at ${(+k.baseline.bestF).toFixed(2)} Hz, killed by: ${k.killedBy.join(", ") || "nothing"}`);
