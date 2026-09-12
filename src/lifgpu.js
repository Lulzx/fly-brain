// WebGPU LIF kernel — same model as src/lif.js / src/wasm/lif.c, on the GPU.
//
// Layout: the connectome (indptr, indices, weights, sign) is packed into one read-only buffer; dynamic
// state into one f32 buffer (v | refr | trace | adapt | res | bias | thr | drive) and one atomic-i32
// buffer (gE | gI | spikeC | ring | ringCount | driven). Chrome's default maxStorageBuffersPerShaderStage
// is 8, so the whole kernel uses five bindings: header, graph, f32 state, atomics, deltas.
//
// A step is seven dispatches: deliver -> driven -> background -> membrane -> threshold -> tick, with the
// CPU->GPU delta list applied at the head of each pass and zeroed at its tail. Steps are encoded into an
// open compute pass and submitted in batches (~8 steps / every couple of ms wall): a `tick` kernel advances
// the delay-ring head, slot, RNG and the background-event accumulator on-device, so a batch needs zero
// per-step queue ops. The delay ring lives on the GPU, so spikes never round-trip through the CPU.
//
// CPU->GPU writes (drive/bias/threshold sets, conductance adds) go into the delta buffer via writeBuffer;
// they are applied by the next submitted batch's first dispatch (<= a batch early, ~4 ms worst case). A
// full delta queue is drained by a standalone apply pass rather than overflowing the buffer.
// GPU->CPU: each submitted batch ends with a copy of spikeCount + trace + the last step's fired
// count/indices into a rotating staging buffer; mapAsync updates the CPU shadows when it resolves, so the
// shadows lag by roughly one submit boundary (~a few ms during bursts; the motor readout low-passes over
// 40 ms, and the GF->TTMn shortcut in fly.js sees spikes ~1-4 ms late, an extra synaptic delay).
//
// Conductances are atomic<i32> fixed point (x1024): WGSL has no f32 atomics.
// API mirrors LIFWasm: step(), setDriveOne/setDrive, setBias, setThr, addG, pulse, reset, setBackground,
// plus the exposed arrays drive/spikeCount/trace/thr/bias (CPU shadows where the GPU owns the truth).
import { DEFAULTS } from './lif.js';

