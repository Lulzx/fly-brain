import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { RateNetwork, regionSizeRef } from '../src/ratenet.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const [type, I = 600, extra = '{}'] = process.argv.slice(2);
const net = new RateNetwork(D.N, D.indptr, D.indices, D.weights, D.nt, size, { sizeRefArray: regionSizeRef(D.meta.superclasses, D.sc, size).ref, sensoryMask: Uint8Array.from(D.sc, k => /sensory/.test(D.meta.superclasses[k]) ? 1 : 0), ...JSON.parse(extra) });
net.setDrive(type.split('+').flatMap(t => D.byType(t)), +I);
const hist = [];
for (let s = 0; s < 1000; s++) { const n = net.step(); if (s % 50 === 49) hist.push(n); }
console.log(type, I, extra, 'active over time:', hist.join(' '));
const act = []; for (let i = 0; i < D.N; i++) if (net.r[i] > 1) act.push(i);
const cnt = (f) => { const c = {}; for (const i of act) { const k = f(i); c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' '); };
console.log('superclass', cnt(i => D.meta.superclasses[D.sc[i]]));
console.log('NT', cnt(i => D.meta.nts[D.nt[i]]));
console.log('types', cnt(i => D.meta.types[i] || '?'));
// first to ignite: which neurons had highest rate at 150ms? rerun
