// flyvis optic lobe on the GPU, sharing the brain's device (docs/27-webgpu.md).
//
// The model is the one in src/wasm/lif.c's fv_step and src/flyvis.js: a rate network of 45,669 nodes and
// 1.5 M synapses per eye, integrated at dt = 20 ms with
//
//     acc[i]  = sum over incoming edges of weight * max(v[pre], 0)
//     v[i]   += (dt / tau[i]) * (-v[i] + bias[i] + acc[i] + x[i])
//
// Two things make this worth putting on the GPU rather than leaving it in WASM. It is the same shape as
// the brain kernel's scatter — one pass over the edges, one pass over the nodes — so it reuses the same
// fixed-point atomics trick (WGSL has no f32 atomics, so accumulation is atomic<i32>; the values here are
// small, unlike conductances, so the scale can be 65536 rather than 1024). And both eyes of a fly, and
// every fly hosted in the same worker, share the parameters: the edge list, weights, bias and tau are
// identical, so they are uploaded once per device and only the per-eye state (v, x, acc) is private.
//
// Verified against the WASM kernel on the shipped export by scripts/check_flyvisgpu.mjs.
import { gpuDevice } from './lifgpu.js';

// Fixed-point scale for the atomic accumulator. 1/65536 per edge, rounded rather than truncated: with a
// median of ~33 incoming edges per node and 25 steps of integration, truncation at 1/4096 accumulated a
// visible 0.027 disagreement with the reference, which is what set both of these choices.
const SCALE = 65536.0;

// The parameter-array offsets are shader constants and depend on N and E, so the shader is generated per
// model rather than pretending one static layout fits every export.
function shaderFor(N, E) {
  const ipOff = 0, tOff = N + 1, wOff = tOff + E, bOff = wOff + E, kOff = bOff + N;
  return /* wgsl */`
struct Hdr { N: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<storage, read> hdr: Hdr;
@group(0) @binding(1) var<storage, read> prm: array<u32>;
@group(0) @binding(2) var<storage, read_write> st: array<f32>;
@group(0) @binding(3) var<storage, read_write> acc: array<atomic<i32>>;
const S: f32 = ${SCALE};
const IP: u32 = ${ipOff}u; const T: u32 = ${tOff}u; const W: u32 = ${wOff}u;
const B: u32 = ${bOff}u; const K: u32 = ${kOff}u;

@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; if (i >= hdr.N) { return; }
  atomicStore(&acc[i], 0);
}

@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) g: vec3<u32>) {
  let j = g.x; if (j >= hdr.N) { return; }
  let r = st[j];
  if (r <= 0.0) { return; }
  let b = prm[IP + j];
  let e = prm[IP + j + 1u];
  for (var k: u32 = b; k < e; k = k + 1u) {
    let t = prm[T + k];
    let w = bitcast<f32>(prm[W + k]);
    atomicAdd(&acc[t], i32(round(w * r * S)));
  }
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; if (i >= hdr.N) { return; }
  let a = f32(atomicLoad(&acc[i])) / S;
  let v = st[i];
  st[i] = v + bitcast<f32>(prm[K + i]) * (-v + bitcast<f32>(prm[B + i]) + a + st[hdr.N + i]);
}
`;
}

const _paramCache = new Map();        // key -> { device, buffer, words, refs }

export function flyvisSharedStats() {
  let bytes = 0, refs = 0;
  for (const p of _paramCache.values()) { bytes += p.words * 4; refs += p.refs; }
  return { packs: _paramCache.size, bytes, refs };
}

