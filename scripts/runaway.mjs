import fs from 'node:fs';
import { LIFNetwork } from '../src/lif.js';
const meta = JSON.parse(fs.readFileSync('public/data/meta.json')); const N = meta.N;
const nb = fs.readFileSync('public/data/neurons.bin'); const ab = nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.byteLength);
let off = 8 + N * 8 + N * 12; const indeg = new Uint32Array(ab, off, N); off += N * 4; const outdeg = new Uint32Array(ab, off, N); off += N * 4; const cls = new Uint16Array(ab, off, N); off += N * 2; const nt = new Uint8Array(ab, off, N); off += N; const sc = new Uint8Array(ab, off, N);
const gb = fs.readFileSync(`public/data/graph_w${meta.minWeight}.bin`); const g = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength);
const E = new Uint32Array(g, 0, 2)[1]; const indptr = new Uint32Array(g, 8, N + 1); const indices = new Uint32Array(g, 8 + (N + 1) * 4, E); const weights = new Uint16Array(g, 8 + (N + 1) * 4 + E * 4, E);
const count = (arr, names) => { const c = {}; for (const i of arr) { const k = names(i); c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]); };
console.log('NT all traced:', count([...Array(N).keys()], i => meta.nts[nt[i]]));
console.log('superclass all:', count([...Array(N).keys()], i => meta.superclasses[sc[i]]));
// total excitatory vs inhibitory input synapses per neuron
const exc = new Float64Array(N), inh = new Float64Array(N);
for (let p = 0; p < N; p++) { const s = [1, 1, -1, -1, 1, 1, 1, -1][nt[p]]; for (let k = indptr[p]; k < indptr[p + 1]; k++) { if (s > 0) exc[indices[k]] += weights[k]; else inh[indices[k]] += weights[k]; } }
let te = 0, ti = 0; for (let i = 0; i < N; i++) { te += exc[i]; ti += inh[i]; }
console.log('total exc syn', te, 'inh syn', ti, 'E/I', (te / ti).toFixed(2));
const net = new LIFNetwork(N, indptr, indices, weights, nt);
const ix = []; for (let i = 0; i < N; i++) if (meta.types[i] === 'DNp01') ix.push(i);
net.setDrive(ix, 100); for (let s = 0; s < 1000; s++) net.step();
const run = []; for (let i = 0; i < N; i++) if (net.spikeCount[i] > 50) run.push(i);
console.log('runaway set', run.length);
console.log('runaway NT:', count(run, i => meta.nts[nt[i]]));
console.log('runaway superclass:', count(run, i => meta.superclasses[sc[i]]));
console.log('runaway class:', count(run, i => meta.classes[cls[i]] || '-').slice(0, 12));
