import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain } from '../src/brainmodel.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const S = Object.fromEntries(D.bodymap.sensors.map(s => [s.name, s.idx]));
const net = createBrain(D, size); const ix = [...S['ORN_DM1 left'], ...S['ORN_DM1 right']]; net.setDrive(ix, 60);
const first = new Float32Array(D.N).fill(-1);
for (let s = 0; s < 120; s++) { const f = net.step(); for (const i of f) if (first[i] < 0) first[i] = net.t; }
const order = [...Array(D.N).keys()].filter(i => first[i] >= 0 && !ix.includes(i)).sort((a, b) => first[a] - first[b]);
console.log('first 60 non-ORN neurons to spike:');
console.log(order.slice(0, 60).map(i => `${D.meta.types[i] || '?'}(${D.meta.nts[D.nt[i]].slice(0, 3)},${first[i]})`).join(' '));
// strongest excitatory inputs onto a non-DM1 PN that fired early
const pn = order.find(i => D.meta.classes[D.cls[i]] === 'ALPN' && !/DM1/.test(D.meta.types[i]));
if (pn !== undefined) { const ins = []; for (let p = 0; p < D.N; p++) for (let k = D.indptr[p]; k < D.indptr[p + 1]; k++) if (D.indices[k] === pn && first[p] >= 0 && first[p] < first[pn]) ins.push([D.meta.types[p], D.meta.nts[D.nt[p]], D.weights[k]]);
  console.log(`early non-DM1 PN ${D.meta.types[pn]} at ${first[pn]}ms; active presynaptic inputs before it:`, ins.sort((a, b) => b[2] - a[2]).slice(0, 12).map(x => x.join(':')).join(' ')); }
