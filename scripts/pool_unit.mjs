// Instrument test for src/exp/pools.js: synthetic pool rate traces with known answers.
//
//   node scripts/pool_unit.mjs
//
// The same cases doc 44's contact instrument is held to (scripts/gait_unit.mjs), moved to the
// motor pools' firing rates. A tripod at 10 Hz must read cadence 10, duty 0.6, contralateral
// phase 0.5 and tripod 1. An in-phase hop must read tripod 0 and phase 0. A metachronal wave
// must read tripod below 0.3. A tonic pool and a silent pool must both read no rhythm, and
// must be told apart by their mean rate. One-bin rate flickers must not count as steps.
// If any of these fail, the instrument is wrong before any nerve cord is.
import { poolMetrics, binarise, bestPeriodicity, traceFromCounts, LEG_ORDER, MIN_MOD_HZ } from '../src/exp/pools.js';

const dt = 2, secs = 3, n = secs * 1000 / dt, L = LEG_ORDER.length;
const TRIPOD_A = new Set(['T1_left', 'T2_right', 'T3_left']);
const HI = 120, LO = 5;   // a leg pool's burst and its floor, in Hz

function trace(fn) {
  const rate = new Float32Array(n * L);
  for (let i = 0; i < n; i++) for (let l = 0; l < L; l++) rate[i * L + l] = fn(i * dt / 1000, LEG_ORDER[l], i);
  return { dtMs: dt, pools: LEG_ORDER, rate };
}
const burst = (t, f, duty, phase) => (((t * f + phase) % 1) + 1) % 1 < duty ? HI : LO;

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' -> ' + JSON.stringify(got)}`); if (!ok) fails++; };
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

// 1. clean tripod, 10 Hz, 0.6 of the cycle bursting
{ const g = poolMetrics(trace((t, p) => burst(t, 10, 0.6, TRIPOD_A.has(p) ? 0 : 0.5)));
  check('tripod cadence 10 Hz', near(g.cadence, 10, 0.4), g.cadence);
  check('tripod duty 0.6', near(g.duty, 0.6, 0.03), g.duty);
  check('tripod contralateral phase 0.5', near(g.contraPhase, 0.5, 0.03) && g.contraR > 0.95, [g.contraPhase, g.contraR]);
  check('tripod index ~1', near(g.tripod, 1, 0.05), g.tripod);
  check('tripod swing 40 ms', near(g.swingMs, 40, 4), g.swingMs);
  check('tripod all six pools stepping', g.legsStepping === 6 && g.minLifts >= 25, [g.legsStepping, g.minLifts]);
  check('tripod rate rhythmic', g.rateRhythm > 0.5, g.rateRhythm);
  check('tripod six pools modulated', g.poolsModulated === 6, g.poolsModulated);
  check('tripod periodicity found at 10 Hz', near(g.bestF, 10, 0.3) && g.bestStrength > 0.5, [g.bestF, g.bestStrength]); }

// 2. tonic: every pool fires steadily. No rhythm, but a high mean rate.
{ const g = poolMetrics(trace(() => 60));
  check('tonic cadence 0', g.cadence === 0, g.cadence);
  check('tonic no phase', g.contraPhase == null && g.tripod == null, [g.contraPhase, g.tripod]);
  check('tonic no pool modulated', g.poolsModulated === 0, g.poolsModulated);
  check('tonic mean rate 60', near(g.meanHz, 60, 0.01), g.meanHz);
  check('tonic rhythm 0', g.rateRhythm === 0, g.rateRhythm);
  check('tonic no periodicity', g.bestStrength < 0.05, g.bestStrength); }

// 3. silent: the cord is quiet. Reads like the tonic case except for the mean.
{ const g = poolMetrics(trace(() => 0));
  check('silent cadence 0', g.cadence === 0, g.cadence);
  check('silent mean rate 0', g.meanHz === 0, g.meanHz);
  check('silent told apart from tonic', g.meanHz === 0, g.meanHz); }

// 4. in-phase hop: all six pools burst together
{ const g = poolMetrics(trace(t => burst(t, 8, 0.7, 0)));
  check('hop cadence 8', near(g.cadence, 8, 0.4), g.cadence);
  check('hop contralateral phase 0', (g.contraPhase < 0.03 || g.contraPhase > 0.97) && g.contraR > 0.95, [g.contraPhase, g.contraR]);
  check('hop tripod index 0', near(g.tripod, 0, 0.05), g.tripod); }

// 5. metachronal wave: each pool a sixth of a cycle later
{ const g = poolMetrics(trace((t, p) => burst(t, 10, 0.6, LEG_ORDER.indexOf(p) / 6)));
  check('wave tripod index low', g.tripod != null && g.tripod < 0.3, g.tripod);
  check('wave still cadence 10', near(g.cadence, 10, 0.4), g.cadence); }

// 6. chatter is not stepping: one-bin rate spikes on an otherwise tonic pool
{ const tr = trace(() => 40); for (let i = 50; i < n; i += 50) tr.rate[i * L + 2] = 200;
  const g = poolMetrics(tr); check('debounced flicker cadence 0', g.cadence === 0, g.cadence); }

// 7. one leg dropping out is visible in the count, not in the median
{ const g = poolMetrics(trace((t, p, i) => p === 'T3_right' ? 40 : burst(t, 10, 0.6, TRIPOD_A.has(p) ? 0 : 0.5)));
  check('five pools stepping', g.legsStepping === 5, g.legsStepping);
  check('quiet pool has no lifts', g.lifts[5] === 0, g.lifts);
  check('cadence still 10', near(g.cadence, 10, 0.4), g.cadence); }

// 8. the threshold is the trace's own, and a shallow swing is not a rhythm
{ const b = binarise(Float32Array.from([10, 10, 10, 90, 90, 90]));
  check('threshold halfway between the levels', near(b.thr, 50, 12), b.thr);
  const flat = binarise(Float32Array.from([10, 10.5, 10, 10.5]));
  check('shallow swing is unmodulated', [...flat.seq].every(v => v === 0) && flat.depth < MIN_MOD_HZ, [flat.depth]); }

// 8b. Poisson counting noise is not a rhythm: the sweep must not find one in it
{ let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const x = new Float32Array(1500); for (let i = 0; i < x.length; i++) { let k = 0; for (let j = 0; j < 12; j++) if (rnd() < 0.5) k++; x[i] = k * 500; }
  const b = bestPeriodicity(x, 2);
  check('counting noise has no periodicity', b.strength < 0.2, b); }

// 9. counts to rates: 3 spikes in a 0.5 ms step is 6000 Hz; binning averages
{ const counts = new Uint16Array(4 * L); counts[0] = 3; counts[L] = 1;
  const tr = traceFromCounts(counts, 4, 0.5, 1);
  check('counts to rate', tr.rate[0] === 6000 && tr.rate[L] === 2000, [tr.rate[0], tr.rate[L]]);
  const tb = traceFromCounts(counts, 4, 0.5, 2);
  check('binned counts to rate', tb.rate[0] === 4000 && tb.dtMs === 1, [tb.rate[0], tb.dtMs]); }

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
