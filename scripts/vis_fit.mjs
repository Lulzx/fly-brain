// Fitting a visual assay end to end, through the optic lobe and the spiking CNS together.
//
// scripts/grad_fit.mjs fits the sugar-to-proboscis chain: a handful of sensory neurons are driven at a
// fixed rate and a motor neuron should reach a recorded one. The drive there is a constant, so the
// gradient starts inside the CNS. This script fits the benchmark's *visual* term instead -- a looming
// disc should make the giant fibre DNp01 spike about twice, and translational flow should not make it
// spike at all (von Reyn et al. 2014) -- and the stimulus is luminance on 721 hex columns per eye. The
// gradient therefore has to cross from the CNS into the trained optic lobe, which is what
// src/visdiff.js is for.
//
//   node --max-old-space-size=14000 scripts/vis_fit.mjs [iters] [mode] [steps]
//     mode = globals | gains | both      (default both)
//
// The optic lobe's own parameters are not fitted here even though the gradient for them exists and is
// checked (src/visdiff.js returns it as `fv`, and scripts/vis_grad_check.mjs verifies it). Two reasons,
// both about honesty rather than effort: flyvis is a trained model whose weights are the published
// result of a different fit on a different dataset, and refitting them against one fly's benchmark
// summary statistic would overwrite that with something weaker; and the coupling subtracts a resting
// activity `vRest` measured by settling the optic lobe, so moving its parameters invalidates the
// baseline the gradient was taken at. Unfreezing it is a decision for whoever has functional
// recordings to fit against, not a default.
//
// Writes data/vis_fit.json.
//
// The assay is scripts/calib_eval.mjs's, step for step: 200 ms of grey to let the optic lobe adapt,
// then 400 ms of stimulus, and only the spikes after onset are scored (`lossFrom`). Reusing the
// benchmark's own timing is the point -- a gradient that improves a term the benchmark does not measure
// is not worth having.
//
// READ THIS BEFORE READING THE OUTPUT. This fit does not work at the shipped surrogate width, and the
// reason is measured rather than guessed. The adjoint is correct -- scripts/vis_grad_check.mjs matches
// central finite differences across the join to 1e-4, and scripts/vis_equiv.mjs shows the forward pass
// is bit-identical to the wasm kernel -- but at whole-CNS scale over a 600 ms window the surrogate
// gradient overflows. At surrogateBeta = 2, the value src/lifdiff.js ships and grad_fit.mjs uses,
// 19,619 of the 165,122 per-neuron gains and all nine globals come back non-finite and are zeroed. The
// cause is not the join: it is that this loss reaches 62,157 driven neurons, 38% of the CNS, where the
// sugar chain reaches a few hundred, so far more of the network transmits adjoint at every step.
//
// Widening the surrogate stops the overflow and does not rescue the direction. Measured on one taped
// 1200-step trajectory, with only surrogateBeta changed between backward passes:
//
//     beta    |grad| over the gains    gains zeroed    cosine to the previous beta
//     2       2.0e31                   19,619          --
//     5       9.1e13                   0               -0.0000
//     10      1.2e19                   0                0.0004
//     20      9.8e19                   0                0.9047
//     50      6.8e7                    0                0.5812
//     100     3.6e1                    0                0.0012
//
// Adjacent surrogate widths give gradients that are very nearly orthogonal. A descent direction that
// rotates that much when a smoothing constant moves is not a property of the model, and no amount of
// clipping fixes a direction. BETA defaults to 5 here because it is the narrowest width that does not
// overflow, and the run below is reported as what it is.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { parseFlyVis } from '../src/flyvis.js';
import { VisualChain, DIFF_PARAMS } from '../src/visdiff.js';
import { diffOptions, diffSummary } from '../src/diffsetup.js';
import { BRAIN_DEFAULTS } from '../src/brainmodel.js';

