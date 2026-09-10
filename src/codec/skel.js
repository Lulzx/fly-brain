// FLYS: neuron skeleton codec (display geometry). Each neuron is a tree (or a few) of vertices on an
// integer grid; the trees are written in depth-first preorder as
//   child count per vertex  +  xyz step from the parent vertex.
// Steps are coded as magnitude and sign per axis. Magnitudes are context-modelled on the parent's own
// step (neurites run smoothly) and on whether the vertex starts a side branch; signs on the parent's sign
// (neurites keep their direction). Child counts are modelled on the previous vertex's count.
import { Encoder, Decoder, UInt, SInt, probs, lg } from './rc.js';

const MAGIC = 0x53594C46; // 'FLYS'
const K = 12;             // magnitude buckets for step contexts
function models() {
  return { ncomp: new UInt(4), nkid: new UInt(4), root: new SInt(3), mag: new UInt(3 * 2 * (K + 1)), sign: probs(3 * 2 * 3) };
}
const bucketOf = (a) => { const l = lg(a); return l < K ? l : K - 1; };

/** neurons[n] = array of trees { xyz: Int32Array(3V) grid coords in preorder, kids: Uint32Array(V) }
 *  bmin: grid origin (nm), res: grid step (nm) */
export function encodeSkel(neurons, bmin, res) {
  const e = new Encoder(1 << 24), M = models(), N = neurons.length;
  let V = 0; const prevRoot = [0, 0, 0];
  const dxyz = [0, 0, 0];
  for (let n = 0; n < N; n++) {
    const trees = neurons[n];
    M.ncomp.code(e, 0, trees.length);
    for (const { xyz, kids } of trees) {
      const nv = kids.length, step = new Int32Array(nv * 3), hasStep = new Uint8Array(nv), branch = new Uint8Array(nv);
      const stack = [], left = [];
      let pk = 0;
      for (let v = 0; v < nv; v++) {
        M.nkid.code(e, Math.min(pk, 3), kids[v]); pk = kids[v];
        if (stack.length === 0) {
          for (let k = 0; k < 3; k++) { M.root.code(e, k, xyz[v * 3 + k] - prevRoot[k]); prevRoot[k] = xyz[v * 3 + k]; }
        } else {
          const par = stack[stack.length - 1];
          for (let k = 0; k < 3; k++) dxyz[k] = xyz[v * 3 + k] - xyz[par * 3 + k];
          codeStep(e, M, par, v, step, hasStep, branch, dxyz);
          if (--left[left.length - 1] === 0) { stack.pop(); left.pop(); }
        }
        if (kids[v] > 0) { stack.push(v); left.push(kids[v]); branch[v] = kids[v] > 1 ? 1 : 0; }
      }
      V += nv;
    }
  }
  const body = e.finish(), head = new Uint32Array([MAGIC, 2, N, V]), out = new Uint8Array(16 + 16 + body.length);
  out.set(new Uint8Array(head.buffer)); out.set(new Uint8Array(Float32Array.from([...bmin, res]).buffer), 16); out.set(body, 32);
  return out;
}

// shared by encoder and decoder: io.bit/UInt.code return the (de)coded value; dxyz is in/out
function codeStep(io, M, par, v, step, hasStep, branch, dxyz, dec = false) {
  const hs = hasStep[par], br = branch[par];
  for (let k = 0; k < 3; k++) {
    const ps = step[par * 3 + k], ctx = (k * 2 + br) * (K + 1) + (hs ? bucketOf(ps < 0 ? -ps : ps) : K);
    const x = dxyz[k], m = dec ? M.mag.dec(io, ctx) : M.mag.code(io, ctx, x < 0 ? -x : x);
    let s = 0;
    if (m !== 0) s = io.bit(M.sign, (k * 2 + br) * 3 + (!hs || ps === 0 ? 0 : ps > 0 ? 1 : 2), x < 0 ? 1 : 0);
    const d = s ? -m : m; dxyz[k] = d; step[v * 3 + k] = d;
  }
  hasStep[v] = 1;
}

/** returns { N, V, pos (Float32 xyz in µm), seg (Uint32 vertex pairs), vOff (Uint32 N+1), bbox (µm) } */
export function decodeSkel(buf) {
  const u8 = new Uint8Array(buf), h = new Uint32Array(u8.slice(0, 16).buffer);
  if (h[0] !== MAGIC || h[1] !== 2) throw new Error('not a FLYS v2 file');
  const N = h[2], V = h[3], f = new Float32Array(u8.slice(16, 32).buffer), bmin = [f[0], f[1], f[2]], res = f[3];
  const d = new Decoder(u8.subarray(32)), M = models();
  const pos = new Float32Array(V * 3), seg = new Uint32Array(V * 2), vOff = new Uint32Array(N + 1);
  const q = new Int32Array(V * 3), step = new Int32Array(V * 3), hasStep = new Uint8Array(V), branch = new Uint8Array(V);
  const stack = new Int32Array(V), left = new Int32Array(V), dxyz = [0, 0, 0];
  let v = 0, ns = 0; const r = [0, 0, 0];
  for (let n = 0; n < N; n++) {
    const nc = M.ncomp.dec(d, 0);
    for (let c = 0; c < nc; c++) {
      let sp = 0, pk = 0;
      do {
        const kids = M.nkid.dec(d, pk < 3 ? pk : 3); pk = kids;
        if (sp === 0) {
          for (let k = 0; k < 3; k++) { r[k] += M.root.dec(d, k); q[v * 3 + k] = r[k]; }
        } else {
          const par = stack[sp - 1];
          codeStep(d, M, par, v, step, hasStep, branch, dxyz, true);
          for (let k = 0; k < 3; k++) q[v * 3 + k] = q[par * 3 + k] + dxyz[k];
          seg[ns++] = par; seg[ns++] = v;
          if (--left[sp - 1] === 0) sp--;
        }
        if (kids > 0) { stack[sp] = v; left[sp] = kids; sp++; branch[v] = kids > 1 ? 1 : 0; }
        v++;
      } while (sp > 0);
    }
    vOff[n + 1] = v;
  }
  for (let i = 0; i < V * 3; i++) pos[i] = (bmin[i % 3] + q[i] * res) / 1000;
  const lo = [0, 1, 2].map(k => bmin[k] / 1000);
  let hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < V * 3; i++) if (pos[i] > hi[i % 3]) hi[i % 3] = pos[i];
  return { N, V, pos, seg: seg.subarray(0, ns), vOff, bbox: [...lo, ...hi] };
}