export class FlyVisGpu {
  /** model: what parseFlyVis returns (N, E, indptr, target, weight, bias, tau, inputIdx, dt), or the
   *  same fields read as views into the shared wasm memory, in which case `kdt` stands in for `tau`. */
  static async create({ model, device = null, key = null }) {
    const N = model.N, E = model.E, dt = model.dt || 0.02;
    if (!device) device = await gpuDevice();
    const o = new FlyVisGpu();
    o.device = device; o.N = N; o.E = E; o.dt = dt; o.inputIdx = model.inputIdx; o.model = model;
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const k = key || `flyvis:${N}:${E}`;
    let cached = _paramCache.get(k);
    if (cached && cached.device !== device) cached = undefined;
    const tOff = N + 1, wOff = tOff + E, bOff = wOff + E, kOff = bOff + N, words = kOff + N;
    if (!cached) {
      const prm = new Uint32Array(words);
      prm.set(new Uint32Array(model.indptr.buffer, model.indptr.byteOffset, N + 1), 0);
      prm.set(new Uint32Array(model.target.buffer, model.target.byteOffset, E), tOff);
      prm.set(new Uint32Array(model.weight.buffer, model.weight.byteOffset, E), wOff);
      prm.set(new Uint32Array(model.bias.buffer, model.bias.byteOffset, N), bOff);
      // tau or the precomputed dt/tau: the shared-memory layout already holds the latter
      const kdt = model.kdt ? model.kdt : Float32Array.from(model.tau, (t) => dt / Math.max(t, dt));
      prm.set(new Uint32Array(kdt.buffer, kdt.byteOffset, N), kOff);
      const buffer = device.createBuffer({ size: prm.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, prm.buffer, prm.byteOffset, prm.byteLength);
      cached = { device, buffer, words, refs: 0 };
      _paramCache.set(k, cached);
    }
    cached.refs++; o._key = k;
    o.bias = new Float32Array(model.bias);                 // CPU copy, for reset()
    o.v = new Float32Array(o.bias);                        // shadow of the GPU state
    o.x = new Float32Array(N);
    const hdr = new Uint32Array([N, 0, 0, 0]);
    o.buf = {
      hdr: device.createBuffer({ size: 16, usage: S }),
      prm: cached.buffer,
      st: device.createBuffer({ size: 2 * N * 4, usage: S }),
      acc: device.createBuffer({ size: N * 4, usage: S }),
      read: device.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    };
    // Rotating staging buffers for the automatic shadow update. Callers read `v` synchronously (that is
    // what src/sim/vision.js does), so the shadow is refreshed after each submit and lags by about one
    // step — 20 ms of model time, the same kind of lag the brain kernel's readback already has.
    o._stage = [0, 1, 2].map(() => device.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
    o._busy = [false, false, false]; o._k = 0;
    device.queue.writeBuffer(o.buf.hdr, 0, hdr);
    device.queue.writeBuffer(o.buf.st, 0, o.v);
    const mod = device.createShaderModule({ code: shaderFor(N, E) });
    const types = ['read-only-storage', 'read-only-storage', 'storage', 'storage'];
    const bgl = device.createBindGroupLayout({ entries: types.map((t, i) => ({ binding: i, visibility: GPUShaderStage.COMPUTE, buffer: { type: t } })) });
    o._bg = device.createBindGroup({ layout: bgl, entries: [o.buf.hdr, o.buf.prm, o.buf.st, o.buf.acc].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
    const pll = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    o._pipes = {};
    for (const n of ['clear', 'scatter', 'integrate'])
      o._pipes[n] = device.createComputePipeline({ layout: pll, compute: { module: mod, entryPoint: n } });
    o._wg = Math.ceil(N / 64);
    o._xDirty = false;
    return o;
  }

  /** lum: Float32Array(721) luminance per hex column, as in FlyVis.setInput */
  setInput(lum) {
    const x = this.x;
    for (const t in this.inputIdx) { const ix = this.inputIdx[t]; for (let k = 0; k < ix.length; k++) x[ix[k]] = lum[k]; }
    this._xDirty = true;
  }

  /** one 20 ms flyvis step; steps are cheap enough to submit individually (50 per simulated second) */
  step(n = 1) {
    const d = this.device;
    if (this._xDirty) { d.queue.writeBuffer(this.buf.st, this.N * 4, this.x); this._xDirty = false; }
    const enc = d.createCommandEncoder();
    for (let s = 0; s < n; s++) {
      const cp = enc.beginComputePass();
      cp.setBindGroup(0, this._bg);
      for (const p of ['clear', 'scatter', 'integrate']) { cp.setPipeline(this._pipes[p]); cp.dispatchWorkgroups(this._wg); }
      cp.end();
    }
    // read back into the shadow without blocking: pick a free staging buffer, copy, and map
    const k = this._k;
    if (!this._busy[k]) {
      this._busy[k] = true; this._k = (k + 1) % this._stage.length;
      const rb = d.createCommandEncoder();
      rb.copyBufferToBuffer(this.buf.st, 0, this._stage[k], 0, this.N * 4);
      d.queue.submit([enc.finish(), rb.finish()]);
      this._stage[k].mapAsync(GPUMapMode.READ).then(() => {
        this.v.set(new Float32Array(this._stage[k].getMappedRange()));
        this._stage[k].unmap(); this._busy[k] = false;
      }).catch(() => { this._busy[k] = false; });
      return;
    }
    d.queue.submit([enc.finish()]);
  }

  /** pull v back to the CPU shadow and wait for it — the deterministic version of the shadow update */
  async sync() {
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.buf.st, 0, this.buf.read, 0, this.N * 4);
    this.device.queue.submit([enc.finish()]);
    await this.buf.read.mapAsync(GPUMapMode.READ);
    this.v.set(new Float32Array(this.buf.read.getMappedRange()));
    this.buf.read.unmap();
    return this.v;
  }

  reset() {
    this.v.set(this.bias); this.x.fill(0); this._xDirty = false;
    this.device.queue.writeBuffer(this.buf.st, 0, this.v);
    this.device.queue.writeBuffer(this.buf.st, this.N * 4, this.x);
  }

  destroy() {
    const p = _paramCache.get(this._key);
    if (p && --p.refs <= 0) { p.buffer.destroy(); _paramCache.delete(this._key); }
    for (const k in this.buf) if (k !== 'prm') this.buf[k].destroy();
    for (const b of this._stage) b.destroy();
  }
}
