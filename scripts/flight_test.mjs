// Brainless flight-controller test: the flybody fly in the arena, flight started in the air, fixed steering.
// Usage: node scripts/flight_test.mjs [turn=0] [ms=2500] [noWings]
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { buildWorldXML, DEFAULT_ENV } from '../src/sim/world.js';
import { Flight } from '../src/sim/flight.js';
const [turn = 0, ms = 2500] = process.argv.slice(2).map(Number);
const mj = await loadMujoco(); const env = structuredClone(DEFAULT_ENV);
const M = mj.MjModel.from_xml_string(buildWorldXML(fs.readFileSync('public/body/fly_physics.xml', 'utf8'), env, { flyPos: [0, 0, 0.4] }));
const d = new mj.MjData(M); mj.mj_forward(M, d);
const jointAdr = {}; for (let j = 0; j < M.njnt; j++) jointAdr[M.jnt(j).name] = M.jnt_qposadr[j];
const act = {}, range = {}; for (let i = 0; i < M.nu; i++) { act[M.actuator(i).name] = i; range[M.actuator(i).name] = [M.actuator_ctrlrange[2 * i], M.actuator_ctrlrange[2 * i + 1]]; }
const th = M.body('thorax').id; let seed = 5; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const fl = new Flight({ mj, model: M, data: d, thorax: th, jointAdr, act, range, rand });
fl.start(0); fl.dur = ms - 600;
const per = Math.round(0.001 / M.opt.timestep);
for (let t = 0; t < ms; t++) {
  const legTouch = false;
  const r = fl.update(t, 1, { turn, env, others: [], legTouch });
  for (let s = 0; s < per; s++) { if (fl.active) fl.substep(M.opt.timestep * 1000); mj.mj_step(M, d); }
  if (t % 100 === 0 || r === 'landed') { const R = d.xmat.slice(th * 9, th * 9 + 9);
    console.log(t, fl.phase, 'xyz', [0, 1, 2].map(k => d.xpos[th * 3 + k].toFixed(2)).join(','), 'v', [0, 1, 2].map(k => d.qvel[k].toFixed(1)).join(','), 'roll', Math.atan2(R[7], R[8]).toFixed(2), 'pitch', Math.asin(R[6]).toFixed(2), 'yaw', Math.atan2(R[3], R[0]).toFixed(2), 'w', [3, 4, 5].map(k => d.qvel[k].toFixed(1)).join(','));
    if (r === 'landed') break; }
}
