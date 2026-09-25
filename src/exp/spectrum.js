// Bilateral phase readout for 1 ms spike-count traces. The radix-2 FFT uses
// bit-reversed input, then the usual increasing-size butterflies.
export function fftPow(x) {
  if (!x.length) throw new Error('empty spectrum');
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  const mean = x.reduce((a, v) => a + v, 0) / x.length;
  for (let i = 0; i < x.length; i++)
    re[i] = (x[i] - mean) * (x.length === 1 ? 1 : 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (x.length - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let s = 2; s <= n; s <<= 1) {
    const h = s >> 1, wr = Math.cos(-2 * Math.PI / s), wi = Math.sin(-2 * Math.PI / s);
    for (let k = 0; k < n; k += s) {
      let ar = 1, ai = 0;
      for (let j = 0; j < h; j++) {
        const tr = re[k + j + h] * ar - im[k + j + h] * ai;
        const ti = re[k + j + h] * ai + im[k + j + h] * ar;
        re[k + j + h] = re[k + j] - tr;
        im[k + j + h] = im[k + j] - ti;
        re[k + j] += tr;
        im[k + j] += ti;
        const t = ar * wr - ai * wi;
        ai = ar * wi + ai * wr;
        ar = t;
      }
    }
  }
  const p = new Float64Array(n >> 1);
  for (let k = 1; k < p.length; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return { p, df: 1000 / n };
}

export function inPhase(xL, xR, band = [2, 20]) {
  if (xL.length !== xR.length) throw new Error('unequal trace lengths');
  const { p: plus, df } = fftPow(xL.map((v, i) => v + xR[i]));
  const { p: minus } = fftPow(xL.map((v, i) => v - xR[i]));
  const lo = Math.ceil(band[0] / df), hi = Math.min(plus.length - 1, Math.floor(band[1] / df));
  if (hi < lo) throw new Error('trace too short for phase band');
  let peak = lo, bp = 0, bm = 0;
  for (let k = lo; k <= hi; k++) {
    if (plus[k] + minus[k] > plus[peak] + minus[peak]) peak = k;
    bp += plus[k]; bm += minus[k];
  }
  return {
    peakHz: +(peak * df).toFixed(2),
    inPhase: +(plus[peak] / (plus[peak] + minus[peak] || 1)).toFixed(3),
    inPhaseBand: +(bp / (bp + bm || 1)).toFixed(3),
    peakPower: plus[peak] + minus[peak],
  };
}
