// How long does the adjoint window need to be, and what does the old window cost?
//
// src/lifdiff.js clears the adjoint every `truncate` steps. The comment on that parameter said the
// reason was stability: "a recurrent spiking network of this size diverges if the adjoint is carried
// over hundreds of steps -- the products of Jacobians grow without bound and overflow Float32".
// That claim has never been checked here, and it is testable. This script checks it two ways.
//
//   1. Correctness, at four graph sizes up to 20k neurons and 150 ms. Run the smooth model (soft
//      thresholds, src/lifdiff.js), take the adjoint at several window lengths, and compare each
//      against central finite differences of the loss. Finite differences are the truth; the adjoint
//      is claimed to compute their limit.
//
//   2. Cost, at whole-CNS size. Time one backward pass at each window.
//
// What it shows is that truncation is not a stability measure at this scale -- nothing overflows, and
// the full-window adjoint matches finite differences to ~1e-4 relative. What truncation does do is
// bias the gradient, and at a 25-step window (the default the whole-CNS fit used) the bias is tens of
// percent. The default is now no truncation; the numbers below are why.
//
//   node scripts/adjoint_window.mjs [correctness|cost|all]
import { loadAll } from './lib_node.mjs';
import { LIFDiff, DIFF_PARAMS } from '../src/lifdiff.js';

const MODE = process.argv[2] || 'all';
const D = loadAll();

/** Induced subgraph, breadth-first from a well-connected neuron -- the same construction
 *  scripts/grad_check.mjs uses, so the code path is the whole-CNS one. */
function subgraph(K) {
  const outdeg = Array.from({ length: D.N }, (_, i) => D.indptr[i + 1] - D.indptr[i]);
  let seed = 0; for (let i = 0; i < D.N; i++) if (outdeg[i] > outdeg[seed] && outdeg[i] < 400) seed = i;
  const pick = [seed], inSet = new Map([[seed, 0]]);
  for (let h = 0; h < pick.length && pick.length < K; h++) {
    const u = pick[h];
    for (let j = D.indptr[u]; j < D.indptr[u + 1] && pick.length < K; j++) {
      const q = D.indices[j];
      if (!inSet.has(q)) { inSet.set(q, pick.length); pick.push(q); }
    }
  }
  const n = pick.length, ip = new Uint32Array(n + 1), ix = [], wt = [];
  for (let a = 0; a < n; a++) { const u = pick[a];
    for (let j = D.indptr[u]; j < D.indptr[u + 1]; j++) { const m = inSet.get(D.indices[j]);
      if (m !== undefined) { ix.push(m); wt.push(D.weights[j]); } }
    ip[a + 1] = ix.length; }
  return { N: n, indptr: ip, indices: Uint32Array.from(ix), weights: Uint16Array.from(wt), nt: Uint8Array.from(pick, i => D.nt[i]) };
}

let rs = 12345; const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const P0 = { soft: true, tRef: 0, minSyn: 3, coba: true, wSyn: 0.5, sizeAlpha: 0.6, inhGain: 0.8,
  eInh: -76, vThresh: -45, kcThreshold: 2, laminaBias: 14, adaptInc: 0.4, depU: 0.15, surrogateBeta: 1.5 };
const H = 2e-3;
const PROBED = ['wSyn', 'inhGain', 'adaptInc', 'depU'];

