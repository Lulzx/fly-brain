// Drive sensory neuron types at a firing rate; report target neurons' rates and total activity.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { RateNetwork, regionSizeRef } from '../src/ratenet.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const [types, hz = 100, watch = 'MN9', ms = 500, extra = '{}'] = process.argv.slice(2);
const sensoryMask = Uint8Array.from(D.sc, k => /sensory/.test(D.meta.superclasses[k]) ? 1 : 0);
const net = new RateNetwork(D.N, D.indptr, D.indices, D.weights, D.nt, size, { sizeRefArray: regionSizeRef(D.meta.superclasses, D.sc, size).ref, sensoryMask, ...JSON.parse(extra) });
const stim = types.split('+').flatMap(t => D.byType(t)); net.setRate(stim, +hz);
const W = watch.split('+').map(t => [t, D.byType(t)]);
const hist = []; const wh = W.map(() => []);
for (let s = 1; s <= ms; s++) { const n = net.step(); if (s % 50 === 0) { hist.push(n); W.forEach(([t, ix], k) => wh[k].push(ix.reduce((a, i) => a + net.r[i], 0) / ix.length)); } }
console.log(`${types} @${hz}Hz (${stim.length} neurons) ${extra} | active: ${hist.join(' ')}`);
W.forEach(([t, ix], k) => console.log(`  ${t.padEnd(10)} (${ix.length}) rate over time: ${wh[k].map(x => x.toFixed(0)).join(' ')}`));
