// Runs survival scenarios with the full embodied fly and reports what the brain made it do.
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const fb = fs.readFileSync('public/vision/flyvis.bin'); const vision = { model: parseFlyVis(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength), JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))), map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
const mj = await loadMujoco(); const wasm = fs.readFileSync('public/lif.wasm');
const mem = allocBrainMemory(data, size, sign, params, 1, vision);
async function makeFly(env, pos, yaw) { const brain = await attachBrain(wasm, mem, 0, data, (Math.random() * 1e6) | 0); brain.reset();
  return new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, brain, brainOpts: params, neuromod: loadNeuromod(), pos, yaw, vision: true, flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: vision.map, gain: +(process.env.FVGAIN || 150) } }); }
const only = process.argv[2];
const scenarios = {
  forage: { secs: 12, setup: env => [[-0.2, 0.6], 0], note: 'food + vinegar 1.2 cm ahead' },
  onfood: { secs: 4, setup: env => [[env.food[0].x - 0.05, env.food[0].y], 0], note: 'standing on sugar' },
  threat: { secs: 4, setup: env => [[0, 0], 0], threat: 2000, note: 'dark object looms from front-left at 2 s (escapes are off for the first 1.5 s)' },
  heat: { secs: 4, setup: env => [[env.hazards[0].x, env.hazards[0].y], 0], note: 'placed on a hot patch' },
  bitter: { secs: 4, setup: env => [[env.bitterPatches[0].x - 0.05, env.bitterPatches[0].y], 0], note: 'standing on bitter' },
};
for (const [name, sc] of Object.entries(scenarios)) {
  if (only && only !== name) continue;
  const env = structuredClone(DEFAULT_ENV); const [pos, yaw] = sc.setup(env); const fly = await makeFly(env, pos, yaw);
  const counts = {}; let maxMN9 = 0, minDistFood = 1e9, feedMs = 0; const t0 = Date.now(); let H = null;
  for (let s = 1; s <= sc.secs * 1000; s++) {
    if (sc.threat) { if (s === sc.threat) { const st = fly.state(); H = { p: st.pos, a: Math.atan2(fly.mjd.xmat[fly.bid.thorax * 9 + 3], fly.mjd.xmat[fly.bid.thorax * 9]) + 0.6 }; }
      const u = H ? Math.min(1, (s - sc.threat) / (+process.env.LOOM_MS || 700)) : 0, k = u * u; env.threat = H && s < sc.threat + 1300 ? { x: H.p[0] + Math.cos(H.a) * (3 * (1 - k) + 0.3 * k), y: H.p[1] + Math.sin(H.a) * (3 * (1 - k) + 0.3 * k), z: 1.6 * (1 - k) + 0.45 * k } : null; }
    fly.step();
    if (s % 20 === 0) { const st = fly.state(); const b = fly.behavior(st); counts[b] = (counts[b] || 0) + 20; if (b === 'feeding') feedMs += 20;
      maxMN9 = Math.max(maxMN9, fly.motor.mean(D.byType('MN9'))); minDistFood = Math.min(minDistFood, Math.hypot(st.pos[0] - env.food[0].x, st.pos[1] - env.food[0].y)); }
  }
  const st = fly.state(); const up = fly.mjd.xmat[fly.bid.thorax * 9 + 8];
  console.log(`\n== ${name} (${sc.note}), ${sc.secs}s sim in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('   behaviour time:', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 10 / sc.secs).toFixed(0)}%`).join(', '));
  console.log(`   start ${pos.map(v => v.toFixed(2))} -> end ${st.pos.slice(0, 2).map(v => v.toFixed(2))}, walked ${fly.dist.toFixed(2)} cm, upright ${up.toFixed(2)}, jumps ${fly.jumps}`);
  console.log(`   closest to food ${minDistFood.toFixed(2)} cm, eaten ${(fly.eaten * 1000).toFixed(2)}, feeding ${feedMs} ms, max MN9 ${maxMN9.toFixed(0)} Hz, energy ${fly.energy.toFixed(3)}, health ${fly.health.toFixed(2)}`);
}
