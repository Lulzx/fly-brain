//   node --max-old-space-size=16000 scripts/engram_recover.mjs [--probes=200] [--comp=y4] [--eta=0.7] [--seed=1]
//
// Spec S6.5/S6.6: the recovery experiment. Teach one mushroom-body compartment with one CS+/US
// pairing, then ask whether the installed engram can be read back out of the model's own
// physiology -- and whether recall changes downstream behaviour.
//
// The story this tests is the standard KC->MBON one (Aso & Rubin 2016): odor -> sparse KC
// population -> MBON rate, with the DAN burst stamping a depression pattern into the compartment
// it tiles. The decoder is deliberately simple: KC spike rate during a probe odor times the edge's
// anatomical weight is the feature, the MBON's rate change (trained minus naive) is the
// observation, and ridge regression recovers delta m per edge. If the rule installed a real
// memory, decoded delta m correlates with the written one; the controls say whether that
// correlation means anything.
//
// Controls (spec S6.5):
//   naive     decode trained-vs-naive where both runs are naive: the noise floor
//   swap      decode the same delta-y over a compartment the US never touched: the anatomy test
//   random    teach a degree-matched random engram instead of the rule's: the decoder test
//   shuffle   permute MBON rows of the design matrix: the wiring test
//
// Three graphs live in one WASM memory (naive / trained / random), three brains over them, all
// with the same seed so probe order is a paired measurement, not a Monte Carlo.

import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { brainScales, applyClassPhysiology, BRAIN_DEFAULTS, modulatorySign, typeGains } from '../src/brainmodel.js';
import { graphBytes, brainBytes, writeGraph, LIFWasm } from '../src/lifwasm.js';
import { DEFAULTS as LIF_DEFAULTS } from '../src/lif.js';
import { Neuromod } from '../src/sim/neuromod.js';
import { ODORANTS } from '../src/sim/senses.js';
import { buildMB } from '../src/mb/edges.js';
import { Engram } from '../src/mb/plastic.js';
import { teach } from '../src/mb/teach.js';
import { probe, preference } from '../src/mb/recall.js';

const ARG = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const P = +(ARG.probes || 200), COMP = ARG.comp || 'y4', SWAPCOMP = ARG.swap || 'a3',
  ETA = +(ARG.eta || 0.7), SEED = +(ARG.seed || 1), K_GLOM = +(ARG.glom || 4);
const STIM = { settleMs: 400, stimMs: 800, rate: 100 };

const mulberry32 = a => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const D = loadAll(); const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json')); for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();
const o = { ...BRAIN_DEFAULTS, ...BASE };
const DATA = { ...D, superclass: D.sc };
const mb = buildMB(DATA);
console.log(`MB: ${mb.kc.length} KC, ${mb.mbon.length} MBON, ${mb.dan.length} DAN, ${mb.edges.csr.length} edges, ${mb.comps.length} compartments`);

// ---- odors ------------------------------------------------------------------
const S = D.bodymap.sensors;
const GLOMS = [...new Set(S.filter(s => s.kind === 'odor').map(s => s.glomerulus))];
const ornFor = gls => S.filter(s => s.kind === 'odor' && gls.has(s.glomerulus)).flatMap(s => s.idx);
const named = n => ornFor(new Set(Object.keys(ODORANTS[n])));
const ODORS = { csp: named('vinegar'), csm: named('banana'), nov: named('geosmin') };
const rnd = mulberry32(SEED);
const PROBES = [];
// Single-glomerulus probes first: each ORN channel drives a near-disjoint KC set, which
// de-correlates the decoder's design matrix. The remainder are random K-glomerulus blends.
for (const g of GLOMS) PROBES.push(ornFor(new Set([g])));
for (const g of GLOMS) PROBES.push(ornFor(new Set([g])));   // a second pass, different RNG position
for (let p = PROBES.length; p < P; p++) {
  const set = new Set(); while (set.size < K_GLOM) set.add(GLOMS[(rnd() * GLOMS.length) | 0]);
  PROBES.push(ornFor(set));
}
const P2 = PROBES.length;                                  // actual probe count (>= P)

