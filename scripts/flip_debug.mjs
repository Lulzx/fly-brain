import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = JSON.parse(fs.readFileSync('public/data/brain_params.json')); const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const fb = fs.readFileSync('public/vision/flyvis.bin'); const vision = { model: parseFlyVis(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength), JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))), map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
const mj = await loadMujoco(); const mem = allocBrainMemory(data, size, sign, params, 1, vision);
const brain = await attachBrain(fs.readFileSync('public/lif.wasm'), mem, 0, data, +(process.argv[2] || 3));
const env = structuredClone(DEFAULT_ENV);
const fly = new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, neuromod: loadNeuromod(), brain, brainOpts: params, pos: [0.95, 0.6], yaw: 0, vision: true, flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: vision.map, gain: 250 } });
const hist = [];
for (let t = 0; t < 5000; t++) {
  fly.step(); const up = fly.mjd.xmat[fly.bid.thorax * 9 + 8]; const c = fly.cmd, m = fly.motor, st = fly.state();
  hist.push(`${t}ms up ${up.toFixed(2)} z ${st.pos[2].toFixed(3)} v ${c.v.toFixed(2)} turn ${c.turn.toFixed(2)} groom ${c.grooming ? 1 : 0} jump ${m.jumpT >= 0 ? 1 : 0} right ${m.righting ? 1 : 0} rostrum ${fly.mjd.ctrl[m.act.rostrum].toFixed(2)} haust ${fly.mjd.ctrl[m.act.haustellum].toFixed(2)} labZ ${st.labellumZ.toFixed(3)} feet ${Object.values(st.touch).map(x => x > 0 ? 1 : 0).join('')}`);
  if (up < 0.5) { console.log(hist.slice(-40).filter((_, i) => i % 4 === 0).join('\n')); console.log('FLIP at', t, 'ms'); break; }
}
