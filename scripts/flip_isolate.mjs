import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { buildWorldXML, DEFAULT_ENV } from '../src/sim/world.js';
import { Motor } from '../src/sim/motor.js';
import { loadAll } from './lib_node.mjs';
const D = loadAll(); const mj = await loadMujoco();
const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
async function trial(label, { v = 0.75, turn = -0.6, prob = true, xmlPatch = x => x, T = 3000, wallFriction }) {
  const env = structuredClone(DEFAULT_ENV); if (wallFriction !== undefined) env.arena.wallFriction = wallFriction;
  const M = mj.MjModel.from_xml_string(xmlPatch(buildWorldXML(flyXML, env, { flyPos: [0.95, 0.6, 0.132], nProxies: 7 }))); const d = new mj.MjData(M);
  const motor = new Motor(mj, M, d, D.bodymap, D.meta.types, D.side, gait, 'descending');
  const th = M.body('thorax').id; const per = Math.round(0.001 / M.opt.timestep);
  // bypass brain: stub the DN readout with fixed commands
  motor.readBrain = () => {}; motor.wmean = function (pairs) { if (pairs === this.dn.forward) return 2.5 + v * 10; if (pairs === this.dn.turnL) return Math.max(0, turn) * 12; if (pairs === this.dn.turnR) return Math.max(0, -turn) * 12; return 0; };
  motor.mean = function (ix) { if (prob && this.muscles.some(m => m.idx === ix && /MN9|MN11|MN12/.test(m.name))) return 80; return 0; };
  motor.turnF = turn * 12;
  for (let t = 0; t < T; t++) { motor.apply(t, 1, { up: d.xmat[th * 9 + 8] }); for (let s = 0; s < per; s++) mj.mj_step(M, d);
    if (d.xmat[th * 9 + 8] < 0.3) { console.log(`${label.padEnd(44)} FLIPPED at ${t} ms`); return; } }
  console.log(`${label.padEnd(44)} upright after ${T} ms (rostrum ctrl ${d.ctrl[motor.act.rostrum].toFixed(2)})`);
}
//await trial('baseline: v .75 turn -.6 proboscis out', {});
//await trial('proboscis retracted', { prob: false });
//await trial('turn 0', { turn: 0 });
//await trial('original contact bits (no layers)', { xmlPatch: x => x.replace(/contype="3" conaffinity="3"/g, 'contype="1" conaffinity="1"') });
//await trial('turn -0.35', { turn: -0.35 });
console.log('--- variants');
//await trial('layers but claws also 3 (touch walls)', { xmlPatch: x => x.replace('material="pink" contype="1" conaffinity="1"/>', 'material="pink"/>') });
//await trial('layers, floor contype/conaffinity 3', { xmlPatch: x => x.replace('<geom name="floor" type="plane"', '<geom name="floor" contype="3" conaffinity="3" type="plane"') });
console.log('--- wall friction');
for (const fr of [1, 0.3, 0.1, 0.03]) await trial(`straight into wall, wall friction ${fr}`, { turn: 0, wallFriction: fr });
for (const fr of [0.1, 0.03]) await trial(`circling, wall friction ${fr}`, { turn: -0.6, wallFriction: fr, T: 6000 });
