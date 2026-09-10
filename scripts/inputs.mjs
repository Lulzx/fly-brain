import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain } from '../src/brainmodel.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const [cfgS, stimS, target] = process.argv.slice(2); const cfg = JSON.parse(cfgS);
const net = createBrain(D, size, cfg, sign); const stim = stimS.split('+').flatMap(t => D.byType(t)); net.setDrive(stim, 100);
const orn = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx); if (cfg.baseline) net.setDrive(orn, 6);
const vs = []; for (let s = 0; s < 800; s++) { net.step(); if (s > 400 && s % 20 === 0) vs.push(net.v[D.byType(target)[0]]); }
const tg = D.byType(target)[0];
const rows = []; for (let p = 0; p < D.N; p++) for (let k = D.indptr[p]; k < D.indptr[p + 1]; k++) if (D.indices[k] === tg) rows.push([p, D.weights[k], sign[p], net.spikeCount[p] / 0.4]);
const tot = (f) => rows.filter(f).reduce((a, r) => a + r[1], 0);
console.log(`${target}: in-synapses total ${tot(() => true)}, from stim ${tot(r => stim.includes(r[0]))}, exc ${tot(r => r[2] > 0)}, inh ${tot(r => r[2] < 0)}; rate ${(net.spikeCount[tg] / 0.4).toFixed(0)}Hz; Vm samples ${vs.slice(0, 10).map(v => v.toFixed(1)).join(' ')}`);
console.log('active inputs (syn x rate):', rows.filter(r => r[3] > 0).sort((a, b) => Math.abs(b[1] * b[3] * b[2]) - Math.abs(a[1] * a[3] * a[2])).slice(0, 12).map(r => `${D.meta.types[r[0]] || '?'}:${r[1]}syn:${r[3].toFixed(0)}Hz:${r[2] > 0 ? '+' : '-'}`).join(' '));
