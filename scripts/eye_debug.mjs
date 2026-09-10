import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const mj = await loadMujoco(); const env = structuredClone(DEFAULT_ENV);
const fake = { N: D.N, meta: D.meta, side: D.side, spikeCount: new Uint32Array(D.N), drive: new Float32Array(D.N), setBias() {}, setDriveOne() {}, pulse() {}, step() { return []; }, trace: new Float32Array(D.N) };
const fly = new FlyAgent({ mj, flyXML, env, data, size: null, sign: null, bodymap: D.bodymap, gait, brain: fake, vision: true });
const er = new Map(); fly.eye.update({ set: (ix, hz) => { for (const i of ix) er.set(i, hz); } }, env, 10, fly.albedo);
const gid = fly.eye.gid.GetView(), dist = fly.eye.dist.GetView();
const kinds = {}; const lum = {}; for (let r = 0; r < fly.eye.n; r++) { const k = gid[r] < 0 ? 'sky' : fly.geomKind[gid[r]] + ':' + (fly.geomKind[gid[r]] === 'self' ? fly.model.body(fly.model.geom_bodyid[gid[r]]).name : ''); kinds[k] = (kinds[k] || 0) + 1; }
console.log('ray hits:', Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 15));
const L = fly.eye.lum; const sorted = Float32Array.from(L).sort(); console.log('luminance quantiles', [0.05, 0.25, 0.5, 0.75, 0.95].map(q => sorted[Math.floor(q * L.length)].toFixed(3)));
console.log('dist quantiles', [0.05, 0.5, 0.95].map(q => { const s = Float64Array.from(dist).sort(); return s[Math.floor(q * s.length)].toFixed(4); }));
const h = fly.bid.head; console.log('head pos', fly.mjd.xpos.slice(h * 3, h * 3 + 3));
