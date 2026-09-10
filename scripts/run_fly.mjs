// Headless closed-loop run of one embodied fly. Usage: node scripts/run_fly.mjs [seconds] [scenario] [mode]
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain } from '../src/brainsetup.js';
const [secs = 2, scenario = 'default', mode = 'descending', extra = '{}'] = process.argv.slice(2);
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const mj = await loadMujoco();
const env = structuredClone(DEFAULT_ENV); const X = JSON.parse(extra);
let pos = [0, 0], yaw = 0;
if (scenario === 'onfood') { pos = [env.food[0].x - 0.05, env.food[0].y]; }            // standing on sugar
if (scenario === 'nearodor') { pos = [0, 0.6]; yaw = 0; }                               // food/odor 1 cm ahead
if (scenario === 'onheat') { pos = [env.hazards[0].x, env.hazards[0].y]; }
const calib = fs.existsSync('public/data/brain_params.json') ? JSON.parse(fs.readFileSync('public/data/brain_params.json')) : { wSyn: 0.4 };
const brainOpts = { ...calib, ...X.brain };
const mem = allocBrainMemory(data, size, sign, brainOpts, 1);
const brain = await attachBrain(fs.readFileSync('public/lif.wasm'), mem, 0, data, 7);
const fly = new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, pos, yaw, mode, brainOpts, vision: X.vision ?? true, brain });
const t0 = Date.now(); const steps = secs * 1000; const prev = new Uint32Array(D.N);
console.log(`scenario ${scenario}, mode ${mode}, start pos ${pos}, ${extra}`);
for (let s = 1; s <= steps; s++) {
  fly.step();
  if (s % 100 === 0) {
    const st = fly.state(); let act = 0; for (let i = 0; i < D.N; i++) if (fly.brain.spikeCount[i] !== prev[i]) act++; prev.set(fly.brain.spikeCount);
    const c = fly.cmd; const yawNow = Math.atan2(fly.mjd.xmat[fly.bid.thorax * 9 + 3], fly.mjd.xmat[fly.bid.thorax * 9]) * 180 / Math.PI;
    const up = fly.mjd.xmat[fly.bid.thorax * 9 + 8]; console.log(`t=${(s / 1000).toFixed(1)}s up ${up.toFixed(2)} pos ${st.pos.map(v => v.toFixed(2)).join(',')} yaw ${yawNow.toFixed(0)} | active ${act} | DN fwd ${c.drive.toFixed(0)} back ${c.back.toFixed(0)} turn ${c.turn.toFixed(2)} v ${c.v.toFixed(2)} GF ${c.escape.toFixed(0)} | MN9 ${fly.motor.mean(D.byType('MN9')).toFixed(0)} rostrum ${fly.mjd.ctrl[fly.motor.act.rostrum].toFixed(2)} | energy ${fly.energy.toFixed(3)} eaten ${fly.eaten.toFixed(4)} health ${fly.health.toFixed(2)} | sensory ${fly.driven.length}`);
  }
}
console.log(`wall ${(Date.now() - t0) / 1000}s for ${secs}s sim (${((Date.now() - t0) / 1000 / secs).toFixed(2)}x real-time)`);
