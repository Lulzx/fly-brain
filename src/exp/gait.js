// The gait instrument (spec S8, docs/44-walking-compiler.md): walking observables from a foot-contact
// trace, with no knowledge of how the legs were driven.
//
// Every number here is defined so that it survives *not knowing the phase*: a stepping generator
// knows its own phase, a nerve cord does not, and doc 36 says the objective has to be over quantities
// that are measurable either way. The instrument is calibrated on the supplied tripod generator
// (scripts/gait_unit.mjs and the walk_cpg assay): if it does not read the fitted gait as walking, it
// is the instrument that is wrong, not the fly.
//
// Trace: { dtMs, legs: [6 names], touch: Uint8Array[n*6] (1 = claw on substrate), load: Float32Array[n*6],
//          z: Float32Array[n] thorax height (cm), up: Float32Array[n] body-up z component,
//          x, y: Float32Array[n] thorax position (cm), hx, hy: Float32Array[n] body heading (unit, world xy) }
// Legs are ordered T1_left, T2_left, T3_left, T1_right, T2_right, T3_right. The two tripods are
// {T1_left, T2_right, T3_left} and {T1_right, T2_left, T3_right}.

export const LEG_ORDER = ['T1_left', 'T2_left', 'T3_left', 'T1_right', 'T2_right', 'T3_right'];
const TRIPOD_A = new Set([0, 4, 2]), TRIPOD_B = new Set([3, 1, 5]);

// Real-fly bands, taken from the sibling registry (CONSTRAINT-REGISTRY.json) with the sources
// recorded there: cadence 5-16 Hz (Mendes et al. 2013 ceiling, DeAngelis et al. 2019), stance fraction
// 0.5-0.83 and contralateral anti-phase 0.35-0.65 (Mendes et al. 2013), swing 15-60 ms. These are the
// bands the classification below reads; they are not fitted here.
export const BANDS = {
  cadence: [5, 16], duty: [0.5, 0.83], contraPhase: [0.35, 0.65], swingMs: [15, 60], speed: [0.2, 4.5] /* cm/s */,
};

/** debounce a 0/1 sequence: runs shorter than minRun samples are absorbed into their neighbour */
export function debounce(seq, minRun) {
  const out = Uint8Array.from(seq);
  if (minRun <= 1 || !out.length) return out;
  let changed = true;
  while (changed) {
    changed = false;
    let i = 0;
    while (i < out.length) {
      let j = i; while (j < out.length && out[j] === out[i]) j++;
      const len = j - i;
      if (len < minRun && i > 0 && j < out.length) { out.fill(out[i - 1], i, j); changed = true; }
      i = j;
    }
  }
  return out;
}

/** swing onsets (stance -> swing transitions), in sample indices */
export function liftTimes(seq) {
  const t = [];
  for (let i = 1; i < seq.length; i++) if (seq[i - 1] === 1 && seq[i] === 0) t.push(i);
  return t;
}

/** phase of b's lifts inside a's step cycles: circular mean in [0,1) and resultant length R */
export function pairPhase(liftsA, liftsB) {
  let cx = 0, cy = 0, n = 0;
  for (let i = 0; i + 1 < liftsA.length; i++) {
    const t0 = liftsA[i], t1 = liftsA[i + 1], T = t1 - t0;
    for (const tb of liftsB) { if (tb < t0 || tb >= t1) continue; const ph = (tb - t0) / T; cx += Math.cos(2 * Math.PI * ph); cy += Math.sin(2 * Math.PI * ph); n++; }
  }
  if (!n) return { mean: null, R: 0, n: 0 };
  let mean = Math.atan2(cy, cx) / (2 * Math.PI); if (mean < 0) mean += 1;
  return { mean, R: Math.hypot(cx, cy) / n, n };
}

