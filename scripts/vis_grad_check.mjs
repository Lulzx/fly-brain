// Does the joined adjoint in src/visdiff.js compute the gradient it claims to?
//
// The chain is optic lobe -> coupling -> spiking CNS, and each of the three joints is a place a sign
// error hides. The test is the same one scripts/grad_check.mjs applies to the CNS alone, extended
// across the join: make every stage of the forward pass genuinely smooth, then require the adjoint to
// match central finite differences of the loss.
//
// Two surrogates have to be switched off for that to mean anything:
//
//   soft: true       the spike threshold becomes a logistic, as in scripts/grad_check.mjs
//   driveSoft: true  the Poisson drive becomes its expectation as a graded spike amplitude, so the
//                    drive -- the quantity that carries the gradient across the join -- is a
//                    differentiable input rather than a sample
//
// and one property of the shipped coupling has to be suspended: its 0.02 deadband makes the drive rate
// jump discontinuously from 0 to gain * 0.02 = 5 Hz as a node rises past rest, so a finite difference
// straddling that point measures the jump rather than the slope. The check runs with `dead: 0`, which
// is the same coupling without the discontinuity. That the discontinuity exists at all is a defect
// worth knowing about and is reported separately at the end.
//
//   node scripts/vis_grad_check.mjs [cnsNeurons] [fvNodes] [steps] [pairs]
//
// Both halves run on induced subgraphs of the real models, so the code path is the one the whole-brain
// chain uses: the real flyvis CSR and time constants, the real connectome CSR, the real delay ring.
// The coupling map is synthetic -- the first `pairs` optic-lobe nodes of the subgraph drive the first
// `pairs` CNS neurons of the subgraph -- because an anatomical column map does not survive taking two
// independent induced subgraphs. What is being checked is the chain rule through the join, not the map.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { parseFlyVis } from '../src/flyvis.js';
import { VisualChain, DIFF_PARAMS } from '../src/visdiff.js';

