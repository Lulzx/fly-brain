// FlyBrain: one simulated male-CNS connectome instance running in its own worker.
// Designed to be instantiated once per fly. Inputs: drive(indices, rateHz) / pulse. Outputs: onFrame(trace, spikes).
const BASE = import.meta.env.BASE_URL; // "/" in dev, "/fly-brain/" on GitHub Pages
export class FlyBrain {
  constructor(data) {
    this.data = data; this.N = data.N;
    this.worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
    this.listeners = new Set();
    this.ready = new Promise(res => { this._resolveReady = res; });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') this._resolveReady();
      else if (m.type === 'frame') this.listeners.forEach(fn => fn(m));
      else if (m.type === 'state' && this._stateCb) { this._stateCb(m); this._stateCb = null; }
    };
    // Share graph arrays via structured clone (copy). For many flies, move to SharedArrayBuffer.
    Promise.all([fetch(`${BASE}data/neuron_size.bin`).then(r => r.arrayBuffer()), fetch(`${BASE}data/ntsign.bin`).then(r => r.arrayBuffer()),
      fetch(`${BASE}data/brain_params.json`).then(r => r.json()), fetch(`${BASE}lif.wasm`).then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b)),
      fetch(`${BASE}data/neuromod.json`).then(r => r.ok ? r.json() : null).catch(() => null)]).then(([sz, sg, params, wasm, neuromod]) => {
      this.params = params;
      this.worker.postMessage({ type: 'init', N: data.N, E: data.E, meta: data.meta, indptr: data.indptr, indices: data.indices, weights: data.weights, nt: data.nt,
        superclass: data.superclass, cls: data.cls, side: data.side, size: new Float32Array(sz), sign: new Float32Array(sg), params: { ...params, neuromod: !!(params.neuromod && neuromod) }, neuromod, wasm });
    });
  }
  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  setParams(p) { this.worker.postMessage({ type: 'params', params: p }); }
  run() { this.worker.postMessage({ type: 'run' }); }
  pause() { this.worker.postMessage({ type: 'pause' }); }
  reset() { this.worker.postMessage({ type: 'reset' }); }
  drive(indices, rate) { this.worker.postMessage({ type: 'drive', indices: Uint32Array.from(indices), rate }); }
  clearDrive() { this.worker.postMessage({ type: 'clearDrive' }); }
  pulse(indices, amount) { this.worker.postMessage({ type: 'pulse', indices: Uint32Array.from(indices), amount }); }
  getState() { return new Promise(res => { this._stateCb = res; this.worker.postMessage({ type: 'getState' }); }); }
  destroy() { this.worker.terminate(); }
}
