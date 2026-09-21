//   node scripts/engram_decode.mjs [engram_recover.json] [--iters=2000]
//
// Offline decoder iteration over the saved probe matrices from engram_recover.mjs -- the
// expensive part (the probes) is done once; recovery experiments replay from the artifact.
// Methods: ridge, ISTA (proper L via power iteration), and OMP-ish greedy support selection.

import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { buildMB } from '../src/mb/edges.js';

const FILE = process.argv[2] || 'public/data/engram_recover.json';
const ARG = Object.fromEntries(process.argv.slice(3).map(a => a.replace(/^--/, '').split('=')));
const ITERS = +(ARG.iters || 2000);

const R = JSON.parse(fs.readFileSync(FILE));
const D = loadAll(); const mb = buildMB({ ...D, superclass: D.sc });
const { csr, pre, post } = mb.edges, W = D.weights;
const COMP = R.config.comp, compE = [...mb.compEdges.get(mb.cIx.get(COMP))];
const compJs = [...new Set(compE.map(k => post[k]))];
const edgesByPost = new Map();
for (let k = 0; k < csr.length; k++) (edgesByPost.get(post[k]) || edgesByPost.set(post[k], []).get(post[k])).push(k);
const P = R.probes.Y0.length;
const RR = R.probes.R.map(o => { const v = new Float32Array(mb.kc.length); for (const [i, x] of Object.entries(o)) v[+i] = x; return v; });
const dY = R.probes.Y1.map((y, p) => y.map((v, j) => v - R.probes.Y0[p][j]));
const dY0 = R.probes.Y0b.map((y, p) => y.map((v, j) => v - R.probes.Y0[p][j]));

// m* sparse from the serialized engram entries [[csr, m], ...]
const mStar = new Float32Array(csr.length).fill(1);
const pos = new Map(); for (let k = 0; k < csr.length; k++) pos.set(csr[k], k);
for (const [c, v] of R.engram) { const k = pos.get(c); if (k !== undefined) mStar[k] = v; }
const dmStar = compE.map(k => mStar[k] - 1);

function cosDm(dm, ks) {
  let ab = 0, aa = 0, bb = 0;
  for (const k of ks) { const a = dm[k], b = mStar[k] - 1; ab += a * b; aa += a * a; bb += b * b; }
  return ab / (Math.sqrt(aa * bb) || 1);
}
function topKO(dm, ks, K) {
  const byD = [...ks].sort((a, b) => Math.abs(dm[b]) - Math.abs(dm[a])).slice(0, K);
  const byS = new Set([...ks].sort((a, b) => Math.abs(mStar[b] - 1) - Math.abs(mStar[a] - 1)).slice(0, K));
  return byD.filter(k => byS.has(k)).length / K;
}

// Per-MBON decode over ALL its KC edges; three solvers on the same normal equations.
function decodeAll(dYm) {
  const out = { ridge: new Float32Array(csr.length), l1: new Float32Array(csr.length), l1n: 0 };
  for (const j of compJs) {
    const ks = edgesByPost.get(j) || [], n = ks.length;
    const A = new Float64Array(P * n);                      // P x n, design
    for (let p = 0; p < P; p++) { const rp = RR[p]; for (let u = 0; u < n; u++) A[p * n + u] = rp[pre[ks[u]]] * W[csr[ks[u]]]; }
    const colN = new Float64Array(n);
    for (let u = 0; u < n; u++) { let s = 0; for (let p = 0; p < P; p++) s += A[p * n + u] ** 2; colN[u] = Math.sqrt(s) || 1; }
    const y = Float64Array.from({ length: P }, (_, p) => dYm[p][j]);
    // ridge in normalised coords
    const AA = new Float64Array(n * n), AY = new Float64Array(n);
    for (let p = 0; p < P; p++) for (let u = 0; u < n; u++) { const au = A[p * n + u] / colN[u]; if (!au) continue; AY[u] += au * y[p]; for (let v = 0; v <= u; v++) AA[u * n + v] += au * A[p * n + v] / colN[v]; }
    for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) AA[u * n + v] = AA[v * n + u];
    const lam = 0.01;   // normalised design: diag ~ P
    const G = Float64Array.from(AA); for (let u = 0; u < n; u++) G[u * n + u] += lam;
    const b = Float64Array.from(AY);
    for (let c = 0; c < n; c++) {
      let pv = c; for (let r = c + 1; r < n; r++) if (Math.abs(G[r * n + c]) > Math.abs(G[pv * n + c])) pv = r;
      if (pv !== c) { for (let q = c; q < n; q++) { const t = G[c * n + q]; G[c * n + q] = G[pv * n + q]; G[pv * n + q] = t; } const t = b[c]; b[c] = b[pv]; b[pv] = t; }
      const d = G[c * n + c]; if (!d) continue;
      for (let r = c + 1; r < n; r++) { const f = G[r * n + c] / d; if (!f) continue; for (let q = c; q < n; q++) G[r * n + q] -= f * G[c * n + q]; b[r] -= f * b[c]; }
    }
    const x = new Float64Array(n);
    for (let c = n - 1; c >= 0; c--) { let s = b[c]; for (let q = c + 1; q < n; q++) s -= G[c * n + q] * x[q]; x[c] = G[c * n + c] ? s / G[c * n + c] : 0; }
    for (let u = 0; u < n; u++) out.ridge[ks[u]] = x[u] / colN[u];
    // ISTA with power-iterated L on AA
    const grad = new Float64Array(n);
    const v = new Float64Array(n).fill(1); let L = 1;
    for (let it = 0; it < 30; it++) {
      for (let u = 0; u < n; u++) { let s = 0; for (let w = 0; w < n; w++) s += AA[u * n + w] * v[w]; grad[u] = s; }
      let nv = 0; for (const q of grad) nv = Math.max(nv, Math.abs(q));
      if (nv > 0) { for (let u = 0; u < n; u++) v[u] = grad[u] / nv; L = nv; }
    }
    const z = new Float64Array(n);
    let muMax = 0; for (const a of AY) muMax = Math.max(muMax, Math.abs(a));
    const mu = muMax * 0.1;
    for (let it = 0; it < ITERS; it++) {
      for (let u = 0; u < n; u++) { let s = AY[u]; for (let w = 0; w < n; w++) s -= AA[u * n + w] * z[w]; grad[u] = s / L; }
      for (let u = 0; u < n; u++) { const zz = z[u] + grad[u]; z[u] = Math.sign(zz) * Math.max(0, Math.abs(zz) - mu / L); }
    }
    for (let u = 0; u < n; u++) if (z[u]) { out.l1[ks[u]] = z[u] / colN[u]; out.l1n++; }
  }
  return out;
}

console.log(`comp=${COMP} edges=${compE.length} mbons=${compJs.length} probes=${P} changed=${R.teach.changed}`);
const D1 = decodeAll(dY), D0 = decodeAll(dY0);
console.log(`ridge:   cosine ${cosDm(D1.ridge, compE).toFixed(3)}   topK ${topKO(D1.ridge, compE, R.teach.changed).toFixed(3)}   noise cos ${cosDm(D0.ridge, compE).toFixed(3)}`);
console.log(`ISTA L1: cosine ${cosDm(D1.l1, compE).toFixed(3)}   topK ${topKO(D1.l1, compE, R.teach.changed).toFixed(3)}   noise cos ${cosDm(D0.l1, compE).toFixed(3)}   nnz ${D1.l1n}`);
