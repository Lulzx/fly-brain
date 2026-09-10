import fs from 'node:fs';
import { LIFNetwork } from '../src/lif.js';
const meta = JSON.parse(fs.readFileSync('public/data/meta.json')); const N = meta.N;
const nb = fs.readFileSync('public/data/neurons.bin'); const ab = nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.byteLength);
let off = 8 + N * 8 + N * 12 + N * 8; const cls = new Uint16Array(ab, off, N); off += N * 2; const nt = new Uint8Array(ab, off, N); off += N; const sc = new Uint8Array(ab, off, N);
const gb = fs.readFileSync(`public/data/graph_w${meta.minWeight}.bin`); const g = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength);
const E = new Uint32Array(g, 0, 2)[1]; const indptr = new Uint32Array(g, 8, N + 1); const indices = new Uint32Array(g, 8 + (N + 1) * 4, E); const weights = new Uint16Array(g, 8 + (N + 1) * 4 + E * 4, E);
const [kind, query, rate, wSyn, adaptInc, depU] = process.argv.slice(2);
const ix = []; for (let i = 0; i < N; i++) { const v = kind === 'type' ? meta.types[i] : kind === 'class' ? meta.classes[cls[i]] : meta.superclasses[sc[i]]; if (v === query) ix.push(i); }
const net = new LIFNetwork(N, indptr, indices, weights, nt, { wSyn: +wSyn, adaptInc: +adaptInc, depU: +depU });
net.setDrive(ix, +rate);
const bins = []; let acc = 0;
for (let s = 0; s < 3000; s++) { if (s === 600) net.setDrive(ix, 0); acc += net.step().length; if (s % 200 === 199) { bins.push(acc); acc = 0; } }
console.log(`${query}@${rate} wSyn ${wSyn} adapt ${adaptInc} dep ${depU} | spikes per 100ms (stim off at 300ms): ${bins.join(' ')}`);
