// Adaptive binary range coder (LZMA-style carry-less encoder, 12-bit probabilities) plus the integer
// model every fly-brain codec is built on. Encoder and decoder share the model code, so each format is
// written once as a `code(io, ...)` routine that either encodes or decodes depending on `io`.
const TOP = 2 ** 24, PBITS = 12, PONE = 1 << PBITS, MOVE = 5;

export class Encoder {
  constructor(cap = 1 << 20) { this.buf = new Uint8Array(cap); this.n = 0; this.low = 0; this.range = 0xFFFFFFFF; this.cache = 0; this.cacheSize = 1; }
  byte(b) { if (this.n === this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; } this.buf[this.n++] = b; }
  shiftLow() {
    if (this.low < 0xFF000000 || this.low >= 2 ** 32) {
      const carry = this.low >= 2 ** 32 ? 1 : 0; let t = this.cache;
      do { this.byte((t + carry) & 0xFF); t = 0xFF; } while (--this.cacheSize !== 0);
      this.cache = Math.floor(this.low / TOP) & 0xFF;
    }
    this.cacheSize++; this.low = (this.low % TOP) * 256;
  }
  bit(p, i, b) {
    const pr = p[i], bound = (this.range >>> PBITS) * pr;
    if (b === 0) { this.range = bound; p[i] = pr + ((PONE - pr) >> MOVE); }
    else { this.low += bound; this.range -= bound; p[i] = pr - (pr >> MOVE); }
    while (this.range < TOP) { this.range = (this.range * 256) >>> 0; this.shiftLow(); }
    return b;
  }
  direct(v, nbits) {   // equiprobable bits, up to 16 at a time: the range is split into 2^n equal parts
    while (nbits > 0) {
      const n = Math.min(nbits, 16); nbits -= n;
      this.range = this.range >>> n; this.low += Math.floor(v / 2 ** nbits) % (1 << n) * this.range;
      while (this.range < TOP) { this.range = (this.range * 256) >>> 0; this.shiftLow(); }
    }
    return v;
  }
  finish() { for (let i = 0; i < 5; i++) this.shiftLow(); return this.buf.subarray(0, this.n); }
}

// The decoder keeps range/code as int32 bit patterns (Math.imul, xor-biased unsigned compares) so V8 stays
// on int32 arithmetic; values >= 2^31 held as plain numbers fall back to doubles and run ~2x slower.
const MIN = 0x80000000 | 0;
export class Decoder {
  constructor(bytes, pos = 0) {
    this.b = bytes; this.s = new Int32Array(3); this.s[0] = -1; this.s[2] = pos;
    let code = 0; for (let i = 0; i < 5; i++) code = (code << 8) | this.next(); this.s[1] = code;
  }
  next() { const p = this.s[2]; this.s[2] = p + 1; return p < this.b.length ? this.b[p] : 0; }
  bit(p, i) {
    const s = this.s; let range = s[0], code = s[1], b;
    const pr = p[i], bound = Math.imul(range >>> PBITS, pr);
    if ((code ^ MIN) < (bound ^ MIN)) { range = bound; p[i] = pr + ((PONE - pr) >> MOVE); b = 0; }
    else { code = (code - bound) | 0; range = (range - bound) | 0; p[i] = pr - (pr >> MOVE); b = 1; }
    if ((range >>> 24) === 0) { const buf = this.b; let pos = s[2]; do { range <<= 8; code = (code << 8) | (pos < buf.length ? buf[pos++] : 0); } while ((range >>> 24) === 0); s[2] = pos; }
    s[0] = range; s[1] = code; return b;
  }
  direct(_, nbits) {
    const s = this.s, buf = this.b; let range = s[0], code = s[1], pos = s[2], v = 0;
    while (nbits > 0) {
      const n = nbits < 16 ? nbits : 16; nbits -= n;
      range = range >>> n; const x = ((code >>> 0) / range) | 0;
      code = (code - Math.imul(x, range)) | 0; v = v * (1 << n) + x;
      while ((range >>> 24) === 0) { range <<= 8; code = (code << 8) | (pos < buf.length ? buf[pos++] : 0); }
    }
    s[0] = range; s[1] = code; s[2] = pos; return v;
  }
}

