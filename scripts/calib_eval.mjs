// Worker process: evaluates a parameter set on the benchmark suite; used by calib_search.mjs
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain, brainScales, applyClassPhysiology, BRAIN_DEFAULTS } from '../src/brainmodel.js';
import { graphBytes, brainBytes, writeGraph, LIFWasm } from '../src/lifwasm.js';
import { DEFAULTS as LIF_DEFAULTS } from '../src/lif.js';
const D = loadAll(); const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const T = (...ts) => ts.flatMap(t => D.byType(t));
const DATA = { ...D, superclass: D.sc };
const WASM = fs.readFileSync('public/lif.wasm');
const MEM = new WebAssembly.Memory({ initial: Math.ceil((graphBytes(D.N, D.E) + brainBytes(D.N, 20) + (1 << 20)) / 65536), maximum: Math.ceil((graphBytes(D.N, D.E) + brainBytes(D.N, 20) + (1 << 20)) / 65536), shared: true });
const INST = (await WebAssembly.instantiate(WASM, { env: { memory: MEM } })).instance;
let graphKey = null, GRAPH = null;
function makeBrain(cfg) {
  const o = { ...BRAIN_DEFAULTS, ...cfg }; const key = JSON.stringify(o);
  if (key !== graphKey) { const { inScale, sensoryMask } = brainScales(DATA, SIZE, o); GRAPH = writeGraph(MEM, 1024, DATA, { ...LIF_DEFAULTS, ...o }, inScale, sensoryMask, SIGN); graphKey = key; }
  const b = new LIFWasm({ instance: INST, memory: MEM, graph: GRAPH, base: (GRAPH.end + 4095) & ~4095, N: D.N, params: o, seed: (Math.random() * 1e9) | 0 });
  return applyClassPhysiology(b, DATA, o);
}
const S = D.bodymap.sensors, SN = Object.fromEntries(S.map(s => [s.name, s.idx]));
const RELAY = T('GNG232'), RELAY2 = T('DNge080');
const SUGAR = T('LB3b', 'LB3c'), BITTER = T('LB1a', 'LB1b', 'LB1c', 'LB1d'), MN9 = T('MN9'), BDN2 = T('DNg100');
const ORN_ALL = S.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const DM1 = [...SN['ORN_DM1 left'], ...SN['ORN_DM1 right']], VA2 = [...SN['ORN_VA2 left'], ...SN['ORN_VA2 right']];
const DM1PN = T('DM1_lPN'); const KC = [], PN = []; for (let i = 0; i < D.N; i++) { const c = D.meta.classes[D.cls[i]]; if (c === 'Kenyon_Cell') KC.push(i); if (c === 'ALPN') PN.push(i); }
const LEGSUGAR = (legs) => legs.flatMap(k => (SN[`taste ${k}`] || []).filter(i => ['LgLG3', 'LgLG4', 'LgAG2'].includes(D.meta.types[i])));
const FRONT_SUGAR = LEGSUGAR(['T1 left', 'T1 right']), ALL_SUGAR = LEGSUGAR(['T1 left', 'T1 right', 'T2 left', 'T2 right', 'T3 left', 'T3 right']);
const FWD_POP = Object.entries({ DNg100: 1, DNg97: 1, DNp09: 1, DNa05: 0.7, DNa07: 0.7, DNp26: 0.7, DNg25: 0.7, DNa01: 0.4, DNa02: 0.4 }).flatMap(([t, w]) => D.byType(t).map(i => [i, w]));
const fwdRate = (net, ms) => FWD_POP.reduce((a, [i, w]) => a + w * net.spikeCount[i], 0) / FWD_POP.reduce((a, [, w]) => a + w, 0) / (ms / 1000);
const MDN = T('MDN');
const legGroups = D.bodymap.muscles.filter(m => /T[123]/.test(m.name) && !/ltm/.test(m.name));
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function sim(cfg, drives, ms, off = 0, bins = null) {
  const net = makeBrain(cfg); for (const [ix, hz] of drives) net.setDrive(ix, hz);
  const steps = (ms + off) / net.p.dt; const trace = []; let prev = new Uint32Array(D.N);
  for (let s = 1; s <= steps; s++) { if (s === ms / net.p.dt) for (const [ix] of drives) net.setDrive(ix, 0); net.step();
    if (bins && s % (bins / net.p.dt) === 0) { let a = 0; for (let i = 0; i < D.N; i++) if (net.spikeCount[i] !== prev[i]) a++; trace.push(a); prev = net.spikeCount.slice(); } }
  return { net, trace };
}
const rate = (net, ix, ms) => mean(ix.map(i => net.spikeCount[i])) / (ms / 1000);
function rhythm(x) { const y = x.slice(5); const m = mean(y); const z = y.map(v => v - m); const v0 = z.reduce((a, b) => a + b * b, 0); if (v0 < 1e-9) return 0;
  let best = 0; for (let lag = 3; lag < 20; lag++) { let c = 0; for (let i = 0; i + lag < z.length; i++) c += z[i] * z[i + lag]; best = Math.max(best, c / v0); } return best; }
