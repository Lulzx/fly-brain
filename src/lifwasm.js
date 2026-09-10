// WebAssembly LIF kernel wrapper. Same model and API as LIFNetwork (src/lif.js), ~several x faster.
// Memory layout: one shared WebAssembly.Memory holds the read-only connectome once (indptr, indices,
// weights, signs) followed by per-brain state blocks, so many flies (workers) share a single graph.
import { DEFAULTS, EXC_SIGN } from './lif.js';

const HDR = 192;
const align = n => (n + 63) & ~63;
export function graphBytes(N, E) { return align((N + 1) * 4) + align(E * 4) * 2 + align(N * 4) + 256; }
export function brainBytes(N, nslots = 5) { return HDR + 64 + align(N * 4) * 13 + align(nslots * N * 4) + align(nslots * 4) + 64 * 16; }

/** Build the effective weight/sign arrays (depend on model params) and place them in memory. */
export function writeGraph(memory, base, { N, E, indptr, indices, weights, nt }, p, inScale, sensoryMask, preSign) {
  const buf = memory.buffer; let o = base;
  const ip = new Uint32Array(buf, o, N + 1); ip.set(indptr); o += align((N + 1) * 4);
  const ix = new Uint32Array(buf, o, E); ix.set(indices); o += align(E * 4);
  const w = new Float32Array(buf, o, E); o += align(E * 4);
  const sg = new Float32Array(buf, o, N); o += align(N * 4);
  const SIGN = p.ntSign || EXC_SIGN;
  for (let j = 0; j < N; j++) {
    const s = preSign ? preSign[j] : SIGN[nt[j]]; sg[j] = s * p.wSyn;
    const ig = s < 0 ? p.inhGain : 1;
    for (let k = indptr[j]; k < indptr[j + 1]; k++) { const q = indices[k], c = weights[k];
      w[k] = (c >= p.minSyn && !(sensoryMask && sensoryMask[q])) ? c * (inScale ? inScale[q] : 1) * ig : 0; }
  }
  return { indptr: ip.byteOffset, indices: ix.byteOffset, weights: w.byteOffset, sign: sg.byteOffset, end: o };
}

