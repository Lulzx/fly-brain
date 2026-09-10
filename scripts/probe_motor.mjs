// Stimulate a neuron type; print leg-muscle firing rates over time to look for rhythmic, alternating output.
import { loadAll } from './lib_node.mjs';
import { LIFNetwork } from '../src/lif.js';
const D = loadAll();
const [type, rate = 150, ms = 1000, extra = '{}'] = process.argv.slice(2);
const params = JSON.parse(extra);
const stim = type.split('+').flatMap(t => D.byType(t));
const net = new LIFNetwork(D.N, D.indptr, D.indices, D.weights, D.nt, params);
net.setDrive(stim, +rate);
const groups = D.bodymap.muscles;
const BIN = 20, steps = ms / net.p.dt, stepsPerBin = BIN / net.p.dt;
const counts = groups.map(() => []);
let prev = new Uint32Array(D.N);
let totalSp = 0;
for (let s = 1; s <= steps; s++) {
  totalSp += net.step().length;
  if (s % stepsPerBin === 0) {
    groups.forEach((g, k) => { let c = 0; for (const i of g.idx) c += net.spikeCount[i] - prev[i]; counts[k].push(c / g.idx.length / (BIN / 1000)); });
    prev = net.spikeCount.slice();
  }
}
console.log(`stim ${type} (${stim.length} neurons) @${rate}Hz for ${ms}ms; total spikes ${totalSp}; params ${extra}`);
const active = groups.map((g, k) => ({ g, k, mean: counts[k].reduce((a, b) => a + b, 0) / counts[k].length })).filter(x => x.mean > 1).sort((a, b) => b.mean - a.mean);
const glyph = r => r <= 0 ? '·' : r < 20 ? '▁' : r < 50 ? '▃' : r < 100 ? '▅' : r < 200 ? '▇' : '█';
for (const { g, k, mean } of active.slice(0, 40)) console.log(`${g.name.padEnd(42)} ${mean.toFixed(0).padStart(4)}Hz ${counts[k].map(glyph).join('')}`);
if (!active.length) console.log('no leg/proboscis muscle activity');