function problem(sub, steps) {
  const n = sub.N;
  rs = 12345;
  const sizeLog = Float32Array.from({ length: n }, () => rnd() * 2 - 1);
  const thrMask = Uint8Array.from({ length: n }, () => (rnd() < 0.2 ? 1 : 0));
  const biasMask = Uint8Array.from({ length: n }, (_, i) => (i < n / 4 ? 1 : 0));
  const logGain = Float32Array.from({ length: n }, () => (rnd() - 0.5) * 0.2);
  const target = []; for (let i = 0; i < n; i++) if (rnd() < 0.1) target.push(i);
  const mk = over => new LIFDiff(sub, { ...P0, ...over, sizeLog, thrMask, biasMask, logGain: over?.logGain || logGain });
  const loss = over => { const net = mk(over); net.forward(steps, { record: false });
    let L = 0; for (const i of target) L += net.spikeCount[i]; return L; };
  const fd = Object.fromEntries(PROBED.map(k => [k, (loss({ [k]: P0[k] + H }) - loss({ [k]: P0[k] - H })) / (2 * H)]));
  const run = truncate => { const net = mk({}); const tape = net.forward(steps); const dL = new Float32Array(n);
    for (const i of target) dL[i] = 1;
    const t0 = Date.now(); const g = net.backward(tape, dL, { truncate });
    return { g, ms: Date.now() - t0 }; };
  return { n, target: target.length, fd, run };
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
if (MODE === 'correctness' || MODE === 'all') {
  console.log('1. Is truncation needed for stability, and what does it cost in accuracy?');
  console.log('   Relative error of the adjoint against central finite differences.\n');
  console.log('   neurons   steps   window      ' + PROBED.map(k => k.padEnd(10)).join('') + 'status');
  for (const [K, steps] of [[600, 200], [1500, 400], [6000, 300], [20000, 300]]) {
    const { fd, run } = problem(subgraph(K), steps);
    for (const truncate of [25, 50, 100, 200, 0]) {
      if (truncate > steps) continue;
      const { g } = run(truncate);
      const finite = Object.values(g.params).every(Number.isFinite) && g.logGain.every(Number.isFinite);
      const win = truncate === 0 ? `full (${steps * 0.5} ms)` : `${truncate * 0.5} ms`;
      const err = k => finite ? ((g.params[k] - fd[k]) / Math.max(1e-9, Math.abs(fd[k]))).toFixed(4) : 'nan';
      console.log('  ', String(K).padStart(7), String(steps).padStart(7), ' ', win.padEnd(16),
        PROBED.map(k => err(k).padEnd(10)).join(''), finite ? '' : 'NON-FINITE');
    }
    console.log();
  }
}

if (MODE === 'cost' || MODE === 'all') {
  console.log('\n2. What does the window cost at whole-CNS size?');
  // The setting that matters is the one the fit uses: hard thresholds, and a driven input. With `soft`
  // every neuron emits a small logistic "spike" every step, the activity is no longer sparse, and the
  // cost measures the worst case rather than the real one.
  const sub = { N: D.N, indptr: D.indptr, indices: D.indices, weights: D.weights, nt: D.nt };
  const steps = 200, n = D.N;
  const sizeLog = new Float32Array(n), thrMask = new Uint8Array(n), biasMask = new Uint8Array(n);
  const logGain = new Float32Array(n);
  const target = []; for (let i = 0; i < n; i += 137) target.push(i);
  const P1 = { ...P0, soft: false };
  const net = new LIFDiff(sub, { ...P1, sizeLog, thrMask, biasMask, logGain });
  const S = D.bodymap.sensors;
  const SUGAR = ['LB3b', 'LB3c'].flatMap(t => D.byType(t));
  net.setDrive(SUGAR, 100);
  console.log(`   whole CNS: ${n} neurons, ${D.E} connections, ${steps} steps (${steps * 0.5} ms), ${target.length} loss neurons`);
  console.log(`   drive: ${SUGAR.length} sugar neurons at 100 Hz; hard thresholds`);
  const t0 = Date.now(); const tape = net.forward(steps); const fwd = Date.now() - t0;
  const dL = new Float32Array(n); for (const i of target) dL[i] = 1;
  console.log(`   forward (tape recorded): ${fwd} ms`);
  for (const truncate of [25, 0]) {
    const t1 = Date.now(); const g = net.backward(tape, dL, { truncate }); const ms = Date.now() - t1;
    const finite = Object.values(g.params).every(Number.isFinite) && g.logGain.every(Number.isFinite);
    console.log(`   backward, ${(truncate === 0 ? 'full window' : `truncate ${truncate} (${truncate * 0.5} ms)`).padEnd(28)} ${String(ms).padStart(6)} ms   ${finite ? 'finite' : 'NON-FINITE'}`);
  }
  // Is the backward pass sparse enough for an event-driven wake list to pay? It is not, and this is
  // the measurement that settles it: the adjoint state is carried by nearly every neuron, because the
  // surrogate derivative is evaluated at every neuron whether or not it spiked, so a neuron that is
  // silent in the forward pass still transmits gradient in the backward one.
  for (const truncate of [25, 0]) {
    net.diag = {};
    net.backward(tape, dL, { truncate });
    const c = net.diag.counts, mean = c.reduce((a, b) => a + b, 0) / c.length;
    console.log(`   adjoint state nonzero at ${mean.toFixed(0)} neurons per step (${(100 * mean / n).toFixed(1)}% of N)`
      + ` with truncate ${truncate || 'off'}`);
  }
}
