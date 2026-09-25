import assert from 'node:assert/strict';
import { fftPow, inPhase } from '../src/exp/spectrum.js';

// Compare every Fourier bin with a direct DFT, including Hann windowing and
// zero padding. This catches a missing or incorrect bit-reversal permutation.
const x = [3, -2, 5, 7, 1, -4, 2, 6, 0, -1, 4, 8, -3];
const { p } = fftPow(x);
const n = p.length * 2, mean = x.reduce((a, v) => a + v, 0) / x.length;
for (let k = 1; k < p.length; k++) {
  let re = 0, im = 0;
  for (let t = 0; t < x.length; t++) {
    const v = (x[t] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / (x.length - 1)));
    re += v * Math.cos(2 * Math.PI * k * t / n);
    im -= v * Math.sin(2 * Math.PI * k * t / n);
  }
  assert.ok(Math.abs(p[k] - re * re - im * im) < 1e-9, `DFT bin ${k}`);
}

const steps = 512, f = 7.8125;
const wave = Array.from({ length: steps }, (_, i) => Math.sin(2 * Math.PI * f * i / 1000));
const pos = inPhase(wave, wave);
assert.equal(pos.peakHz, 7.81);
assert.equal(pos.inPhase, 1);
assert.equal(pos.inPhaseBand, 1);
const neg = inPhase(wave, wave.map(v => -v));
assert.equal(neg.peakHz, 7.81);
assert.equal(neg.inPhase, 0);
assert.equal(neg.inPhaseBand, 0);
console.log('spectrum: DFT bins, in-phase and anti-phase checks pass');
