// Tethered fly: the body is held (no physics steps); its compound eye watches moving proxy objects.
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = { ...JSON.parse(fs.readFileSync('public/data/brain_params.json')), ...JSON.parse(process.argv[3] || '{}') };
const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const mj = await loadMujoco(); const env = structuredClone(DEFAULT_ENV); env.odors = []; env.food = []; env.bitterPatches = []; env.hazards = []; env.obstacles = [];
const fb = fs.readFileSync('public/vision/flyvis.bin'); const vision = { model: parseFlyVis(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength), JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))), map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
const mem = allocBrainMemory(data, size, sign, params, 1, vision); const brain = await attachBrain(fs.readFileSync('public/lif.wasm'), mem, 0, data, 9);
const fly = new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, brain, brainOpts: params, nProxies: 1, vision: true, flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: vision.map, gain: +(process.env.FVGAIN || 60) } });
const T = (t, s) => D.byType(t).filter(i => !s || D.side[i] === s);
const G = { DNp02: T('DNp02'), DNp04: T('DNp04'), DNp06: T('DNp06'), DNp11: T('DNp11'), T4L: T('T4a', 1).concat(T('T4b', 1), T('T4c', 1), T('T4d', 1)), T5L: T('T5a', 1).concat(T('T5b', 1), T('T5c', 1), T('T5d', 1)), LPLC2L: T('LPLC2', 1), LC4L: T('LC4', 1), LPLC2R: T('LPLC2', 2), fwd: [...T('DNg100'), ...T('DNg97'), ...T('DNp09')], P9L: T('DNp09', 1), P9R: T('DNp09', 2), DNaL: [...T('DNa02', 1), ...T('DNa01', 1)], DNaR: [...T('DNa02', 2), ...T('DNa01', 2)], GF: T('DNp01'), MDN: T('MDN') };
const vpn = []; for (let i = 0; i < D.N; i++) if (D.meta.superclasses[D.sc[i]] === 'visual_projection') vpn.push(i);
const stim = process.argv[2] || 'circle';
const M = fly.model, d = fly.mjd, mid = M.body_mocapid[M.body(stim === 'loom' ? 'threat' : 'proxy0').id];
const prev = new Uint32Array(D.N); let line = [];
for (let t = 0; t < 3000; t++) {
  let x = 50, y = 50, z = -5;
  if (stim === 'circle') { const a = t / 1000 * 2 * Math.PI * 0.5; x = 0.6 * Math.cos(a); y = 0.6 * Math.sin(a); z = 0.13; }   // circles at 0.5 Hz, starts in front (az 0), moves to the left
  if (stim === 'left') { x = 0.5; y = 0.6 + 0.0 * t; z = 0.13; }            // static object front-left
  if (stim === 'loom') { const u = Math.min(1, Math.max(0, (t - 500) / 700)); const k = u * u; x = 3 * (1 - k) + 0.55 * k; y = 1.5 * (1 - k) + 0.28 * k; z = 1.2 * (1 - k) + 0.5 * k; }
  d.mocap_pos[mid * 3] = x; d.mocap_pos[mid * 3 + 1] = y; d.mocap_pos[mid * 3 + 2] = z;
  mj.mj_forward(M, d);
  // closed-loop sensing but no motor effect (tethered)
  const st = fly.state(); const rates = fly.senses.update(st, env, 1);
  if (t % 20 === 0) { fly._eyeRates = new Map(); const er = fly._eyeRates; fly.fv.update((ix, hz) => { for (const i of ix) er.set(i, hz); }, env, fly.albedo, 20); }
  for (const [i, hz] of fly._eyeRates) rates.set(i, hz);
  for (const i of fly.driven) brain.drive[i] = 0; const nd = []; for (const [i, hz] of rates) { brain.setDriveOne(i, hz); nd.push(i); } fly.driven = nd;
  brain.step(); brain.step();
  if ((t + 1) % 100 === 0) {
    const r = Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.reduce((a, i) => a + brain.spikeCount[i] - prev[i], 0) / v.length / 0.1]));
    let va = 0; for (const i of vpn) if (brain.spikeCount[i] !== prev[i]) va++;
    const az = Math.atan2(y, x) * 180 / Math.PI;
    let dark = 0; for (let r = 0; r < fly.fv.n; r++) if (fly.fv.lum[r] < 0.1) dark++;
    console.log(`t=${((t + 1) / 1000).toFixed(2)} dark ommatidia ${dark} obj az ${az.toFixed(0)}° | VPNs active ${va} | ` + Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' '));
    prev.set(brain.spikeCount);
  }
}
