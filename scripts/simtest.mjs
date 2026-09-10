// Node harness: load public/data and run the LIF core with a chosen stimulus.
import fs from 'node:fs';
import { LIFNetwork } from '../src/lif.js';
const meta = JSON.parse(fs.readFileSync('public/data/meta.json'));
const N = meta.N;
const nb = fs.readFileSync('public/data/neurons.bin'); const ab = nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.byteLength);
let off = 8 + N * 8 + N * 12 + N * 8; const cls = new Uint16Array(ab, off, N); off += N * 2; const nt = new Uint8Array(ab, off, N); off += N; const sc = new Uint8Array(ab, off, N); off += N; const side = new Uint8Array(ab, off, N);
const gb = fs.readFileSync(`public/data/graph_w${meta.minWeight}.bin`); const g = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength);
const E = new Uint32Array(g, 0, 2)[1]; const indptr = new Uint32Array(g, 8, N + 1); const indices = new Uint32Array(g, 8 + (N + 1) * 4, E); const weights = new Uint16Array(g, 8 + (N + 1) * 4 + E * 4, E);
const [kind, query, rate = 100, ms = 500, wSyn = 0.275, minW = 0, adaptInc = 1.0, depU = 0.1] = process.argv.slice(2);
let wcopy = weights; if (+minW > 0) { wcopy = weights.slice(0); let dropped = 0; for (let k = 0; k < E; k++) if (wcopy[k] < +minW) { wcopy[k] = 0; dropped++; } console.log('edges dropped', dropped, 'of', E); }
const ix = [];
for (let i = 0; i < N; i++) { const v = kind === 'type' ? meta.types[i] : kind === 'class' ? meta.classes[cls[i]] : meta.superclasses[sc[i]]; if (v === query) ix.push(i); }
console.log(`stim ${kind}=${query}: ${ix.length} neurons @ ${rate} Hz, wSyn ${wSyn}`);
const net = new LIFNetwork(N, indptr, indices, wcopy, nt, { wSyn: +wSyn, adaptInc: +adaptInc, depU: +depU });
net.setDrive(ix, +rate);
const t0 = Date.now(); let tot = 0;
for (let s = 0; s < ms / net.p.dt; s++) { const f = net.step().length; tot += f; if (s % 200 === 199) console.log(`t=${net.t}ms spikes/step=${(f).toString().padStart(6)}`); }
const stimSet = new Set(ix); let downstream = 0, active = 0;
for (let i = 0; i < N; i++) if (!stimSet.has(i) && net.spikeCount[i] > 0) { downstream++; }
const top = [...net.spikeCount].map((c, i) => [c, i]).filter(([c, i]) => !stimSet.has(i)).sort((a, b) => b[0] - a[0]).slice(0, 12);
console.log(`total spikes ${tot}, downstream neurons active ${downstream}, wall ${Date.now() - t0} ms for ${ms} sim ms`);
console.log('top responders:', top.map(([c, i]) => `${meta.types[i] || meta.superclasses[sc[i]]}(${(c / (ms / 1000)).toFixed(0)}Hz)`).join(', '));
