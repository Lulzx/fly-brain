// Shared Node loader for the preprocessed connectome (mirrors src/data.js).
import fs from 'node:fs';
export function loadAll() {
  const meta = JSON.parse(fs.readFileSync('public/data/meta.json')); const N = meta.N;
  const nb = fs.readFileSync('public/data/neurons.bin'); const ab = nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.byteLength);
  let off = 8; const bodyIds = new BigInt64Array(ab, off, N); off += N * 8; const soma = new Float32Array(ab, off, N * 3); off += N * 12;
  const indeg = new Uint32Array(ab, off, N); off += N * 4; const outdeg = new Uint32Array(ab, off, N); off += N * 4;
  const cls = new Uint16Array(ab, off, N); off += N * 2; const nt = new Uint8Array(ab, off, N); off += N; const sc = new Uint8Array(ab, off, N); off += N; const side = new Uint8Array(ab, off, N);
  const gb = fs.readFileSync(`public/data/graph_w${meta.minWeight}.bin`); const g = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength);
  const E = new Uint32Array(g, 0, 2)[1]; const indptr = new Uint32Array(g, 8, N + 1); const indices = new Uint32Array(g, 8 + (N + 1) * 4, E); const weights = new Uint16Array(g, 8 + (N + 1) * 4 + E * 4, E);
  const bodymap = fs.existsSync('public/data/bodymap.json') ? JSON.parse(fs.readFileSync('public/data/bodymap.json')) : null;
  const byType = (t, s = 0) => { const o = []; for (let i = 0; i < N; i++) if (meta.types[i] === t && (!s || side[i] === s)) o.push(i); return o; };
  return { meta, N, E, bodyIds, soma, indeg, outdeg, cls, nt, sc, side, indptr, indices, weights, bodymap, byType };
}
/** calibration of the neuromodulation module (src/sim/neuromod.js), for FlyAgent's `neuromod` option */
export const loadNeuromod = () => fs.existsSync('public/data/neuromod.json') ? { calib: JSON.parse(fs.readFileSync('public/data/neuromod.json')) } : null;
