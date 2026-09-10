import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
const mj = await loadMujoco();
let xml = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
xml = xml.replace('<worldbody>', '<worldbody>\n<geom name="floor" type="plane" size="5 5 .1" pos="0 0 -.132" rgba=".5 .5 .5 1"/><geom name="box" type="box" size=".2 .2 .2" pos="1 0 0" rgba="1 0 0 1"/>');
const model = mj.MjModel.from_xml_string(xml); const data = new mj.MjData(model);
mj.mj_forward(model, data);
const nray = 4000; const vec = new Array(nray * 3);
for (let i = 0; i < nray; i++) { const az = (i / nray) * 2 * Math.PI, el = -0.3 + 0.6 * ((i * 7919) % nray) / nray; vec[i*3] = Math.cos(el) * Math.cos(az); vec[i*3+1] = Math.cos(el) * Math.sin(az); vec[i*3+2] = Math.sin(el); }
const gid = new mj.IntBuffer(new Array(nray).fill(0)); const dist = new mj.DoubleBuffer(new Array(nray).fill(0));
const normal = new mj.DoubleBuffer(new Array(nray * 3).fill(0));
const head = model.body('head').id;
const groups = [1, 1, 0, 0, 1, 0];
let t0 = performance.now();
for (let k = 0; k < 20; k++) mj.mj_multiRay(model, data, [0.06, 0, 0.02], vec, groups, true, head, gid, dist, normal, nray, 100);
const dt = (performance.now() - t0) / 20;
const g = gid.getView(), d = dist.getView(); const hits = {};
for (let i = 0; i < nray; i++) { const n = g[i] >= 0 ? model.geom(g[i]).name : 'sky'; hits[n] = (hits[n] || 0) + 1; }
console.log(`multiRay ${nray} rays: ${dt.toFixed(2)} ms`, Object.entries(hits).sort((a,b)=>b[1]-a[1]).slice(0,8));