// ---- brains ------------------------------------------------------------------
const WASM = fs.readFileSync('public/lif.wasm');
const GB = graphBytes(D.N, D.E), BB = brainBytes(D.N, 20);
const MEMB = 3 * GB + 4 * BB + (8 << 20);
const MEM = new WebAssembly.Memory({ initial: Math.ceil(MEMB / 65536), maximum: Math.ceil(MEMB / 65536), shared: true });
const INST = (await WebAssembly.instantiate(WASM, { env: { memory: MEM } })).instance;
const { inScale, sensoryMask } = brainScales(DATA, SIZE, o);
const SGN = modulatorySign(DATA, SIGN, o), TG = typeGains(DATA, o), LP = { ...LIF_DEFAULTS, ...o };
const align = v => (v + 4095) & ~4095;
const graphs = [], brains = [];
let top = 1024;
function addGraph(edgeGain) {
  const g = writeGraph(MEM, top, DATA, LP, inScale, sensoryMask, SGN, TG, edgeGain);
  graphs.push(g); top = align(g.end); return g;
}
function addBrain(g) {
  const b = new LIFWasm({ instance: INST, memory: MEM, graph: g, base: top, N: D.N, params: o, seed: SEED });
  top = align(b.end);
  applyClassPhysiology(b, DATA, o);
  if (o.neuromod) new Neuromod(DATA, b, { minSyn: o.minSyn }).modulate();
  brains.push(b); return b;
}
// Layout order matters -- everything is just offsets into one memory: g0, the teach brain on it,
// then the trained/random graphs (edgeGain unknown until teach runs), then the probe brains.
const g0 = addGraph(null);
const teachBrain = addBrain(g0);       // teaching consumes RNG; the probe brains below stay paired

// ---- teach -------------------------------------------------------------------
const t0 = Date.now();
const taught = teach(teachBrain, mb, { csOrns: ODORS.csp, comp: COMP, eta: ETA, seed: SEED });
console.log(`teach (${((Date.now() - t0) / 1e3).toFixed(1)}s): comp=${COMP} dans=${taught.dans} ` +
  `maxTr=${taught.maxTr.toFixed(2)} maxEl=${taught.maxEl.toFixed(2)} changed=${taught.changed}`);
const eng = new Engram(mb, taught.m);
const trained = addBrain(addGraph(eng.edgeGain(D.E)));
// degree-matched random engram: same edges changed count, uniform depression on random comp edges
const rndEng = new Engram(mb);
{
  const compE = mb.compEdges.get(mb.cIx.get(COMP)), r = mulberry32(SEED + 7);
  const pick = [...compE];
  for (let i = pick.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [pick[i], pick[j]] = [pick[j], pick[i]]; }
  const dm = taught.m ? [...compE].filter(k => taught.m[k] !== 1).map(k => taught.m[k] - 1) : [];
  for (let u = 0; u < dm.length; u++) rndEng.m[pick[u]] = 1 + dm[u];   // same multiset of deltas
}
const random = addBrain(addGraph(rndEng.edgeGain(D.E)));
const naive = addBrain(g0);            // fresh brain on the naive graph, same seed -> paired probes
console.log(`memory: ${(top / 1e6).toFixed(0)} MB of ${(MEMB / 1e6).toFixed(0)} MB`);
console.log(`random engram: ${rndEng.nChanged} edges changed`);

