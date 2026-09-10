// Find which neurons carry activity from a stimulus to a target (first-spike order + strongest active inputs).
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain } from '../src/brainmodel.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const [stimT, target, extra = '{}', graded = '0'] = process.argv.slice(2);
const net = createBrain(D, size, JSON.parse(extra), graded === '1' ? SIGN : null);
const stim = stimT.split('+').flatMap(t => D.byType(t)); net.setDrive(stim, 100);
const first = new Float32Array(D.N).fill(-1);
for (let s = 0; s < 600; s++) { const f = net.step(); for (const i of f) if (first[i] < 0) first[i] = net.t; }
const tg = D.byType(target); console.log(target, 'first spike', tg.map(i => first[i]), 'rates', tg.map(i => net.spikeCount[i] / 0.3));
// backtrack: for target, strongest presyn that spiked before; recurse 4 levels
const sgn = i => graded === '1' ? SIGN[i] : [0, 1, -1, -1, 1, 1, 1, -1][D.nt[i]];
function inputs(q) { const o = []; for (let p = 0; p < D.N; p++) for (let k = D.indptr[p]; k < D.indptr[p + 1]; k++) if (D.indices[k] === q && D.weights[k] >= 5 && first[p] >= 0) o.push([p, D.weights[k] * sgn(p) * net.spikeCount[p]]); return o.sort((a, b) => b[1] - a[1]); }
function show(q, depth, pre = '') { if (depth === 0) return; for (const [p, w] of inputs(q).slice(0, 3)) { console.log(`${pre}<- ${D.meta.types[p] || '?'} [${D.meta.nts[D.nt[p]]}, sign ${sgn(p).toFixed(2)}] drive ${w.toFixed(0)} first ${first[p]}ms`); if (!stim.includes(p)) show(p, depth - 1, pre + '   '); } }
show(tg[0], 4);
