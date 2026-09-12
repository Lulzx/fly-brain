import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain } from '../src/brainsetup.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const mj = await loadMujoco(); const env = structuredClone(DEFAULT_ENV);
const mem = allocBrainMemory(data, size, sign, params, 1); const brain = await attachBrain(fs.readFileSync('public/lif.wasm'), mem, 0, data, 7);
const vision = process.argv[2] !== 'novision';
const fly = new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, neuromod: loadNeuromod(), brain, brainOpts: params, pos: [0.95, 0.6], vision });
const legSugar = new Set(Object.values(fly.senses.taste.legs).flatMap(x => x.sugar));
for (let t = 0; t < 400; t++) {
  fly.step();
  if (t % 50 === 49) { const st = fly.state(); let ns = 0, sum = 0; for (const i of fly.driven) if (legSugar.has(i)) { ns++; sum += brain.drive[i]; }
    console.log(`t=${t + 1}ms touch ${Object.values(st.touch).map(v => v > 0 ? 1 : 0).join('')} leg sugar GRNs driven ${ns} (mean ${(sum / Math.max(1, ns)).toFixed(0)}Hz) | fwd ${fly.cmd.drive.toFixed(1)} back ${fly.cmd.back.toFixed(1)} v ${fly.cmd.v.toFixed(2)} | MN9 ${fly.motor.mean(D.byType('MN9')).toFixed(0)} | labellumZ ${st.labellumZ.toFixed(3)}`); }
}