// ---- probes ------------------------------------------------------------------
// Paired: same probe order, same construction seed -> the RNG stream is a shared nuisance, not
// extra variance. The naive brain is probed twice (before and after the teach run used it) for
// the noise-floor control.
const pools = {
  fwd: T(['DNg100', 'DNg97', 'DNp09', 'DNa05', 'DNa07', 'DNp26', 'DNg25', 'DNa01', 'DNa02']),
  bwd: T(['DNb01', 'DNb02', 'DNb03', 'DNb04', 'DNb05', 'DNb06', 'DNb07', 'DNb08', 'DNb09',
    'DNbe001', 'DNbe002', 'DNbe003', 'DNbe004', 'DNbe005', 'DNbe006', 'DNbe007']),
};
function T(types) { return types.flatMap(t => D.byType(t)); }
function probeSet(net, tag) {
  const t = Date.now(), out = { R: [], Y: [], pref: {} };
  for (const ix of PROBES) { const p = probe(net, mb, pools, ix, STIM); out.R.push(p.kcHz); out.Y.push(p.mbonHz); }
  for (const [k, ix] of Object.entries(ODORS)) { const p = probe(net, mb, pools, ix, STIM); out.pref[k] = { pref: preference(p), mbonHz: [...p.mbonHz].map(x => +x.toFixed(2)), fwd: [...p.fwdHz].map(x => +x.toFixed(2)), bwd: [...p.bwdHz].map(x => +x.toFixed(2)) }; }
  console.log(`probes ${tag}: ${((Date.now() - t) / 1e3).toFixed(0)}s`);
  return out;
}
const A0 = probeSet(naive, 'naive');
const A1 = probeSet(trained, 'trained');
const A2 = probeSet(random, 'random');
const A0b = probeSet(naive, 'naive-re');   // noise floor: same graph, fresh RNG stream position

