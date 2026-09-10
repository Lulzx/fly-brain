import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain, brainScales } from '../src/brainmodel.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const S = Object.fromEntries(D.bodymap.sensors.map(s => [s.name, s.idx]));
const [glom = 'DM1', hz = 60, extra = '{}'] = process.argv.slice(2);
const ix = glom.split('+').flatMap(g => [...(S[`ORN_${g} left`] || []), ...(S[`ORN_${g} right`] || [])]);
const net = createBrain(D, size, JSON.parse(extra)); net.setDrive(ix, +hz);
const hist = []; let prev = new Uint32Array(D.N);
for (let s = 1; s <= 1000; s++) { net.step(); if (s % 100 === 0) { let a = 0; for (let i = 0; i < D.N; i++) if (net.spikeCount[i] !== prev[i]) a++; hist.push(a); prev = net.spikeCount.slice(); } }
const act = []; for (let i = 0; i < D.N; i++) if (net.spikeCount[i] > 2) act.push(i);
const cnt = f => { const c = {}; for (const i of act) { const k = f(i); c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}:${v}`).join(' '); };
console.log(`${glom} ORNs (${ix.length}) @${hz}Hz ${extra}: active per 50ms ${hist.join(' ')}`);
console.log(' superclass', cnt(i => D.meta.superclasses[D.sc[i]]));
console.log(' class', cnt(i => D.meta.classes[D.cls[i]] || '-'));
console.log(' types', cnt(i => D.meta.types[i] || '?'));
const apl = D.byType('APL'); console.log(' APL rate', apl.map(i => net.spikeCount[i] / 0.5), 'KC active frac', (() => { let k = 0, n = 0; for (let i = 0; i < D.N; i++) if (D.meta.classes[D.cls[i]] === 'Kenyon_Cell') { n++; if (net.spikeCount[i] > 0) k++; } return (k / n).toFixed(2); })());