const ITERS = +(process.argv[2] || 8), MODE = process.argv[3] || 'both', STEPS = +(process.argv[4] || 1200);
const PRE = +(process.env.PRE || 400);              // steps of grey before the stimulus
const BETA = +(process.env.BETA || 5);
const CLIP = +(process.env.CLIP || 10);
const LR_W = +(process.env.LR_W || 0.01), LR_G = +(process.env.LR_G || 0.01), LR_C = +(process.env.LR_C || 2);
const W_FLOW = +(process.env.W_FLOW || 1);
const TARGET_GF = 2;                                 // spikes per giant-fibre neuron, von Reyn et al. 2014

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
const P = { ...BRAIN_DEFAULTS, ...BASE, surrogateBeta: BETA };

const SETUP = diffOptions(D, SIZE, P, SIGN);
const GF = D.byType('DNp01');
const ORN_ALL = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const COLDIRS = ['L', 'R'].map(sd => FVMAP.eyes[sd].dirs);

// the benchmark's two stimuli, unchanged from scripts/calib_eval.mjs
const GREY = new Float32Array(721).fill(0.5);
function lumLoom(eye, t) {
  if (t < 0) return GREY;
  const c = [Math.cos(0.17) * Math.cos(0.7), Math.cos(0.17) * Math.sin(0.7), Math.sin(0.17)];
  const rad = (5 + 70 * Math.max(0, Math.min(1, t / 0.4)) ** 2) * Math.PI / 180;
  return Float32Array.from(COLDIRS[eye], d =>
    Math.acos(Math.min(1, d[0] * c[0] + d[1] * c[1] + d[2] * c[2])) < rad ? 0.05 : 0.5);
}
function lumFlow(eye, t) {
  if (t < 0) return GREY;
  return Float32Array.from(COLDIRS[eye], d => {
    const th = Math.atan2(Math.abs(d[1]), d[0]) * 180 / Math.PI;
    return 0.5 + 0.35 * Math.sin(2 * Math.PI * (th - 60 * t) / 30);
  });
}
// An optic-lobe step at epoch e covers LIF steps [e*40, e*40+40), and the benchmark's clock is
// t = (step - PRE) / 2000. Keeping that exact mapping is what makes this the benchmark's assay.
const clock = stim => (eye, tEpoch) => stim(eye, (Math.round(tEpoch / FVM.dt) * 40 - PRE) / 2000);

const globals = Object.fromEntries(DIFF_PARAMS.map(k => [k, P[k]]));
const logGain = new Float32Array(D.N);
let couplingGain = 250;
const fitGlobals = MODE === 'globals' || MODE === 'both';
const fitGains = MODE === 'gains' || MODE === 'both';
console.log(`whole CNS + both optic lobes: ${D.N} + 2x${FVM.N} nodes | ${STEPS} steps (${STEPS * 0.5} ms),`
  + ` ${PRE} grey | mode ${MODE} | surrogateBeta ${BETA}`);
console.log(`assay: looming disc -> DNp01 ${TARGET_GF} spikes/neuron; translational flow -> 0 (weight ${W_FLOW})`);
{ const sm = diffSummary(SETUP);
  console.log(`setup: ${sm.thrShifted} threshold offsets, ${sm.signZeroed} neurons with their fast`
    + ` synapses removed, ${sm.typeGained} type gains`); }

function build(over = {}) {
  const ch = new VisualChain(D, FVM, FVMAP, { ...P, ...globals, ...over, ...SETUP,
    gain: couplingGain, logGain, soft: false });
  ch.net.setDrive(ORN_ALL, 6);
  return ch;
}
/** One stimulus: forward, loss, and the gradient of that loss. */
function run(stim, target, weight) {
  const ch = build();
  ch.settle();
  const { tape } = ch.forward(STEPS, { lum: clock(stim), seed: 1 });
  // spikes after onset only, which is what the benchmark scores
  const post = tape.spikes.slice(PRE).reduce((acc, f) => { for (const i of f.idx) acc[i]++; return acc; },
    new Float32Array(D.N));
  let gf = 0; for (const i of GF) gf += post[i];
  gf /= GF.length;
  const err = gf - target;
  const L = weight * err * err;
  const dL = new Float32Array(D.N);
  const k = weight * 2 * err / GF.length;
  for (const i of GF) dL[i] = k;
  const g = ch.backward(tape, dL, { lossFrom: PRE });
  return { L, gf, g, ch, post };
}