// ---- decoder -----------------------------------------------------------------
// delta y_j(p) = sum_i r_i(p) * w_ij * dm_ij + e. Ridge per MBON over ALL the KC edges into it --
// not just the taught compartment's -- so the anatomy control can ask whether the decoder puts
// the mass on the right compartment of the right MBON, not merely on the right MBON.
const W = DATA.weights, { csr, pre, post } = mb.edges;
const edgesByPost = new Map();
for (let k = 0; k < csr.length; k++) (edgesByPost.get(post[k]) || edgesByPost.set(post[k], []).get(post[k])).push(k);
function decode(dY, R, mbons, shuffleMbon = null) {
  const dm = new Float32Array(mb.edges.csr.length), dmL1 = new Float32Array(mb.edges.csr.length);
  for (const j0 of mbons) {
    const j = shuffleMbon ? shuffleMbon.get(j0) ?? j0 : j0;
    const ks = edgesByPost.get(j0) || [];
    const n = ks.length, AtA = new Float64Array(n * n), AtY = new Float64Array(n);
    for (let p = 0; p < P2; p++) {
      const dy = dY[p][j], rp = R[p];
      const a = new Float64Array(n);
      for (let u = 0; u < n; u++) a[u] = rp[pre[ks[u]]] * W[csr[ks[u]]];
      for (let u = 0; u < n; u++) { const au = a[u]; if (!au) continue; AtY[u] += au * dy; for (let v = 0; v <= u; v++) AtA[u * n + v] += au * a[v]; }
    }
    for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) AtA[u * n + v] = AtA[v * n + u];
    // Column-normalise: edge weights span ~50x, so raw coordinates let strong synapses dominate
    // the penalty. Both decoders run in normalised coords and rescale at the end.
    const colN = new Float64Array(n); for (let u = 0; u < n; u++) colN[u] = Math.sqrt(AtA[u * n + u]) || 1;
    const AA = new Float64Array(n * n), AY = new Float64Array(n);
    for (let u = 0; u < n; u++) { AY[u] = AtY[u] / colN[u]; for (let v = 0; v < n; v++) AA[u * n + v] = AtA[u * n + v] / (colN[u] * colN[v]); }
    // ridge
    let dg = 0; for (let u = 0; u < n; u++) dg += AA[u * n + u];
    const lam = 1e-3 * dg / Math.max(1, n);
    const G = Float64Array.from(AA); for (let u = 0; u < n; u++) G[u * n + u] += lam;
    const b = Float64Array.from(AY);
    for (let c = 0; c < n; c++) {
      let pv = c; for (let r = c + 1; r < n; r++) if (Math.abs(G[r * n + c]) > Math.abs(G[pv * n + c])) pv = r;
      if (pv !== c) { for (let q = c; q < n; q++) { const t = G[c * n + q]; G[c * n + q] = G[pv * n + q]; G[pv * n + q] = t; } const t = b[c]; b[c] = b[pv]; b[pv] = t; }
      const d = G[c * n + c]; if (!d) continue;
      for (let r = c + 1; r < n; r++) { const f = G[r * n + c] / d; if (!f) continue; for (let q = c; q < n; q++) G[r * n + q] -= f * G[c * n + q]; b[r] -= f * b[c]; }
    }
    for (let c = n - 1; c >= 0; c--) {
      let s = b[c]; for (let q = c + 1; q < n; q++) s -= G[c * n + q] * (dm[ks[q]] * colN[q]);
      dm[ks[c]] = (G[c * n + c] ? s / G[c * n + c] : 0) / colN[c];
    }
    // ISTA (L1): the truth is sparse -- a few hundred edges depressed out of ~450 per MBON.
    // z_{t+1} = S_mu(z_t + (AY - AA z)/L), L from the Gershgorin bound on AA.
    let L = 0; for (let u = 0; u < n; u++) { let rs = 0; for (let v = 0; v < n; v++) rs += Math.abs(AA[u * n + v]); if (rs > L) L = rs; }
    const mu = 0.02 * Math.max(...AY.map(Math.abs));
    const z = new Float64Array(n), grad = new Float64Array(n);
    for (let it = 0; it < 400; it++) {
      for (let u = 0; u < n; u++) { let s = AY[u]; for (let v = 0; v < n; v++) s -= AA[u * n + v] * z[v]; grad[u] = s / L; }
      for (let u = 0; u < n; u++) { const zz = z[u] + grad[u]; z[u] = Math.sign(zz) * Math.max(0, Math.abs(zz) - mu / L); }
    }
    for (let u = 0; u < n; u++) dmL1[ks[u]] = z[u] / colN[u];
  }
  return { dm, dmL1 };
}
function cos(dm, mStar, ks) {
  let ab = 0, aa = 0, bb = 0;
  for (const k of ks) { const a = dm[k], b = mStar[k] - 1; ab += a * b; aa += a * a; bb += b * b; }
  return ab / (Math.sqrt(aa * bb) || 1);
}
function norm(dm, ks) { let s = 0; for (const k of ks) s += dm[k] * dm[k]; return Math.sqrt(s); }
function topK(dm, mStar, ks, K) {
  const byD = [...ks].sort((a, b) => Math.abs(dm[b]) - Math.abs(dm[a])).slice(0, K);
  const byS = new Set([...ks].sort((a, b) => Math.abs(mStar[b] - 1) - Math.abs(mStar[a] - 1)).slice(0, K));
  return byD.filter(k => byS.has(k)).length / K;
}

const compE = [...mb.compEdges.get(mb.cIx.get(COMP))];
const dY1 = A1.Y.map((y, p) => Float32Array.from(y, (v, j) => v - A0.Y[p][j]));
const dY2 = A2.Y.map((y, p) => Float32Array.from(y, (v, j) => v - A0.Y[p][j]));
const dY0 = A0b.Y.map((y, p) => Float32Array.from(y, (v, j) => v - A0.Y[p][j]));
const dmStar = taught.m;

