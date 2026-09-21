// S4.6 step 4a: fit the escape-chain gains and nothing else, behind frozen benchmarks.
//
// The window question is settled before this script runs: scripts/adjoint_stability.mjs reports
// cosine(150, 600) = 0.82 at surrogateBeta 10 + adjClip 100, which is the only configuration that
// passes the 0.5 gate. Every parameter class below is fixed except one:
//
//   fitted   per-neuron logGain on the escape chain's output neurons -- the giant fibre pair
//            (DNp01) and the takeoff descending neurons (DNp02, DNp04). That is ~6 parameters out
//            of 165,122. Steps 4b/4c widen this; 4a does not.
//   loss     the benchmark's own loom terms (scripts/calib_eval.mjs): GF spikes per neuron -> 2,
//            takeoff-DN rate loom - flow -> 30 Hz, and flow -> GF must stay 0.
//   frozen   sugar->MN9, KC sparseness, quietMN9 -- evaluated through the shipped kernel with the
//            fitted gains deployed as a neuronGainTable, after the fit, not trusted to the twin.
//
//   node --max-old-space-size=16000 scripts/loom_refit.mjs [iters]
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { parseFlyVis } from '../src/flyvis.js';
import { VisualChain, DIFF_PARAMS } from '../src/visdiff.js';
import { diffOptions, diffSummary } from '../src/diffsetup.js';
import { BRAIN_DEFAULTS } from '../src/brainmodel.js';

const ITERS = +(process.argv[2] || 10), STEPS = +(process.env.STEPS || 1200), PRE = 400;
const BETA = +(process.env.BETA || 10), CLIP = +(process.env.CLIP || 100);
const LR = +(process.env.LR || 0.05);
const TARGET_GF = 2, TARGET_TO = 30;

