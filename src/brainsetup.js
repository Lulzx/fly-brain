// Shared-memory brain setup used by the browser (main thread + fly workers) and by Node tests.
import { BRAIN_DEFAULTS, brainScales, applyClassPhysiology } from './brainmodel.js';
import { DEFAULTS as LIF_DEFAULTS } from './lif.js';
import { graphBytes, brainBytes, writeGraph, LIFWasm } from './lifwasm.js';
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
  const graph = writeGraph(memory, 1024, data, { ...LIF_DEFAULTS, ...o }, inScale, sensoryMask, sign);
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
/** worker: attach the two flyvis eyes of a fly slot (shared weights, private state) */
export function attachEyes(instance, mem, slot) {
  if (!mem.fv) return null;
  const buf = mem.memory.buffer, F = mem.fv, N = F.N, E = F.E, sp = F.sharedParts;
  const shared = { bias: new Float32Array(buf, sp.bias, N), kdt: new Float32Array(buf, sp.kdt, N), indptr: new Int32Array(buf, sp.indptr, N + 1), target: new Int32Array(buf, sp.target, E), weight: new Float32Array(buf, sp.weight, E) };
  return F.eyeBases[slot].map(base => new FlyVis(instance, mem.memory, base, { N, E, shared, bias: shared.bias, inputIdx: F.inputIdx, dt: 0.02 }));
}
/** worker: attach a brain to its slot */
export async function attachBrain(wasmModuleOrBytes, mem, slot, data, seed) {
  const inst = wasmModuleOrBytes instanceof WebAssembly.Module ? await WebAssembly.instantiate(wasmModuleOrBytes, { env: { memory: mem.memory } })
    : (await WebAssembly.instantiate(wasmModuleOrBytes, { env: { memory: mem.memory } })).instance;
  const b = new LIFWasm({ instance: inst, memory: mem.memory, graph: mem.graph, base: mem.bases[slot], N: data.N, params: mem.opts, seed });
  b.instance = inst;
  return applyClassPhysiology(b, data, mem.opts);
}
