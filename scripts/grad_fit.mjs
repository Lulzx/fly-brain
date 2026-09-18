// Gradient descent on the whole central nervous system.
//
// The calibrated model is fitted by cross-entropy search over nine global parameters, because a
// population search is all that nine dimensions need and all that 10^5 dimensions can never have.
// This script fits the same connectome with the adjoint from src/lifdiff.js instead: the nine
// globals if you ask for them, and a gain per neuron -- 165,122 parameters -- if you ask for that.
//
// The assay is the sugar-to-proboscis chain from the calibration benchmark (docs/07-calibration.md):
// sugar-sensing neurons are driven, and the motor neuron MN9 should reach the rate recorded in the
// literature. Loss is squared error on that rate, plus a term that holds baseline activity where it
// was, because a model can always reach one target by exciting everything.
//
//   node scripts/grad_fit.mjs [steps] [iterations] [mode]
//     mode = globals | gains | both      (default both)
//
// Writes data/grad_fit.json.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { LIFDiff, DIFF_PARAMS } from '../src/lifdiff.js';
import { diffOptions, diffSummary } from '../src/diffsetup.js';
import { BRAIN_DEFAULTS } from '../src/brainmodel.js';

const STEPS = +(process.argv[2] || 600), ITERS = +(process.argv[3] || 20), MODE = process.argv[4] || 'both';
// Truncation off by default: it was biasing every gradient and buying nothing (scripts/adjoint_window.mjs).
const TRUNC = +(process.env.TRUNC || 0), CLIP = +(process.env.CLIP || 10);
const LR_W = +(process.env.LR_W || 0.01), LR_G = +(process.env.LR_G || 0.01), W_BASE = +(process.env.W_BASE || 2);
const D = loadAll();
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();
const P = { ...BRAIN_DEFAULTS, ...BASE };

// ---- the per-neuron quantities the model parameters act on --------------------------------------
// This used to be built inline here, and it was missing four of the things makeBrain applies -- the
// octopamine tone above all -- which left the fitted model at 64% of the shipped model's MN9 rate
// (scripts/lifdiff_equiv.mjs). src/diffsetup.js calls the shipped functions instead.
const SETUP = diffOptions(D, SIZE, P, SIGN);
{ const sm = diffSummary(SETUP);
  console.log(`setup: ${sm.thrShifted} threshold offsets, ${sm.signZeroed} neurons with their fast`
    + ` synapses removed, ${sm.typeGained} type gains, ${sm.sensory} sensory`); }

const T = (...ts) => ts.flatMap(t => D.byType(t));
const S = D.bodymap.sensors;
const SUGAR = T('LB3b', 'LB3c'), MN9 = T('MN9');
const ORN_ALL = S.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const MS = STEPS * 0.5, SECS = MS / 1000;
const TARGET_MN9 = 60;                      // Hz, the benchmark's sugar target
console.log(`whole CNS: ${D.N} neurons, ${D.E} connections | ${STEPS} steps (${MS} ms) | mode ${MODE}`);
console.log(`assay: sugar neurons at 100 Hz, MN9 -> ${TARGET_MN9} Hz, baseline held`);

const logGain = new Float32Array(D.N);
// Start from the calibrated values where the fit has one, and from the model's own defaults where it
// does not -- brain_params.json only stores the nine parameters calib_search.mjs varies, so vThresh
// and the rest of the fixed physiology have to come from LIFDiff itself.
const DEFAULTS = new LIFDiff({ N: 1, indptr: new Uint32Array(2), indices: new Uint32Array(0),
  weights: new Uint16Array(0), nt: new Uint8Array(1) }, P).p;
const globals = Object.fromEntries(DIFF_PARAMS.map(k => [k, P[k] ?? DEFAULTS[k]]));
for (const k of DIFF_PARAMS) if (!Number.isFinite(globals[k])) throw new Error(`no value for ${k}`);
console.log('start:', DIFF_PARAMS.map(k => `${k}=${(+globals[k]).toFixed(3)}`).join(' '));

function build(over = {}) {
  const net = new LIFDiff(D, { ...P, ...globals, ...over, ...SETUP,
    logGain: over.logGain || logGain, soft: false });
  net.setDrive(ORN_ALL, 6); net.setDrive(SUGAR, 100);
  return net;
}

// loss = (MN9 rate - target)^2 / target^2  +  w * (mean network rate - baseline)^2 / baseline^2
let BASELINE = null;
function evaluate(record) {
  const net = build();
  const tape = net.forward(STEPS, { seed: 7, record });
  const mn9 = MN9.reduce((a, i) => a + net.spikeCount[i], 0) / MN9.length / SECS;
  let tot = 0; for (let i = 0; i < D.N; i++) tot += net.spikeCount[i];
  const mean = tot / D.N / SECS;
  if (BASELINE === null) BASELINE = mean;
  const eMn9 = (mn9 - TARGET_MN9) / TARGET_MN9, eBase = (mean - BASELINE) / Math.max(1e-6, BASELINE);
  const L = eMn9 * eMn9 + W_BASE * eBase * eBase;
  // dL/d(spike count of neuron i)
  const dL = new Float32Array(D.N);
  const kMn9 = 2 * eMn9 / TARGET_MN9 / MN9.length / SECS;
  for (const i of MN9) dL[i] = kMn9;
  const kBase = 2 * W_BASE * eBase / Math.max(1e-6, BASELINE) / D.N / SECS;
  for (let i = 0; i < D.N; i++) dL[i] += kBase;
  return { net, tape, L, mn9, mean, dL };
}

