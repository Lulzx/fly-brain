// Twin audit (spec S4.3): is src/lifdiff.js the model that ships?
//
// A fit that claims to update the arena brain must run against a differentiable model that applies
// the same typeGains, thrOffset, octopamine operator, sensory mask and physiology as the shipped
// kernel. This script checks that claim in two parts and fails the gate if either loses:
//
//   1. construction identity -- diffsetup.js is given the SAME parameters and must produce the
//      effective thresholds, outgoing gains, signs, sensory mask, lamina bias and size scaling the
//      shipped build applies. Checked elementwise, not asserted by construction.
//   2. three traces, same drive, same seed, shipped LIFWasm vs LIFDiff:
//        sugar    -- the benchmark's own assay: ORN 6 Hz + LB3b/c 100 Hz, 400 ms on + 300 ms off
//        loom     -- expanding disk through flyvis; the drive the shipped brain computed is recorded
//                    per 40-step epoch and replayed into BOTH kernels, so the optic lobe and the
//                    coupling are identical by construction and only the spiking CNS can differ
//        proprio  -- a synthetic tripod gait: chordotonal and hair-plate population codes oscillating
//                    at stepping frequency with campaniform load bursts on stance. No vision.
//
// Gate criteria per named type, per trace:
//   |mean spikes/neuron, diff - wasm| <= max(1 spike, 2% of the wasm mean)
//   |mean rate, diff - wasm| <= 0.5 Hz
// (the two kernels draw from independent RNG streams, so the comparison is of population statistics
// -- "1 spike" is read per neuron, which is the only reading that is not guaranteed to fail on
// sparse types under any faithful implementation).
//
//   node --max-old-space-size=14000 scripts/twin_audit.mjs
//
// Until this exits 0, visual fitting is closed (spec S4.3). Writes public/data/twin_audit.json.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { makeBrain, ORN_ALL, SUGAR, MN9, RELAY, RELAY2, D } from './calib_eval.mjs';
import { LIFDiff } from '../src/lifdiff.js';
import { diffOptions, diffSummary } from '../src/diffsetup.js';
import { parseFlyVis, FlyVis, flyvisBytes } from '../src/flyvis.js';
import { LIFWasm, writeGraph, graphBytes, brainBytes } from '../src/lifwasm.js';
import { brainScales, applyClassPhysiology, modulatorySign, typeGains, BRAIN_DEFAULTS } from '../src/brainmodel.js';
import { Neuromod } from '../src/sim/neuromod.js';

const D0 = Date.now();
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();
const o = { ...BRAIN_DEFAULTS, ...BASE };
const DATA = { ...D, superclass: D.sc };
const T = (...ts) => ts.flatMap(t => D.byType(t));
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const fmt = (x, k = 6) => String(typeof x === 'number' ? +x.toFixed(3) : x).padEnd(k);

// ------------------------------------------------------------------ 1. construction identity
// The shipped build writes into net.thr / net.bias / the graph via applyClassPhysiology, Neuromod,
// typeGains, modulatorySign and brainScales. The twin gets the same structure through diffOptions.
// Replay the shipped side into the shim and compare arrays elementwise.
const shim = { thr: new Float32Array(D.N), bias: new Float32Array(D.N), spikeCount: new Uint32Array(D.N),
  setThr(i, mv) { this.thr[i] = mv; }, setBias(ix, mv) { for (const i of ix) this.bias[i] = mv; }, addG() {} };
applyClassPhysiology(shim, DATA, o);
if (o.neuromod) new Neuromod(DATA, shim, { minSyn: o.minSyn }).modulate();
const SETUP = diffOptions(D, SIZE, o, SIGN);
const { inScale: wIn, sensoryMask: wSens } = brainScales(DATA, SIZE, o);
const wSign = modulatorySign(DATA, SIGN, o);
const wOut = typeGains(DATA, o);

// one diff instance, only to read the arrays _prepare() derives from the setup
const probe = new LIFDiff(D, { ...o, ...SETUP }); probe.reset();