// Signal check before inversion: the linear model predicts dY_j(p) ~ sum_i r_i(p)*w_ij*(m*-1)
// on the compartment's edges. If that prediction does not correlate with the observed delta-y,
// either the engram did not move the MBONs or the linear readout is wrong -- and no decoder can
// fix that. Noise floor = the same correlation on the naive-vs-naive deltas.
function predictedDelta(mStar, R, compName) {
  const compE = mb.compEdges.get(mb.cIx.get(compName)) || [];
  const yh = A0.Y.map(() => new Float64Array(mb.mbon.length));
  for (const k of compE) {
    const dm = mStar[k] - 1; if (!dm) continue;
    const i = pre[k], j = post[k], w = W[csr[k]];
    for (let p = 0; p < P2; p++) yh[p][j] += R[p][i] * w * dm;
  }
  return yh;
}
function corrPred(dY, yh, js) {
  let ab = 0, aa = 0, bb = 0, n = 0;
  for (let p = 0; p < P2; p++) for (const j of js) {
    const a = yh[p][j], b = dY[p][j];
    ab += a * b; aa += a * a; bb += b * b; n++;
  }
  return ab / (Math.sqrt(aa * bb) || 1);
}
const compJs = [...new Set(compE.map(k => post[k]))];
const yhStar = predictedDelta(dmStar, A0.R, COMP);
const predCorr = corrPred(dY1, yhStar, compJs);
const predCorrNoise = corrPred(dY0, yhStar, compJs);
const dym1 = compJs.map(j => { let s = 0; for (const d of dY1) s += Math.abs(d[j]); return s / P2; });
const dym0 = compJs.map(j => { let s = 0; for (const d of dY0) s += Math.abs(d[j]); return s / P2; });
console.log(`comp-MBON |dy| trained-vs-naive ${(dym1.reduce((a, x) => a + x) / dym1.length).toFixed(2)} Hz,` +
  ` naive-vs-naive ${(dym0.reduce((a, x) => a + x) / dym0.length).toFixed(2)} Hz`);
console.log(`predicted-dy corr: signal ${predCorr.toFixed(3)} vs noise ${predCorrNoise.toFixed(3)}`);

const { dm: dm1, dmL1: dmL1a } = decode(dY1, A0.R, compJs);
const { dm: dm0 } = decode(dY0, A0.R, compJs);
const { dm: dmR, dmL1: dmR1 } = decode(dY2, A0.R, compJs);
const mbonPerm = new Map(); { const sh = [...compJs]; for (let i = sh.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [sh[i], sh[j]] = [sh[j], sh[i]]; } compJs.forEach((j, i) => mbonPerm.set(j, sh[i])); }
const { dm: dmShuf } = decode(dY1, A0.R, compJs, mbonPerm);
// Compartment specificity: the write should move only MBONs whose dendrite carries the tag. The
// packed graph cannot place a synapse inside a compartment, so the honest version of the
// "swapped compartment" control is at the MBON level: |dY| on untagged MBONs should stay at the
// naive-vs-naive floor while tagged MBONs move.
const compSet = new Set(compJs);
const nonCompJs = mb.mbon.map((_, j) => j).filter(j => !compSet.has(j));
const meanAbsDy = (dY, js) => { let s = 0; for (const d of dY) for (const j of js) s += Math.abs(d[j]); return s / (P2 * js.length); };
const dyTagged = meanAbsDy(dY1, compJs), dyUntagged = meanAbsDy(dY1, nonCompJs),
  dyNoise = meanAbsDy(dY0, compJs);
// Spec's swapped-compartment control, MBON level: run the same decode against a compartment the
// US never touched. Its MBONs' dY is pure propagation noise, so the recovered pattern should
// carry no mass and no correlation with m*.
const swapJs = mb.compMbons(SWAPCOMP).map(j => mb.mbonPos.get(j));
const { dm: dmSwap } = decode(dY1, A0.R, swapJs);
const swapMass = norm(dmSwap, [...(mb.compEdges.get(mb.cIx.get(SWAPCOMP)) || [])]);
const K = taught.changed || 1;
const dmStarR = rndEng.m;