const WGSL = /* wgsl */`
struct Hdr {
  N: u32, nslots: u32, head: u32, slot: u32, coba: u32, nDriven: u32, nDelta: u32, nBg: u32,
  dt: f32, vRest: f32, vThresh: f32, vReset: f32, tRef: f32, adaptInc: f32, depU: f32, bgAmp: f32,
  dE: f32, dTr: f32, dA: f32, kRec: f32, kM: f32, dtS: f32, eExc: f32, eInh: f32, cE: f32, cI: f32,
  rng: u32, ipOff: u32, ixOff: u32, wOff: u32, sOff: u32, ringOff: u32, rcOff: u32, drvOff: u32,
  bgEvents: f32, bgAcc: f32,
};
struct Delta { idx: u32, kind: u32, val: f32, pad: u32 };   // kind: 0 drive set, 1 bias set, 2 thr set, 3 gE add, 4 gI add
struct Deltas { n: u32, pad0: u32, pad1: u32, pad2: u32, items: array<Delta> };
const GS: f32 = 1024.0;

@group(0) @binding(0) var<storage, read_write> hdr: Hdr;
@group(0) @binding(1) var<storage, read> graph: array<u32>;             // indptr | indices | weights(bitcast) | sign(bitcast)
@group(0) @binding(2) var<storage, read_write> st: array<f32>;          // v | refr | trace | adapt | res | bias | thr | drive
@group(0) @binding(3) var<storage, read_write> at: array<atomic<i32>>;  // gE | gI | spikeC | ring | ringCount | driven
@group(0) @binding(4) var<storage, read_write> deltas: Deltas;

fn V(i: u32) -> f32 { return st[i]; }
fn REF(i: u32) -> f32 { return st[hdr.N + i]; }
fn AD(i: u32) -> f32 { return st[3u * hdr.N + i]; }
fn RS(i: u32) -> f32 { return st[4u * hdr.N + i]; }
fn TH(i: u32) -> f32 { return st[6u * hdr.N + i]; }
fn DR(i: u32) -> f32 { return st[7u * hdr.N + i]; }

fn xs(s: u32) -> u32 { var x = s; x ^= x << 13u; x ^= x >> 17u; x ^= x << 5u; return x; }
fn rngFor(k: u32) -> u32 { var x = hdr.rng ^ (k * 2654435761u); x = xs(x); x = xs(x); return x; }
fn uf(x: u32) -> f32 { return f32(x >> 8u) * (1.0 / 16777216.0); }

fn spikeOut(i: u32) {
  let n = atomicAdd(&at[hdr.rcOff + hdr.slot], 1);
  atomicStore(&at[hdr.ringOff + hdr.slot * hdr.N + u32(n)], i32(i));
  atomicAdd(&at[2u * hdr.N + i], 1);
  st[2u * hdr.N + i] = 1.0; st[3u * hdr.N + i] = AD(i) + hdr.adaptInc;
}

// dispatched as 16 workgroups x 256 threads = 4096: the stride must equal the total thread count or
// deltas past the first stride get applied more than once (gE/gI adds are not idempotent)
@compute @workgroup_size(256) fn applyDeltas(@builtin(global_invocation_id) g: vec3u) {
  for (var k = g.x; k < deltas.n; k += 4096u) {
    let d = deltas.items[k];
    switch d.kind {
      case 0u: { st[7u * hdr.N + d.idx] = d.val; }
      case 1u: { st[5u * hdr.N + d.idx] = d.val; }
      case 2u: { st[6u * hdr.N + d.idx] = d.val; }
      case 3u: { atomicAdd(&at[d.idx], i32(d.val * GS)); }
      default: { atomicAdd(&at[hdr.N + d.idx], i32(d.val * GS)); }
    }
  }
}

@compute @workgroup_size(1) fn zeroDeltas() { deltas.n = 0u; }

@compute @workgroup_size(64) fn deliver(@builtin(global_invocation_id) g: vec3u) {
  let na = u32(atomicLoad(&at[hdr.rcOff + hdr.head]));
  for (var k = g.x; k < na; k += 4096u) {
    let pre = u32(atomicLoad(&at[hdr.ringOff + hdr.head * hdr.N + k]));
    let s = bitcast<f32>(graph[hdr.sOff + pre]) * RS(pre);
    if (s != 0.0) { st[4u * hdr.N + pre] = RS(pre) - hdr.depU * RS(pre); }
    if (s == 0.0) { continue; }
    let a = graph[hdr.ipOff + pre]; let b = graph[hdr.ipOff + pre + 1u];
    if (s > 0.0) { for (var j = a; j < b; j++) { let w = bitcast<f32>(graph[hdr.wOff + j]); if (w != 0.0) { atomicAdd(&at[graph[hdr.ixOff + j]], i32(w * s * GS)); } } }
    else { for (var j = a; j < b; j++) { let w = bitcast<f32>(graph[hdr.wOff + j]); if (w != 0.0) { atomicAdd(&at[hdr.N + graph[hdr.ixOff + j]], i32(w * s * GS)); } } }
  }
  // the count is NOT zeroed here: workgroups have no ordering, so a finished workgroup could store 0
  // before a late-scheduled one has read it, silently dropping its share of the arriving spikes.
  // tick clears it — one thread, after every reader of this step is done.
}

@compute @workgroup_size(64) fn driven(@builtin(global_invocation_id) g: vec3u) {
  for (var k = g.x; k < hdr.nDriven; k += 4096u) {
    let i = u32(atomicLoad(&at[hdr.drvOff + k]));
    if (REF(i) > 0.0) { continue; }
    if (uf(rngFor(k + i)) < DR(i) * hdr.dtS) { st[i] = hdr.vReset; st[hdr.N + i] = hdr.tRef + hdr.dt; spikeOut(i); }
  }
}

@compute @workgroup_size(64) fn background(@builtin(global_invocation_id) g: vec3u) {
  for (var k = g.x; k < hdr.nBg; k += 4096u) {
    let i = rngFor(k + 7349u) % hdr.N;
    atomicAdd(&at[i], i32(hdr.bgAmp * GS));
  }
}

@compute @workgroup_size(256) fn membrane(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= hdr.N) { return; }
  var vi = V(i); let r = REF(i);
  let ge = f32(atomicLoad(&at[i])) / GS; let gi = f32(atomicLoad(&at[hdr.N + i])) / GS;
  var dv: f32;
  if (hdr.coba != 0u) { dv = (hdr.vRest - vi + ge * (hdr.eExc - vi) * hdr.cE + gi * (vi - hdr.eInh) * hdr.cI + st[5u * hdr.N + i]) * hdr.kM; }
  else { dv = (hdr.vRest - vi + ge + gi + st[5u * hdr.N + i]) * hdr.kM; }
  vi = select(vi + dv, hdr.vReset, r > 0.0);
  st[hdr.N + i] = select(r, r - hdr.dt, r > 0.0);
  st[i] = vi;
  atomicStore(&at[i], i32(ge * hdr.dE * GS));
  atomicStore(&at[hdr.N + i], i32(gi * hdr.dE * GS));
  st[2u * hdr.N + i] *= hdr.dTr;
  st[3u * hdr.N + i] = AD(i) * hdr.dA;
  st[4u * hdr.N + i] = RS(i) + (1.0 - RS(i)) * hdr.kRec;
}

@compute @workgroup_size(256) fn threshold(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= hdr.N) { return; }
  if (V(i) >= hdr.vThresh + AD(i) + TH(i) && REF(i) <= 0.0) {
    st[i] = hdr.vReset; st[hdr.N + i] = hdr.tRef; spikeOut(i);
  }
}

// advance the delay ring, RNG and background accumulator so a batch needs no per-step queue ops
@compute @workgroup_size(1) fn tick() {
  // the slot just delivered becomes spikeOut's write target next step; clear its count now that every
  // deliver thread has read it (the spike list itself needs no clearing — it is overwritten in place)
  atomicStore(&at[hdr.rcOff + hdr.head], 0);
  hdr.head = (hdr.head + 1u) % hdr.nslots;
  hdr.slot = (hdr.head + hdr.nslots - 1u) % hdr.nslots;
  hdr.rng = xs(hdr.rng);
  hdr.bgAcc += hdr.bgEvents;
  let n = u32(hdr.bgAcc); hdr.bgAcc -= f32(n); hdr.nBg = n;
}
`;

