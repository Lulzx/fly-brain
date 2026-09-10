// One embodied fly per worker: its own connectome brain + MuJoCo physics world.
import loadMujoco from '@mujoco/mujoco';
import { FlyAgent } from './fly.js';
import { attachBrain, attachEyes } from '../brainsetup.js';

let fly = null, running = false, speed = 1, others = [], env = null, lastReal = 0, simAhead = 0;
const POSE_EVERY = 16; // ms of sim between pose messages (renderer interpolates)

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const mj = await loadMujoco();
    const g = m.graph;
    const data = { N: g.N, E: g.E, meta: m.meta, indptr: g.indptr, indices: g.indices, weights: g.weights, nt: g.nt, side: g.side, superclass: g.superclass, cls: g.cls };
    env = m.env;
    const brain = await attachBrain(m.wasmModule, m.brainMem, m.slot, data, 101 + m.id);
    const flyvis = m.brainMem.fv ? { eyes: attachEyes(brain.instance, m.brainMem, m.slot), map: m.flyvisMap, gain: 150 } : null;
    fly = new FlyAgent({ brain, flyvis, mj, flyXML: m.flyXML, env, data, size: g.size, sign: g.sign, bodymap: m.bodymap, gait: m.gait, id: m.id,
      pos: m.pos, yaw: m.yaw, nProxies: m.nProxies, mode: m.mode, brainOpts: m.brainOpts, vision: m.vision });
    postMessage({ type: 'ready', id: m.id, nbody: fly.model.nbody, bodyNames: [...Array(fly.model.nbody).keys()].map(i => fly.model.body(i).name) });
    postPose();
  } else if (m.type === 'run') { running = true; lastReal = performance.now(); loop(); }
  else if (m.type === 'pause') running = false;
  else if (m.type === 'speed') speed = m.speed;
  else if (m.type === 'env') { Object.assign(env, m.env); fly.env = env; if (fly.foodEaten.length !== env.food.length) fly.foodEaten = env.food.map(() => 0); }
  else if (m.type === 'others') { others = m.others; fly.others = others; setProxies(); }
  else if (m.type === 'mode') fly.motor.mode = m.mode;
  else if (m.type === 'stimulate') fly.brain.setDrive(m.indices, m.rate);
  else if (m.type === 'activity') postMessage({ type: 'activity', id: fly.id, trace: fly.brain.trace.slice(0), t: fly.t });
};
function setProxies() {
  const d = fly.mjd, M = fly.model;
  others.forEach((o, k) => { const b = M.body(`proxy${k}`); if (!b) return; const mid = M.body_mocapid[b.id]; if (mid < 0) return;
    d.mocap_pos[mid * 3] = o.x; d.mocap_pos[mid * 3 + 1] = o.y; d.mocap_pos[mid * 3 + 2] = o.z ?? 0.13;
    d.mocap_quat[mid * 4] = Math.cos(o.yaw / 2); d.mocap_quat[mid * 4 + 1] = 0; d.mocap_quat[mid * 4 + 2] = 0; d.mocap_quat[mid * 4 + 3] = Math.sin(o.yaw / 2); });
}
function postPose() {
  const p = fly.pose(); const st = fly.state();
  postMessage({ type: 'pose', id: fly.id, t: fly.t, xpos: p.xpos, xquat: p.xquat, cmd: fly.cmd, energy: fly.energy, health: fly.health, alive: fly.alive, eaten: fly.eaten,
    mn9: fly.motor.mean(fly.motor.muscles.find(x => x.name.startsWith('MN9'))?.idx || []), feeding: fly.motor.feeding(), heat: st.heat || 0, nSensory: fly.driven.length,
    foodEaten: fly.foodEaten.splice(0, fly.foodEaten.length, ...fly.foodEaten.map(() => 0)), behavior: fly.behavior(st), dist: fly.dist, jumps: fly.jumps, pos: st.pos, yaw: Math.atan2(fly.mjd.xmat[fly.bid.thorax * 9 + 3], fly.mjd.xmat[fly.bid.thorax * 9]) });
}
function loop() {
  if (!running) return;
  const now = performance.now(); simAhead += Math.min(100, now - lastReal) * speed; lastReal = now;
  const t0 = performance.now(); let sinceP = 0;
  while (simAhead >= 1 && performance.now() - t0 < 40) { fly.step(); simAhead -= 1; if (++sinceP >= POSE_EVERY) { postPose(); sinceP = 0; } }
  if (simAhead > 50) simAhead = 50;   // can't keep up: run as fast as possible
  if (sinceP) postPose();
  setTimeout(loop, 0);
}