// ---- Adam ---------------------------------------------------------------------------------------
const B1 = 0.9, B2 = 0.999, EPS = 1e-8;
const mG = Object.fromEntries(DIFF_PARAMS.map(k => [k, 0])), vG = { ...mG };
const mW = new Float32Array(D.N), vW = new Float32Array(D.N);
const SCALE = { wSyn: 1, sizeAlpha: 1, inhGain: 1, eInh: 10, vThresh: 5, kcThreshold: 5, laminaBias: 5, adaptInc: 1, depU: 0.2 };

const history = [];
for (let it = 1; it <= ITERS; it++) {
  const t0 = Date.now();
  const e = evaluate(true);
  const tf = Date.now() - t0;
  const g = e.net.backward(e.tape, e.dL, { truncate: TRUNC });
  // clip by global norm: surrogate gradients through a spiking recurrent network are heavy-tailed
  let sq = 0; for (const k of DIFF_PARAMS) sq += g.params[k] ** 2;
  for (let i = 0; i < D.N; i++) sq += g.logGain[i] ** 2;
  const norm = Math.sqrt(sq), clip = norm > CLIP ? CLIP / norm : 1;
  if (clip < 1) { for (const k of DIFF_PARAMS) g.params[k] *= clip;
    for (let i = 0; i < D.N; i++) g.logGain[i] *= clip; }
  const tb = Date.now() - t0 - tf;

  history.push({ iter: it, loss: +e.L.toFixed(6), mn9: +e.mn9.toFixed(2), mean: +e.mean.toFixed(3),
    gradNorm: +norm.toPrecision(4), clipped: clip < 1, forwardMs: tf, backwardMs: tb,
    globals: Object.fromEntries(DIFF_PARAMS.map(k => [k, +globals[k].toFixed(4)])) });
  console.log(`it ${String(it).padStart(3)}  loss ${e.L.toFixed(5)}  MN9 ${e.mn9.toFixed(1)} Hz  ` +
    `network ${e.mean.toFixed(2)} Hz  |grad| ${norm.toExponential(2)}  (fwd ${tf} ms, bwd ${tb} ms)`);
  if (it === ITERS) break;

  if (MODE === 'globals' || MODE === 'both') {
    for (const k of DIFF_PARAMS) {
      const gr = g.params[k] * SCALE[k];
      mG[k] = B1 * mG[k] + (1 - B1) * gr; vG[k] = B2 * vG[k] + (1 - B2) * gr * gr;
      const mh = mG[k] / (1 - B1 ** it), vh = vG[k] / (1 - B2 ** it);
      globals[k] -= LR_G * SCALE[k] * mh / (Math.sqrt(vh) + EPS);
    }
    globals.sizeAlpha = Math.min(1, Math.max(0, globals.sizeAlpha));
    globals.inhGain = Math.max(0.05, globals.inhGain);
    globals.depU = Math.min(0.9, Math.max(0, globals.depU));
    globals.adaptInc = Math.max(0, globals.adaptInc);
  }
  if (MODE === 'gains' || MODE === 'both') {
    for (let i = 0; i < D.N; i++) {
      const gr = g.logGain[i];
      mW[i] = B1 * mW[i] + (1 - B1) * gr; vW[i] = B2 * vW[i] + (1 - B2) * gr * gr;
      const mh = mW[i] / (1 - B1 ** it), vh = vW[i] / (1 - B2 ** it);
      logGain[i] = Math.max(-2, Math.min(2, logGain[i] - LR_W * mh / (Math.sqrt(vh) + EPS)));
    }
  }
}

const nz = Array.from(logGain).filter(x => Math.abs(x) > 1e-3).length;
const out = { _source: 'scripts/grad_fit.mjs', generated: new Date().toISOString().slice(0, 10),
  steps: STEPS, iterations: ITERS, mode: MODE, target: TARGET_MN9, baselineRate: BASELINE,
  truncateSteps: TRUNC, gradClip: CLIP, lrGains: LR_W, lrGlobals: LR_G, baselineWeight: W_BASE,
  parameters: { globals: DIFF_PARAMS.length, perNeuronGains: MODE === 'globals' ? 0 : D.N },
  finalGlobals: Object.fromEntries(DIFF_PARAMS.map(k => [k, +globals[k].toFixed(5)])),
  gainsMoved: nz, history };
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/grad_fit.json', JSON.stringify(out, null, 1));
console.log(`\nloss ${history[0].loss.toFixed(5)} -> ${history[history.length - 1].loss.toFixed(5)}  ` +
  `(MN9 ${history[0].mn9} -> ${history[history.length - 1].mn9} Hz, target ${TARGET_MN9})`);
if (MODE !== 'globals') console.log(`${nz} of ${D.N} per-neuron gains moved`);
console.log('wrote data/grad_fit.json');