export class LIFWasm {
  constructor({ instance, memory, graph, base, N, params = {}, seed = 1 }) {
    this.inst = instance; this.mem = memory; this.N = N; this.p = { ...DEFAULTS, ...params };
    const p = this.p; this.nslots = Math.max(1, Math.round(p.delay / p.dt)) + 1;
    let o = align(base + HDR + 64); const buf = memory.buffer;
    const f32 = () => { const a = new Float32Array(buf, o, N); o += align(N * 4); return a; };
    this.hdr = base;
    this.v = f32(); this.gE = f32(); this.gI = f32(); this.refr = f32(); this.trace = f32(); this.adapt = f32(); this.res = f32();
    this.bias = f32(); this.thr = f32(); this.drive = f32();
    this.spikeCount = new Uint32Array(buf, o, N); o += align(N * 4);
    this.ring = new Int32Array(buf, o, this.nslots * N); o += align(this.nslots * N * 4);
    this.ringCount = new Int32Array(buf, o, this.nslots); o += align(this.nslots * 4);
    this.drivenList = new Int32Array(buf, o, N); o += align(N * 4);
    this.end = o;
    this.dv = new DataView(buf, base, HDR);
    this.graph = graph; this._drivenDirty = true; this.drivenSet = new Set();
    this.reset(); this.bias.fill(0); this.thr.fill(0); this.drive.fill(0); this.drivenList.fill(0); this.t = 0; this._seed = (seed * 2654435761) >>> 0 || 1;
    this._writeHeader();
  }
  _writeHeader() {
    const p = this.p, d = this.dv, L = true; let o = 0;
    const i32 = v => { d.setInt32(o, v, L); o += 4; }, f = v => { d.setFloat32(o, v, L); o += 4; }, u = v => { d.setUint32(o, v >>> 0, L); o += 4; };
    i32(this.N); i32(this.nslots); i32(0); i32(p.coba ? 1 : 0);
    f(p.dt); f(p.vRest); f(p.vThresh); f(p.vReset); f(p.tRef); f(p.adaptInc); f(p.depU);
    f(Math.exp(-p.dt / p.tauSyn)); f(Math.exp(-p.dt / p.traceTau)); f(Math.exp(-p.dt / p.adaptTau)); f(p.dt / p.depTau); f(p.dt / p.tauM); f(p.dt / 1000);
    f(p.eExc); f(p.eInh); f(1 / (p.eExc - p.vRest)); f(1 / (p.vRest - p.eInh));
    u(this._seed);
    for (const a of [this.v, this.gE, this.gI, this.refr, this.trace, this.adapt, this.res, this.bias, this.thr, this.drive]) u(a.byteOffset);
    u(this.graph.sign); u(this.spikeCount.byteOffset); u(this.graph.indptr); u(this.graph.indices); u(this.graph.weights);
    u(this.ring.byteOffset); u(this.ringCount.byteOffset); u(this.drivenList.byteOffset);
    i32(0); i32(0); i32(0);
    f(this.N * (p.bgRate || 0) * p.dt / 1000); f(p.bgAmp || 0); f(0);
  }
  setBackground(rateHz, ampMv) { this.p.bgRate = rateHz; this.p.bgAmp = ampMv; this.dv.setFloat32(172, this.N * rateHz * this.p.dt / 1000, true); this.dv.setFloat32(176, ampMv, true); }
  _syncDriven() { let n = 0; for (const i of this.drivenSet) this.drivenList[n++] = i; this.dv.setInt32(160, n, true); this._drivenDirty = false; }
  setDriveOne(i, rate) { this.drive[i] = rate; if (rate > 0) { if (!this.drivenSet.has(i)) { this.drivenSet.add(i); this._drivenDirty = true; } } else if (this.drivenSet.delete(i)) this._drivenDirty = true; }
  setDrive(ix, rate) { for (let k = 0; k < ix.length; k++) this.setDriveOne(ix[k], rate); }
  setBias(ix, mv) { for (let k = 0; k < ix.length; k++) this.bias[ix[k]] = mv; }
  pulse(ix, mv) { for (let k = 0; k < ix.length; k++) this.gE[ix[k]] += mv; }
  wake() {}
  reset() { this.v.fill(this.p.vRest); this.gE.fill(0); this.gI.fill(0); this.refr.fill(0); this.trace.fill(0); this.adapt.fill(0); this.res.fill(1); this.spikeCount.fill(0); this.ringCount.fill(0); this.t = 0; }
  step() {
    if (this._drivenDirty) this._syncDriven();
    const nf = this.inst.exports.lif_step(this.hdr);
    this.t += this.p.dt;
    const slot = this.dv.getInt32(168, true);
    return this.ring.subarray(slot * this.N, slot * this.N + nf);
  }
  get nAwake() { return this.N; }
}

/** Convenience: create a memory + instance + graph + one brain (Node tests, single-fly pages). */
export async function createWasmBrain(wasmBytes, data, p, inScale, sensoryMask, preSign, { nBrains = 1 } = {}) {
  const gb = graphBytes(data.N, data.E), bb = brainBytes(data.N);
  const pages = Math.ceil((gb + bb * nBrains + (1 << 20)) / 65536);
  const memory = new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true });
  const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { memory } });
  const graph = writeGraph(memory, 1024, data, { ...DEFAULTS, ...p }, inScale, sensoryMask, preSign);
  const brains = []; let base = align(graph.end);
  for (let k = 0; k < nBrains; k++) { const b = new LIFWasm({ instance, memory, graph, base, N: data.N, params: p, seed: k + 1 }); brains.push(b); base = align(b.end); }
  return { memory, instance, graph, brains };
}