const result = {
  config: { probes: P, comp: COMP, eta: ETA, seed: SEED, kGlom: K_GLOM, stim: STIM },
  teach: { changed: taught.changed, dans: taught.dans, maxTr: taught.maxTr, maxEl: taught.maxEl },
  recovery: {
    predCorr, predCorrNoise,
    compAbsDyTrained: dym1, compAbsDyNoise: dym0,
    cosine: cos(dm1, dmStar, compE), topK: topK(dm1, dmStar, compE, K), K,
    cosineL1: cos(dmL1a, dmStar, compE), topKL1: topK(dmL1a, dmStar, compE, K),
    randomCosineL1: cos(dmR1, dmStarR, compE),
    normTrained: norm(dm1, compE), normNoise: norm(dm0, compE),
    randomCosine: cos(dmR, dmStarR, compE), randomTopK: topK(dmR, dmStarR, compE, rndEng.nChanged || 1),
    dyTagged, dyUntagged, dyNoise, swapMass,
    shuffleCosine: cos(dmShuf, dmStar, compE),
    naiveCosine: cos(dm0, dmStar, compE),
  },
  preference: Object.fromEntries(Object.keys(ODORS).map(k => [k, {
    naive: A0.pref[k].pref, trained: A1.pref[k].pref,
    dMbonTrained: A1.pref[k].mbonHz.map((v, j) => +(v - A0.pref[k].mbonHz[j]).toFixed(2)),
  }])),
  engram: eng.toJSON(),
  // The raw probe matrices, so the decoder can be re-run without re-simulating. R is sparse
  // (Kenyon-cell sparseness is the point of the cell type); Y is dense over the 97 MBONs.
  probes: {
    R: A0.R.map(r => Object.fromEntries([...r].map((v, i) => [i, +v.toFixed(3)]).filter(([, v]) => v > 0))),
    Y0: A0.Y.map(y => [...y].map(v => +v.toFixed(3))),
    Y1: A1.Y.map(y => [...y].map(v => +v.toFixed(3))),
    Y2: A2.Y.map(y => [...y].map(v => +v.toFixed(3))),
    Y0b: A0b.Y.map(y => [...y].map(v => +v.toFixed(3))),
  },
};
console.log('\n--- recovery ---');
console.log(`cosine(dm^, dm*)      ${result.recovery.cosine.toFixed(3)}`);
console.log(`top-${K} overlap         ${result.recovery.topK.toFixed(3)}`);
console.log(`||dm^|| trained        ${result.recovery.normTrained.toFixed(2)}   noise floor ${result.recovery.normNoise.toFixed(2)}`);
console.log(`L1 cosine              ${result.recovery.cosineL1.toFixed(3)}   (sparse decoder)`);
console.log(`random-m* cosine       ${result.recovery.randomCosine.toFixed(3)}  L1 ${result.recovery.randomCosineL1.toFixed(3)}   (decoder sanity)`);
console.log(`compartment |dy|       tagged ${dyTagged.toFixed(2)} Hz vs untagged ${dyUntagged.toFixed(2)} Hz, noise ${dyNoise.toFixed(2)} Hz`);
console.log(`swap ${SWAPCOMP} decode mass   ${swapMass.toFixed(3)} vs taught ${norm(dm1, compE).toFixed(3)}   (anatomy control)`);
console.log(`shuffle-MBON cosine    ${result.recovery.shuffleCosine.toFixed(3)}   (wiring control)`);
console.log(`naive-vs-naive cosine  ${result.recovery.naiveCosine.toFixed(3)}   (noise floor)`);
console.log('\n--- preference (fwd-bwd)/(fwd+bwd) ---');
for (const k of Object.keys(ODORS)) {
  const p = result.preference[k];
  console.log(`${k}: naive ${p.naive.toFixed(3)} -> trained ${p.trained.toFixed(3)}`);
}
fs.writeFileSync('public/data/engram_recover.json', JSON.stringify(result, null, 1));
console.log('\nwrote public/data/engram_recover.json');