/** normalised vector strength of x at f (Hz): 1 for a pure sinusoid, ~0 for noise or a flat line */
export function vectorStrength(x, fHz, dtMs) {
  const n = x.length; if (!n || !(fHz > 0)) return 0;
  let m = 0; for (let i = 0; i < n; i++) m += x[i]; m /= n;
  let sd = 0; for (let i = 0; i < n; i++) sd += (x[i] - m) ** 2; sd = Math.sqrt(sd / n);
  if (sd < 1e-12) return 0;
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) { const w = 2 * Math.PI * fHz * i * dtMs / 1000; re += (x[i] - m) * Math.cos(w); im -= (x[i] - m) * Math.sin(w); }
  return Math.min(1, Math.hypot(re, im) / (n * sd) * Math.SQRT2);
}

const median = a => { const s = a.filter(v => v != null && !Number.isNaN(v)).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };

/** the observables. Every field is a number (or null when undefined, e.g. phase with no steps). */
export function gaitMetrics(tr, { minRunMs = 6, startMs = 0 } = {}) {
  const dt = tr.dtMs, n = tr.z.length, L = LEG_ORDER.length;
  const i0 = Math.min(n, Math.round(startMs / dt));
  const secs = (n - i0) * dt / 1000;
  const minRun = Math.max(1, Math.round(minRunMs / dt));
  const seqs = [], lifts = [], cadence = [], duty = [], swingMs = [];
  for (let l = 0; l < L; l++) {
    const raw = new Uint8Array(n - i0); for (let i = i0; i < n; i++) raw[i - i0] = tr.touch[i * L + l] ? 1 : 0;
    const s = debounce(raw, minRun); seqs.push(s);
    const lt = liftTimes(s); lifts.push(lt);
    cadence.push(lt.length / secs);
    let stance = 0; for (let i = 0; i < s.length; i++) stance += s[i];
    duty.push(s.length ? stance / s.length : null);
    // swing durations: from each lift to the next touchdown
    const sw = []; for (const t of lt) { let j = t; while (j < s.length && s[j] === 0) j++; if (j < s.length) sw.push((j - t) * dt); }
    swingMs.push(median(sw));
  }
  const stepping = l => lifts[l].length >= 2;
  // contralateral phase: right leg's lifts inside the left leg's cycles, per segment, pooled circularly
  const contra = [0, 1, 2].map(seg => pairPhase(lifts[seg], lifts[seg + 3]));
  const pool = ps => { let cx = 0, cy = 0, n = 0; for (const p of ps) { if (!p.n) continue; cx += p.R * p.n * Math.cos(2 * Math.PI * p.mean); cy += p.R * p.n * Math.sin(2 * Math.PI * p.mean); n += p.n; }
    if (!n) return { mean: null, R: 0, n: 0 }; let mean = Math.atan2(cy, cx) / (2 * Math.PI); if (mean < 0) mean += 1; return { mean, R: Math.hypot(cx, cy) / n, n }; };
  const contraPooled = pool(contra);
  // tripod index: within-tripod pairs should be in phase (cos = +1), cross-tripod pairs in antiphase
  // (cos = -1). tripod = (mean cos within - mean cos across) / 2, so a clean tripod reads 1, a
  // metachronal wave or random phases read near 0, an in-phase hop reads 0 as well (both means +1).
  const cosOf = (a, b) => { const p = pairPhase(lifts[a], lifts[b]); return p.n ? p.R * Math.cos(2 * Math.PI * p.mean) : null; };
  const within = [], across = [];
  for (let a = 0; a < L; a++) for (let b = a + 1; b < L; b++) {
    const c = cosOf(a, b); if (c == null) continue;
    ((TRIPOD_A.has(a) && TRIPOD_A.has(b)) || (TRIPOD_B.has(a) && TRIPOD_B.has(b)) ? within : across).push(c);
  }
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const tripod = within.length && across.length ? (mean(within) - mean(across)) / 2 : null;
  // posture and body
  let upN = 0, sup = 0; const zs = [];
  for (let i = i0; i < n; i++) { if (tr.up[i] > 0.5) upN++; zs.push(tr.z[i]); let down = 0; for (let l = 0; l < L; l++) down += tr.touch[i * L + l] ? 1 : 0; if (down >= 3) sup++; }
  // reference height: the first 50 ms of the whole trace, before any scoring window, when the fly
  // is still at its spawned standing posture -- a fly already down at the window's start must not
  // become its own reference
  const z0 = median(Array.from(tr.z.subarray(0, Math.max(1, Math.round(50 / dt)))));
  const dx = tr.x[n - 1] - tr.x[i0], dy = tr.y[n - 1] - tr.y[i0];
  let path = 0; for (let i = i0 + 1; i < n; i++) path += Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]);
  // signed fore-aft travel: each step's displacement projected on the heading at that moment, so a
  // backward-walking fly reads negative even if it turns (the MDN read; Bidaye et al. 2014)
  let fore = 0, backN = 0, moveN = 0;
  if (tr.hx) for (let i = i0 + 1; i < n; i++) { const p = (tr.x[i] - tr.x[i - 1]) * tr.hx[i] + (tr.y[i] - tr.y[i - 1]) * tr.hy[i]; fore += p;
    if (Math.abs(p) > 1e-5) { moveN++; if (p < 0) backN++; } }
  // rhythm: each leg's load vector strength at that leg's own lift rate (why_not_walking's phase
  // instrument): a leg that is quiet and a leg that is incoherent both read low on raw amplitude;
  // this separates them. A leg with fewer than two lifts has no rate and reads 0.
  const cadMed = median(cadence.filter((_, l) => stepping(l)));
  const loadRhythm = [];
  for (let l = 0; l < L; l++) { const x = new Float32Array(n - i0); for (let i = i0; i < n; i++) x[i - i0] = tr.load[i * L + l]; loadRhythm.push(stepping(l) ? vectorStrength(x, cadence[l], dt) : 0); }
  const liftCounts = lifts.map(t => t.length);
  return {
    secs, cadence: cadMed ?? 0, cadenceLegs: cadence.map(v => +v.toFixed(3)),
    duty: median(duty.filter((_, l) => stepping(l))), dutyLegs: duty.map(v => v == null ? null : +v.toFixed(3)),
    swingMs: median(swingMs), contraPhase: contraPooled.mean, contraR: +contraPooled.R.toFixed(3), contraN: contraPooled.n,
    tripod: tripod == null ? null : +tripod.toFixed(3), legsStepping: liftCounts.filter(c => c >= 3).length, minLifts: Math.min(...liftCounts), lifts: liftCounts,
    upright: upN / Math.max(1, n - i0), support: sup / Math.max(1, n - i0),
    bodyHeight: median(zs), bodyHeightRel: z0 ? median(zs) / z0 : null,
    speed: Math.hypot(dx, dy) / secs, path: path / secs,
    forward: tr.hx ? fore / secs : null, backFrac: tr.hx ? (moveN ? backN / moveN : 0) : null, displacement: Math.hypot(dx, dy),
    loadRhythm: median(loadRhythm), loadRhythmLegs: loadRhythm.map(v => +v.toFixed(3)),
  };
}

/** outcome class per observable, read against BANDS; anything else falls through to the caller */
export function classifyGait(id, v) {
  if (v == null || Number.isNaN(v)) return 'undefined';
  const band = BANDS[id]; if (band) return v < band[0] ? (id === 'cadence' && v < 1 ? 'none' : 'below') : v > band[1] ? 'above' : 'band';
  switch (id) {
    case 'upright': case 'support': return v > 0.9 ? 'up' : v > 0.5 ? 'unsteady' : 'fallen';
    case 'tripod': return v > 0.5 ? 'tripod' : v > 0.15 ? 'weak' : 'none';
    case 'legsStepping': return v >= 6 ? 'all' : v >= 3 ? 'some' : 'none';
    case 'loadRhythm': return v > 0.5 ? 'rhythmic' : v > 0.2 ? 'weak' : 'none';
    case 'bodyHeightRel': return v > 0.9 ? 'held' : v > 0.6 ? 'sagging' : 'collapsed';
  }
  return null;
}
