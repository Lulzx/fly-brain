import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain } from '../src/brainmodel.js';
import * as L from '../src/lif.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const stim = ['LB3b', 'LB3c'].flatMap(t => D.byType(t));
function firsts(preSign, unknownSign) {
  const ntSign = [unknownSign, 1, -1, -1, 1, 1, 1, -1];
  const net = createBrain(D, size, { ntSign }, preSign); net.setDrive(stim, 100);
  const f = new Float32Array(D.N).fill(-1); for (let s = 0; s < 160; s++) for (const i of net.step()) if (f[i] < 0) f[i] = net.t; return f;
}
const a = firsts(null, 1), b = firsts(SIGN, 0);
const onlyOld = [...Array(D.N).keys()].filter(i => a[i] >= 0 && b[i] < 0).sort((x, y) => a[x] - a[y]);
console.log('fire with unknown=+1 but not with graded signs (first 80ms):', onlyOld.length);
console.log(onlyOld.slice(0, 30).map(i => `${D.meta.types[i] || '?'}(${D.meta.nts[D.nt[i]].slice(0, 3)},g${SIGN[i].toFixed(2)},${a[i]}ms)`).join(' '));