const KC = +(process.argv[2] || 500), KF = +(process.argv[3] || 1200), STEPS = +(process.argv[4] || 120);
const NPAIR = +(process.argv[5] || 120);
const D = loadAll();
const FVB = fs.readFileSync('public/vision/flyvis.bin');
const FVM = parseFlyVis(FVB.buffer.slice(FVB.byteOffset, FVB.byteOffset + FVB.byteLength),
  JSON.parse(fs.readFileSync('public/vision/flyvis.json')),
  JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json')));

// ---- induced CNS subgraph, breadth-first from a well-connected neuron ----------------------------
function induce(N, indptr, indices, weights, seed, K) {
  const pick = [seed], inSet = new Map([[seed, 0]]);
  for (let h = 0; h < pick.length && pick.length < K; h++) {
    for (let j = indptr[pick[h]]; j < indptr[pick[h] + 1] && pick.length < K; j++) {
      const q = indices[j]; if (!inSet.has(q)) { inSet.set(q, pick.length); pick.push(q); }
    }
  }
  const n = pick.length, ip = new Int32Array(n + 1), ix = [], wt = [];
  for (let a = 0; a < n; a++) {
    for (let j = indptr[pick[a]]; j < indptr[pick[a] + 1]; j++) {
      const m = inSet.get(indices[j]); if (m !== undefined) { ix.push(m); wt.push(weights ? weights[j] : 1); }
    }
    ip[a + 1] = ix.length;
  }
  return { pick, n, indptr: ip, indices: ix, weights: wt };
}

const outdeg = i => D.indptr[i + 1] - D.indptr[i];
let cseed = 0; for (let i = 0; i < D.N; i++) if (outdeg(i) > outdeg(cseed) && outdeg(i) < 400) cseed = i;
const C = induce(D.N, D.indptr, D.indices, D.weights, cseed, KC);
const sub = { N: C.n, indptr: Uint32Array.from(C.indptr), indices: Uint32Array.from(C.indices),
  weights: Uint16Array.from(C.weights), nt: Uint8Array.from(C.pick, i => D.nt[i]) };

// ---- induced flyvis subgraph, breadth-first from the photoreceptor inputs ------------------------
// Starting from R1-R8 keeps the input path real: the luminance the loss depends on enters the subgraph
// the same way it enters the full model.
const R1 = FVM.inputIdx.R1 || Object.values(FVM.inputIdx)[0];
// Only a handful of columns seed the search, so the subgraph runs deep into the lobe rather than wide
// across the retina: a subgraph that is all photoreceptors has nothing for a weight gradient to be
// about, and an earlier version of this check passed nine optic-lobe rows that were all exactly zero.
const NSEED = +(process.env.NSEED || 24);
const F = (() => {
  const pick = [], inSet = new Map();
  for (const i of R1.slice(0, NSEED)) { if (pick.length >= KF) break; if (!inSet.has(i)) { inSet.set(i, pick.length); pick.push(i); } }
  for (let h = 0; h < pick.length && pick.length < KF; h++) {
    for (let k = FVM.indptr[pick[h]]; k < FVM.indptr[pick[h] + 1] && pick.length < KF; k++) {
      const q = FVM.target[k]; if (!inSet.has(q)) { inSet.set(q, pick.length); pick.push(q); }
    }
  }
  const n = pick.length, ip = new Int32Array(n + 1), tg = [], wt = [];
  for (let a = 0; a < n; a++) {
    for (let k = FVM.indptr[pick[a]]; k < FVM.indptr[pick[a] + 1]; k++) {
      const m = inSet.get(FVM.target[k]); if (m !== undefined) { tg.push(m); wt.push(FVM.weight[k]); }
    }
    ip[a + 1] = tg.length;
  }
  // input map: the subgraph's own photoreceptor nodes, one column each
  const inputIdx = { R1: [] };
  const R1set = new Set(R1);
  for (let a = 0; a < n; a++) if (R1set.has(pick[a])) inputIdx.R1.push(a);
  return { N: n, E: tg.length, bias: Float32Array.from(pick, i => FVM.bias[i]),
    tau: Float32Array.from(pick, i => FVM.tau[i]), indptr: ip, target: Int32Array.from(tg),
    weight: Float32Array.from(wt), inputIdx, dt: FVM.dt, pick };
})();
const NCOL = F.inputIdx.R1.length;
console.log(`CNS subgraph: ${C.n} neurons, ${C.indices.length} connections`);
console.log(`flyvis subgraph: ${F.N} nodes, ${F.E} edges, ${NCOL} input columns`);
console.log(`coupling: ${NPAIR} pairs | ${STEPS} LIF steps (${STEPS * 0.5} ms), soft spikes, soft drive\n`);

// ---- the synthetic coupling map ------------------------------------------------------------------
// The pairs read the DEEPEST nodes of the optic-lobe subgraph, the ones furthest from the retina, so
// that an upstream weight or time constant has a route to the loss. Pairing the CNS to the
// photoreceptors instead makes every interior gradient zero and the check vacuous.
const npair = Math.min(NPAIR, C.n, F.N - F.inputIdx.R1.length);
const half = npair >> 1;
const node0 = F.N - npair;
const mkPairs = (from, to) => { const a = []; for (let k = from; k < to; k++) a.push([k, node0 + k]); return a; };
const FVMAP = { eyes: { L: { pairs: mkPairs(0, half) }, R: { pairs: mkPairs(half, npair) } } };

// ---- a deterministic, smooth test problem -------------------------------------------------------
let rs = 987654321; const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const sizeLog = Float32Array.from({ length: C.n }, () => rnd() * 2 - 1);
const thrMask = Uint8Array.from({ length: C.n }, () => (rnd() < 0.2 ? 1 : 0));
const biasMask = new Uint8Array(C.n);
const logGain = Float32Array.from({ length: C.n }, () => (rnd() - 0.5) * 0.2);
const target = []; for (let i = 0; i < C.n; i++) if (rnd() < 0.3) target.push(i);

// COUPLING=soft runs the check on the shipped deadband and cap through the C1 map of S4.4 instead of
// suspending the discontinuity -- the finite differences then measure the real operating point.
const SOFT = process.env.COUPLING === 'soft';
const P0 = { soft: true, driveSoft: true, tRef: 0, minSyn: 3, coba: true, wSyn: 0.5, sizeAlpha: 0.6,
  inhGain: 0.8, eInh: -76, vThresh: -45, kcThreshold: 2, laminaBias: 0, adaptInc: 0.4, depU: 0.15,
  surrogateBeta: 1.5, gain: 250, dead: SOFT ? 0.02 : 0, cap: SOFT ? 200 : 1e9, coupling: SOFT ? 'soft' : 'hard',
  sizeLog, thrMask, biasMask };

// A moving bright bar across the input columns: smooth in time, and it drives the subgraph hard
// enough that a good share of the coupling sits in the live band.
const lum = (eye, t) => Float32Array.from({ length: NCOL },
  (_, c) => 0.5 + 0.45 * Math.sin(2 * Math.PI * (c / NCOL - (eye ? 1.7 : 1.3) * t)));

// vRest is pinned across every evaluation. It is a function of the optic-lobe parameters, and the
// adjoint deliberately does not take that path (src/visdiff.js, note 2); letting it move would make
// the finite difference measure a quantity the adjoint does not claim to compute.
let VREST = null;
function chain(over = {}, fvOver = {}) {
  const model = { ...F, ...fvOver };
  const ch = new VisualChain(sub, model, FVMAP, { ...P0, ...over, logGain: over.logGain || logGain });
  if (VREST) ch.vRest = VREST; else VREST = ch.settle();
  return ch;
}
function loss(over = {}, fvOver = {}) {
  const ch = chain(over, fvOver);
  ch.forward(STEPS, { lum, record: false });
  let L = 0; for (const i of target) L += ch.net.spikeCount[i];
  return L;
}
function gradient() {
  const ch = chain();
  const { tape } = ch.forward(STEPS, { lum });
  let L = 0; for (const i of target) L += ch.net.spikeCount[i];
  const dL = new Float32Array(C.n); for (const i of target) dL[i] = 1;
  const t0 = Date.now();
  const g = ch.backward(tape, dL, { lum: true });
  return { L, ms: Date.now() - t0, g, ch };
}

chain();                                   // pin vRest before anything is measured
const G = gradient();
console.log(`loss ${G.L.toFixed(6)}   backward ${G.ms} ms   coupling live fraction ${(G.g.live * 100).toFixed(1)}%`);
const st = G.ch.stats();
console.log(`coupling: ${(st.live * 100).toFixed(1)}% live, ${(st.belowDeadband * 100).toFixed(1)}% at or below rest, mean drive ${st.meanRate.toFixed(1)} Hz\n`);


// ---- reading the table ---------------------------------------------------------------------------
// A central difference of a Float32 loss carries about 1e-6 * |L| of noise, divided by h. A row whose
// finite difference is smaller than that floor is not evidence about the adjoint in either direction,
// and the earlier version of this script reported nine such rows as passing because the tolerance
// included the floor. They are now labelled `under fd noise` and excluded from the verdict, which is
// why the optic-lobe gradients are checked twice: once here, end to end through the spiking CNS, where
// a single weight's influence on a spike count is at the edge of what Float32 can resolve, and once
// against the optic lobe's own activity, where it is not.
const pad = (s, k) => String(s).padEnd(k);
let fails = 0, rows = 0, mute = 0;
function row(name, a, fd, h, L) {
  const floor = 4e-6 * Math.abs(L) / h;
  const tol = 2e-3 * Math.abs(fd) + floor;
  const rel = Math.abs(a - fd) / Math.max(1e-12, Math.abs(fd));
  const under = Math.abs(fd) < 3 * floor;
  const ok = Math.abs(a - fd) <= tol;
  if (under) mute++; else { rows++; if (!ok) fails++; }
  console.log(pad(name, 18), pad(a.toExponential(4), 14), pad(fd.toExponential(4), 14),
    pad(rel.toExponential(2), 11), under ? 'under fd noise' : (ok ? 'ok' : 'OUT OF TOLERANCE'));
}
const header = () => console.log(pad('parameter', 18), pad('adjoint', 14), pad('finite difference', 14),
  pad('rel. error', 11), 'vs tolerance');

// ---- part one: the CNS globals and the coupling gain, reached through the optic lobe --------------
// These are the rows the join exists for. The gradient reaches them from a spiking loss, through the
// drive, through the coupling, and the coupling gain in particular is a parameter that has no meaning
// until the two models are joined.
console.log('through the join, from a loss on CNS spike counts:');
header();
const H = { wSyn: 2e-3, sizeAlpha: 2e-3, inhGain: 2e-3, eInh: 2e-1, vThresh: 1e-2,
  kcThreshold: 1e-2, laminaBias: 1e-2, adaptInc: 2e-3, depU: 2e-3 };
for (const k of DIFF_PARAMS) {
  if (k === 'laminaBias') continue;                       // no biasMask in this subgraph
  const h = H[k];
  row(k, G.g.params[k], (loss({ [k]: P0[k] + h }) - loss({ [k]: P0[k] - h })) / (2 * h), h, G.L);
}
{ const h = 0.5;
  row('coupling gain', G.g.gain, (loss({ gain: P0.gain + h }) - loss({ gain: P0.gain - h })) / (2 * h), h, G.L); }

// ---- part two: the optic lobe, against its own activity -------------------------------------------
// The same adjoint code, the same tape, a loss it can actually move: the summed activity of the nodes
// the CNS reads. Nothing spikes here and nothing is sampled, so the model is exactly differentiable
// and a disagreement is a bug rather than noise. This is the decisive test of src/flyvisdiff.js.
console.log('\nthe optic lobe alone, loss = summed activity of the coupled nodes:');
header();
const { FlyVisDiff } = await import('../src/flyvisdiff.js');
// Long enough for the retina to reach the read nodes: at 3 steps -- what a 120-step LIF window buys --
// most of the subgraph has not been touched yet and every interior gradient is legitimately zero,
// which tests nothing.
const FVSTEPS = +(process.env.FVSTEPS || 40);
const readNodes = []; for (let k = 0; k < npair; k++) readNodes.push(node0 + k);
const readSet = new Set(readNodes);
// Probe the parameters that actually reach the loss: nodes presynaptic to a read node, and edges
// landing on one. Picking by index instead is how the previous version produced ten rows of zeros.
// A node with v <= 0 is rectified off and its outgoing weights genuinely have zero gradient, so the
// probes are chosen after a forward pass rather than by index: nodes that are actually active and
// actually presynaptic to a read node. Three rows of structural zeros look like a pass and are not one.
const preNodes = [], inEdges = [];
function fvLoss(fvOver = {}, lumFn = lum) {
  const e = new FlyVisDiff({ ...F, ...fvOver });
  e.v.set(FVV0);
  let L = 0;
  for (let t = 0; t < FVSTEPS; t++) { e.setInput(lumFn(0, t * F.dt)); e.step();
    for (const i of readNodes) L += e.v[i]; }
  return L;
}
const FVV0 = (() => { const e = new FlyVisDiff(F);
  e.settle(new Float32Array(NCOL).fill(0.5), 150); return e.v.slice(); })();
{ // which nodes carry activity during the assay, and which of their edges land on a read node
  const e = new FlyVisDiff(F); e.v.set(FVV0);
  const live = new Uint8Array(F.N);
  for (let t = 0; t < FVSTEPS; t++) { e.setInput(lum(0, t * F.dt)); e.step();
    for (let i = 0; i < F.N; i++) if (e.v[i] > 0) live[i] = 1; }
  for (let j = 0; j < F.N && (preNodes.length < 4 || inEdges.length < 3); j++) {
    if (!live[j] || readSet.has(j)) continue;
    for (let k = F.indptr[j]; k < F.indptr[j + 1]; k++) {
      if (!readSet.has(F.target[k]) || F.weight[k] === 0) continue;
      if (preNodes.length < 4 && !preNodes.includes(j)) preNodes.push(j);
      if (inEdges.length < 3) inEdges.push(k);
    }
  }
  console.log(`probing ${preNodes.length} active presynaptic nodes and ${inEdges.length} edges into the read set`);
}
const fvG = (() => {
  const e = new FlyVisDiff(F);
  e.v.set(FVV0); e.startTape(FVSTEPS);
  const dLdV = new Float32Array(FVSTEPS * F.N);
  for (let t = 0; t < FVSTEPS; t++) { e.setInput(lum(0, t * F.dt)); e.stepTaped();
    for (const i of readNodes) dLdV[t * F.N + i] = 1; }
  const gLum = new Float32Array(FVSTEPS * NCOL);
  return { g: e.backward(dLdV, null, gLum), gLum };
})();
const FVL = fvLoss();
console.log(`(loss ${FVL.toFixed(4)} over ${FVSTEPS} optic-lobe steps)`);
const kdt0 = Float32Array.from(F.tau, t => F.dt / Math.max(t, F.dt));
for (const i of [...preNodes, F.N - 1]) {
  const h = 3e-2;
  const up = Float32Array.from(F.bias); up[i] += h;
  const dn = Float32Array.from(F.bias); dn[i] -= h;
  row(`fv bias[${i}]`, fvG.g.bias[i], (fvLoss({ bias: up }) - fvLoss({ bias: dn })) / (2 * h), h, FVL);
}
// kdt is probed at the photoreceptor nodes as well as in the interior. A node sitting at its fixed
// point is insensitive to its own time constant -- (-v + bias + acc + x) is zero there, so the
// gradient is genuinely about 1e-5 -- and every interior node in a 40-step assay is close to one. The
// nodes the moving bar actually drives are the ones where the quantity is measurable.
for (const i of [...F.inputIdx.R1.slice(0, 2), ...preNodes.slice(0, 2), F.N - 1]) {
  const h = 1e-2;
  const up = Float32Array.from(kdt0); up[i] += h;
  const dn = Float32Array.from(kdt0); dn[i] -= h;
  row(`fv kdt[${i}]`, fvG.g.kdt[i], (fvLoss({ kdt: up }) - fvLoss({ kdt: dn })) / (2 * h), h, FVL);
}
for (const k of inEdges) {
  // 1e-2 rather than 1e-1: the optic lobe is piecewise linear and a large step crosses rectification
  // boundaries, which the finite difference reads as slope. One edge here disagreed by 1.1e-2 at
  // h = 1e-1 and converges monotonically -- 9.7e-3, 4.6e-3, 1.4e-3 at 3e-2, 1e-2, 3e-3 -- so the
  // disagreement was the difference's truncation and not the adjoint.
  const h = +(process.env.HW || 1e-2);
  const up = Float32Array.from(F.weight); up[k] += h;
  const dn = Float32Array.from(F.weight); dn[k] -= h;
  row(`fv weight[${k}]`, fvG.g.weight[k], (fvLoss({ weight: up }) - fvLoss({ weight: dn })) / (2 * h), h, FVL);
}
// the luminance: the gradient that makes a stimulus-optimisation experiment possible
for (const [t, c] of [[1, 0], [2, (NCOL / 2) | 0]]) {
  const h = 1e-1;
  const bump = d => (eye, tt) => { const a = lum(eye, tt); if (Math.round(tt / F.dt) === t) a[c] += d; return a; };
  row(`lum[t=${t},col=${c}]`, fvG.gLum[t * NCOL + c],
    (fvLoss({}, bump(h)) - fvLoss({}, bump(-h))) / (2 * h), h, FVL);
}

// ---- the shipped coupling's discontinuity, measured rather than asserted -------------------------
const jump = (() => {
  const ch = new VisualChain(sub, F, FVMAP, { ...P0, dead: 0.02, cap: 200, logGain });
  ch.vRest = VREST; ch.eyeV0 = null;
  ch.forward(STEPS, { lum });
  return { s: ch.stats(), dz: 0.02 * P0.gain };
})();
console.log(`\nwith the shipped coupling (deadband 0.02, cap 200 Hz): ${(jump.s.live * 100).toFixed(1)}% of`
  + ` pair-steps are in the live band, ${(jump.s.belowDeadband * 100).toFixed(1)}% at or below the deadband,`
  + ` ${(jump.s.saturated * 100).toFixed(1)}% saturated.`);
console.log(`The deadband is a ${jump.dz.toFixed(0)} Hz discontinuity rather than a soft floor: a node crossing`
  + ` it takes the drive from 0 to ${jump.dz.toFixed(0)} Hz in one step. No gradient exists there and none`
  + ` is claimed; the ${(100 - jump.s.live * 100).toFixed(0)}% of pair-steps outside the live band are what a`
  + ` visual fit cannot see.`);

console.log(`\n${fails === 0 ? `PASS (${rows} gradients checked, ${mute} under the finite-difference floor)`
  : `FAIL: ${fails} of ${rows} outside tolerance`}`);
process.exit(fails === 0 ? 0 : 1);
