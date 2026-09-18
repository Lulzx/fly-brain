// Shared-memory brain setup used by the browser (main thread + fly workers) and by Node tests.
import { BRAIN_DEFAULTS, brainScales, applyClassPhysiology, modulatorySign, typeGains } from './brainmodel.js';
import { DEFAULTS as LIF_DEFAULTS } from './lif.js';
import { graphBytes, brainBytes, writeGraph, LIFWasm } from './lifwasm.js';
import { LIFGpu, gpuDevice } from './lifgpu.js';
import { FlyVisGpu } from './flyvisgpu.js';
import { FlyVis, flyvisBytes } from './flyvis.js';
export const MAX_FLIES = 12;
/** main thread: allocate memory for the connectome + MAX_FLIES brains and write the graph once */
export function allocBrainMemory(data, size, sign, opts = {}, maxFlies = MAX_FLIES, vision = null) {
  // vision: { model (parsed flyvis), map (flyvis_map.json) } -> flyvis-driven optic-lobe neurons become externally driven
  const o = { ...BRAIN_DEFAULTS, ...opts };
  const fvPerEye = vision ? (vision.model.N * 4 * 3 + 64 * 4) : 0, fvShared = vision ? flyvisBytes(vision.model.N, vision.model.E) : 0;
  const pages = Math.ceil((graphBytes(data.N, data.E) + (brainBytes(data.N) + 2 * fvPerEye + 8192) * maxFlies + fvShared + (2 << 20)) / 65536);
  const memory = new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true });
  const { inScale, sensoryMask } = brainScales(data, size, o);
  if (vision) for (const sd of ['L', 'R']) for (const [i] of vision.map.eyes[sd].pairs) sensoryMask[i] = 1;
  const graph = writeGraph(memory, 1024, data, { ...LIF_DEFAULTS, ...o }, inScale, sensoryMask, modulatorySign(data, sign, o), typeGains(data, o));
  const bases = []; let b = (graph.end + 4095) & ~4095; for (let k = 0; k < maxFlies; k++) { bases.push(b); b = (b + brainBytes(data.N) + 4095) & ~4095; }
  let fv = null;
  if (vision) { // shared flyvis parameters once, then 2 eye-state blocks per fly
    const proto = new FlyVis(null, memory, b, vision.model); const sharedParts = proto.sharedParts; b = (proto.end + 4095) & ~4095;
    const eyeBases = []; for (let k = 0; k < maxFlies; k++) { eyeBases.push([b, b + ((fvPerEye + 4095) & ~4095)]); b += 2 * ((fvPerEye + 4095) & ~4095); }
    fv = { sharedParts: { bias: sharedParts.bias.byteOffset, kdt: sharedParts.kdt.byteOffset, indptr: sharedParts.indptr.byteOffset, target: sharedParts.target.byteOffset, weight: sharedParts.weight.byteOffset },
      eyeBases, N: vision.model.N, E: vision.model.E, inputIdx: vision.model.inputIdx };
  }
  return { memory, graph, bases, opts: o, fv };
}
/** worker: attach the two flyvis eyes of a fly slot on the GPU, sharing the brain's device and one
 * parameter pack. Falls back to the WASM eyes on any failure, exactly as the brain kernel does. */
export async function attachEyesGpu(mem) {
  if (!mem.fv || mem.opts.gpu === false || typeof navigator === 'undefined' || !navigator.gpu) return null;
  try {
    const buf = mem.memory.buffer, F = mem.fv, N = F.N, E = F.E, sp = F.sharedParts;
    // the shared block holds dt/tau rather than tau; FlyVisGpu takes either
    const model = { N, E, dt: 0.02, inputIdx: F.inputIdx,
      bias: new Float32Array(buf, sp.bias, N), kdt: new Float32Array(buf, sp.kdt, N),
      indptr: new Int32Array(buf, sp.indptr, N + 1), target: new Int32Array(buf, sp.target, E),
      weight: new Float32Array(buf, sp.weight, E) };
    const device = await gpuDevice();
    const eyes = [];
    for (let e = 0; e < 2; e++) eyes.push(await FlyVisGpu.create({ model, device }));
    // Resting activity under a uniform grey field, measured here because it is the one quantity the
    // vision layer needs synchronously and the GPU shadow is asynchronous. It is a property of the
    // model, so measuring it once per worker on one eye is exact rather than an approximation.
    const grey = new Float32Array(F.inputIdx.R1.length).fill(0.5);
    eyes[0].reset(); eyes[0].setInput(grey); eyes[0].step(150);
    const vRest = (await eyes[0].sync()).slice(0);
    for (const e of eyes) e.reset();
    console.info('flyvis backend: WebGPU');
    return { eyes, vRest };
  } catch (e) { console.warn('WebGPU flyvis unavailable, falling back to WASM:', e); return null; }
}
/** worker: attach the two flyvis eyes of a fly slot (shared weights, private state) */
export function attachEyes(instance, mem, slot) {
  if (!mem.fv) return null;
  const buf = mem.memory.buffer, F = mem.fv, N = F.N, E = F.E, sp = F.sharedParts;
  const shared = { bias: new Float32Array(buf, sp.bias, N), kdt: new Float32Array(buf, sp.kdt, N), indptr: new Int32Array(buf, sp.indptr, N + 1), target: new Int32Array(buf, sp.target, E), weight: new Float32Array(buf, sp.weight, E) };
  return F.eyeBases[slot].map(base => new FlyVis(instance, mem.memory, base, { N, E, shared, bias: shared.bias, inputIdx: F.inputIdx, dt: 0.02 }));
}
/** worker: attach a brain to its slot. Uses the WebGPU kernel when available (opts.gpu !== false); the wasm
 * module is still instantiated either way because the flyvis eyes run on its fv_step. Falls back to WASM. */
export async function attachBrain(wasmModuleOrBytes, mem, slot, data, seed) {
  const inst = wasmModuleOrBytes instanceof WebAssembly.Module ? await WebAssembly.instantiate(wasmModuleOrBytes, { env: { memory: mem.memory } })
    : (await WebAssembly.instantiate(wasmModuleOrBytes, { env: { memory: mem.memory } })).instance;
  if (mem.opts.gpu !== false && typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const buf = mem.memory.buffer, G = mem.graph, N = data.N, E = data.E;
      const graph = { indptr: new Uint32Array(buf, G.indptr, N + 1), indices: new Uint32Array(buf, G.indices, E), weights: new Float32Array(buf, G.weights, E), sign: new Float32Array(buf, G.sign, N) };
      const gb = await LIFGpu.create({ N, E, graph, params: mem.opts, seed });
      gb.instance = inst;
      console.info('brain backend: WebGPU');
      return applyClassPhysiology(gb, data, mem.opts);
    } catch (e) { console.warn('WebGPU brain unavailable, falling back to WASM:', e); }
  }
  const b = new LIFWasm({ instance: inst, memory: mem.memory, graph: mem.graph, base: mem.bases[slot], N: data.N, params: mem.opts, seed });
  b.instance = inst;
  return applyClassPhysiology(b, data, mem.opts);
}