const D = loadAll();
const FVB = fs.readFileSync('public/vision/flyvis.bin');
const FVM = parseFlyVis(FVB.buffer.slice(FVB.byteOffset, FVB.byteOffset + FVB.byteLength),
  JSON.parse(fs.readFileSync('public/vision/flyvis.json')),
  JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json')));
const FVMAP = JSON.parse(fs.readFileSync('public/vision/flyvis_map.json'));
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();
const P = { ...BRAIN_DEFAULTS, ...BASE, surrogateBeta: BETA, adjClip: CLIP };

const SETUP = diffOptions(D, SIZE, P, SIGN);
const GF = D.byType('DNp01'), TO = [...D.byType('DNp02'), ...D.byType('DNp04')];
const FIT = new Set([...GF, ...TO]);          // the whole parameter class for step 4a
const ORN_ALL = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const COLDIRS = ['L', 'R'].map(sd => FVMAP.eyes[sd].dirs);
const GREY = new Float32Array(721).fill(0.5);
const lumLoom = (eye, t) => {
  if (t < 0) return GREY;
  const c = [Math.cos(0.17) * Math.cos(0.7), Math.cos(0.17) * Math.sin(0.7), Math.sin(0.17)];
  const rad = (5 + 70 * Math.max(0, Math.min(1, t / 0.4)) ** 2) * Math.PI / 180;
  return Float32Array.from(COLDIRS[eye], d =>
    Math.acos(Math.min(1, d[0] * c[0] + d[1] * c[1] + d[2] * c[2])) < rad ? 0.05 : 0.5);
};
const lumFlow = (eye, t) => t < 0 ? GREY : Float32Array.from(COLDIRS[eye], d => {
  const th = Math.atan2(Math.abs(d[1]), d[0]) * 180 / Math.PI;
  return 0.5 + 0.35 * Math.sin(2 * Math.PI * (th - 60 * t) / 30);
});
const clock = stim => (eye, tEpoch) => stim(eye, (Math.round(tEpoch / FVM.dt) * 40 - PRE) / 2000);

const logGain = new Float32Array(D.N);
console.log(`loom refit 4a: fitting ${FIT.size} logGains (DNp01/DNp02/DNp04), beta ${BETA}, adjClip ${CLIP}, coupling soft`);
{ const sm = diffSummary(SETUP);
  console.log(`setup: ${sm.thrShifted} threshold offsets, ${sm.signZeroed} sign-zeroed, ${sm.typeGained} type gains`); }

function run(stim) {
  const ch = new VisualChain(D, FVM, FVMAP, { ...P, ...SETUP, gain: 250, coupling: 'soft', soft: false, logGain });
  ch.net.setDrive(ORN_ALL, 6);
  ch.settle();
  const { tape } = ch.forward(STEPS, { lum: clock(stim), seed: 1 });
  const post = tape.spikes.slice(PRE).reduce((acc, f) => { for (const i of f.idx) acc[i]++; return acc; }, new Float32Array(D.N));
  const gf = GF.reduce((a, i) => a + post[i], 0) / GF.length;
  const to = TO.reduce((a, i) => a + post[i], 0) / TO.length / 0.4;   // Hz over the 400 ms stimulus
  return { ch, tape, post, gf, to };
}

const m = new Float32Array(D.N), v = new Float32Array(D.N);
for (let it = 1; it <= ITERS; it++) {
  const loom = run(lumLoom), flow = run(lumFlow);
  // loss = benchmark terms, unclamped: (gf-2)^2 + ((toLoom - toFlow) - 30)^2/900 + flowGF^2/4
  const errG = loom.gf - TARGET_GF, errT = (loom.to - flow.to) - TARGET_TO;
  const L = errG * errG + errT * errT / (TARGET_TO * TARGET_TO) + flow.gf * flow.gf / 4;
  // dL/d(spikeCount): loom run sees both terms; flow run sees -to and +flowGF terms.
  const dLoom = new Float32Array(D.N);
  for (const i of GF) dLoom[i] = 2 * errG / GF.length;
  for (const i of TO) dLoom[i] = 2 * errT / (TARGET_TO * TARGET_TO) / (TO.length * 0.4);
  const dFlow = new Float32Array(D.N);
  for (const i of GF) dFlow[i] = flow.gf / 2 / GF.length;
  for (const i of TO) dFlow[i] = -2 * errT / (TARGET_TO * TARGET_TO) / (TO.length * 0.4);
  const gLoom = loom.ch.backward(loom.tape, dLoom, { lossFrom: PRE });
  const gFlow = flow.ch.backward(flow.tape, dFlow, { lossFrom: PRE });
  // masked Adam on the fitted gains only
  let moved = 0, mx = 0;
  for (const i of FIT) {
    const g = gLoom.logGain[i] + gFlow.logGain[i];
    if (!Number.isFinite(g) || g === 0) continue;
    m[i] = 0.9 * m[i] + 0.1 * g; v[i] = 0.999 * v[i] + 0.001 * g * g;
    const mh = m[i] / (1 - Math.pow(0.9, it)), vh = v[i] / (1 - Math.pow(0.999, it));
    const d = LR * mh / (Math.sqrt(vh) + 1e-8);
    logGain[i] -= d; moved++; mx = Math.max(mx, Math.abs(d));
  }
  const clamped = gLoom.clamped.logGain + gFlow.clamped.logGain;
  console.log(`it ${String(it).padStart(2)}  L ${L.toFixed(4)}  loomGF ${loom.gf.toFixed(3)}  flowGF ${flow.gf.toFixed(3)}`
    + `  loomTO ${loom.to.toFixed(1)}  flowTO ${flow.to.toFixed(1)}  | moved ${moved}/${FIT.size}  max|d| ${mx.toFixed(4)}  clamped ${clamped}`);
}

const gains = [...FIT].map(i => ({ orig: i, logGain: logGain[i] })).filter(g => g.logGain !== 0);
fs.writeFileSync('public/data/loom_refit.json', JSON.stringify({
  version: 1, spec: 'S4.6 step 4a: escape-chain logGain only (DNp01/DNp02/DNp04)',
  beta: BETA, adjClip: CLIP, iters: ITERS, gains,
}));
console.log(`-> public/data/loom_refit.json  (${gains.length} nonzero gains)`);
