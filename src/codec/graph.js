// FLYG: lossless connectome codec (CSR graph, rows = presynaptic neuron).
// Neurons are renumbered so that connected cells get nearby ids (the encoder sorts by cell type, then by
// a Morton code of the skeleton centroid), and the permutation is stored. Each row is then coded as
//   degree | "copy" bits over the previous row's targets (same-type neighbours share many partners) |
//   gaps between the remaining targets | weights, context-modelled on the copied edge's weight.
// Decoding restores the original numbering and the exact original CSR arrays.
import { Encoder, Decoder, UInt, SInt, probs, lg } from './rc.js';

const MAGIC = 0x47594C46; // 'FLYG'
function models() {
  return { deg: new UInt(24), first: new SInt(24), gap: new UInt(24), w: new UInt(48), copy: probs(4 * 8 * 2), perm: 18 };
}
const cctx = (prevBit, degRatio, i) => (prevBit * 8 + degRatio) * 2 + (i === 0 ? 1 : 0);

/** @param order new -> old neuron id (Uint32Array N) */
export function encodeGraph({ N, E, indptr, indices, weights, minWeight }, order) {
  const inv = new Uint32Array(N); for (let r = 0; r < N; r++) inv[order[r]] = r;
  const e = new Encoder(E * 2), M = models();
  const head = new Uint32Array([MAGIC, 1, N, E, minWeight]);
  for (let r = 0; r < N; r++) e.direct(order[r], M.perm);
  let prevT = new Uint32Array(0), prevW = new Uint16Array(0), prevDeg = 0;
  const tmp = [];
  for (let r = 0; r < N; r++) {
    const o = order[r], a = indptr[o], b = indptr[o + 1], d = b - a;
    tmp.length = 0; for (let k = a; k < b; k++) tmp.push([inv[indices[k]], weights[k]]);
    tmp.sort((x, y) => x[0] - y[0]);
    M.deg.code(e, Math.min(lg(prevDeg), 23), d);
    const ratio = prevT.length ? Math.min(7, Math.max(0, lg(d) - lg(prevT.length) + 4)) : 0;
    // copy bits over previous row's targets
    const inPrev = new Map(); let pb = 0, j = 0;
    for (let i = 0; i < prevT.length; i++) {
      while (j < tmp.length && tmp[j][0] < prevT[i]) j++;
      const hit = j < tmp.length && tmp[j][0] === prevT[i] ? 1 : 0;
      e.bit(M.copy, cctx(pb, ratio, i), hit); pb = hit;
      if (hit) inPrev.set(prevT[i], prevW[i]);
    }
    // residual targets as gaps
    let last = -1, pg = 0, first = true;
    for (const [t] of tmp) {
      if (inPrev.has(t)) continue;
      if (first) { M.first.code(e, Math.min(lg(d), 23), t - r); first = false; }
      else { const g = t - last - 1; M.gap.code(e, Math.min(lg(pg), 23), g); pg = g; }
      last = t;
    }
    // weights in target order
    let pw = 0;
    for (const [t, w] of tmp) {
      const ref = inPrev.get(t);
      const ctx = ref !== undefined ? 24 + Math.min(lg(ref - minWeight), 23) : Math.min(lg(pw), 23);
      M.w.code(e, ctx, w - minWeight); pw = w - minWeight;
    }
    prevT = Uint32Array.from(tmp, x => x[0]); prevW = Uint16Array.from(tmp, x => x[1]); prevDeg = d;
  }
  const body = e.finish(), out = new Uint8Array(20 + body.length);
  out.set(new Uint8Array(head.buffer)); out.set(body, 20);
  return out;
}

/** returns { N, E, indptr, indices, weights, minWeight } identical to the pre-encoding arrays */
export function decodeGraph(buf) {
  const u8 = new Uint8Array(buf), h = new Uint32Array(u8.buffer, u8.byteOffset, 5);
  if (h[0] !== MAGIC || h[1] !== 1) throw new Error('not a FLYG v1 file');
  const N = h[2], E = h[3], minWeight = h[4];
  const d = new Decoder(u8.subarray(20)), M = models();
  const order = new Uint32Array(N); for (let r = 0; r < N; r++) order[r] = d.direct(0, M.perm);
  // pass 1: rows in coded (new) order
  const ptrN = new Uint32Array(N + 1), tgt = new Uint32Array(E), wt = new Uint16Array(E);
  let pos = 0, pa = 0, pb = 0; // previous row = tgt[pa..pb)
  let prevDeg = 0;
  let res = new Uint32Array(8192), cop = new Uint32Array(8192);
  for (let r = 0; r < N; r++) {
    const deg = M.deg.dec(d, Math.min(lg(prevDeg), 23));
    if (deg > res.length || pb - pa > cop.length) { res = new Uint32Array(2 * Math.max(deg, pb - pa)); cop = new Uint32Array(res.length); }
    const plen = pb - pa;
    const ratio = plen ? Math.min(7, Math.max(0, lg(deg) - lg(plen) + 4)) : 0;
    let nc = 0, bit = 0;
    for (let i = 0; i < plen; i++) { bit = d.bit(M.copy, cctx(bit, ratio, i)); if (bit) { cop[nc] = i; nc++; } }
    const nr = deg - nc; let last = -1, pg = 0;
    for (let i = 0; i < nr; i++) {
      if (i === 0) last = r + M.first.dec(d, Math.min(lg(deg), 23));
      else { const g = M.gap.dec(d, Math.min(lg(pg), 23)); pg = g; last += g + 1; }
      res[i] = last;
    }
    // merge copied (from previous row, sorted) and residual (sorted)
    let i = 0, k = 0, pw = 0; const start = pos;
    while (i < nc || k < nr) {
      const ct = i < nc ? tgt[pa + cop[i]] : 0xFFFFFFFF, rt = k < nr ? res[k] : 0xFFFFFFFF;
      let w;
      if (ct < rt) { w = M.w.dec(d, 24 + Math.min(lg(wt[pa + cop[i]] - minWeight), 23)); tgt[pos] = ct; i++; }
      else { w = M.w.dec(d, Math.min(lg(pw), 23)); tgt[pos] = rt; k++; }
      wt[pos++] = w + minWeight; pw = w;
    }
    pa = start; pb = pos; ptrN[r + 1] = pos; prevDeg = deg;
  }
  // pass 2: back to the original numbering. A counting sort by (old) target id, scattered into each
  // (old) row, leaves every row sorted by target exactly like the source file.
  const indptr = new Uint32Array(N + 1);
  for (let r = 0; r < N; r++) indptr[order[r] + 1] = ptrN[r + 1] - ptrN[r];
  for (let o = 0; o < N; o++) indptr[o + 1] += indptr[o];
  const tstart = new Uint32Array(N + 1);
  for (let j = 0; j < E; j++) tstart[order[tgt[j]] + 1]++;
  for (let t = 0; t < N; t++) tstart[t + 1] += tstart[t];
  const rowOf = new Uint32Array(E), wOf = new Uint16Array(E);
  for (let r = 0; r < N; r++) { const o = order[r]; for (let j = ptrN[r]; j < ptrN[r + 1]; j++) { const s = tstart[order[tgt[j]]]++; rowOf[s] = o; wOf[s] = wt[j]; } }
  const indices = new Uint32Array(E), weights = new Uint16Array(E), cur = indptr.slice(0, N);
  for (let t = 0, s = 0; t < N; t++) for (const end = tstart[t]; s < end; s++) { const k = cur[rowOf[s]]++; indices[k] = t; weights[k] = wOf[s]; }
  return { N, E, indptr, indices, weights, minWeight };
}
