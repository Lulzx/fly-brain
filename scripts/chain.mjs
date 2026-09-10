import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain } from '../src/brainmodel.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const [cfgS, stimS, chainS] = process.argv.slice(2); const cfg = JSON.parse(cfgS);
const net = createBrain(D, size, cfg, sign); const stim = stimS.split('+').flatMap(t => D.byType(t)); net.setDrive(stim, 100);
const orn = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx); if (cfg.baseline) net.setDrive(orn, 6);
for (let s = 0; s < 800; s++) net.step();
const { brainScales } = await import('../src/brainmodel.js'); const { inScale } = brainScales({ ...D, superclass: D.sc }, size, cfg);
for (const t of chainS.split(',')) { const ix = D.byType(t); console.log(t.padEnd(10), ix.map(i => `${(net.spikeCount[i] / 0.4).toFixed(0)}Hz(s^-a=${inScale[i].toFixed(2)})`).join(' ')); }
// inhibitory input onto MN9
const mn9 = D.byType('MN9')[0]; let e = 0, inh = 0; const top = [];
for (let p = 0; p < D.N; p++) for (let k = D.indptr[p]; k < D.indptr[p + 1]; k++) if (D.indices[k] === mn9 && D.weights[k] >= (cfg.minSyn || 5) && net.spikeCount[p] > 0) { const c = D.weights[k] * sign[p] * net.spikeCount[p]; if (c > 0) e += c; else { inh -= c; top.push([D.meta.types[p], D.weights[k], (net.spikeCount[p] / 0.4).toFixed(0)]); } }
console.log('MN9 active input: exc', e.toFixed(0), 'inh', inh.toFixed(0), 'top inhibitors', top.sort((a, b) => b[1] * b[2] - a[1] * a[2]).slice(0, 6).map(x => x.join(':')).join(' '));