const DELTA_DRIVE = 0, DELTA_BIAS = 1, DELTA_THR = 2, DELTA_GE = 3, DELTA_GI = 4;
const DELTA_CAP = 65536;   // delta-buffer capacity; the queue drains mid-batch rather than overflowing
const align = n => (n + 15) & ~15;
const xs32 = x => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };   // same stream as the WGSL xs()
const BATCH_STEPS = 8, BATCH_MS = 2;

export class LIFGpu {
  /** graph: { indptr, indices, weights, sign } as typed arrays (views into shared wasm memory are fine) */
  static async create({ N, E, graph, params = {}, seed = 1, device = null }) {
    if (!device) {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('no WebGPU adapter');
      device = await adapter.requestDevice();
    }
    const b = new LIFGpu();
    b.device = device; b.N = N; b.E = E; b.p = { ...DEFAULTS, ...params };
    const p = b.p; b.nslots = Math.max(1, Math.round(p.delay / p.dt)) + 1;
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    // graph pack: indptr | indices | weights | sign as u32 words
    const ipOff = 0, ixOff = align(N + 1), wOff = ixOff + align(E), sOff = wOff + align(E), gWords = sOff + align(N);
    const gArr = new Uint32Array(gWords);
    gArr.set(graph.indptr, ipOff); gArr.set(graph.indices, ixOff);
    gArr.set(new Uint32Array(graph.weights.buffer, graph.weights.byteOffset, E), wOff);
    gArr.set(new Uint32Array(graph.sign.buffer, graph.sign.byteOffset, N), sOff);
    // f32 state pack: v | refr | trace | adapt | res | bias | thr | drive
    const st = new Float32Array(8 * N); st.fill(p.vRest, 0, N); st.fill(1, 4 * N, 5 * N);   // v=vRest, res=1
    // atomics pack: gE | gI | spikeC | ring | ringCount | driven
    const ringOff = 3 * N, rcOff = ringOff + b.nslots * N, drvOff = rcOff + b.nslots, atWords = drvOff + N;
    const mk = (arr, usage = S) => { const g = device.createBuffer({ size: Math.max(16, arr.byteLength), usage }); device.queue.writeBuffer(g, 0, arr.buffer, arr.byteOffset, arr.byteLength); return g; };
    b.buf = {
      hdr: device.createBuffer({ size: 144, usage: S }),
      graph: mk(gArr, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
      st: mk(st), at: mk(new Int32Array(atWords)), deltas: device.createBuffer({ size: 16 + 16 * DELTA_CAP, usage: S }),
    };
    b._offs = { ipOff, ixOff, wOff, sOff, ringOff, rcOff, drvOff };
    // CPU shadows: spikeCount/trace update from the readback; drive/thr/bias are authoritative here.
    b.spikeCount = new Uint32Array(N); b.trace = new Float32Array(N);
    b.drive = new Float32Array(N); b.thr = new Float32Array(N); b.bias = new Float32Array(N);
    b.v = new Float32Array(N).fill(p.vRest); b.gE = new Float32Array(N); b.gI = new Float32Array(N);   // compat shadows (unused)
    b.drivenSet = new Set(); b._drivenDirty = true;
    b._deltas = []; b._rng = (seed * 2654435761) >>> 0 || 1; b.t = 0; b.head = 0;
    b._lastFired = new Int32Array(0); b._lastSlot = 0;
    b._fireCap = Math.min(65536, N);   // fired-index readback is capped; step() still reports the true count
    b._rbSize = N * 8 + 16 + b._fireCap * 4;
    b._staging = [0, 1, 2, 3].map(() => device.createBuffer({ size: b._rbSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
    b._rbBusy = [false, false, false, false]; b._rbK = 0;
    b._enc = null; b._cp = null; b._stepsInPass = 0; b._lastSubmit = 0;
    const mod = device.createShaderModule({ code: WGSL });
    const types = ['storage', 'read-only-storage', 'storage', 'storage', 'storage'];
    const bgl = device.createBindGroupLayout({ entries: types.map((t, i) => ({ binding: i, visibility: GPUShaderStage.COMPUTE, buffer: { type: t } })) });
    const pll = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    b._pipes = {};
    for (const n of ['applyDeltas', 'zeroDeltas', 'deliver', 'driven', 'background', 'membrane', 'threshold', 'tick'])
      b._pipes[n] = device.createComputePipeline({ layout: pll, compute: { module: mod, entryPoint: n } });
    b._bg = device.createBindGroup({ layout: bgl, entries: [b.buf.hdr, b.buf.graph, b.buf.st, b.buf.at, b.buf.deltas].map((r, i) => ({ binding: i, resource: { buffer: r } })) });
    b._hdrBuf = new ArrayBuffer(144); b._hd = new DataView(b._hdrBuf);
    b._writeParams();   // static header: N, constants, offsets, ring position
    return b;
  }

  /** write the whole header (params + offsets + ring position). Submits any open batch first: head/slot/rng
   *  must describe the state after the encoded steps run, not a mid-batch CPU count. */
  _writeParams() {
    this._submit();
    const p = this.p, d = this._hd, L = true, o = this._offs;
    for (const [off, val] of [[0, this.N], [4, this.nslots], [8, this.head], [12, (this.head + this.nslots - 1) % this.nslots], [16, p.coba ? 1 : 0], [20, this.drivenSet.size], [24, 0], [28, 0]]) d.setUint32(off, val, L);
    for (const [off, val] of [[32, p.dt], [36, p.vRest], [40, p.vThresh], [44, p.vReset], [48, p.tRef], [52, p.adaptInc], [56, p.depU], [60, p.bgAmp || 0],
      [64, Math.exp(-p.dt / p.tauSyn)], [68, Math.exp(-p.dt / p.traceTau)], [72, Math.exp(-p.dt / p.adaptTau)], [76, p.dt / p.depTau], [80, p.dt / p.tauM], [84, p.dt / 1000],
      [88, p.eExc], [92, p.eInh], [96, 1 / (p.eExc - p.vRest)], [100, 1 / (p.vRest - p.eInh)]]) d.setFloat32(off, val, L);
    d.setUint32(104, this._rng, L); this._rng = xs32(this._rng);   // a mid-run rewrite must not replay the same stream
    for (const [off, val] of [[108, o.ipOff], [112, o.ixOff], [116, o.wOff], [120, o.sOff], [124, o.ringOff], [128, o.rcOff], [132, o.drvOff]]) d.setUint32(off, val, L);
    d.setFloat32(136, this.N * (p.bgRate || 0) * p.dt / 1000, L); d.setFloat32(140, 0, L);
    this.device.queue.writeBuffer(this.buf.hdr, 0, this._hdrBuf);
  }

  _flushDriven() {
    if (!this._drivenDirty) return;
    const list = new Int32Array(this.drivenSet.size); let k = 0; for (const i of this.drivenSet) list[k++] = i;
    const q = this.device.queue;
    q.writeBuffer(this.buf.at, this._offs.drvOff * 4, list);
    q.writeBuffer(this.buf.hdr, 20, new Uint32Array([this.drivenSet.size]));
    this._drivenDirty = false;
  }

  _flushDeltas() {
    if (!this._deltas.length) return;
    const a = new ArrayBuffer(16 + this._deltas.length * 16), dv = new DataView(a);
    dv.setUint32(0, this._deltas.length, true);
    this._deltas.forEach(([idx, kind, val], k) => { dv.setUint32(16 + k * 16, idx, true); dv.setUint32(16 + k * 16 + 4, kind, true); dv.setFloat32(16 + k * 16 + 8, val, true); });
    this.device.queue.writeBuffer(this.buf.deltas, 0, a);
    this._deltas.length = 0;
  }

  step() {
    const dev = this.device;
    if (!this._enc) { this._enc = dev.createCommandEncoder(); this._cp = this._enc.beginComputePass(); this._cp.setBindGroup(0, this._bg); this._stepsInPass = 0; this._flushDeltas(); this._flushDriven(); }
    const cp = this._cp;
    const disp = (n, wg) => { cp.setPipeline(this._pipes[n]); cp.dispatchWorkgroups(wg); };
    if (this._stepsInPass === 0) disp('applyDeltas', 16);   // 16 x 256 = 4096 threads, matching the kernel stride
    disp('deliver', 64);        // 64 wg x 64 = 4096 threads, strided over the arriving-spike list
    disp('driven', 64);
    if (this.p.bgRate) disp('background', 64);
    disp('membrane', Math.ceil(this.N / 256));
    disp('threshold', Math.ceil(this.N / 256));
    disp('tick', 1);
    this._stepsInPass++;
    this._lastSlot = (this.head + this.nslots - 1) % this.nslots;   // ring slot the GPU wrote this step
    this.head = (this.head + 1) % this.nslots;
    this.t += this.p.dt;
    if (this._stepsInPass >= BATCH_STEPS || performance.now() - this._lastSubmit >= BATCH_MS) this._submit();
    return this._lastFired;
  }

  _submit() {
    if (!this._enc) return;
    this._cp.setPipeline(this._pipes.zeroDeltas); this._cp.dispatchWorkgroups(1);
    this._cp.end();
    const k = this._rbK;
    let copied = false;
    if (this._stepsInPass > 0 && !this._rbBusy[k]) {
      this._rbBusy[k] = true; copied = true; this._rbK = (k + 1) % this._staging.length;
      this._enc.copyBufferToBuffer(this.buf.at, 2 * this.N * 4, this._staging[k], 0, this.N * 4);                        // spikeC
      this._enc.copyBufferToBuffer(this.buf.st, 2 * this.N * 4, this._staging[k], this.N * 4, this.N * 4);               // trace
      this._enc.copyBufferToBuffer(this.buf.at, (this._offs.rcOff + this._lastSlot) * 4, this._staging[k], this.N * 8, 4);   // fired in the batch's last step
      this._enc.copyBufferToBuffer(this.buf.at, (this._offs.ringOff + this._lastSlot * this.N) * 4, this._staging[k], this.N * 8 + 16, this._fireCap * 4);   // the fired indices themselves
    }
    this.device.queue.submit([this._enc.finish()]);
    this._enc = null; this._cp = null; this._lastSubmit = performance.now();
    if (copied) this._staging[k].mapAsync(GPUMapMode.READ).then(() => {
      const src = this._staging[k].getMappedRange();
      this.spikeCount.set(new Uint32Array(src, 0, this.N)); this.trace.set(new Float32Array(src, this.N * 4, this.N));
      const n = Math.max(0, Math.min(this.N, new Int32Array(src, this.N * 8, 1)[0])), fired = new Int32Array(n);
      fired.set(new Int32Array(src, this.N * 8 + 16, Math.min(n, this._fireCap)));   // real indices; beyond the cap the tail stays 0
      this._lastFired = fired;
      this._staging[k].unmap(); this._rbBusy[k] = false;
    }).catch(e => { console.warn('lifgpu readback:', e); this._rbBusy[k] = false; });
  }

  _pushDelta(idx, kind, val) {
    this._deltas.push([idx, kind, val]);
    if (this._deltas.length >= DELTA_CAP) this._drainDeltas();
  }
  // a full queue is applied by a standalone pass now — the same batch-boundary semantics, just early —
  // instead of letting writeBuffer overflow, which would drop the whole batch and leave the CPU shadows
  // permanently ahead of GPU state
  _drainDeltas() {
    this._submit();
    if (!this._deltas.length) return;
    this._flushDeltas();
    const enc = this.device.createCommandEncoder(), cp = enc.beginComputePass();
    cp.setBindGroup(0, this._bg);
    cp.setPipeline(this._pipes.applyDeltas); cp.dispatchWorkgroups(16);
    cp.setPipeline(this._pipes.zeroDeltas); cp.dispatchWorkgroups(1);
    cp.end();
    this.device.queue.submit([enc.finish()]);
  }

  get nAwake() { return this.N; }
  setDriveOne(i, rate) { if (this.drive[i] !== rate) { this.drive[i] = rate; this._pushDelta(i, DELTA_DRIVE, rate); } if (rate > 0) { if (!this.drivenSet.has(i)) { this.drivenSet.add(i); this._drivenDirty = true; } } else if (this.drivenSet.delete(i)) this._drivenDirty = true; }
  setDrive(ix, rate) { for (const i of ix) this.setDriveOne(i, rate); }
  setBias(ix, mv) { for (const i of ix) { this.bias[i] = mv; this._pushDelta(i, DELTA_BIAS, mv); } }
  setThr(i, mv) { if (this.thr[i] !== mv) { this.thr[i] = mv; this._pushDelta(i, DELTA_THR, mv); } }
  addG(i, e, ii) { if (e) this._pushDelta(i, DELTA_GE, e); if (ii) this._pushDelta(i, DELTA_GI, ii); }
  pulse(ix, mv) { for (const i of ix) this._pushDelta(i, DELTA_GE, mv); }
  wake() {}
  setBackground(rateHz, ampMv) { this.p.bgRate = rateHz; this.p.bgAmp = ampMv; this._writeParams(); }
  setParams(q) { Object.assign(this.p, q); this._writeParams(); }
  /** submit any open batch (end of a synchronous burst); safe to call anytime */
  flush() { this._submit(); }
  reset() {
    this._submit();
    const dev = this.device, N = this.N;
    const z = new Float32Array(N), v0 = new Float32Array(N).fill(this.p.vRest), r1 = new Float32Array(N).fill(1);
    const q = dev.queue;
    q.writeBuffer(this.buf.st, 0, v0); q.writeBuffer(this.buf.st, N * 4, z); q.writeBuffer(this.buf.st, 2 * N * 4, z);
    q.writeBuffer(this.buf.st, 3 * N * 4, z); q.writeBuffer(this.buf.st, 4 * N * 4, r1);
    q.writeBuffer(this.buf.at, 0, new Int32Array(3 * N + this.nslots * N + this.nslots));   // gE, gI, spikeC, ring, ringCount
    this.spikeCount.fill(0); this.trace.fill(0); this.t = 0; this.head = 0; this._writeParams();
  }
  destroy() { for (const k in this.buf) this.buf[k].destroy(); for (const s of this._staging) s.destroy(); }
}