export function evaluate(cfg) {
  const o = {}; const base = [[ORN_ALL, 6]];
  let r = sim(cfg, [...base, [SUGAR, 100]], 400, 300, 100); o.sugarMN9 = rate(r.net, MN9, 700) * 700 / 400; o.relay = rate(r.net, RELAY, 700) * 700 / 400; o.relay2 = rate(r.net, RELAY2, 700) * 700 / 400; o.sugarPeak = Math.max(...r.trace.slice(0, 4)); o.afterSugar = r.trace[6];
  r = sim(cfg, [...base, [BITTER, 100]], 400); o.bitterMN9 = rate(r.net, MN9, 400);
  r = sim(cfg, [...base, [SUGAR, 100], [BITTER, 100]], 400); o.mixMN9 = rate(r.net, MN9, 400);
  r = sim(cfg, [...base, [FRONT_SUGAR, 150]], 400); o.tarsalMN9 = rate(r.net, MN9, 400);
  r = sim(cfg, [...base, [ALL_SUGAR, 150]], 400); o.sugarFwd = fwdRate(r.net, 400); o.sugarMDN = rate(r.net, MDN, 400);
  r = sim(cfg, base, 400, 0, 100); o.baseActive = mean(r.trace.slice(1)); o.baseMN9 = rate(r.net, MN9, 400); o.baseFwd = fwdRate(r.net, 400); o.baseKC = KC.filter(i => r.net.spikeCount[i] > 1).length / KC.length; o.basePN = PN.filter(i => r.net.spikeCount[i] > 1).length;
  const a = sim(cfg, [...base, [DM1, 80]], 400), b = sim(cfg, [...base, [VA2, 80]], 400);
  const ka = new Set(KC.filter(i => a.net.spikeCount[i] > 1)), kb = new Set(KC.filter(i => b.net.spikeCount[i] > 1)); let inter = 0; for (const x of ka) if (kb.has(x)) inter++;
  o.kcFrac = ka.size / KC.length; o.kcJaccard = inter / Math.max(1, ka.size + kb.size - inter);
  o.dm1PN = rate(a.net, DM1PN, 400); o.pnFrac = PN.filter(i => a.net.spikeCount[i] > 1).length / PN.length;
  const net = makeBrain(cfg); net.setDrive(BDN2, 150); const series = legGroups.map(() => []); let prev = new Uint32Array(D.N);
  for (let s = 1; s <= 1600; s++) { net.step(); if (s % 40 === 0) { legGroups.forEach((g, k) => series[k].push(g.idx.reduce((x, i) => x + net.spikeCount[i] - prev[i], 0) / g.idx.length / 0.02)); prev = net.spikeCount.slice(); } }
  const act = series.map(mean); const on = act.map((v, k) => [v, rhythm(series[k])]).filter(([v]) => v > 3);
  o.legActive = on.length; o.legRhythm = mean(on.map(x => x[1]));
  // objective (higher is better), each term in [0,1]
  const clamp = x => Math.max(0, Math.min(1, x));
  const terms = {
    sugar: 0.2 * clamp(o.relay / 40) + 0.2 * clamp(o.relay2 / 40) + 0.6 * clamp(o.sugarMN9 / 60), bitter: clamp(1 - o.bitterMN9 / 20), mix: o.sugarMN9 > 10 ? clamp(1 - o.mixMN9 / o.sugarMN9) : 0,
    kcSparse: clamp(1 - Math.abs(Math.log((o.kcFrac + 1e-3) / 0.08)) / 2), kcSpecific: o.kcFrac > 0.01 ? clamp(1 - o.kcJaccard / 0.6) : 0,
    pnSpecific: clamp(1 - (o.pnFrac - 0.05) / 0.5), dm1PN: clamp(o.dm1PN / 60),
    baseline: clamp(1 - o.baseActive / 20000), offset: clamp(1 - (o.afterSugar - o.baseActive) / 3000),
    legs: clamp(o.legActive / 25), rhythm: clamp(o.legRhythm / 0.6),
    tarsalPER: clamp(o.tarsalMN9 / 30), sugarStop: o.baseFwd > 1 ? clamp((o.baseFwd - o.sugarFwd) / o.baseFwd * 2) : 0,
    noMDN: clamp(1 - o.sugarMDN / 10), quietMN9: clamp(1 - o.baseMN9 / 10),
  };
  const W = { sugar: 2, bitter: 1, mix: 1, kcSparse: 1, kcSpecific: 0.5, pnSpecific: 0.5, dm1PN: 1, baseline: 1.5, offset: 1, legs: 1.5, rhythm: 1, tarsalPER: 1.5, sugarStop: 1, noMDN: 0.5, quietMN9: 0.5 };
  o.score = Object.entries(terms).reduce((s, [k, v]) => s + W[k] * v, 0) / Object.values(W).reduce((a, b) => a + b, 0);
  o.terms = terms; return o;
}
process.on('message', (msg) => { try { const o = evaluate(msg.cfg); process.send({ id: msg.id, cfg: msg.cfg, out: o }); } catch (e) { process.send({ id: msg.id, cfg: msg.cfg, error: String(e.stack) }); } });
if (process.argv[2]) { const t0 = Date.now(); const o = evaluate(JSON.parse(process.argv[2])); console.log(JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v), (Date.now() - t0) / 1000 + 's'); }
