// Worker process: evaluates a parameter set on the benchmark suite; used by calib_search.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAll } from './lib_node.mjs';
import { createBrain, brainScales, applyClassPhysiology, BRAIN_DEFAULTS, modulatorySign, typeGains } from '../src/brainmodel.js';
import { graphBytes, brainBytes, writeGraph, LIFWasm } from '../src/lifwasm.js';
import { DEFAULTS as LIF_DEFAULTS } from '../src/lif.js';
import { FlyVis, parseFlyVis, flyvisBytes } from '../src/flyvis.js';
import { Neuromod } from '../src/sim/neuromod.js';
export const D = loadAll(); const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const T = (...ts) => ts.flatMap(t => D.byType(t));
const DATA = { ...D, superclass: D.sc };
const WASM = fs.readFileSync('public/lif.wasm');
const FVB = fs.readFileSync('public/vision/flyvis.bin'); const FVM = parseFlyVis(FVB.buffer.slice(FVB.byteOffset, FVB.byteOffset + FVB.byteLength), JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json')));
const FVMAP = JSON.parse(fs.readFileSync('public/vision/flyvis_map.json'));
const MEMB = graphBytes(D.N, D.E) + brainBytes(D.N, 20) + flyvisBytes(FVM.N, FVM.E) + FVM.N * 4 * 8 + (4 << 20);
const MEM = new WebAssembly.Memory({ initial: Math.ceil(MEMB / 65536), maximum: Math.ceil(MEMB / 65536), shared: true });
const INST = (await WebAssembly.instantiate(WASM, { env: { memory: MEM } })).instance;
let graphKey = null, GRAPH = null, BRAIN_END = 0;
const ALL_EXC = new Float32Array(D.N).fill(1);   // sign-free control: every neuron excitatory
// Weight ablations for the substitution ladder (scripts/ablation_ladder.mjs): graded synapse counts
// replaced by their mean (topology only) or permuted among the retained edges (a matched control).
const mulberry32 = a => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let EBW = null;   // empirical-Bayes connection weights from scripts/synapse_confidence.py
function weightsFor(o) {
  // `cutOut` removes a population's output from the graph by zeroing its outgoing edges, which is how
  // scripts/mn9_quiet.mjs asks what a layer contributes to a resting rate. It composes with the
  // ablations below rather than replacing them.
  const cut = w => { if (!o.cutOut) return w; const out = Float32Array.from(w); for (const p of o.cutOut) for (let k = DATA.indptr[p]; k < DATA.indptr[p + 1]; k++) out[k] = 0; return out; };
  if (o.wEB) { if (!EBW) { const b = fs.readFileSync('public/data/edge_w_shrunk.u16'); EBW = new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
    if (EBW.length !== DATA.weights.length) throw new Error('edge_w_shrunk.u16 does not match the graph'); return cut(EBW); }
  if (!o.wBinary && !o.wShuffle) return cut(DATA.weights);
  const min = o.minSyn ?? 1, src = DATA.weights, kept = [];
  for (let k = 0; k < src.length; k++) if (src[k] >= min) kept.push(k);
  const w = Float32Array.from(src);
  if (o.wBinary) { let m = 0; for (const k of kept) m += src[k]; m /= Math.max(1, kept.length); for (const k of kept) w[k] = m; }
  else { const vals = kept.map(k => src[k]), rnd = mulberry32((o.seed ?? 1) >>> 0);
    for (let i = vals.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [vals[i], vals[j]] = [vals[j], vals[i]]; }
    kept.forEach((k, i) => { w[k] = vals[i]; }); }
  return cut(w);
}
export function makeBrain(cfg) {
  const o = { ...BRAIN_DEFAULTS, ...cfg }; const { seed: cfgSeed, cutOut, ...gcfg } = o;
  const key = JSON.stringify(gcfg) + (cutOut ? `|cut${cutOut.length}:${cutOut[0]}:${cutOut[cutOut.length - 1]}` : '') + (o.wShuffle ? '|' + cfgSeed : '');
  if (key !== graphKey) { const { inScale, sensoryMask } = brainScales(DATA, SIZE, o); for (const sd of ['L', 'R']) for (const [i] of FVMAP.eyes[sd].pairs) sensoryMask[i] = 1; GRAPH = writeGraph(MEM, 1024, { ...DATA, weights: weightsFor(o) }, { ...LIF_DEFAULTS, ...o }, inScale, sensoryMask, modulatorySign(DATA, o.signFree ? ALL_EXC : SIGN, o), typeGains(DATA, o)); graphKey = key; }
  const b = new LIFWasm({ instance: INST, memory: MEM, graph: GRAPH, base: (GRAPH.end + 4095) & ~4095, N: D.N, params: o, seed: cfgSeed ?? ((Math.random() * 1e9) | 0) });
  BRAIN_END = b.end;
  applyClassPhysiology(b, DATA, o);
  if (o.neuromod) new Neuromod(DATA, b, { minSyn: o.minSyn }).modulate();   // fed octopamine tone on OA targets (its fast synapses are off)
  return b;
}
export const S = D.bodymap.sensors, SN = Object.fromEntries(S.map(s => [s.name, s.idx]));
export const RELAY = T('GNG232'), RELAY2 = T('DNge080');
export const SUGAR = T('LB3b', 'LB3c'), BITTER = T('LB1a', 'LB1b', 'LB1c', 'LB1d'), MN9 = T('MN9'), BDN2 = T('DNg100');
export const ORN_ALL = S.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const DM1 = [...SN['ORN_DM1 left'], ...SN['ORN_DM1 right']], VA2 = [...SN['ORN_VA2 left'], ...SN['ORN_VA2 right']];
const DM1PN = T('DM1_lPN'); const KC = [], PN = []; for (let i = 0; i < D.N; i++) { const c = D.meta.classes[D.cls[i]]; if (c === 'Kenyon_Cell') KC.push(i); if (c === 'ALPN') PN.push(i); }
const LEGSUGAR = (legs) => legs.flatMap(k => (SN[`taste ${k}`] || []).filter(i => ['LgLG3', 'LgLG4', 'LgAG2'].includes(D.meta.types[i])));
export const FRONT_SUGAR = LEGSUGAR(['T1 left', 'T1 right']), ALL_SUGAR = LEGSUGAR(['T1 left', 'T1 right', 'T2 left', 'T2 right', 'T3 left', 'T3 right']);
const FWD_POP = Object.entries({ DNg100: 1, DNg97: 1, DNp09: 1, DNa05: 0.7, DNa07: 0.7, DNp26: 0.7, DNg25: 0.7, DNa01: 0.4, DNa02: 0.4 }).flatMap(([t, w]) => D.byType(t).map(i => [i, w]));
const fwdRate = (net, ms) => FWD_POP.reduce((a, [i, w]) => a + w * net.spikeCount[i], 0) / FWD_POP.reduce((a, [, w]) => a + w, 0) / (ms / 1000);
const MDN = T('MDN'); const GF = T('DNp01');
// Poisson sigmas above its own baseline before a neuron counts as odour-responsive. Three is the
// conventional level, and the null is empty at three: `kcNull`/`pnFracNull` below report how much of
// each layer clears the same bar when the stimulus is a second baseline run.
const SIGMA = 3;
const PHOTO = D.bodymap.eyes.flatMap(e => e.idx);
// looming: expanding dark disc centred at az 30 deg, el 10 deg (frontal-left), radius 5 -> 70 deg over 300 ms
const EYE_DIRS = D.bodymap.eyes.flatMap(e => e.idx.map((i, k) => [i, e.az[k] * Math.PI / 180, e.el[k] * Math.PI / 180]));
const LC = [Math.cos(0.17) * Math.cos(0.52), Math.cos(0.17) * Math.sin(0.52), Math.sin(0.17)];
const ANG = EYE_DIRS.map(([i, az, el]) => [i, Math.acos(Math.min(1, Math.cos(el) * Math.cos(az) * LC[0] + Math.cos(el) * Math.sin(az) * LC[1] + Math.sin(el) * LC[2])) * 180 / Math.PI]);
const VPN = []; for (let i = 0; i < D.N; i++) if (D.meta.superclasses[D.sc[i]] === 'visual_projection') VPN.push(i);
const COLDIRS = ['L', 'R'].map(sd => FVMAP.eyes[sd].dirs);
function makeEyes() { let base = (BRAIN_END + 65535) & ~65535; const e0 = new FlyVis(INST, MEM, base, FVM); const e1 = new FlyVis(INST, MEM, (e0.end + 4095) & ~4095, { ...FVM, shared: e0.sharedParts, bias: e0.bias });
  const grey = new Float32Array(721).fill(0.5); for (const e of [e0, e1]) { e.setInput(grey); for (let k = 0; k < 150; k++) e.step(); } return [e0, e1, e0.v.slice(0)]; }
const FVPAIRS = ['L', 'R'].map(sd => ({ n: Int32Array.from(FVMAP.eyes[sd].pairs, p => p[0]), node: Int32Array.from(FVMAP.eyes[sd].pairs, p => p[1]) }));
function driveFromEyes(net, eyes, vRest, gain = 250) { for (let s = 0; s < 2; s++) { const v = eyes[s].v, P = FVPAIRS[s]; for (let k = 0; k < P.n.length; k++) { const a = v[P.node[k]] - vRest[P.node[k]]; net.setDriveOne(P.n[k], a > 0.02 ? Math.min(200, gain * a) : 0); } } }
// visual stimuli on the flyvis columns: loom = dark disc expanding at (az 40, el 10) on the left eye; flow = front-to-back grating on both eyes
function lumLoom(eye, t) { const c = [Math.cos(0.17) * Math.cos(0.7), Math.cos(0.17) * Math.sin(0.7), Math.sin(0.17)]; const rad = (5 + 70 * Math.max(0, Math.min(1, t / 0.4)) ** 2) * Math.PI / 180;
  return Float32Array.from(COLDIRS[eye], d => Math.acos(Math.min(1, d[0] * c[0] + d[1] * c[1] + d[2] * c[2])) < rad ? 0.05 : 0.5); }
function lumFlow(eye, t) { return Float32Array.from(COLDIRS[eye], d => { const th = Math.atan2(Math.abs(d[1]), d[0]) * 180 / Math.PI; return 0.5 + 0.35 * Math.sin(2 * Math.PI * (th - 60 * t) / 30); }); }
const legGroups = D.bodymap.muscles.filter(m => /T[123]/.test(m.name) && !/ltm/.test(m.name));
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
export function sim(cfg, drives, ms, off = 0, bins = null) {
  const net = makeBrain(cfg); for (const [ix, hz] of drives) net.setDrive(ix, hz);
  const steps = (ms + off) / net.p.dt; const trace = []; let prev = new Uint32Array(D.N);
  for (let s = 1; s <= steps; s++) { if (s === ms / net.p.dt) for (const [ix] of drives) net.setDrive(ix, 0); net.step();
    if (bins && s % (bins / net.p.dt) === 0) { let a = 0; for (let i = 0; i < D.N; i++) if (net.spikeCount[i] !== prev[i]) a++; trace.push(a); prev = net.spikeCount.slice(); } }
  // `sp` is a snapshot, and it is not a convenience. Every LIFWasm is laid out at the same base of the
  // one shared WebAssembly.Memory, so two networks constructed in the same expression expose the *same*
  // Uint32Array -- reading counts off both of them compares a run with itself. That silently made the
  // DM1 and VA2 Kenyon-cell sets identical in every evaluation ever run here (kcJaccard = 1.000 to
  // three decimals, which is what gave it away). Read counts from `sp`, not from `net.spikeCount`,
  // whenever two networks are alive at once.
  return { net, trace, sp: Uint32Array.from(net.spikeCount) };
}
export const rate = (net, ix, ms) => mean(ix.map(i => net.spikeCount[i])) / (ms / 1000);
function rhythm(x) { const y = x.slice(5); const m = mean(y); const z = y.map(v => v - m); const v0 = z.reduce((a, b) => a + b * b, 0); if (v0 < 1e-9) return 0;
  let best = 0; for (let lag = 3; lag < 20; lag++) { let c = 0; for (let i = 0; i + lag < z.length; i++) c += z[i] * z[i + lag]; best = Math.max(best, c / v0); } return best; }
export function evaluate(cfg) {
  const o = {}; const base = [[ORN_ALL, 6]];
  const sd0 = cfg.seed ?? ((Math.random() * 1e9) | 0); const C = { ...cfg, seed: sd0 };
  // The feeding block shares one seed across its runs, and the response terms are scored on the tastant-
  // evoked *increase* rather than on the raw rate, for the reason docs/20-roadmap.md M3 measures: MN9
  // idles at 26.6 Hz on olfactory drive alone, and the raw rate under a tastant is mostly that idle.
  // Scored raw, `tarsalPER` reads 0.85 off a pathway whose evoked component is -0.16 +- 1.57 Hz -- it
  // and `quietMN9` were two readings of one number with opposite signs, which is why no fit could ever
  // satisfy both. Quiescence terms (`bitter`, `quietMN9`) stay absolute, because "is it quiet" is a
  // question about the rate and not about a change in it.
  let r = sim(C, base, 400, 0, 100); const spBase = r.sp;
  o.baseActive = mean(r.trace.slice(1)); o.baseMN9 = rate(r.net, MN9, 400); o.baseFwd = fwdRate(r.net, 400);
  o.baseKC = KC.filter(i => spBase[i] > 1).length / KC.length; o.basePN = PN.filter(i => spBase[i] > 1).length;
  const baseMN9 = o.baseMN9, evoked = x => Math.max(0, x - baseMN9);
  r = sim(C, [...base, [SUGAR, 100]], 400, 300, 100); o.sugarMN9 = rate(r.net, MN9, 700) * 700 / 400; o.relay = rate(r.net, RELAY, 700) * 700 / 400; o.relay2 = rate(r.net, RELAY2, 700) * 700 / 400; o.sugarPeak = Math.max(...r.trace.slice(0, 4)); o.afterSugar = r.trace[6];
  o.sugarMN9ev = evoked(o.sugarMN9);
  r = sim(C, [...base, [BITTER, 100]], 400); o.bitterMN9 = rate(r.net, MN9, 400);
  r = sim(C, [...base, [SUGAR, 100], [BITTER, 100]], 400); o.mixMN9 = rate(r.net, MN9, 400); o.mixMN9ev = evoked(o.mixMN9);
  r = sim(C, [...base, [FRONT_SUGAR, 150]], 400); o.tarsalMN9 = rate(r.net, MN9, 400); o.tarsalMN9ev = evoked(o.tarsalMN9);
  r = sim(C, [...base, [ALL_SUGAR, 150]], 400); o.sugarFwd = fwdRate(r.net, 400); o.sugarMDN = rate(r.net, MDN, 400);
  // Odour-evoked, baseline-subtracted, with a **noise-aware response threshold**. A neuron counts as
  // responding to DM1 when its spike count exceeds its own baseline count by SIGMA Poisson sigmas of
  // that baseline. This replaces a fixed `> 1` count, which is the same threshold at 0.5 Hz and at
  // 50 Hz and so is not a response criterion at all: measured at the fitted point, 23% of Kenyon cells
  // and 72% of ALPNs clear it with no odour applied, and two independently seeded baseline runs agree
  // at Jaccard 0.93. Under the fixed threshold the terms credited DM1 with 18.4% of Kenyon cells and
  // 60.5% of ALPNs while the raw population fraction rose by 2.1 and 0.6 points respectively -- an
  // overshoot of eightfold, and inflatable, because raising the baseline raises the count without
  // raising the bound. docs/20-roadmap.md A7 records the fit buying specificity exactly that way.
  //
  // SIGMA scales with the square root of the baseline, so a busier neuron needs a bigger rise, and the
  // null collapses: at three sigma no Kenyon cell passes with no odour applied. The anatomy supports
  // the smaller numbers -- DM1 drives 28 of 686 ALPNs (4.1%) directly -- and both layers come out
  // sparser than their targets, which is the opposite of what the fixed threshold reported and is the
  // quantity the fit should now be pushed on. The rise is still computed, and bounds the response
  // fraction, because no response measure can exceed the population change it is measuring.
  //
  // The three runs share a seed: subtracting counts from independently seeded networks would measure
  // the seed, not the odour.
  { const sd = cfg.seed ?? ((Math.random() * 1e9) | 0), z = sim({ ...cfg, seed: sd }, base, 400);
    const a = sim({ ...cfg, seed: sd }, [...base, [DM1, 80]], 400), b = sim({ ...cfg, seed: sd }, [...base, [VA2, 80]], 400);
    const z2 = sim({ ...cfg, seed: sd + 1 }, base, 400);
    const sig = (r2, i) => Math.max(0, r2.sp[i] - z.sp[i]) > SIGMA * Math.sqrt(z.sp[i] + 1);
    const ka = new Set(KC.filter(i => sig(a, i))), kb = new Set(KC.filter(i => sig(b, i)));
    let inter = 0; for (const x of ka) if (kb.has(x)) inter++;
    const raw = (r2, pop) => pop.filter(i => r2.sp[i] > 1).length / pop.length;
    o.kcRise = raw(a, KC) - raw(z, KC); o.pnRise = raw(a, PN) - raw(z, PN);
    o.kcFracRaw = raw(a, KC); o.pnFracRaw = raw(a, PN);
    // The null: how much of each layer the same criterion calls responsive when the "odour" is a second
    // baseline run. Reported so the term can be read against it rather than against zero.
    o.kcNull = KC.filter(i => Math.max(0, z2.sp[i] - z.sp[i]) > SIGMA * Math.sqrt(z.sp[i] + 1)).length / KC.length;
    // Every responder contributes more than SIGMA spikes to the population total, because sqrt(n+1) >= 1,
    // so the number of responders is bounded by the total evoked count over SIGMA. This is the bound the
    // raw fraction cannot give: a cell crossing the >1 threshold and a different cell falling back under
    // it cancel in the fraction and not in the total. It is the sense in which a response measure cannot
    // exceed the population change it is measuring.
    o.kcCap = Math.min(1, KC.reduce((s, i) => s + Math.max(0, a.sp[i] - z.sp[i]), 0) / (SIGMA * KC.length));
    // The effective number of responding cells: (sum e)^2 / sum e^2, over the evoked counts. Scale
    // invariant -- multiplying the whole odour response by any factor leaves it unchanged -- so unlike
    // the threshold-crossing fraction it cannot be raised by making the layer more excitable or the
    // response larger, only by making the response more concentrated in fewer cells.
    { let s1 = 0, s2 = 0; for (const i of KC) { const e = Math.max(0, a.sp[i] - z.sp[i]); s1 += e; s2 += e * e; }
      o.kcEff = s2 > 0 ? (s1 * s1) / s2 / KC.length : 0; }
    o.kcFrac = Math.min(ka.size / KC.length, o.kcCap);
    o.kcJaccard = inter / Math.max(1, ka.size + kb.size - inter);
    o.pnFrac = PN.filter(i => sig(a, i)).length / PN.length;
    o.pnFracNull = PN.filter(i => Math.max(0, z2.sp[i] - z.sp[i]) > SIGMA * Math.sqrt(z.sp[i] + 1)).length / PN.length;
    // The lPN rate is odour-evoked too. Scored raw it is the baseline drive plus the response, and at
    // the fitted point that saturates the term against its 60 Hz target before the odour is applied.
    o.dm1PNRaw = mean(DM1PN.map(i => a.sp[i])) / 0.4; o.dm1PN = mean(DM1PN.map(i => Math.max(0, a.sp[i] - z.sp[i]))) / 0.4; }
  for (const [label, stim] of [['loom', lumLoom], ['flow', lumFlow]]) { const net = makeBrain(cfg); net.setDrive(ORN_ALL, 6); const [e0, e1, vRest] = makeEyes(); const eyes = [e0, e1];
    const prev = new Uint32Array(D.N); const TK = pop => pop.reduce((a, [i, w]) => a + w * net.spikeCount[i], 0);
    for (let s = 0; s < 1200; s++) {                        // 200 ms grey, then 400 ms stimulus
      if (s % 40 === 0) { const t = (s - 400) / 2000; for (let e = 0; e < 2; e++) { eyes[e].setInput(t < 0 ? new Float32Array(721).fill(0.5) : stim(e, t)); eyes[e].step(); } driveFromEyes(net, eyes, vRest); }
      if (s === 400) prev.set(net.spikeCount); net.step(); }
    // Spikes per giant-fibre neuron over the 400 ms stimulus, through the trained optic lobe. von Reyn
    // et al. 2014 record 1-3 spikes per loom and none to translation, so the unit is spikes/neuron and
    // 2 is as many as the benchmark asks for. Reporting the raw population count here and then dividing
    // by two in the score conflated that with the number of cells (two, one per side).
    const gf = GF.reduce((a, i) => a + net.spikeCount[i] - prev[i], 0) / GF.length;
    const to = ['DNp02', 'DNp04'].flatMap(t => D.byType(t)).reduce((a, i) => a + net.spikeCount[i] - prev[i], 0) / 4 / 0.4;
    o[label + 'GF'] = gf; o[label + 'TO'] = to; }
  // Photoreceptor-driven loom, reported but not scored. It is a real stimulus and a real route
  // (photoreceptor -> lamina -> ... -> giant fibre) and it does not work: the lamina is driven by
  // histaminergic photoreceptors, so adding photoreceptor spikes inhibits L1-L5 rather than exciting
  // them, and the relay is silent at every stage. Scoring this would tell the fit that zero is correct.
  // It used to: this block wrote o.loomGF, overwriting the flyvis measurement above, and 60% of the
  // loom term was reading a number that could not move. See docs/20-roadmap.md A3.
  { const net = makeBrain(cfg); net.setDrive(ORN_ALL, 6); net.setDrive(PHOTO, 40);
    const prevGF = new Uint32Array(D.N); let vpnBase = 0;
    for (let s = 1; s <= 1400; s++) {       // 400 ms adapted static scene, then 300 ms loom
      if (s > 800) { const rad = 5 + 65 * (s - 800) / 600; for (const [i, a] of ANG) if (a < rad) net.setDriveOne(i, 0); }
      net.step(); if (s === 800) { vpnBase = VPN.filter(i => net.spikeCount[i] > 0).length; prevGF.set(net.spikeCount); } }
    o.photoGF = GF.reduce((a, i) => a + net.spikeCount[i] - prevGF[i], 0) / GF.length / 0.3;
    o.vpnBase = vpnBase; o.staticGF = GF.reduce((a, i) => a + prevGF[i], 0) / GF.length / 0.4; }
  const net = makeBrain(cfg); net.setDrive(BDN2, 150); const series = legGroups.map(() => []); let prev = new Uint32Array(D.N);
  for (let s = 1; s <= 1600; s++) { net.step(); if (s % 40 === 0) { legGroups.forEach((g, k) => series[k].push(g.idx.reduce((x, i) => x + net.spikeCount[i] - prev[i], 0) / g.idx.length / 0.02)); prev = net.spikeCount.slice(); } }
  const act = series.map(mean); const on = act.map((v, k) => [v, rhythm(series[k])]).filter(([v]) => v > 3);
  o.legActive = on.length; o.legRhythm = mean(on.map(x => x[1]));
  // objective (higher is better), each term in [0,1]
  const clamp = x => Math.max(0, Math.min(1, x));
  const terms = {
    sugar: 0.2 * clamp(o.relay / 40) + 0.2 * clamp(o.relay2 / 40) + 0.6 * clamp(o.sugarMN9ev / 60), bitter: clamp(1 - o.bitterMN9 / 20), mix: o.sugarMN9ev > 10 ? clamp(1 - o.mixMN9ev / o.sugarMN9ev) : 0,
    // kcSparse scores the *effective* fraction of Kenyon cells carrying the odour response rather than
    // the fraction crossing a threshold. The two disagree and the disagreement is the point: a refit
    // that raised the baseline from 23% of cells active to 62% passed twice as many cells through the
    // 3-sigma bar and its crossing fraction doubled (0.015 to 0.030), but the response it bought is
    // broader and weaker, so the effective fraction rose from 0.163 to 0.364 -- the wrong way. The
    // count is scale invariant, so no gain change can move it; only concentrating the response can.
    // Target 0.08 is the sparseness the imaging literature reports for a food odour, which for equally
    // responding cells is an effective fraction of 0.08. pnSpecific targets the 4.1% of ALPNs DM1
    kcSparse: clamp(1 - Math.abs(Math.log((o.kcEff + 1e-3) / 0.08)) / 2), kcSpecific: o.kcFrac > 0.01 ? clamp(1 - o.kcJaccard / 0.6) : 0,
    // pnSpecific is a ceiling, not a band. The wiring puts DM1 on 28 of 686 ALPNs (4.1%), so at most that
    // fraction of the layer can be driven by it directly. A band centred on 4.1% would penalise the model
    // for the attenuation between "innervated" and "significantly driven", which is real: at the fitted
    // point 0.27% of the layer clears the 3-sigma bar. The connectome sets the ceiling and the term reads
    // how far under it the layer sits. It carries little weight either way -- where the model's odour
    // response actually lives shows up in kcSparse, kcSpecific and dm1PN.
    pnSpecific: clamp(1 - o.pnFrac / 0.041), dm1PN: clamp(o.dm1PN / 60),
    baseline: clamp(1 - o.baseActive / 20000), offset: clamp(1 - (o.afterSugar - o.baseActive) / 3000),
    legs: clamp(o.legActive / 25), rhythm: clamp(o.legRhythm / 0.6),
    tarsalPER: clamp(o.tarsalMN9ev / 30), sugarStop: o.baseFwd > 1 ? clamp((o.baseFwd - o.sugarFwd) / o.baseFwd * 2) : 0,
    noMDN: clamp(1 - o.sugarMDN / 10), quietMN9: clamp(1 - o.baseMN9 / 10),
    loom: 0.6 * clamp(o.loomGF / 2) + 0.4 * clamp((o.loomTO - o.flowTO) / 30), noFalseAlarm: clamp(1 - o.flowGF / 2),
  };
  const W = { sugar: 2, bitter: 1, mix: 1, kcSparse: 1, kcSpecific: 0.5, pnSpecific: 0.5, dm1PN: 1, baseline: 1.5, offset: 1, legs: 1.5, rhythm: 1, tarsalPER: 1.5, sugarStop: 1, noMDN: 0.5, quietMN9: 0.5, loom: 2, noFalseAlarm: 1 };
  o.score = Object.entries(terms).reduce((s, [k, v]) => s + W[k] * v, 0) / Object.values(W).reduce((a, b) => a + b, 0);
  o.terms = terms; return o;
}
// Worker/CLI entry, only when this file is the process entry point: other scripts import makeBrain,
// sim and the index sets from here, and must not trigger an evaluation by doing so.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
process.on('message', (msg) => { try { const o = evaluate(msg.cfg); process.send({ id: msg.id, cfg: msg.cfg, out: o }); } catch (e) { process.send({ id: msg.id, cfg: msg.cfg, error: String(e.stack) }); } });
if (process.argv[2]) { const t0 = Date.now(); const o = evaluate(JSON.parse(process.argv[2])); console.log(JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v), (Date.now() - t0) / 1000 + 's'); }
}
