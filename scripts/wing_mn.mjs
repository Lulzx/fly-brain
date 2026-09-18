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

export const WING_POOLS = {
  power: ['DLMn a, b', 'DLMn c-f', 'DVMn 1a-c', 'DVMn 2a, b', 'DVMn 3a, b'],
  basalar: ['b1 MN', 'b2 MN', 'b3 MN'],              // amplitude and stroke timing
  first: ['i1 MN', 'i2 MN', 'hi1 MN', 'hi2 MN'],     // first axillary group
  third: ['iii1 MN', 'iii3 MN', 'hiii2 MN'],         // third axillary group
  hg: ['hg1 MN', 'hg2 MN', 'hg3 MN', 'hg4 MN'],      // large turns
  pitch: ['ps1 MN', 'tp1 MN', 'tp2 MN', 'tpn MN', 'hDVM MN'],
};

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
const out = { _source: 'scripts/wing_mn.mjs', seconds: SECS, seed: SEED,
  samples_flying: flying.length, samples_ground: ground.length,
  pools: Object.fromEntries(Object.entries(ix).map(([p, v]) => [p, {
    cells: v.all.length, left: v.L.length, right: v.R.length,
    rate_ground: +mean(ground, p).toFixed(2), rate_flight: +mean(flying, p).toFixed(2),
    asym_flight_mean: +mean(flying, `${p}_LR`).toFixed(2),
    asym_vs_commanded_turn_r: corr(flying, `${p}_LR`),
  }])), samples };
fs.writeFileSync('public/data/wing_mn.json', JSON.stringify(out, null, 1));

console.log(`\n${flying.length} flying samples, ${ground.length} on the ground`);
console.log('pool      cells   ground Hz   flight Hz   L-R asym   r(asym, commanded turn)');
for (const [p, v] of Object.entries(out.pools))
  console.log(`${p.padEnd(9)} ${String(v.cells).padStart(4)}   ${String(v.rate_ground).padStart(9)}   ${String(v.rate_flight).padStart(9)}   ${String(v.asym_flight_mean).padStart(8)}   ${v.asym_vs_commanded_turn_r ?? '-'}`);
console.log('\nwrote public/data/wing_mn.json');