const ident = {};
// thresholds and bias are compared at float32 tolerance: the shipped kernel stores them in f32 and
// the twin sums f64, so an exact compare reports every lamina cell and Kenyon cell at 1 ulp. A real
// missing-physiology bug is orders of magnitude larger; report the worst error so that stays visible.
const MV_TOL = 1e-4;
{ let bad = 0, mx = 0; for (let i = 0; i < D.N; i++) {
    const eff = (SETUP.thrMask[i] ? o.kcThreshold : 0) + SETUP.thrOffset[i];
    const d = Math.abs(eff - shim.thr[i]); if (d > mx) mx = d; if (d > MV_TOL) bad++; }
  ident.thrOffset = { mismatched: bad, maxAbsErrMv: +mx.toExponential(2) }; }
{ let bad = 0, mx = 0; for (let i = 0; i < D.N; i++) {
    const eff = SETUP.biasMask[i] ? o.laminaBias : 0;
    const d = Math.abs(eff - shim.bias[i]); if (d > mx) mx = d; if (d > MV_TOL) bad++; }
  ident.bias = { mismatched: bad, maxAbsErrMv: +mx.toExponential(2) }; }
{ let bad = 0; for (let i = 0; i < D.N; i++) if ((SETUP.outScale?.[i] ?? 1) !== (wOut?.[i] ?? 1)) bad++;
  ident.typeGains = { mismatched: bad, fitted: !!wOut }; }
{ let bad = 0; for (let i = 0; i < D.N; i++) if (SETUP.preSign[i] !== wSign[i]) bad++;
  ident.sign = { mismatched: bad }; }
{ let bad = 0; for (let i = 0; i < D.N; i++) if (SETUP.sensoryMask[i] !== wSens[i]) bad++;
  ident.sensoryMask = { mismatched: bad }; }
{ let bad = 0, mx = 0; for (let i = 0; i < D.N; i++) { const d = Math.abs(probe.inScale[i] - wIn[i]);
    if (d > 1e-6) { bad++; mx = Math.max(mx, d); } }
  ident.inScale = { mismatched: bad, maxAbsErr: mx }; }
ident.params = { kcThreshold: o.kcThreshold, laminaBias: o.laminaBias, neuromod: !!o.neuromod,
  oaOperator: 'thrField (static tone via Neuromod.modulate)' };
const sm = diffSummary(SETUP);
console.log(`construction: thrShifted ${sm.thrShifted}, signZeroed ${sm.signZeroed}, typeGained ${sm.typeGained}, sensory ${sm.sensory}`);
for (const [k, v] of Object.entries(ident)) if (v.mismatched !== undefined)
  console.log(`  ${k.padEnd(12)} ${v.mismatched === 0 ? 'identical' : v.mismatched + ' MISMATCHED'}`);

// ------------------------------------------------------------------ shared pair runner
// A trace is a drive schedule: { dIdx, epochs: Float32Array[], epochSteps, steps, constDrives }.
// The same schedule is applied to a shipped LIFWasm and to LIFDiff; spike counts are compared over
// the whole run (or from `from`, for the post-onset window).
// makeBrain widens the sensory mask with every flyvis-coupled neuron before writeGraph -- their
// incoming synapses are culled because they are driven, not synaptic. The twin must cull the same
// edges on every trace, not just the loom one: undriven flyvis neurons still receive central input
// otherwise, and their threshold spikes leak downstream.
const FVMAP = JSON.parse(fs.readFileSync('public/vision/flyvis_map.json'));
const FVPAIRS = ['L', 'R'].map(sd => ({ n: Int32Array.from(FVMAP.eyes[sd].pairs, p => p[0]), node: Int32Array.from(FVMAP.eyes[sd].pairs, p => p[1]) }));
const ALLN = [...FVPAIRS[0].n, ...FVPAIRS[1].n];
const sensFly = Uint8Array.from(SETUP.sensoryMask);
for (const sd of ['L', 'R']) for (const [i] of FVMAP.eyes[sd].pairs) sensFly[i] = 1;
function runWasm(schedule, seed = 1) {
  const net = makeBrain({ ...o, seed });
  for (const [ix, hz] of schedule.constDrives || []) net.setDrive(ix, hz);
  const { steps, epochSteps, epochs, dIdx } = schedule;
  for (let t = 0; t < steps; t++) {
    if (epochs && t % epochSteps === 0) { const rec = epochs[t / epochSteps];
      if (rec) for (let k = 0; k < dIdx.length; k++) net.setDriveOne(dIdx[k], rec[k]); }
    net.step();
  }
  return Uint32Array.from(net.spikeCount);
}
function runDiff(schedule, seed = 1, extra = {}) {
  // extra.sensoryMask: assays that drive neurons outside the bodymap sensor set (the 62k flyvis
  // pairs) must pass the widened mask, exactly as scripts/lifdiff_loom_equiv.mjs does.
  // exact32 runs the hard path in lif.c's arithmetic -- same draw order, same f32 rounding -- so a
  // matching spike train is exact rather than statistical. It needs the composed threshold field
  // (shim.thr) rather than the mask+offset split, because lif.c sums vThresh + adapt + thr.
  const net = new LIFDiff(D, { ...o, ...SETUP, soft: false, exact32: true, thrOffset: shim.thr, thrMask: null,
    inScale: wIn, sensoryMask: sensFly, driveEpoch: schedule.epochSteps || 1, ...extra });
  for (const [ix, hz] of schedule.constDrives || []) net.setDrive(ix, hz);
  const { steps, epochs, dIdx } = schedule;
  net.forward(steps, { seed, record: false, onEpoch: e => { const rec = epochs?.[e];
    if (rec) for (let k = 0; k < dIdx.length; k++) net.setDriveOne(dIdx[k], rec[k]); } });
  return Uint32Array.from(net.spikeCount.map(Math.round));
}

