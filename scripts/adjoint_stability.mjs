// S4.5: is the reverse pass stable enough to fit the visual chain at benchmark scale?
//
// scripts/vis_fit.mjs measured the failure this item exists to fix: at surrogateBeta = 2 the
// whole-CNS visual adjoint overflows Float32 (19,619 of 165,122 per-neuron gradients non-finite
// over a 600 ms window), and widening beta stops the overflow but rotates the gradient to a
// near-orthogonal direction. Two remedies are on the table, and this script measures both:
//
//   1. adjClip -- bound every carried adjoint component to +-Amax each step, so Jacobian products
//      cannot compound past Amax. The clip is in src/lifdiff.js; what remains is choosing Amax:
//      too large and nothing is fixed, too small and every adjoint saturates. Amax is acceptable
//      if the backward at 1200 steps returns all-finite gradients AND the clip did not fire on the
//      overwhelming majority of steps (a clip that fires everywhere is a different operator, not
//      a bound).
//   2. typed surrogateBeta -- wider on visual projection neurons, narrower on the rest, so the
//      smoothing lives where the adjoint is densest instead of rotating the global direction.
//
// and one acceptance measurement:
//
//   3. cosine(gradient at a 150-step window, gradient at a 600-step window). The spec's gate is
//      0.5: below it the long-window gradient is a different direction, the window is still
//      undefined, and no visual fit should run.
//
//   node --max-old-space-size=16000 scripts/adjoint_stability.mjs [steps=1200] [clips]
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { parseFlyVis } from '../src/flyvis.js';
import { VisualChain, DIFF_PARAMS } from '../src/visdiff.js';
import { diffOptions, diffSummary, typedBeta } from '../src/diffsetup.js';
import { BRAIN_DEFAULTS } from '../src/brainmodel.js';

const STEPS = +(process.argv[2] || 1200);
const CLIPS = (process.argv[3] || '0,1000,100,10,1').split(',').map(Number);
const PRE = 400;
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
const P0 = { ...BRAIN_DEFAULTS, ...BASE };

const GF = D.byType('DNp01');
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
const clock = stim => (eye, tEpoch) => stim(eye, (Math.round(tEpoch / FVM.dt) * 40 - PRE) / 2000);

// The typed-surrogate arm: surrogateBeta 2 on the bulk of the CNS (the shipped width), wider on the
// populations whose dense driven activity is what overflows -- the flyvis-driven optic-lobe neurons
// and the visual projection neurons that relay them. The split is a named hypothesis; changing it
// is a new spec, not a tuning knob.
const BETA_SPEC = { base: 2, bySuperclass: { ol_intrinsic: 5, visual_projection: 5 } };
const BETAS = (() => {
  const which = (process.env.BETAS || 'scalar2,scalar5,typed').split(',');
  const all = {
    scalar2: 2, scalar5: 5, scalar10: 10,
    typed: typedBeta(D, BETA_SPEC),
    typed510: typedBeta(D, { base: 5, bySuperclass: { ol_intrinsic: 10, visual_projection: 10 } }),
    typedVpn10: typedBeta(D, { base: 2, bySuperclass: { visual_projection: 10 } }),
  };
  return Object.fromEntries(which.map(k => [k, all[k]]));
})();

function chainFor(beta) {
  const P = { ...P0, surrogateBeta: beta };
  const ch = new VisualChain(D, FVM, FVMAP, { ...P, ...diffOptions(D, SIZE, P, SIGN),
    gain: 250, coupling: 'soft', soft: false });
  ch.net.setDrive(ORN_ALL, 6);
  ch.settle();
  return ch;
}

const stats = g => {
  let fin = 0, norm = 0;
  for (let i = 0; i < g.logGain.length; i++) { const x = g.logGain[i]; if (Number.isFinite(x)) { fin++; norm += x * x; } }
  return { finite: fin, norm: Math.sqrt(norm) };
};
const cos = (a, b) => { let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / Math.max(1e-30, Math.sqrt(aa) * Math.sqrt(bb)); };

console.log(`adjoint stability: ${D.N} neurons, ${STEPS} steps (${STEPS * 0.5} ms), loom -> DNp01 loss, coupling=soft`);

for (const [bn, beta] of Object.entries(BETAS)) {
  const ch = chainFor(beta);
  const { tape } = ch.forward(STEPS, { lum: clock(lumLoom), seed: 1 });
  let gf = 0; for (const i of GF) gf += ch.net.spikeCount[i];
  const dL = new Float32Array(D.N); for (const i of GF) dL[i] = 1 / GF.length;
  console.log(`\n== surrogateBeta: ${bn}${bn === 'typed' ? ` (${JSON.stringify(BETA_SPEC)})` : ''} -- forward GF spikes ${(gf / GF.length).toFixed(2)}`);

  let g150 = null;
  // clip is a model parameter, but it only touches the backward pass, so one taped forward serves
  // every Amax value.
  const rows = [];
  for (const clip of CLIPS) {
    ch.net.p.adjClip = clip;
    const t0 = Date.now();
    const g = ch.backward(tape, dL, { lossFrom: PRE });
    const s = stats(g), ms = Date.now() - t0;
    rows.push({ clip, g });
    console.log(`  clip ${String(clip).padStart(5)} | logGain finite ${s.finite}/${D.N} | norm ${s.norm.toExponential(3)}`
      + ` | clamped params ${g.clamped.params} gains ${g.clamped.logGain} drive ${g.clamped.drive} | ${ms} ms`);
  }
  // window comparison at the chosen clip: 150-step vs 600-step truncated windows, both inside the
  // same 1200-step trajectory. cosine < 0.5 means the long window rotates the gradient -- the
  // window is still undefined and a fit on it would be noise.
  const pick = rows.find(r => r.g.clamped.logGain === 0 && r.g.clamped.params === 0 && r.clip > 0) || rows[rows.length - 1];
  ch.net.p.adjClip = pick.clip;
  for (const w of [150, 600]) {
    const g = ch.backward(tape, dL, { lossFrom: PRE, truncate: w });
    const s = stats(g);
    console.log(`  window ${w}: finite ${s.finite}/${D.N} norm ${s.norm.toExponential(3)}`);
    if (w === 150) g150 = g.logGain;
    else console.log(`  cosine(logGain 150, logGain 600) = ${cos(g150, g.logGain).toFixed(4)}   (spec: >= 0.5 or the window is undefined)`);
  }
}
