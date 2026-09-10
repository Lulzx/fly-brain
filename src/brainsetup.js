// Shared-memory brain setup used by the browser (main thread + fly workers) and by Node tests.
import { BRAIN_DEFAULTS, brainScales, applyClassPhysiology } from './brainmodel.js';
import { DEFAULTS as LIF_DEFAULTS } from './lif.js';
import { graphBytes, brainBytes, writeGraph, LIFWasm } from './lifwasm.js';
export const MAX_FLIES = 12;
/** main thread: allocate memory for the connectome + MAX_FLIES brains and write the graph once */
export function allocBrainMemory(data, size, sign, opts = {}, maxFlies = MAX_FLIES) {
  const o = { ...BRAIN_DEFAULTS, ...opts };
  const pages = Math.ceil((graphBytes(data.N, data.E) + brainBytes(data.N) * maxFlies + (1 << 20)) / 65536);
  const memory = new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true });
  const { inScale, sensoryMask } = brainScales(data, size, o);
  const graph = writeGraph(memory, 1024, data, { ...LIF_DEFAULTS, ...o }, inScale, sensoryMask, sign);
  const bases = []; let b = (graph.end + 4095) & ~4095; for (let k = 0; k < maxFlies; k++) { bases.push(b); b = (b + brainBytes(data.N) + 4095) & ~4095; }
  return { memory, graph, bases, opts: o };
}
/** worker: attach a brain to its slot */
export async function attachBrain(wasmModuleOrBytes, mem, slot, data, seed) {
  const inst = wasmModuleOrBytes instanceof WebAssembly.Module ? await WebAssembly.instantiate(wasmModuleOrBytes, { env: { memory: mem.memory } })
    : (await WebAssembly.instantiate(wasmModuleOrBytes, { env: { memory: mem.memory } })).instance;
  const b = new LIFWasm({ instance: inst, memory: mem.memory, graph: mem.graph, base: mem.bases[slot], N: data.N, params: mem.opts, seed });
  return applyClassPhysiology(b, data, mem.opts);
}