// The two kernels draw from independent RNG streams, so a single seed only ever reports jitter.
// The gate compares means over SEEDS seeds -- the same convention as scripts/lifdiff_equiv.mjs --
// which is the only reading of "relative error <= 2%" that is not a coin flip on sparse types.
const SEEDS = +(process.env.TWIN_SEEDS || 4);
function runPair(schedule, extra = {}) {
  const w = new Float64Array(D.N), d = new Float64Array(D.N);
  for (let s = 1; s <= SEEDS; s++) {
    const a = runWasm(schedule, s), b = runDiff(schedule, s, extra);
    for (let i = 0; i < D.N; i++) { w[i] += a[i] / SEEDS; d[i] += b[i] / SEEDS; }
  }
  return { w, d };
}

// per-type comparison against the gate criteria. types: [name, idx[]].
function compare(name, types, wSp, dSp, durS) {
  const rows = [];
  let fail = 0;
  for (const [tname, ix] of types) {
    let w = 0, d = 0; for (const i of ix) { w += wSp[i]; d += dSp[i]; }
    const n = ix.length, wm = w / n, dm = d / n;
    const cntTol = Math.max(1, 0.02 * wm), rateTol = 0.5;
    const cntOk = Math.abs(dm - wm) <= cntTol, rateOk = Math.abs(dm - wm) / durS <= rateTol;
    if (!(cntOk && rateOk)) fail++;
    rows.push({ type: tname, n, wasm: +wm.toFixed(3), diff: +dm.toFixed(3),
      countTol: +cntTol.toFixed(2), rateDiffHz: +((dm - wm) / durS).toFixed(3), pass: cntOk && rateOk });
  }
  let wt = 0, dt = 0; for (let i = 0; i < D.N; i++) { wt += wSp[i]; dt += dSp[i]; }
  return { name, durS, seeds: SEEDS, totalWasm: +wt.toFixed(1), totalDiff: +dt.toFixed(1), totalRatio: +(dt / wt).toFixed(3), fail, rows };
}

// ------------------------------------------------------------------ trace 1: sugar
const MS = 700, STEPS = 1400, ON = 800;
const sugarSched = { steps: STEPS, epochSteps: ON, dIdx: SUGAR,
  epochs: [new Float32Array(SUGAR.length).fill(100), new Float32Array(SUGAR.length)],
  constDrives: [[ORN_ALL, 6]] };
// wasm applies epoch 0 at t=0, epoch 1 (zero) at t=800 -- the benchmark's 400 ms on / 300 ms off.
{
  // setDrive at t=800 must zero the sugar drive; the schedule's second epoch does that. ORN stays.
  console.log(`\nsugar trace (${MS} ms, benchmark protocol, ${SEEDS} seeds)`);
  const { w, d } = runPair(sugarSched);
  const r = compare('sugar', [['MN9', MN9], ['GNG232', RELAY], ['DNge080', RELAY2]], w, d, MS / 1000);
  for (const row of r.rows) console.log(`  ${row.type.padEnd(9)} n=${String(row.n).padStart(4)}  wasm ${fmt(row.wasm)}  diff ${fmt(row.diff)}  ${row.pass ? 'ok' : 'FAIL'}`);
  console.log(`  total spikes wasm ${r.totalWasm} diff ${r.totalDiff} ratio ${r.totalRatio}`);
  var sugarRes = r;
}

