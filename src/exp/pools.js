// The gait instrument over motor-pool spike trains, with no body (docs/46-cord-ir.md).
//
// Doc 44's instrument reads six claw contacts. This one reads the six leg motor pools' firing
// rates instead, so a rhythm can be measured before the body has a chance to fall — the
// "circuit site" doc 44 ends by asking for. Every field is defined the same way and survives
// not knowing the phase; the only new step is turning a rate into an on/off sequence.
//
// The threshold is the pool's own half-way point between its 10th and 90th percentile, so it
// is a property of the trace rather than a number anyone chose, and a pool whose rate barely
// moves is called unmodulated rather than being thresholded into noise. A tonically firing
// pool and a silent pool both read as no rhythm, which is the honest reading: neither is
// stepping. `meanHz` and `modDepth` are reported beside the gait fields so the two can be told
// apart.
//
// Trace: { dtMs, pools: [6 names], rate: Float32Array[n*6] } in the order of LEG_ORDER.
import { LEG_ORDER, BANDS, debounce, liftTimes, pairPhase, vectorStrength, classifyGait } from './gait.js';

export { LEG_ORDER, BANDS, classifyGait };
const TRIPOD_A = new Set([0, 4, 2]), TRIPOD_B = new Set([3, 1, 5]);

/** the minimum peak-to-trough rate swing, in Hz, for a pool to count as modulated */
export const MIN_MOD_HZ = 2;

const median = a => { const s = a.filter(v => v != null && !Number.isNaN(v)).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };
const pct = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] : 0;

/** on/off sequence for one pool's rate trace, plus the threshold and depth that produced it */
export function binarise(x, minModHz = MIN_MOD_HZ) {
  const sorted = Float64Array.from(x).sort();
  const lo = pct(sorted, 0.1), hi = pct(sorted, 0.9);
  const depth = hi - lo, thr = (lo + hi) / 2;
  const seq = new Uint8Array(x.length);
  if (depth >= minModHz) for (let i = 0; i < x.length; i++) seq[i] = x[i] > thr ? 1 : 0;
  return { seq, thr, depth };
}

/** the strongest periodicity in a rate trace between loHz and hiHz, and where it sits.
 *  Threshold-free and phase-free: a rate that oscillates anywhere in the band shows up here
 *  whether or not it crosses any particular level, and Poisson counting noise does not. */
export function bestPeriodicity(x, dtMs, loHz = 1, hiHz = 20, stepHz = 0.25) {
  let bf = 0, bs = 0;
  for (let f = loHz; f <= hiHz + 1e-9; f += stepHz) { const v = vectorStrength(x, f, dtMs); if (v > bs) { bs = v; bf = f; } }
  return { f: bf, strength: bs };
}

