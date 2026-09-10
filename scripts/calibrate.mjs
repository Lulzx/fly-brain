// Benchmark suite for whole-CNS model calibration against published behaviours.
import { loadAll } from './lib_node.mjs';
import fs from 'node:fs';
import { createBrain } from '../src/brainmodel.js';
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const makeLIF = (D, cfg) => createBrain(D, SIZE, cfg, SIGN);
const D = loadAll();
const T = (...ts) => ts.flatMap(t => D.byType(t));
const SUGAR = T('LB3b', 'LB3c'), BITTER = T('LB1a', 'LB1b', 'LB1c', 'LB1d'), MN9 = T('MN9');
const ORN = T('ORN_DM1', 'ORN_VA2', 'ORN_DM4'), PN = T('DM1_lPN', 'VA2_adPN', 'DM4_adPN', 'DM4_vPN');
const BDN2 = T('DNg100');
const S = Object.fromEntries(D.bodymap.sensors.map(s => [s.name, s.idx]));
const DM1 = [...S['ORN_DM1 left'], ...S['ORN_DM1 right']];
const KC = []; for (let i = 0; i < D.N; i++) if (D.meta.classes[D.cls[i]] === 'Kenyon_Cell') KC.push(i);
const ALPN = []; for (let i = 0; i < D.N; i++) if (D.meta.classes[D.cls[i]] === 'ALPN') ALPN.push(i);
const legGroups = D.bodymap.muscles.filter(m => /T[123]/.test(m.name) && !/ltm/.test(m.name));
function run(net, stimSets, msOn, msOff, watch, binMs = 10) {
  for (const [ix, hz] of stimSets) net.setDrive(ix, hz);
  const steps = (msOn + msOff) / net.p.dt, per = binMs / net.p.dt; const prev = new Uint32Array(D.N);
  const res = { watch: watch.map(() => []), active: [] };
  for (let s = 1; s <= steps; s++) {
    if (s === msOn / net.p.dt) for (const [ix] of stimSets) net.setDrive(ix, 0);
    net.step();
    if (s % per === 0) { let a = 0; for (let i = 0; i < D.N; i++) if (net.spikeCount[i] !== prev[i]) a++; res.active.push(a);
      watch.forEach((ix, k) => res.watch[k].push(ix.reduce((x, i) => x + net.spikeCount[i] - prev[i], 0) / ix.length / (binMs / 1000))); prev.set(net.spikeCount); }
  }
  return res;
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function rhythm(x) { const y = x.slice(10); const m = mean(y); const z = y.map(v => v - m); const v0 = z.reduce((a, b) => a + b * b, 0); if (v0 < 1e-9) return 0;
  let best = 0; for (let lag = 3; lag < 30; lag++) { let c = 0; for (let i = 0; i + lag < z.length; i++) c += z[i] * z[i + lag]; best = Math.max(best, c / v0); } return best; }
export function bench(cfg) {
  const out = {};
  let net = makeLIF(D, cfg);
  let r = run(net, [[SUGAR, 100]], 500, 300, [MN9]);
  out.sugarMN9 = mean(r.watch[0].slice(10, 50)); out.sugarActive = Math.max(...r.active.slice(0, 50)); out.afterSugar = mean(r.active.slice(70, 80));
  net = makeLIF(D, cfg); r = run(net, [[BITTER, 100]], 500, 0, [MN9]); out.bitterMN9 = mean(r.watch[0].slice(10));
  net = makeLIF(D, cfg); r = run(net, [[SUGAR, 100], [BITTER, 100]], 500, 0, [MN9]); out.mixMN9 = mean(r.watch[0].slice(10));
  net = makeLIF(D, cfg); r = run(net, [[ORN, 100]], 300, 0, [PN]); out.PN = mean(r.watch[0].slice(5)); out.ornActive = Math.max(...r.active);
  net = makeLIF(D, cfg); r = run(net, [[DM1, 60]], 300, 0, []);
  out.kcFrac = KC.filter(i => net.spikeCount[i] > 0).length / KC.length; out.pnActive = ALPN.filter(i => net.spikeCount[i] > 0).length; out.dm1Active = Math.max(...r.active);
  net = makeLIF(D, cfg); r = run(net, [[BDN2, 150]], 1000, 300, legGroups.map(g => g.idx), 20);
  const act = r.watch.map(w => mean(w.slice(5, 50))); const rh = r.watch.map(w => rhythm(w.slice(0, 50)));
  const on = act.map((a, k) => [a, rh[k]]).filter(([a]) => a > 2);
  out.legActive = on.length; out.legRhythm = on.length ? mean(on.map(x => x[1])) : 0; out.legRate = on.length ? mean(on.map(x => x[0])) : 0;
  out.bdnActive = Math.max(...r.active.slice(0, 50)); out.afterBDN = mean(r.active.slice(55, 65));
  return out;
}
if (process.argv[1].endsWith('calibrate.mjs')) {
  const grid = JSON.parse(process.argv[2] || '[{}]');
  for (const cfg of grid) { const t0 = Date.now(); const o = bench(cfg);
    console.log(JSON.stringify(cfg).padEnd(62), Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'number' ? (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(0)) : v}`).join(' '), `${((Date.now() - t0) / 1000).toFixed(0)}s`); }
}