// ------------------------------------------------------------------ trace 2: loom (recorded drive)
// The shipped brain runs the benchmark's loom through flyvis; the drive it computes for the 62,157
// coupled neurons is recorded per 40-step epoch and replayed into a fresh LIFWasm and LIFDiff.
console.log('\nloom trace (recorded flyvis drive, replayed into both kernels)');
const FVB = fs.readFileSync('public/vision/flyvis.bin');
const FVM = parseFlyVis(FVB.buffer.slice(FVB.byteOffset, FVB.byteOffset + FVB.byteLength),
  JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json')));
const loomEpochs = await (async () => {
  // a shipped brain + live eyes, exactly as scripts/lifdiff_loom_equiv.mjs runs it
  const MEMB = graphBytes(D.N, D.E) + brainBytes(D.N, 20) + flyvisBytes(FVM.N, FVM.E) + FVM.N * 4 * 8 + (8 << 20);
  const MEM = new WebAssembly.Memory({ initial: Math.ceil(MEMB / 65536), maximum: Math.ceil(MEMB / 65536), shared: true });
  const INST = (await WebAssembly.instantiate(fs.readFileSync('public/lif.wasm'), { env: { memory: MEM } })).instance;
  const { inScale, sensoryMask } = brainScales(DATA, SIZE, o);
  for (const sd of ['L', 'R']) for (const [i] of FVMAP.eyes[sd].pairs) sensoryMask[i] = 1;
  const GRAPH = writeGraph(MEM, 1024, { ...DATA, weights: DATA.weights }, { ...o }, inScale, sensoryMask, modulatorySign(DATA, SIGN, o), typeGains(DATA, o));
  const net = new LIFWasm({ instance: INST, memory: MEM, graph: GRAPH, base: (GRAPH.end + 4095) & ~4095, N: D.N, params: o, seed: 1 });
  applyClassPhysiology(net, DATA, o);
  if (o.neuromod) new Neuromod(DATA, net, { minSyn: o.minSyn }).modulate();
  const base = (net.end + 65535) & ~65535;
  const e0 = new FlyVis(INST, MEM, base, FVM);
  const eyes = [e0, new FlyVis(INST, MEM, (e0.end + 4095) & ~4095, { ...FVM, shared: e0.sharedParts, bias: e0.bias })];
  const grey = new Float32Array(721).fill(0.5);
  for (const e of eyes) { e.setInput(grey); for (let k = 0; k < 150; k++) e.step(); }
  const vRest = eyes[0].v.slice(0);
  const COLDIRS = ['L', 'R'].map(sd => FVMAP.eyes[sd].dirs);
  const lumLoom = (eye, t) => { const c = [Math.cos(0.17) * Math.cos(0.7), Math.cos(0.17) * Math.sin(0.7), Math.sin(0.17)];
    const rad = (5 + 70 * Math.max(0, Math.min(1, t / 0.4)) ** 2) * Math.PI / 180;
    return Float32Array.from(COLDIRS[eye], d => Math.acos(Math.min(1, d[0] * c[0] + d[1] * c[1] + d[2] * c[2])) < rad ? 0.05 : 0.5); };
  net.setDrive(ORN_ALL, 6);
  const epochs = [];
  for (let s = 0; s < 1200; s++) {
    if (s % 40 === 0) { const t = (s - 400) / 2000;
      for (let e = 0; e < 2; e++) { eyes[e].setInput(t < 0 ? grey : lumLoom(e, t)); eyes[e].step(); }
      const rec = new Float32Array(ALLN.length); let w = 0;
      for (let e = 0; e < 2; e++) { const v = eyes[e].v, P = FVPAIRS[e];
        for (let k = 0; k < P.n.length; k++) { const a = v[P.node[k]] - vRest[P.node[k]]; rec[w++] = a > 0.02 ? Math.min(200, 250 * a) : 0; } }
      epochs.push(rec); }
    net.step();
  }
  return epochs;
})();
const loomSched = { steps: 1200, epochSteps: 40, epochs: loomEpochs, dIdx: ALLN,
  constDrives: [[ORN_ALL, 6]] };
{
  const { w, d } = runPair(loomSched);
  const r = compare('loom', [['DNp01', T('DNp01')], ['LC4', T('LC4')], ['LPLC2', T('LPLC2')],
    ['DNp02', T('DNp02')], ['DNp04', T('DNp04')]], w, d, 1200 * 0.5 / 1000);
  for (const row of r.rows) console.log(`  ${row.type.padEnd(9)} n=${String(row.n).padStart(4)}  wasm ${fmt(row.wasm)}  diff ${fmt(row.diff)}  ${row.pass ? 'ok' : 'FAIL'}`);
  console.log(`  total spikes wasm ${r.totalWasm} diff ${r.totalDiff} ratio ${r.totalRatio}`);
  var loomRes = r;
}

// ------------------------------------------------------------------ trace 3: walking proprioception
// Tripod gait at 20 Hz: chordotonal (tibia) and hair-plate (coxa) population codes oscillate with the
// leg phase; campaniform load sensors burst on the stance half-cycle. Same popCode formula as
// src/sim/senses.js. Drives refresh every 10 steps (5 ms) and replay into both kernels.
console.log('\nproprio trace (synthetic gait, no vision)');
const propSensors = D.bodymap.sensors.filter(s => s.kind === 'joint_angle' || s.kind === 'load');
const LEG_PHASE = { T1_left: 0, T2_right: 0, T3_left: 0, T1_right: Math.PI, T2_left: Math.PI, T3_right: Math.PI };
const GAIT_HZ = 20, P_STEPS = 400, P_EPOCH = 10;
const popRate = (ix, q, lo, hi) => ix.map((_, k) => {
  const x = (q - lo) / (hi - lo), pref = (k + 0.5) / ix.length;
  const r = 120 * Math.exp(-(((x - pref) ** 2) / (2 * 0.25 * 0.25))); return r > 5 ? r : 0; });
const pDriven = propSensors.flatMap(s => s.idx);
const pSlot = new Map(); pDriven.forEach((i, k) => pSlot.set(i, k));
const propEpochs = [];
for (let e = 0; e * P_EPOCH < P_STEPS; e++) {
  const t = e * P_EPOCH * 0.5 / 1000, rec = new Float32Array(pDriven.length);
  for (const s of propSensors) {
    const leg = (s.joint || s.name).match(/T[123]_(left|right)/)?.[0];
    const ph = LEG_PHASE[leg] ?? 0, cyc = 2 * Math.PI * GAIT_HZ * t + ph;
    let rates;
    if (/tibia/.test(s.joint || '')) rates = popRate(s.idx, -0.025 + 0.8 * Math.sin(cyc), -1.35, 1.3);
    else if (/coxa/.test(s.joint || '')) rates = popRate(s.idx, 0.7 + 0.6 * Math.sin(cyc - 0.9), -0.3, 1.7);
    else rates = s.idx.map(() => Math.sin(cyc) < 0 ? Math.min(200, 3000 * 0.4) : 0);   // stance load burst
    for (let k = 0; k < s.idx.length; k++) rec[pSlot.get(s.idx[k])] = rates[k];
  }
  propEpochs.push(rec);
}
const propSched = { steps: P_STEPS, epochSteps: P_EPOCH, epochs: propEpochs, dIdx: pDriven,
  constDrives: [[ORN_ALL, 6]] };   // the animal's resting olfactory tone; the trace isolates vision off
{
  const { w, d } = runPair(propSched);
  const types = new Map();
  for (const i of pDriven) { const t = D.meta.types[i]; if (!types.has(t)) types.set(t, []); types.get(t).push(i); }
  const named = [['DNg100', T('DNg100')], ['DNa01', T('DNa01')], ['DNa02', T('DNa02')], ['MDN', T('MDN')],
    ['DNp09', T('DNp09')], ['DNg97', T('DNg97')], ['DNp26', T('DNp26')]];
  const rows = [...types.entries()].map(([t, ix]) => [t, ix]).concat(named);
  const r = compare('proprio', rows, w, d, P_STEPS * 0.5 / 1000);
  for (const row of r.rows) console.log(`  ${row.type.padEnd(22)} n=${String(row.n).padStart(4)}  wasm ${fmt(row.wasm)}  diff ${fmt(row.diff)}  ${row.pass ? 'ok' : 'FAIL'}`);
  console.log(`  total spikes wasm ${r.totalWasm} diff ${r.totalDiff} ratio ${r.totalRatio}`);
  var propRes = r;
}

// ------------------------------------------------------------------ verdict
const traces = [sugarRes, loomRes, propRes];
const constFail = Object.entries(ident).filter(([k, v]) => v.mismatched > 0).map(([k]) => k);
const traceFail = traces.filter(t => t.fail > 0).map(t => t.name);
const pass = constFail.length === 0 && traceFail.length === 0;
const out = { generated: new Date().toISOString(), gate: 'spec S4.3', pass,
  criteria: 'per named type: |dmean spikes/neuron| <= max(1, 2% wasm); |drate| <= 0.5 Hz',
  construction: ident, traces };
fs.writeFileSync('public/data/twin_audit.json', JSON.stringify(out, null, 1));
console.log(`\ntwin_audit.json written (${((Date.now() - D0) / 60000).toFixed(1)} min)`);
if (!pass) { console.log(`AUDIT FAILED -- construction: ${constFail.join(',') || 'ok'}; traces: ${traceFail.join(',') || 'ok'}. `
  + 'Until this gate is green, visual fitting is closed (spec S4.3).'); process.exit(1); }
console.log('AUDIT PASS -- the differentiable twin is the shipped model on all three traces.');
