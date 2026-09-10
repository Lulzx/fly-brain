import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { RateNetwork, regionSizeRef } from '../src/ratenet.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const [type, I = 800, extra = '{}'] = process.argv.slice(2);
const sensoryMask = Uint8Array.from(D.sc, k => /sensory/.test(D.meta.superclasses[k]) ? 1 : 0);
const net = new RateNetwork(D.N, D.indptr, D.indices, D.weights, D.nt, size, { sizeRefArray: regionSizeRef(D.meta.superclasses, D.sc, size).ref, sensoryMask, ...JSON.parse(extra) });
net.setDrive(type.split('+').flatMap(t => D.byType(t)), +I);
const first = new Float32Array(D.N).fill(-1);
for (let s = 0; s < 300; s++) { net.step(); for (let i = 0; i < D.N; i++) if (first[i] < 0 && net.r[i] > 5) first[i] = net.t; }
const order = [...Array(D.N).keys()].filter(i => first[i] >= 0).sort((a, b) => first[a] - first[b]);
const byWin = {};
for (const i of order) { const w = Math.floor(first[i] / 20) * 20; const k = D.meta.superclasses[D.sc[i]]; (byWin[w] ||= {})[k] = (byWin[w][k] || 0) + 1; }
for (const [w, c] of Object.entries(byWin)) console.log(`${w}-${+w + 20}ms`, Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' '));
// first brain neurons (cb_ / ol_) to ignite
const brain = order.filter(i => /^(cb_|ol_|visual)/.test(D.meta.superclasses[D.sc[i]])).slice(0, 40);
console.log('first brain neurons:', brain.map(i => `${D.meta.types[i] || '?'}(${D.meta.nts[D.nt[i]].slice(0, 3)},${first[i]}ms)`).join(' '));
