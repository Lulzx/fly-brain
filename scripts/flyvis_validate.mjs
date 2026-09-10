import fs from 'node:fs';
import { FlyVis, parseFlyVis, flyvisBytes } from '../src/flyvis.js';
const json = JSON.parse(fs.readFileSync('public/vision/flyvis.json')); const inputs = JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'));
const b = fs.readFileSync('public/vision/flyvis.bin'); const model = parseFlyVis(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json, inputs);
const pages = Math.ceil((flyvisBytes(model.N, model.E) + 65536 * 4) / 65536);
const memory = new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true });
const { instance } = await WebAssembly.instantiate(fs.readFileSync('public/lif.wasm'), { env: { memory } });
const fv = new FlyVis(instance, memory, 1024, model);
const ref = JSON.parse(fs.readFileSync('data/flyvis_ref.json'));
const stimB = fs.readFileSync('data/flyvis_ref_stim0.bin'), actB = fs.readFileSync('data/flyvis_ref_act0.bin');
const stim = new Float32Array(stimB.buffer.slice(stimB.byteOffset, stimB.byteOffset + stimB.byteLength)); const act = new Float32Array(actB.buffer.slice(actB.byteOffset, actB.byteOffset + actB.byteLength));
const T = stim.length / 721, C = ref.idx.length; let maxErr = 0; const t0 = performance.now();
for (let t = 0; t < T; t++) { fv.setInput(stim.subarray(t * 721, t * 721 + 721)); fv.step(); for (let c = 0; c < C; c++) maxErr = Math.max(maxErr, Math.abs(fv.v[ref.idx[c]] - act[t * C + c])); }
const ms = (performance.now() - t0) / T;
console.log(`flyvis JS/wasm vs PyTorch over ${T} steps: max abs error ${maxErr.toExponential(2)} | ${ms.toFixed(2)} ms per step (${model.N} nodes, ${model.E} edges)`);
console.log('final central activities JS:', ref.cells.map((c, k) => `${c}=${fv.v[ref.idx[k]].toFixed(3)}`).join(' '));
console.log('final central activities PY:', ref.cells.map((c, k) => `${c}=${act[(T - 1) * C + k].toFixed(3)}`).join(' '));
