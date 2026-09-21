//   node --max-old-space-size=16000 scripts/engram_recon_pref.mjs [engram_recover.json]
//
// The strict half of spec S6.6's success clause: "the recovered model expresses the trained
// preference on a recall protocol it was not fitted against." Not the true engram -- the
// *decoded* one. Take the ridge reconstruction from the saved probe matrices, bake it into a
// graph as an edgeGain (clamped to the rule's bounds), and ask whether the animal that carries
// the reconstruction prefers CS+ over CS-/novel the way the truly trained animal did.
//
// Also reports the naive and truly-trained baselines so the comparison is on one page.

import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { brainScales, applyClassPhysiology, BRAIN_DEFAULTS, modulatorySign, typeGains } from '../src/brainmodel.js';
import { graphBytes, brainBytes, writeGraph, LIFWasm } from '../src/lifwasm.js';
import { DEFAULTS as LIF_DEFAULTS } from '../src/lif.js';
import { Neuromod } from '../src/sim/neuromod.js';
import { ODORANTS } from '../src/sim/senses.js';
import { buildMB } from '../src/mb/edges.js';
import { probe, preference } from '../src/mb/recall.js';

const FILE = process.argv[2] || 'public/data/engram_recover.json';
const R = JSON.parse(fs.readFileSync(FILE));
const D = loadAll(); const DATA = { ...D, superclass: D.sc };
const mb = buildMB(DATA);
const { csr, pre, post } = mb.edges, W = DATA.weights;
const COMP = R.config.comp, compE = [...mb.compEdges.get(mb.cIx.get(COMP))];
const compJs = [...new Set(compE.map(k => post[k]))];
const edgesByPost = new Map();
for (let k = 0; k < csr.length; k++) (edgesByPost.get(post[k]) || edgesByPost.set(post[k], []).get(post[k])).push(k);
const P = R.probes.Y0.length;
const RR = R.probes.R.map(o => { const v = new Float32Array(mb.kc.length); for (const [i, x] of Object.entries(o)) v[+i] = x; return v; });
const dY = R.probes.Y1.map((y, p) => y.map((v, j) => v - R.probes.Y0[p][j]));

// Ridge decode per compartment MBON over all its KC edges, column-normalised.
const dm = new Float32Array(csr.length);
for (const j of compJs) {
  const ks = edgesByPost.get(j) || [], n = ks.length;
  const A = new Float64Array(P * n);
  for (let p = 0; p < P; p++) { const rp = RR[p]; for (let u = 0; u < n; u++) A[p * n + u] = rp[pre[ks[u]]] * W[csr[ks[u]]]; }
  const colN = new Float64Array(n);
  for (let u = 0; u < n; u++) { let s = 0; for (let p = 0; p < P; p++) s += A[p * n + u] * A[p * n + u]; colN[u] = Math.sqrt(s) || 1; }
  const AA = new Float64Array(n * n), AY = new Float64Array(n);
  for (let p = 0; p < P; p++) {
    const dy = dY[p][j];
    for (let u = 0; u < n; u++) {
      const au = A[p * n + u] / colN[u]; if (!au) continue;
      AY[u] += au * dy;
      for (let v = 0; v <= u; v++) AA[u * n + v] += au * A[p * n + v] / colN[v];
    }
  }
  for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) AA[u * n + v] = AA[v * n + u];
  for (let u = 0; u < n; u++) AA[u * n + u] += 0.01;
  const b = Float64Array.from(AY);
  for (let c = 0; c < n; c++) {
    let pv = c; for (let r = c + 1; r < n; r++) if (Math.abs(AA[r * n + c]) > Math.abs(AA[pv * n + c])) pv = r;
    if (pv !== c) { for (let q = c; q < n; q++) { const t = AA[c * n + q]; AA[c * n + q] = AA[pv * n + q]; AA[pv * n + q] = t; } const t = b[c]; b[c] = b[pv]; b[pv] = t; }
    const d = AA[c * n + c]; if (!d) continue;
    for (let r = c + 1; r < n; r++) { const f = AA[r * n + c] / d; if (!f) continue; for (let q = c; q < n; q++) AA[r * n + q] -= f * AA[c * n + q]; b[r] -= f * b[c]; }
  }
  for (let c = n - 1; c >= 0; c--) { let s = b[c]; for (let q = c + 1; q < n; q++) s -= AA[c * n + q] * (dm[ks[q]] * colN[q]); dm[ks[c]] = (AA[c * n + c] ? s / AA[c * n + c] : 0) / colN[c]; }
}

