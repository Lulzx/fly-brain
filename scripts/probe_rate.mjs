// Stimulate neuron type(s) in the rate model; print leg-muscle rates over time + rhythmicity score.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { RateNetwork, regionSizeRef } from '../src/ratenet.js';
const D = loadAll();
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const [type, I = 400, ms = 1000, extra = '{}'] = process.argv.slice(2);
const params = JSON.parse(extra);
const stim = type.split('+').flatMap(t => D.byType(t));
const net = new RateNetwork(D.N, D.indptr, D.indices, D.weights, D.nt, size, { sizeRefArray: regionSizeRef(D.meta.superclasses, D.sc, size).ref, sensoryMask: Uint8Array.from(D.sc, k => /sensory/.test(D.meta.superclasses[k]) ? 1 : 0), ...params });
if (process.env.VNCONLY) { const { region } = regionSizeRef(D.meta.superclasses, D.sc, size); for (let i = 0; i < D.N; i++) if (region[i] !== 2) net.silenced[i] = 1; }
net.setDrive(stim, +I);
const groups = D.bodymap.muscles;
const BIN = 10, steps = ms / net.p.dt, per = BIN / net.p.dt;
const series = groups.map(() => []); let acc = groups.map(() => 0), nact = 0; const t0 = Date.now();
for (let s = 1; s <= steps; s++) {
  nact = net.step();
  groups.forEach((g, k) => { let c = 0; for (const i of g.idx) c += net.r[i]; acc[k] += c / g.idx.length; });
  if (s % per === 0) { groups.forEach((g, k) => { series[k].push(acc[k] / per); acc[k] = 0; }); }
}
const wall = Date.now() - t0;
function rhythm(x) { // autocorrelation peak (lags 40-400 ms) after first 200 ms
  const y = x.slice(20); const m = y.reduce((a, b) => a + b, 0) / y.length; const z = y.map(v => v - m);
  const v0 = z.reduce((a, b) => a + b * b, 0); if (v0 < 1e-6) return 0;
  let best = 0; for (let lag = 4; lag < Math.min(40, z.length / 2); lag++) { let c = 0; for (let i = 0; i + lag < z.length; i++) c += z[i] * z[i + lag]; best = Math.max(best, c / v0); }
  return best;
}
console.log(`stim ${type} (${stim.length}) I=${I} ${ms}ms | active at end ${nact} | wall ${wall}ms | ${extra}`);
const glyph = r => r <= 0.5 ? '·' : r < 20 ? '▁' : r < 50 ? '▃' : r < 100 ? '▅' : r < 150 ? '▇' : '█';
const act = groups.map((g, k) => ({ g, k, mean: series[k].reduce((a, b) => a + b, 0) / series[k].length, rh: rhythm(series[k]) })).filter(x => x.mean > 0.5);
act.sort((a, b) => a.g.name.localeCompare(b.g.name));
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
for (const { g, k, mean, rh } of act) { if (only && !only.test(g.name)) continue; console.log(`${g.name.padEnd(40)} ${mean.toFixed(0).padStart(4)}Hz rh${rh.toFixed(2)} ${series[k].filter((_, i) => i % 2 === 0).map(glyph).join('')}`); }
console.log(`active muscle groups ${act.length}/${groups.length}, mean rhythmicity ${(act.reduce((a, b) => a + b.rh, 0) / Math.max(1, act.length)).toFixed(2)}`);
