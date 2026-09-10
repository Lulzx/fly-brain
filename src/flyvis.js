// flyvis optic-lobe model (Lappalainen et al. 2024, MIT) running in the shared wasm kernel (fv_step).
// One instance per eye. Input: luminance per hex column (721); output: graded activity per node.
export class FlyVis {
  constructor(instance, memory, base, model) {
    // model: { N, E, tid, u, v, bias, tau, indptr, target, weight, types, inputIdx: {R1:[721],...}, dt }
    this.inst = instance; this.mem = memory; this.N = model.N; this.dt = model.dt || 0.02;
    const buf = memory.buffer; let o = base; const N = model.N, E = model.E;
    const al = n => (n + 63) & ~63;
    const f32 = (n, src) => { const a = new Float32Array(buf, o, n); if (src) a.set(src); o += al(n * 4); return a; };
    const i32 = (n, src) => { const a = new Int32Array(buf, o, n); if (src) a.set(src); o += al(n * 4); return a; };
    if (model.shared) { Object.assign(this, model.shared); }
    else {
      this.bias = f32(N, model.bias); this.kdt = f32(N, Float32Array.from(model.tau, t => this.dt / Math.max(t, this.dt)));
      this.indptr = i32(N + 1, model.indptr); this.target = i32(E, model.target); this.weight = f32(E, model.weight);
    }
    this.v = f32(N, model.shared ? model.shared.bias : model.bias); this.acc = f32(N); this.x = f32(N);
    this.end = o; this.inputIdx = model.inputIdx; this.model = model;
  }
  get sharedParts() { return { bias: this.bias, kdt: this.kdt, indptr: this.indptr, target: this.target, weight: this.weight }; }
  /** lum: Float32Array(721) luminance (0..1) per hex column, same for R1-R8 */
  setInput(lum) { const x = this.x; for (const t in this.inputIdx) { const ix = this.inputIdx[t]; for (let k = 0; k < ix.length; k++) x[ix[k]] = lum[k]; } }
  step() { this.inst.exports.fv_step(this.N, this.bias.byteOffset, this.kdt.byteOffset, this.indptr.byteOffset, this.target.byteOffset, this.weight.byteOffset, this.v.byteOffset, this.acc.byteOffset, this.x.byteOffset); }
  reset() { this.v.set(this.bias); }
}
export function parseFlyVis(bin, json, inputs) {
  const N = json.N, E = json.E; let o = 0;
  const take = (C, n) => { const a = new C(bin.slice(o, o + n * C.BYTES_PER_ELEMENT)); o += n * C.BYTES_PER_ELEMENT; return a; };
  const tid = take(Uint8Array, N), u = take(Int16Array, N), v = take(Int16Array, N), bias = take(Float32Array, N), tau = take(Float32Array, N);
  const indptr = take(Int32Array, N + 1), target = take(Int32Array, E), weight = take(Float32Array, E);
  return { N, E, tid, u, v, bias, tau, indptr, target, weight, types: json.types, inputIdx: inputs, dt: 0.02 };
}
export function flyvisBytes(N, E) { return ((N + 1) * 4 + E * 8 + N * 4 * 5 + 64 * 10); }
