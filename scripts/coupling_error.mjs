// S4.4's error plot: how far the soft coupling is from the shipped deadband rectifier.
//
//   node scripts/coupling_error.mjs
//
// Three measurements, all on the real artefacts:
//
//   1. Band errors -- max |soft - hard| on a < dead - 0.5e-3 (spec: < 0.5 Hz), on
//      dead + 0.5e-3 <= a <= cap/gain (spec: ~gain*a), and past the cap (spec: ~cap). The band
//      |a - dead| < 0.5e-3 is reported separately: no C1 map can beat half the 5 Hz jump there.
//   2. The quiet-column floor -- a real FlyVisDiff eye settled on a uniform grey field, then run
//      40 steps: the soft map's mean emitted rate over the anatomically mapped nodes must stay
//      < 1 Hz (it should be ~0: the gate underflows below the deadband).
//   3. An SVG of rate(a) and |soft - hard|(a) written to docs/coupling_error.svg.
import fs from 'node:fs';
import { parseFlyVis } from '../src/flyvis.js';
import { FlyVisDiff } from '../src/flyvisdiff.js';
import { COUPLING, COUPLING_SOFT } from '../src/visdiff.js';

const { gain, dead, cap } = COUPLING;
const { gateK, capKnee } = COUPLING_SOFT;
const srelu = (x, e) => 0.5 * (x + Math.sqrt(x * x + e * e));
const hard = a => (a <= dead ? 0 : Math.min(cap, gain * a));
const soft = a => Math.max(0, (cap - srelu(cap - gain * a, capKnee)) / (1 + Math.exp(-gateK * (a - dead))));

// --- 1: band errors ---
const grid = [];
for (let a = -0.05; a <= 0.0195; a += 1e-5) grid.push(a);
for (let a = 0.0195; a <= 0.0205; a += 1e-6) grid.push(a);       // dense through the transition
for (let a = 0.0205; a <= 1.0; a += 5e-4) grid.push(a);
let maxBelow = 0, maxEdge = 0, maxLive = 0, maxSat = 0, edgeAt = 0;
for (const a of grid) {
  const err = Math.abs(soft(a) - hard(a));
  if (a <= dead - 5e-4) maxBelow = Math.max(maxBelow, err);
  else if (a < dead + 5e-4) { if (err > maxEdge) { maxEdge = err; edgeAt = a; } }
  else if (gain * a < cap) maxLive = Math.max(maxLive, err);
  else maxSat = Math.max(maxSat, err);
}
console.log('== band errors (|soft - hard|, Hz) ==');
console.log(`a <= dead-0.5e-3 : ${maxBelow.toFixed(4)}  (spec < 0.5)`);
console.log(`edge band        : ${maxEdge.toFixed(4)}  at a=${edgeAt.toFixed(5)}  (unavoidable <= ${(gain * dead / 2).toFixed(2)})`);
console.log(`live band        : ${maxLive.toFixed(4)}  (${(100 * maxLive / cap).toFixed(2)}% of cap)`);
console.log(`saturated        : ${maxSat.toFixed(4)}  soft(1.0)=${soft(1).toFixed(3)}`);
console.log(`rate(0)          : ${soft(0).toExponential(2)}  (must invent no drive at rest)`);

// --- 2: quiet-column floor on the real optic lobe ---
const FVB = fs.readFileSync('public/vision/flyvis.bin');
const FVM = parseFlyVis(FVB.buffer.slice(FVB.byteOffset, FVB.byteOffset + FVB.byteLength),
  JSON.parse(fs.readFileSync('public/vision/flyvis.json')),
  JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json')));
const FVMAP = JSON.parse(fs.readFileSync('public/vision/flyvis_map.json'));
const eye = new FlyVisDiff(FVM);
const grey = new Float32Array(eye.nCol).fill(0.5);
eye.settle(grey, 150);
const vRest = eye.v.slice();
const nodes = Int32Array.from(FVMAP.eyes.L.pairs, p => p[1]);
let sumS = 0, sumH = 0, n = 0, maxA = 0;
for (let s = 0; s < 40; s++) {
  eye.setInput(grey); eye.step();
  for (const nd of nodes) { const a = eye.v[nd] - vRest[nd]; maxA = Math.max(maxA, Math.abs(a)); sumS += soft(a); sumH += hard(a); n++; }
}
console.log('\n== quiet-column floor (grey field, 40 steps x ' + nodes.length + ' mapped nodes) ==');
console.log(`mean rate soft : ${(sumS / n).toFixed(4)} Hz  (spec < 1)`);
console.log(`mean rate hard : ${(sumH / n).toFixed(4)} Hz`);
console.log(`max |a| at rest: ${maxA.toExponential(2)}`);

// --- 3: the error plot ---
const W = 900, H = 420, pad = 60;
const xs = [], ys = [], es = [];
for (let a = -0.02; a <= 1.0; a += 2e-4) { xs.push(a); ys.push(soft(a)); es.push(Math.abs(soft(a) - hard(a))); }
const X = a => pad + (a + 0.02) / 1.02 * (W - 2 * pad), Y = r => H - pad - r / cap * (H - 2 * pad);
const path = (f) => xs.map((a, i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)},${Y(f(a)).toFixed(1)}`).join('');
const ePath = xs.map((a, i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)},${(H - pad - es[i] / 6 * (H - 2 * pad)).toFixed(1)}`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff;font:12px sans-serif">
<path d="${path(hard)}" stroke="#888" fill="none" stroke-width="1.5" stroke-dasharray="4 3"/>
<path d="${path(soft)}" stroke="#06c" fill="none" stroke-width="1.5"/>
<path d="${ePath}" stroke="#c30" fill="none" stroke-width="1"/>
<line x1="${X(dead)}" y1="${Y(0)}" x2="${X(dead)}" y2="${Y(cap)}" stroke="#ccc"/>
<text x="${X(dead) + 4}" y="${Y(cap) + 14}">dead=${dead}</text>
<text x="${W - 200}" y="${Y(cap) + 20}" fill="#888">hard: min(${cap}, ${gain}a)</text>
<text x="${W - 200}" y="${Y(cap) + 36}" fill="#06c">soft: inner(gain*a)*sigmoid(${gateK}(a-dead))</text>
<text x="${W - 200}" y="${Y(cap) + 52}" fill="#c30">|soft-hard| (6 Hz full scale)</text>
<text x="${pad}" y="${pad - 20}">flyvis->CNS coupling: rate(a), a = v - vRest; Hz on y</text>
</svg>`;
fs.writeFileSync('docs/coupling_error.svg', svg);
console.log('\n-> docs/coupling_error.svg');