const adam = (n) => ({ m: new Float32Array(n), v: new Float32Array(n), t: 0 });
const St = { globals: adam(DIFF_PARAMS.length), gains: adam(D.N), gain: adam(1) };
function step(state, i, g, lr) {
  state.m[i] = 0.9 * state.m[i] + 0.1 * g;
  state.v[i] = 0.999 * state.v[i] + 0.001 * g * g;
  const mh = state.m[i] / (1 - Math.pow(0.9, state.t)), vh = state.v[i] / (1 - Math.pow(0.999, state.t));
  return lr * mh / (Math.sqrt(vh) + 1e-8);
}
const l2 = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s); };

const hist = [];
for (let it = 1; it <= ITERS; it++) {
  const t0 = Date.now();
  const loom = run(lumLoom, TARGET_GF, 1);
  const flow = W_FLOW > 0 ? run(lumFlow, 0, W_FLOW) : null;
  const L = loom.L + (flow ? flow.L : 0);
  // sum the two stimuli's gradients
  const gp = Object.fromEntries(DIFF_PARAMS.map(k => [k, loom.g.params[k] + (flow ? flow.g.params[k] : 0)]));
  const gg = new Float32Array(D.N);
  for (let i = 0; i < D.N; i++) gg[i] = loom.g.logGain[i] + (flow ? flow.g.logGain[i] : 0);
  const gc = loom.g.gain + (flow ? flow.g.gain : 0);
  // global-norm clipping, over everything at once, as scripts/grad_fit.mjs does
  const nrm = Math.sqrt(l2(gg) ** 2 + Object.values(gp).reduce((a, b) => a + b * b, 0) + gc * gc);
  const sc = nrm > CLIP ? CLIP / nrm : 1;
  St.globals.t++; St.gains.t++; St.gain.t++;
  if (fitGlobals) DIFF_PARAMS.forEach((k, i) => { globals[k] -= step(St.globals, i, gp[k] * sc, LR_W); });
  if (fitGains) for (let i = 0; i < D.N; i++) logGain[i] -= step(St.gains, i, gg[i] * sc, LR_G);
  couplingGain -= step(St.gain, 0, gc * sc, LR_C);
  const cl = loom.g.clamped;
  const st = loom.ch.stats();
  hist.push({ it, L, loomGF: loom.gf, flowGF: flow ? flow.gf : null, gradNorm: nrm,
    clampedGains: cl.logGain, clampedGlobals: cl.params, couplingGain, live: st.live,
    globals: { ...globals }, ms: Date.now() - t0 });
  console.log(`it ${String(it).padStart(2)}  loss ${L.toFixed(4)}  loomGF ${loom.gf.toFixed(3)}`
    + `  flowGF ${flow ? flow.gf.toFixed(3) : '-'}  |grad| ${nrm.toExponential(2)}`
    + `  zeroed ${cl.logGain}/${D.N} gains, ${cl.params}/9 globals`
    + `  coupling ${(st.live * 100).toFixed(1)}% live, gain ${couplingGain.toFixed(1)}`
    + `  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/vis_fit.json', JSON.stringify({
  _: 'End-to-end visual fit through the joined optic lobe and CNS. See docs/33-differentiable-brain.md.',
  steps: STEPS, pre: PRE, mode: MODE, beta: BETA, clip: CLIP, targetGF: TARGET_GF,
  coupledNeurons: 62157, iterations: ITERS, history: hist,
}, null, 1));
console.log('\nwrote data/vis_fit.json');
const first = hist[0], last = hist[hist.length - 1];
console.log(`loss ${first.L.toFixed(4)} -> ${last.L.toFixed(4)}`
  + `  |  loomGF ${first.loomGF.toFixed(3)} -> ${last.loomGF.toFixed(3)} (target ${TARGET_GF})`);
if (hist.some(h => h.clampedGains > 0)) {
  console.log(`NOTE: up to ${Math.max(...hist.map(h => h.clampedGains))} per-neuron gradients overflowed and`
    + ` were zeroed. The direction this fit descended is not the gradient of the model.`);
}