// Bake: edgeGain = clamp(1 + dm, 0, 4) on decoded edges only; 1 elsewhere.
const edgeGainRecon = new Float32Array(D.E).fill(1);
for (let k = 0; k < csr.length; k++) if (dm[k]) edgeGainRecon[csr[k]] = Math.min(4, Math.max(0, 1 + dm[k]));
// the true engram, re-serialised
const edgeGainTrue = new Float32Array(D.E).fill(1);
for (const [c, v] of R.engram) edgeGainTrue[c] = v;

const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json')); for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();
const o = { ...BRAIN_DEFAULTS, ...BASE };
const WASM = fs.readFileSync('public/lif.wasm');
const GB = graphBytes(D.N, D.E), BB = brainBytes(D.N, 20);
const PAGES = Math.ceil((3 * GB + 3 * BB + (8 << 20)) / 65536);
const MEM = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES, shared: true });
const INST = (await WebAssembly.instantiate(WASM, { env: { memory: MEM } })).instance;
const { inScale, sensoryMask } = brainScales(DATA, SIZE, o);
const SGN = modulatorySign(DATA, SIGN, o), TG = typeGains(DATA, o), LP = { ...LIF_DEFAULTS, ...o };
const align = v => (v + 4095) & ~4095;
let top = 1024; const brains = {};
for (const [name, eg] of [['naive', null], ['true', edgeGainTrue], ['recon', edgeGainRecon]]) {
  const g = writeGraph(MEM, top, DATA, LP, inScale, sensoryMask, SGN, TG, eg); top = align(g.end);
  const b = new LIFWasm({ instance: INST, memory: MEM, graph: g, base: top, N: D.N, params: o, seed: R.config.seed });
  top = align(b.end);
  applyClassPhysiology(b, DATA, o);
  if (o.neuromod) new Neuromod(DATA, b, { minSyn: o.minSyn }).modulate();
  brains[name] = b;
}
const S = D.bodymap.sensors;
const ornFor = gls => S.filter(s => s.kind === 'odor' && gls.has(s.glomerulus)).flatMap(s => s.idx);
const named = n => ornFor(new Set(Object.keys(ODORANTS[n])));
const ODORS = { csp: named('vinegar'), csm: named('banana'), nov: named('geosmin') };
const pools = {
  fwd: ['DNg100', 'DNg97', 'DNp09', 'DNa05', 'DNa07', 'DNp26', 'DNg25', 'DNa01', 'DNa02'].flatMap(t => D.byType(t)),
  bwd: ['DNb01', 'DNb02', 'DNb03', 'DNb04', 'DNb05', 'DNb06', 'DNb07', 'DNb08', 'DNb09',
    'DNbe001', 'DNbe002', 'DNbe003', 'DNbe004', 'DNbe005', 'DNbe006', 'DNbe007'].flatMap(t => D.byType(t)),
};
console.log('odor   naive     true-m*   recon-m^');
for (const [k, ix] of Object.entries(ODORS)) {
  const out = {};
  for (const [name, b] of Object.entries(brains)) out[name] = preference(probe(b, mb, pools, ix, { settleMs: 400, stimMs: 800, rate: 100 }));
  console.log(`${k.padEnd(6)} ${out.naive.toFixed(3)}    ${out.true.toFixed(3)}     ${out.recon.toFixed(3)}`);
}
