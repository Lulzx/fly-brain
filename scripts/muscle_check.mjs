// M4: does the per-class force-frequency model change anything in the mode the model walks in?
//
// src/sim/motor.js gives each muscle class its own curve, 1 - exp(-ln2 (rate/f50)^n), replacing the one
// 17 Hz constant that stood in for every neuromuscular junction in the animal. The roadmap wanted the
// behavioural ladder run to say what that constant was costing. This says it in three seconds instead,
// and the reason is structural: in 'descending' mode `Motor.apply` calls `muscleCtrl` only for the
// proboscis, antennae and labrum -- the legs are driven by the stepping generator -- and those classes
// keep f50 at 17 Hz. So the two models agree on every quantity the eval can read.
//
// They are not bit-identical, and that distinction is the result: exp(-ln2*(r/17)) and exp(-r*(ln2/17))
// differ by up to one ulp for ~4.4% of rate values, which this 3 s / 1e-6 check does not see but the
// full 36 s behavioural ladder amplifies to +0.102 in score (docs/35, muscle_single row). This script
// therefore checks that no *reachable* muscle changed class, not that the runs are identical.
//
//   node scripts/muscle_check.mjs [seconds] [seed]
//
// A non-zero difference means something reaches the muscles in 'descending' mode that the reading of
// `apply()` missed, which would make the `muscle_single` ladder rung worth running for its number
// rather than as a null control.
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const gait = JSON.parse(fs.readFileSync('public/body/gait.json'));
const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const SECS = +(process.argv[2] || 3), SEED = +(process.argv[3] || 7);
const mj = await loadMujoco();
const calib = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const fb = fs.readFileSync('public/vision/flyvis.bin');
const vision = { model: parseFlyVis(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength),
  JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))),
  map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
async function run(perClass) {
  const env = structuredClone(DEFAULT_ENV);
  const mem = allocBrainMemory(data, size, sign, calib, 1, vision);
  const brain = await attachBrain(fs.readFileSync('public/lif.wasm'), mem, 0, data, SEED);
  const fly = new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, pos: [-0.2, 0.6], yaw: 0,
    brainOpts: { ...calib, perClassMuscles: perClass }, neuromod: loadNeuromod(), vision: true, intrinsic: true, brain, seed: SEED,
    flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: vision.map, gain: 150 } });
  const track = [];
  for (let s = 1; s <= SECS * 1000; s++) { fly.step(); if (s % 250 === 0) { const st = fly.state(); track.push([+st.pos[0].toFixed(6), +st.pos[1].toFixed(6), +st.pos[2].toFixed(6), +fly.mjd.ctrl[fly.motor.act.rostrum].toFixed(6)]); } }
  fly.dispose();
  return track;
}
const a = await run(true), b = await run(false);
let maxd = 0; for (let i = 0; i < a.length; i++) for (let k = 0; k < 4; k++) maxd = Math.max(maxd, Math.abs(a[i][k] - b[i][k]));
console.log('per-class on :', JSON.stringify(a[a.length - 1]));
console.log('per-class off:', JSON.stringify(b[b.length - 1]));
console.log(`max |difference| over ${a.length} samples of (x, y, z, rostrum ctrl):`, maxd);
console.log(maxd === 0 ? 'IDENTICAL: the per-class muscle model is a no-op in descending mode' : 'the two modes differ');
