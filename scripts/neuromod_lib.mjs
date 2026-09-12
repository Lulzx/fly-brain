// Shared setup for the neuromodulation scripts: one embodied fly with flyvis eyes and neuromodulation on,
// in the default arena without the food patch or hot patches (the food odour plume stays).
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
const D = loadAll(); export const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const fb = fs.readFileSync('public/vision/flyvis.bin'); const vision = { model: parseFlyVis(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength), JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))), map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
const mj = await loadMujoco(); const wasm = fs.readFileSync('public/lif.wasm');
export const loadCalib = () => fs.existsSync('public/data/neuromod.json') ? JSON.parse(fs.readFileSync('public/data/neuromod.json')) : null;
/** neuromod: false runs the old energy-driven rules on the unmodified graph */
export async function makeFly({ seed = 1, calib = loadCalib(), block = null, nmParams = JSON.parse(process.env.NMPARAMS || '{}'), neuromod = true, env = null, pos = [0, 0], yaw = 0 } = {}) {
  const brainOpts = { ...params, neuromod };   // neuromod false: the old energy-driven rules
  const mem = allocBrainMemory(data, size, sign, brainOpts, 1, vision);
  const brain = await attachBrain(wasm, mem, 0, data, seed); brain.reset();
  if (!env) { env = structuredClone(DEFAULT_ENV); env.food = []; env.hazards = []; }   // the vinegar plume stays: it drives the OA neurons
  return new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, brain, brainOpts, pos, yaw, vision: true, seed,
    flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: vision.map, gain: 150 }, neuromod: { calib, block, params: nmParams } });
}
