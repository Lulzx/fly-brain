// What do the wing motor neurons do while the fly flies? (docs/24-flight.md, roadmap flight item)
//
// The flight controller is an engineered approximation: a velocity/height loop picks stroke amplitude and
// a haltere-like loop supplies attitude torque. The roadmap's next step was to drive the stroke from the
// wing power and steering motor neurons instead — and those motor neurons turn out to be annotated in
// this release, both sets:
//
//   power     DLMn a,b / DLMn c-f / DVMn 1a-c / DVMn 2a,b / DVMn 3a,b   (asynchronous, set flight power)
//   steering  b1 b2 b3 / i1 i2 / iii1 iii3 / hg1-hg4 / ps1 / tp1 tp2    (synchronous, one spike a cycle)
//
// Before wiring them into the controller, this script measures whether they carry anything: it flies the
// fly headless, records each pool's rate per side through takeoff, cruise and turns, and reports the
// left-right asymmetry a steering readout would see. A pool that never fires, or one whose asymmetry is
// uncorrelated with the commanded turn, cannot drive a stroke however it is wired in.
//
//   node scripts/wing_mn.mjs [seconds] [seed]       # writes public/data/wing_mn.json
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';

const SECS = +(process.argv[2] || 6), SEED = +(process.argv[3] || 7);

// The pool definitions now live in scripts/motor_pools.mjs, so M1, M5 and M6 read one list. Re-exported
// here because this script's name is the one the docs cite.
export { WING_POOLS } from './motor_pools.mjs';
import { WING_POOLS, FLIGHT_DN } from './motor_pools.mjs';

const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const gait = JSON.parse(fs.readFileSync('public/body/gait.json'));
const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const mj = await loadMujoco();
const env = structuredClone(DEFAULT_ENV);
const calib = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const fb = fs.readFileSync('public/vision/flyvis.bin');
const vision = { model: parseFlyVis(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength),
  JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))),
  map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
const mem = allocBrainMemory(data, size, sign, calib, 1, vision);
const brain = await attachBrain(fs.readFileSync('public/lif.wasm'), mem, 0, data, SEED);
const flyvis = { eyes: attachEyes(brain.instance, mem, 0), map: vision.map, gain: 150 };
const fly = new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, pos: [0, 0], yaw: 0,
  mode: 'descending', brainOpts: calib, neuromod: loadNeuromod(), vision: true, brain, flyvis, seed: SEED });

// index the pools by side (1 = left, 2 = right)
const types = D.meta.types, side = D.side;
const ix = {};
for (const [pool, names] of Object.entries(WING_POOLS)) {
  ix[pool] = { L: [], R: [], all: [] };
  for (let i = 0; i < D.N; i++) {
    if (!names.includes(String(types[i]))) continue;
    ix[pool].all.push(i);
    if (side[i] === 1) ix[pool].L.push(i); else if (side[i] === 2) ix[pool].R.push(i);
  }
}
// The descending candidates for a flight command (roadmap M1, ranked by scripts/dn_flight.mjs). Their
// rates are recorded beside the wing pools so a threshold can be set from measurement rather than chosen.
const dnIx = { L: [], R: [], all: [] };
for (let i = 0; i < D.N; i++) { if (!FLIGHT_DN.includes(String(types[i]))) continue;
  dnIx.all.push(i); if (side[i] === 1) dnIx.L.push(i); else if (side[i] === 2) dnIx.R.push(i); }
console.log(`flight-command candidates (${FLIGHT_DN.join(', ')}): ${dnIx.all.length} cells (L ${dnIx.L.length} / R ${dnIx.R.length})`);
// Every descending type, so the flight/ground contrast can be looked for rather than assumed. M1's
// stated negative is that no descending population separates the two; this is the measurement that
// decides it, and it costs nothing extra because the run is already happening.
const allDN = new Map();
for (let i = 0; i < D.N; i++) {
  if (D.meta.superclasses[D.sc[i]] !== 'descending_neuron') continue;
  const t = String(types[i] || ''); if (!t) continue;
  if (!allDN.has(t)) allDN.set(t, { all: [], L: [], R: [] });
  const e = allDN.get(t); e.all.push(i); if (side[i] === 1) e.L.push(i); else if (side[i] === 2) e.R.push(i);
}
console.log(`and ${allDN.size} descending types in total, recorded for the contrast table`);
console.log('wing motor pools found:');
for (const [p, v] of Object.entries(ix)) console.log(`  ${p.padEnd(8)} ${String(v.all.length).padStart(3)} cells  (L ${v.L.length} / R ${v.R.length})`);

const prev = new Uint32Array(D.N);
const SAMPLE_MS = 20;      // the window below; rate is spikes per cell per second, not per window
const rate = (idx) => { let n = 0; for (const i of idx) n += brain.spikeCount[i] - prev[i];
  return idx.length ? n * (1000 / SAMPLE_MS) / idx.length : 0; };