/** the observables. Field names match src/exp/gait.js wherever the definition is the same. */
export function poolMetrics(tr, { minRunMs = 6, startMs = 0, minModHz = MIN_MOD_HZ } = {}) {
  const dt = tr.dtMs, L = LEG_ORDER.length, n = tr.rate.length / L;
  const i0 = Math.min(n, Math.round(startMs / dt));
  const secs = (n - i0) * dt / 1000;
  const minRun = Math.max(1, Math.round(minRunMs / dt));
  const seqs = [], lifts = [], cadence = [], duty = [], swingMs = [], meanHz = [], modDepth = [], rateRhythm = [];
  const raws = [];
  for (let l = 0; l < L; l++) {
    const x = new Float32Array(n - i0);
    for (let i = i0; i < n; i++) x[i - i0] = tr.rate[i * L + l];
    raws.push(x);
    let m = 0; for (const v of x) m += v; meanHz.push(x.length ? m / x.length : 0);
    const { seq, depth } = binarise(x, minModHz);
    modDepth.push(depth);
    const s = debounce(seq, minRun); seqs.push(s);
    const lt = liftTimes(s); lifts.push(lt);
    cadence.push(lt.length / secs);
    let on = 0; for (let i = 0; i < s.length; i++) on += s[i];
    duty.push(s.length ? on / s.length : null);
    const sw = []; for (const t of lt) { let j = t; while (j < s.length && s[j] === 0) j++; if (j < s.length) sw.push((j - t) * dt); }
    swingMs.push(median(sw));
  }
  const stepping = l => lifts[l].length >= 2;
  for (let l = 0; l < L; l++) rateRhythm.push(stepping(l) ? vectorStrength(raws[l], cadence[l], dt) : 0);
  const best = raws.map(x => bestPeriodicity(x, dt));

  const contra = [0, 1, 2].map(seg => pairPhase(lifts[seg], lifts[seg + 3]));
  const pool = ps => { let cx = 0, cy = 0, k = 0; for (const p of ps) { if (!p.n) continue; cx += p.R * p.n * Math.cos(2 * Math.PI * p.mean); cy += p.R * p.n * Math.sin(2 * Math.PI * p.mean); k += p.n; }
    if (!k) return { mean: null, R: 0, n: 0 }; let mean = Math.atan2(cy, cx) / (2 * Math.PI); if (mean < 0) mean += 1; return { mean, R: Math.hypot(cx, cy) / k, n: k }; };
  const contraPooled = pool(contra);
  const cosOf = (a, b) => { const p = pairPhase(lifts[a], lifts[b]); return p.n ? p.R * Math.cos(2 * Math.PI * p.mean) : null; };
  const within = [], across = [];
  for (let a = 0; a < L; a++) for (let b = a + 1; b < L; b++) {
    const c = cosOf(a, b); if (c == null) continue;
    ((TRIPOD_A.has(a) && TRIPOD_A.has(b)) || (TRIPOD_B.has(a) && TRIPOD_B.has(b)) ? within : across).push(c);
  }
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const tripod = within.length && across.length ? (mean(within) - mean(across)) / 2 : null;
  const liftCounts = lifts.map(t => t.length);
  const cadMed = median(cadence.filter((_, l) => stepping(l)));
  return {
    secs, cadence: cadMed ?? 0, cadenceLegs: cadence.map(v => +v.toFixed(3)),
    duty: median(duty.filter((_, l) => stepping(l))), dutyLegs: duty.map(v => v == null ? null : +v.toFixed(3)),
    swingMs: median(swingMs),
    contraPhase: contraPooled.mean, contraR: +contraPooled.R.toFixed(3), contraN: contraPooled.n,
    tripod: tripod == null ? null : +tripod.toFixed(3),
    legsStepping: liftCounts.filter(c => c >= 3).length, minLifts: Math.min(...liftCounts), lifts: liftCounts,
    rateRhythm: median(rateRhythm), rateRhythmLegs: rateRhythm.map(v => +v.toFixed(3)),
    meanHz: median(meanHz), meanHzLegs: meanHz.map(v => +v.toFixed(2)),
    modDepth: median(modDepth), modDepthLegs: modDepth.map(v => +v.toFixed(2)),
    poolsModulated: modDepth.filter(d => d >= minModHz).length,
    bestStrength: median(best.map(b => b.strength)), bestF: median(best.map(b => b.f)),
    bestStrengthLegs: best.map(b => +b.strength.toFixed(3)), bestFLegs: best.map(b => +b.f.toFixed(2)),
  };
}

/** build a trace from per-step per-pool spike counts (the shape cordens.bend writes) */
export function traceFromCounts(counts, steps, dtMs, binSteps = 1) {
  const L = LEG_ORDER.length, n = Math.floor(steps / binSteps);
  const rate = new Float32Array(n * L), perSec = 1000 / (dtMs * binSteps);
  for (let b = 0; b < n; b++) for (let l = 0; l < L; l++) {
    let c = 0; for (let k = 0; k < binSteps; k++) c += counts[(b * binSteps + k) * L + l];
    rate[b * L + l] = c * perSec;
  }
  return { dtMs: dtMs * binSteps, pools: LEG_ORDER, rate };
}
