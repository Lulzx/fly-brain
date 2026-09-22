// Instrument test for src/exp/gait.js: synthetic traces with known answers. No MuJoCo.
//
//   node scripts/gait_unit.mjs
//
// A tripod at 10 Hz with a 0.6 stance fraction must read cadence 10, duty 0.6, contralateral phase
// 0.5, tripod 1. A standing fly must read cadence 0 and no phase. An in-phase hop (all six legs
// together) must read tripod 0 with contralateral phase 0. A fly that is quiet on the load channel
// must not read as rhythmic. If any of these fail, the instrument is wrong before any fly is.
import { gaitMetrics, LEG_ORDER, debounce, vectorStrength } from '../src/exp/gait.js';

const dt = 2, secs = 3, n = secs * 1000 / dt, L = LEG_ORDER.length;
const TRIPOD_A = new Set(['T1_left', 'T2_right', 'T3_left']);
function trace(fn) {
  const touch = new Uint8Array(n * L), load = new Float32Array(n * L), z = new Float32Array(n).fill(0.13), up = new Float32Array(n).fill(1), x = new Float32Array(n), y = new Float32Array(n);
  for (let i = 0; i < n; i++) { x[i] = 0.0005 * i; for (let l = 0; l < L; l++) { const s = fn(i * dt / 1000, LEG_ORDER[l]); touch[i * L + l] = s > 0 ? 1 : 0; load[i * L + l] = s > 0 ? 1 + 0.2 * Math.sin(2 * Math.PI * 10 * i * dt / 1000) : 0; } }
  return { dtMs: dt, legs: LEG_ORDER, touch, load, z, up, x, y };
}
const inStance = (t, f, duty, phase) => (((t * f + phase) % 1) + 1) % 1 < duty ? 1 : 0;

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' -> ' + JSON.stringify(got)}`); if (!ok) fails++; };
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

// 1. clean tripod, 10 Hz, duty 0.6
{ const g = gaitMetrics(trace((t, leg) => inStance(t, 10, 0.6, TRIPOD_A.has(leg) ? 0 : 0.5)));
  check('tripod cadence 10 Hz', near(g.cadence, 10, 0.4), g.cadence);
  check('tripod duty 0.6', near(g.duty, 0.6, 0.03), g.duty);
  check('tripod contralateral phase 0.5', near(g.contraPhase, 0.5, 0.03) && g.contraR > 0.95, [g.contraPhase, g.contraR]);
  check('tripod index ~1', near(g.tripod, 1, 0.05), g.tripod);
  check('tripod swing 40 ms', near(g.swingMs, 40, 4), g.swingMs);
  check('tripod all legs stepping', g.legsStepping === 6 && g.minLifts >= 25, [g.legsStepping, g.minLifts]);
  check('tripod load rhythmic', g.loadRhythm > 0.5, g.loadRhythm);
  check('tripod speed 0.25 cm/s', near(g.speed, 0.25, 0.01), g.speed); }
// 2. standing
{ const g = gaitMetrics(trace(() => 1));
  check('standing cadence 0', g.cadence === 0, g.cadence);
  check('standing no phase', g.contraPhase == null && g.tripod == null, [g.contraPhase, g.tripod]);
  check('standing support 1', g.support === 1 && g.upright === 1, [g.support, g.upright]); }
// 3. in-phase hop: every leg lifts together
{ const g = gaitMetrics(trace(t => inStance(t, 8, 0.7, 0)));
  check('hop cadence 8', near(g.cadence, 8, 0.4), g.cadence);
  check('hop contralateral phase 0', (g.contraPhase < 0.03 || g.contraPhase > 0.97) && g.contraR > 0.95, [g.contraPhase, g.contraR]);
  check('hop tripod index 0', near(g.tripod, 0, 0.05), g.tripod); }
// 4. fallen: body up flips
{ const tr = trace((t, leg) => inStance(t, 10, 0.6, TRIPOD_A.has(leg) ? 0 : 0.5)); tr.up.fill(-0.8, n >> 1);
  const g = gaitMetrics(tr); check('fallen upright 0.5', near(g.upright, 0.5, 0.01), g.upright); }
// 5. chatter is not stepping: 1-sample flickers on a standing leg
{ const tr = trace(() => 1); for (let i = 100; i < n; i += 50) tr.touch[i * L + 2] = 0;
  const g = gaitMetrics(tr); check('debounced flicker cadence 0', g.cadence === 0, g.cadence); }
// 6. metachronal wave (each leg 1/6 later): tripod near 0, phases defined
{ const g = gaitMetrics(trace((t, leg) => inStance(t, 10, 0.6, LEG_ORDER.indexOf(leg) / 6)));
  check('wave tripod index low', g.tripod != null && g.tripod < 0.3, g.tripod); }
// 7. vector strength sanity
{ const x = new Float32Array(1500); for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * 10 * i * 0.002);
  check('vector strength sinusoid 1', near(vectorStrength(x, 10, 2), 1, 0.02), vectorStrength(x, 10, 2));
  check('vector strength flat 0', vectorStrength(new Float32Array(100).fill(3), 10, 2) === 0, null);
  check('debounce absorbs short runs', [...debounce([1, 1, 1, 0, 1, 1, 1], 2)].join('') === '1111111', null); }

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