export const probs = (n) => new Uint16Array(n).fill(PONE >> 1);

/** Adaptive Elias-gamma integer model: v >= 0 is coded as the bit length k of v+1 (a 5-bit tree per
 *  context) followed by the bits below the leading one, the top two of which are also context-modelled.
 *  `io.bit(p, i, b)` returns b when encoding and the decoded bit when decoding, so one routine does both. */
export class UInt {
  constructor(nctx) { this.k = probs(nctx * 32); this.m = probs(nctx * 32 * 4); }
  code(io, ctx, v = 0) {
    const n = v + 1, kk = 31 - Math.clz32(n), kp = this.k, base = ctx * 32;
    let t = 1;
    for (let i = 4; i >= 0; i--) t = (t << 1) | io.bit(kp, base + t, (kk >> i) & 1);
    const k = t - 32;
    if (k === 0) return 0;
    const mp = this.m, mb = (base + k) * 4;
    let r = 1;
    const b1 = io.bit(mp, mb + 1, (n >>> (k - 1)) & 1); r = (r << 1) | b1;
    if (k >= 2) { r = (r << 1) | io.bit(mp, mb + 2 + b1, (n >>> (k - 2)) & 1); }
    if (k >= 3) { const rest = k - 2; r = r * 2 ** rest + io.direct(n & ((1 << rest) - 1), rest); }
    return r - 1;
  }
}
// Decoder-only fast path of UInt.code: same bitstream, coder state in locals, bits inlined.
UInt.prototype.dec = function (d, ctx) {
  const st = d.s, buf = d.b, len = buf.length, kp = this.k, base = ctx * 32;
  let range = st[0], code = st[1], pos = st[2], t = 1;
  for (let i = 0; i < 5; i++) {
    const j = base + t, pr = kp[j], bound = Math.imul(range >>> PBITS, pr);
    if ((code ^ MIN) < (bound ^ MIN)) { range = bound; kp[j] = pr + ((PONE - pr) >> MOVE); t <<= 1; }
    else { code = (code - bound) | 0; range = (range - bound) | 0; kp[j] = pr - (pr >> MOVE); t = (t << 1) | 1; }
    while ((range >>> 24) === 0) { range <<= 8; code = (code << 8) | (pos < len ? buf[pos++] : 0); }
  }
  const k = t - 32;
  let r = 1;
  if (k > 0) {
    const mp = this.m, mb = (base + k) * 4;
    for (let s = 0; s < 2 && s < k; s++) {
      const j = mb + (s === 0 ? 1 : 2 + (r & 1)), pr = mp[j], bound = Math.imul(range >>> PBITS, pr);
      if ((code ^ MIN) < (bound ^ MIN)) { range = bound; mp[j] = pr + ((PONE - pr) >> MOVE); r <<= 1; }
      else { code = (code - bound) | 0; range = (range - bound) | 0; mp[j] = pr - (pr >> MOVE); r = (r << 1) | 1; }
      while ((range >>> 24) === 0) { range <<= 8; code = (code << 8) | (pos < len ? buf[pos++] : 0); }
    }
    if (k >= 3) {
      let nbits = k - 2;
      while (nbits > 0) {
        const n = nbits < 16 ? nbits : 16; nbits -= n;
        range = range >>> n; const x = ((code >>> 0) / range) | 0;
        code = (code - Math.imul(x, range)) | 0; r = r * (1 << n) + x;
        while ((range >>> 24) === 0) { range <<= 8; code = (code << 8) | (pos < len ? buf[pos++] : 0); }
      }
    }
  }
  st[0] = range; st[1] = code; st[2] = pos;
  return r - 1;
};

/** signed wrapper (zigzag) */
export class SInt extends UInt {
  code(io, ctx, v = 0) { const z = super.code(io, ctx, v >= 0 ? v * 2 : -v * 2 - 1); return z & 1 ? -(z + 1) / 2 : z / 2; }
  dec(d, ctx) { const z = super.dec(d, ctx); return z & 1 ? -(z + 1) / 2 : z / 2; }
}
/** bit length bucket, the usual context for magnitudes */
export const lg = (x) => 31 - Math.clz32(x + 1);
