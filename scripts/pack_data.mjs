// Pack public/data into the compact codecs in src/codec (FLYG graph, FLYS skeletons, FLYN neurons)
// and verify every file round-trips. Usage: node scripts/pack_data.mjs [graph|neurons ...]
// (skeletons are packed from the raw data by scripts/prep_skel_tree.mjs)
import fs from 'fs';
import { encodeGraph, decodeGraph } from '../src/codec/graph.js';
import { encodeNeurons, decodeNeurons } from '../src/codec/neurons.js';
import { decodeSkel } from '../src/codec/skel.js';
const D = 'public/data', want = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['graph', 'neurons']);
const meta = JSON.parse(fs.readFileSync(`${D}/meta.json`)), N = meta.N;
const ab = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const mb = (n) => (n / 1e6).toFixed(2) + ' MB';

function readGraph() {
  const gb = ab(`${D}/graph_w${meta.minWeight}.bin`), E = new Uint32Array(gb, 0, 2)[1];
  return { N, E, minWeight: meta.minWeight, raw: gb, indptr: new Uint32Array(gb, 8, N + 1), indices: new Uint32Array(gb, 8 + (N + 1) * 4, E), weights: new Uint16Array(gb, 8 + (N + 1) * 4 + E * 4, E) };
}
// neuron order for graph coding: cell type, then Morton code of the skeleton centroid
function neuronOrder() {
  const sk = decodeSkel(ab(`${D}/skeletons.flys`)), c = new Float64Array(N * 3);
  for (let n = 0; n < N; n++) { const a = sk.vOff[n], b = sk.vOff[n + 1]; for (let v = a; v < b; v++) for (let k = 0; k < 3; k++) c[n * 3 + k] += sk.pos[v * 3 + k] / Math.max(1, b - a); }
  const morton = new Float64Array(N), lo = sk.bbox.slice(0, 3), span = [0, 1, 2].map(k => sk.bbox[k + 3] - sk.bbox[k]);
  for (let n = 0; n < N; n++) { let m = 0; const x = [0, 1, 2].map(k => Math.min(1023, Math.max(0, Math.floor((c[n * 3 + k] - lo[k]) / span[k] * 1024))));
    for (let bit = 9; bit >= 0; bit--) for (let k = 0; k < 3; k++) m = m * 2 + ((x[k] >> bit) & 1); morton[n] = m; }
  const types = [...new Set(meta.types)].sort(), tid = new Map(types.map((t, i) => [t, i]));
  const t = meta.types.map(x => tid.get(x));
  return Uint32Array.from([...Array(N).keys()].sort((a, b) => t[a] - t[b] || morton[a] - morton[b] || a - b));
}
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

if (want.has('graph')) {
  const g = readGraph(); let t = performance.now();
  const enc = encodeGraph(g, neuronOrder());
  console.log(`graph: ${mb(g.raw.byteLength)} -> ${mb(enc.length)}  (${(enc.length * 8 / g.E).toFixed(2)} bits/edge, encode ${((performance.now() - t) / 1000).toFixed(1)} s)`);
  t = performance.now(); const dec = decodeGraph(enc); const dt = performance.now() - t;
  const ok = dec.E === g.E && eq(dec.indptr, g.indptr) && eq(dec.indices, g.indices) && eq(dec.weights, g.weights);
  console.log(`  decode ${(dt / 1000).toFixed(2)} s, lossless: ${ok}`);
  if (!ok) process.exit(1);
  fs.writeFileSync(`${D}/graph.flyg`, enc);
}

if (want.has('neurons')) {
  const nb = ab(`${D}/neurons.bin`); let off = 8;
  const t = { N, bodyIds: new BigInt64Array(nb, off, N) }; off += N * 8;
  t.soma = new Float32Array(nb, off, N * 3); off += N * 12 + N * 8; // skip in/out degree (derived from the graph)
  t.cls = new Uint16Array(nb, off, N); off += N * 2; t.nt = new Uint8Array(nb, off, N); off += N;
  t.superclass = new Uint8Array(nb, off, N); off += N; t.side = new Uint8Array(nb, off, N);
  const enc = encodeNeurons(t), dec = decodeNeurons(enc);
  const same = (a, b) => a.every((x, i) => Object.is(x, b[i]));
  const ok = ['bodyIds', 'soma', 'cls', 'nt', 'superclass', 'side'].every(k => same(t[k], dec[k]));
  console.log(`neurons: ${mb(nb.byteLength)} -> ${mb(enc.length)}, lossless: ${ok}`);
  if (!ok) process.exit(1);
  fs.writeFileSync(`${D}/neurons.flyn`, enc);
}
