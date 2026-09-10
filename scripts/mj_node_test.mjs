import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
const mj = await loadMujoco();
let xml = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
xml = xml.replace('<worldbody>', '<worldbody>\n<geom name="floor" type="plane" size="5 5 .1" pos="0 0 -.132" solref="0.0002 1" friction="1"/>');
const model = mj.MjModel.from_xml_string(xml);
const data = new mj.MjData(model);
console.log('nu', model.nu, 'nq', model.nq, 'nbody', model.nbody, 'timestep', model.opt.timestep);
const t0 = performance.now();
for (let i = 0; i < 10000; i++) mj.mj_step(model, data);
const dt = performance.now() - t0;
console.log(`10000 steps (1 s sim): ${dt.toFixed(0)} ms wall, ${(dt / 10).toFixed(1)} us/step; ncon ${data.ncon}`);
const xpos = data.xpos; console.log('thorax z', xpos[3 + 2].toFixed(4));
// named access check
console.log('actuator 0 name', model.actuator(0).name, '| thorax id', model.body('thorax').id);
