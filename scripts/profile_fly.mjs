import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const mj = await loadMujoco(); const env = structuredClone(DEFAULT_ENV);
const cfg = JSON.parse(process.argv[2] || '{"wSyn":0.4}');
const fly = new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, neuromod: loadNeuromod(), mode: 'descending', brainOpts: cfg, vision: true });
let AW = 0, SP = 0, ED = 0; const T = { state: 0, senses: 0, eye: 0, brain: 0, motor: 0, physics: 0 }; const now = () => performance.now();
for (let s = 0; s < 400; s++) {   // instrumented copy of FlyAgent.step
  let t = now(); const st = fly.state(); T.state += now() - t;
  t = now(); const rates = fly.senses.update(st, fly.env, 1); T.senses += now() - t;
  t = now(); if (fly.t % 10 === 0) { fly._eyeRates = new Map(); const er = fly._eyeRates; fly.eye.update({ set: (ix, hz) => { for (const i of ix) er.set(i, hz); } }, fly.env, 10, fly.albedo); } for (const [i, hz] of fly._eyeRates) rates.set(i, hz); T.eye += now() - t;
  t = now(); const B = fly.brain; for (const i of fly.driven) B.drive[i] = 0; const nd = new Int32Array(rates.size); let k = 0; for (const [i, hz] of rates) { B.setDriveOne(i, hz); nd[k++] = i; } fly.driven = nd;
  const f1 = fly.brain.step(), f2 = fly.brain.step(); T.brain += now() - t; AW += fly.brain.nAwake; SP += f1.length + f2.length; let ed = 0; for (const i of f1) ed += fly.brain.indptr[i + 1] - fly.brain.indptr[i]; for (const i of f2) ed += fly.brain.indptr[i + 1] - fly.brain.indptr[i]; ED += ed;
  t = now(); fly.motor.readBrain(fly.brain.spikeCount, 1); fly.cmd = fly.motor.apply(fly.t, 1); T.motor += now() - t;
  t = now(); for (let j = 0; j < 10; j++) mj.mj_step(fly.model, fly.mjd); T.physics += now() - t;
  fly.t++;
}
let act = 0; for (let i = 0; i < D.N; i++) if (fly.brain.spikeCount[i] > 0) act++;
console.log('ms per 1 ms sim:', Object.entries(T).map(([k, v]) => `${k} ${(v / 400).toFixed(3)}`).join(' | '), '| total', (Object.values(T).reduce((a, b) => a + b) / 400).toFixed(2), '| neurons that spiked', act, '| awake', (AW / 400).toFixed(0), 'spikes/ms', (SP / 400).toFixed(0), 'edges/ms', (ED / 400).toFixed(0));
