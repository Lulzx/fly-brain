import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { buildWorldXML, DEFAULT_ENV } from '../src/sim/world.js';
const mj = await loadMujoco(); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const patch = process.argv[2] === 'orig' ? (x => x.replace(/contype="3" conaffinity="3"/g, 'contype="1" conaffinity="1"')) : (x => x);
const M = mj.MjModel.from_xml_string(patch(buildWorldXML(flyXML, structuredClone(DEFAULT_ENV), { flyPos: [0.95, 0.6, 0.132], nProxies: 7 }))); const d = new mj.MjData(M);
const seen = {};
for (let s = 0; s < 2000; s++) { mj.mj_step(M, d); if (s % 50) continue;
  const cv = d.contact; for (let c = 0; c < Math.min(d.ncon, cv.size()); c++) { const con = cv.get(c); const a = M.geom(con.geom1).name, b = M.geom(con.geom2).name; if (!/floor/.test(a + b)) { const k = [a, b].sort().join(' <-> '); seen[k] = (seen[k] || 0) + 1; } con.delete(); } cv.delete(); }
console.log(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 15));