const samples = [];
const steps = SECS * 1000;
const TAKEOFF_AT = 1500;
for (let s = 1; s <= steps; s++) {
  if (s === TAKEOFF_AT) fly.takeoffPending = true;
  fly.step();
  if (s % SAMPLE_MS === 0) {
    const st = fly.state();
    const row = { t: s, flying: !!fly.flight.active, turn: +(fly.motor.cmd.turn || 0).toFixed(3),
                  z: +st.pos[2].toFixed(3) };
    for (const [p, v] of Object.entries(ix)) {
      row[p] = +rate(v.all).toFixed(1);
      row[`${p}_LR`] = +(rate(v.L) - rate(v.R)).toFixed(1);
    }
    row.flightDN = +rate(dnIx.all).toFixed(1);
    row.flightDN_LR = +(rate(dnIx.L) - rate(dnIx.R)).toFixed(1);
    row.dn = {}; for (const [t, e] of allDN) row.dn[t] = [rate(e.all), rate(e.L) - rate(e.R)];
    samples.push(row);
    prev.set(brain.spikeCount);
  }
}

const flying = samples.filter(r => r.flying), ground = samples.filter(r => !r.flying);
const mean = (a, k) => a.length ? a.reduce((x, r) => x + r[k], 0) / a.length : 0;
const corr = (a, k) => {
  if (a.length < 3) return null;
  const mx = mean(a, 'turn'), my = mean(a, k);
  let sxy = 0, sxx = 0, syy = 0;
  for (const r of a) { const dx = r.turn - mx, dy = r[k] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 1e-9 && syy > 1e-9 ? +(sxy / Math.sqrt(sxx * syy)).toFixed(3) : null;
};
// per-type flight/ground contrast and steering correlation
const dnMean = (a, t, k) => a.length ? a.reduce((x, r) => x + r.dn[t][k], 0) / a.length : 0;
const dnCorr = (a, t) => { if (a.length < 3) return null;
  const mx = mean(a, 'turn'); let my = dnMean(a, t, 1), sxy = 0, sxx = 0, syy = 0;
  for (const r of a) { const dx = r.turn - mx, dy = r.dn[t][1] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 1e-9 && syy > 1e-9 ? +(sxy / Math.sqrt(sxx * syy)).toFixed(3) : null; };
const dnTable = [...allDN.keys()].map(t => {
  const g = dnMean(ground, t, 0), f = dnMean(flying, t, 0);
  return { type: t, cells: allDN.get(t).all.length, ground: +g.toFixed(2), flight: +f.toFixed(2),
    contrast: +((f - g) / Math.max(1e-6, f + g)).toFixed(3), r_turn: dnCorr(flying, t) };
}).sort((a, b) => Math.abs(b.contrast) - Math.abs(a.contrast));
const out = { _source: 'scripts/wing_mn.mjs', descendingTypes: dnTable, seconds: SECS, seed: SEED,
  samples_flying: flying.length, samples_ground: ground.length,
  flightDN: { types: FLIGHT_DN, cells: dnIx.all.length,
    rate_ground: +mean(ground, 'flightDN').toFixed(2), rate_flight: +mean(flying, 'flightDN').toFixed(2),
    asym_vs_commanded_turn_r: corr(flying, 'flightDN_LR') },
  pools: Object.fromEntries(Object.entries(ix).map(([p, v]) => [p, {
    cells: v.all.length, left: v.L.length, right: v.R.length,
    rate_ground: +mean(ground, p).toFixed(2), rate_flight: +mean(flying, p).toFixed(2),
    asym_flight_mean: +mean(flying, `${p}_LR`).toFixed(2),
    asym_vs_commanded_turn_r: corr(flying, `${p}_LR`),
  }])), samples: samples.map(({ dn, ...r }) => r) };
fs.writeFileSync('public/data/wing_mn.json', JSON.stringify(out, null, 1));

console.log(`\n${flying.length} flying samples, ${ground.length} on the ground`);
console.log('pool      cells   ground Hz   flight Hz   L-R asym   r(asym, commanded turn)');
for (const [p, v] of Object.entries(out.pools))
  console.log(`${p.padEnd(9)} ${String(v.cells).padStart(4)}   ${String(v.rate_ground).padStart(9)}   ${String(v.rate_flight).padStart(9)}   ${String(v.asym_flight_mean).padStart(8)}   ${v.asym_vs_commanded_turn_r ?? '-'}`);
console.log(`\nflight-command candidates: ground ${out.flightDN.rate_ground} Hz, flight ${out.flightDN.rate_flight} Hz, r(L-R, turn) ${out.flightDN.asym_vs_commanded_turn_r ?? '-'}`);
{
  const live = dnTable.filter(r => r.ground + r.flight > 2);
  console.log(`\n${live.length} of ${dnTable.length} descending types fire above 1 Hz at all; ranked by flight-vs-ground contrast:`);
  console.log('type              cells   ground Hz   flight Hz   contrast   r(L-R, turn)');
  for (const r of live.slice(0, 15))
    console.log(`${r.type.padEnd(17)} ${String(r.cells).padStart(5)}   ${String(r.ground).padStart(9)}   ${String(r.flight).padStart(9)}   ${String(r.contrast).padStart(8)}   ${r.r_turn ?? '-'}`);
  const best = live.reduce((a, b) => Math.abs(b.r_turn ?? 0) > Math.abs(a.r_turn ?? 0) ? b : a, live[0] || { r_turn: 0 });
  console.log(`\nstrongest steering correlation of any descending type: ${best.type} r = ${best.r_turn}`);
}
console.log('\nwrote public/data/wing_mn.json');
