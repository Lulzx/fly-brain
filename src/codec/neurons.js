// FLYN: per-neuron table codec (lossless). Body ids are sorted, so they are coded as gaps; superclass is
// coded first and then conditions class, transmitter and side; soma positions (integer voxels, or
// missing) are coded as offsets from the previous soma. In/out degrees are not stored: they follow
// from the graph.
import { Encoder, Decoder, UInt, SInt, probs } from './rc.js';

const MAGIC = 0x4E594C46; // 'FLYN'
const models = () => ({ id: new UInt(1), sc: new UInt(32), cls: new UInt(32), nt: new UInt(32), side: new UInt(32), has: probs(2), soma: new SInt(3) });

export function encodeNeurons({ N, bodyIds, soma, cls, nt, superclass, side }) {
  const e = new Encoder(1 << 20), M = models();
  let prevId = 0, prev = [0, 0, 0], ph = 1;
  for (let i = 0; i < N; i++) {
    const id = Number(bodyIds[i]); M.id.code(e, 0, id - prevId); prevId = id;
    const s = superclass[i]; M.sc.code(e, 0, s); M.cls.code(e, s, cls[i]); M.nt.code(e, s, nt[i]); M.side.code(e, s, side[i]);
    const has = Number.isFinite(soma[i * 3]) ? 1 : 0; e.bit(M.has, ph, has); ph = has;
    if (has) for (let k = 0; k < 3; k++) { M.soma.code(e, k, soma[i * 3 + k] - prev[k]); prev[k] = soma[i * 3 + k]; }
  }
  const body = e.finish(), out = new Uint8Array(12 + body.length);
  out.set(new Uint8Array(new Uint32Array([MAGIC, 1, N]).buffer)); out.set(body, 12);
  return out;
}

export function decodeNeurons(buf) {
  const u8 = new Uint8Array(buf), h = new Uint32Array(u8.slice(0, 12).buffer);
  if (h[0] !== MAGIC || h[1] !== 1) throw new Error('not a FLYN v1 file');
  const N = h[2], d = new Decoder(u8.subarray(12)), M = models();
  const bodyIds = new BigInt64Array(N), soma = new Float32Array(N * 3), cls = new Uint16Array(N), nt = new Uint8Array(N), superclass = new Uint8Array(N), side = new Uint8Array(N);
  let id = 0, ph = 1; const prev = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    id += M.id.dec(d, 0); bodyIds[i] = BigInt(id);
    const s = M.sc.dec(d, 0); superclass[i] = s; cls[i] = M.cls.dec(d, s); nt[i] = M.nt.dec(d, s); side[i] = M.side.dec(d, s);
    const has = d.bit(M.has, ph); ph = has;
    for (let k = 0; k < 3; k++) { if (has) prev[k] += M.soma.dec(d, k); soma[i * 3 + k] = has ? prev[k] : NaN; }
  }
  return { N, bodyIds, soma, cls, nt, superclass, side };
}
