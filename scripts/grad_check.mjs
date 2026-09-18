// Does the adjoint in src/lifdiff.js compute the gradient it claims to?
//
// A surrogate gradient cannot be checked against finite differences of a spiking model: the true
// derivative of a spike count with respect to a parameter is zero almost everywhere and undefined at
// the crossings, so any disagreement would be uninformative. What can be checked -- and what has to
// be, because the adjoint is where the bugs live -- is the smooth model the surrogate stands in for.
// With `soft: true` the forward pass replaces the threshold with a logistic, the whole simulation
// becomes differentiable, and the adjoint must agree with central finite differences to several
// digits. That is the test below.
//
// It runs on an induced subgraph of the real connectome rather than a toy network, so the code path
// exercised is the one the whole-brain fit uses: the same CSR traversal, the same delay ring, the
// same size-scaling and inhibitory-gain machinery.
//
//   node scripts/grad_check.mjs [neurons] [steps] [truncate]
//
// The third argument is the truncation window: 0 disables truncation, which is the setting that must
// pass, because with it the adjoint differentiates the whole trajectory. A shorter window is a
// deliberate bias (see scripts/adjoint_window.mjs) and will not match finite differences.
import { loadAll } from './lib_node.mjs';
import { LIFDiff, DIFF_PARAMS } from '../src/lifdiff.js';

const K = +(process.argv[2] || 600), STEPS = +(process.argv[3] || 60), TRUNC = +(process.argv[4] ?? 0);
const D = loadAll();

// ---- induced subgraph: breadth-first from a well-connected neuron -------------------------------
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
const n = pick.length;
const ip = new Uint32Array(n + 1); const ix = [], wt = [];
for (let a = 0; a < n; a++) {
  const u = pick[a];
  for (let j = D.indptr[u]; j < D.indptr[u + 1]; j++) { const m = inSet.get(D.indices[j]);
    if (m !== undefined) { ix.push(m); wt.push(D.weights[j]); } }
  ip[a + 1] = ix.length;
}
const sub = { N: n, indptr: ip, indices: Uint32Array.from(ix), weights: Uint16Array.from(wt),
  nt: Uint8Array.from(pick, i => D.nt[i]) };
console.log(`subgraph: ${n} neurons, ${ix.length} connections, ${STEPS} steps, soft spikes,`
  + ' with a type gain and a threshold offset on every neuron');

// ---- a deterministic, smooth test problem -------------------------------------------------------
let rs = 12345; const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const sizeLog = Float32Array.from({ length: n }, () => rnd() * 2 - 1);
const thrMask = Uint8Array.from({ length: n }, () => (rnd() < 0.2 ? 1 : 0));
const biasMask = Uint8Array.from({ length: n }, (_, i) => (i < n / 4 ? 1 : 0));   // the input
const logGain = Float32Array.from({ length: n }, () => (rnd() - 0.5) * 0.2);
// The fixed per-neuron structure src/diffsetup.js supplies: a type gain on outgoing synapses and a
// threshold offset in mV. Neither is differentiated, but both sit inside the expressions the nine
// gradients below are taken of -- outScale multiplies everything wSyn and logGain and depU act on, and
// thrOffset shifts the point the surrogate is evaluated at -- so every row here is also a check that
// they were threaded through the adjoint and not just the forward pass.
const outScale = Float32Array.from({ length: n }, () => 0.5 + rnd());
const thrOffset = Float32Array.from({ length: n }, () => (rnd() - 0.5) * 4);
const target = []; for (let i = 0; i < n; i++) if (rnd() < 0.3) target.push(i);

const P0 = { soft: true, tRef: 0, minSyn: 3, coba: true, wSyn: 0.5, sizeAlpha: 0.6, inhGain: 0.8,
  eInh: -76, vThresh: -45, kcThreshold: 2, laminaBias: 14, adaptInc: 0.4, depU: 0.15,
  surrogateBeta: 1.5 };

function loss(over) {
  const net = new LIFDiff(sub, { ...P0, ...over, sizeLog, thrMask, biasMask, outScale, thrOffset,
    logGain: over?.logGain || logGain });
  net.forward(STEPS, { record: false });
  let L = 0; for (const i of target) L += net.spikeCount[i];
  return L;
}
function gradient() {
  const net = new LIFDiff(sub, { ...P0, sizeLog, thrMask, biasMask, outScale, thrOffset, logGain });
  const tape = net.forward(STEPS);
  let L = 0; for (const i of target) L += net.spikeCount[i];
  const dL = new Float32Array(n); for (const i of target) dL[i] = 1;
  return { L, ...net.backward(tape, dL, { truncate: TRUNC }) };
}

const t0 = Date.now();
const g = gradient();
const ms = Date.now() - t0;
console.log(`loss ${g.L.toFixed(6)}   forward+backward ${ms} ms\n`);

// Step sizes: state is Float32Array, so the loss carries ~1e-5 of absolute noise and a step below
// about 1e-3 measures rounding rather than slope. These are chosen large enough to clear that and
// small enough that the second-order truncation term stays well under it.
const H = { wSyn: 2e-3, sizeAlpha: 2e-3, inhGain: 2e-3, eInh: 2e-1, vThresh: 1e-2,
  kcThreshold: 1e-2, laminaBias: 1e-2, adaptInc: 2e-3, depU: 2e-3 };
// The comparison has to allow for the finite difference's own error: with a Float32 forward pass the
// loss is good to about 1e-6 of its magnitude, and a central difference divides that by h. A row
// passes when the disagreement is within 0.1% of the gradient plus that floor.
const pad = (s, k) => String(s).padEnd(k);
const check = (a, fd, h, L) => { const tol = 1e-3 * Math.abs(fd) + 4e-6 * Math.abs(L) / h;
  return { ok: Math.abs(a - fd) <= tol, rel: Math.abs(a - fd) / Math.max(1e-12, Math.abs(fd)) }; };
console.log(pad('parameter', 14), pad('adjoint', 16), pad('finite difference', 18), pad('rel. error', 12), 'vs tolerance');
let fails = 0;
for (const k of DIFF_PARAMS) {
  const h = H[k];
  const fd = (loss({ [k]: P0[k] + h }) - loss({ [k]: P0[k] - h })) / (2 * h);
  const a = g.params[k], c = check(a, fd, h, g.L);
  if (!c.ok) fails++;
  console.log(pad(k, 14), pad(a.toFixed(6), 16), pad(fd.toFixed(6), 18),
    pad(c.rel.toExponential(2), 12), c.ok ? 'ok' : 'OUT OF TOLERANCE');
}

// a handful of the per-neuron gains, which are the parameters that motivate the whole exercise
console.log('\nper-neuron log-gains (the 10^5-dimensional part):');
const probe = [0, 1, 2, (n / 3) | 0, (n / 2) | 0];
for (const i of probe) {
  const h = 2e-2;
  const up = Float32Array.from(logGain); up[i] += h;
  const dn = Float32Array.from(logGain); dn[i] -= h;
  const fd = (loss({ logGain: up }) - loss({ logGain: dn })) / (2 * h);
  const a = g.logGain[i], c = check(a, fd, h, g.L);
  if (!c.ok) fails++;
  console.log(pad(`  logGain[${i}]`, 14), pad(a.toFixed(6), 16), pad(fd.toFixed(6), 18),
    pad(c.rel.toExponential(2), 12), c.ok ? 'ok' : 'OUT OF TOLERANCE');
}

console.log(`\n${fails === 0 ? 'PASS' : `FAIL: ${fails} gradient(s) outside tolerance`}`);
process.exit(fails === 0 ? 0 : 1);
