// Behaviour diagnostics: runs one embodied fly and writes a 20 ms trace (JSON lines) for analysis.
// Usage: node scripts/diag_walk.mjs <secs> <scenario> <out.jsonl> ['{"vision":false,"seed":7}']
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
const [secs = 10, scenario = 'open', out = '/tmp/flydiag/trace.jsonl', extra = '{}'] = process.argv.slice(2);
const X = JSON.parse(extra);
const D = loadAll(); const _bt = {}; const _byType = D.byType; D.byType = t => _bt[t] ||= _byType(t); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = { ...JSON.parse(fs.readFileSync('public/data/brain_params.json')), ...X.brain };
const gait = JSON.parse(fs.readFileSync('public/body/gait.json')); const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const fb = fs.readFileSync('public/vision/flyvis.bin'); const vision = { model: parseFlyVis(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength), JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))), map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
const mj = await loadMujoco(); const wasm = fs.readFileSync('public/lif.wasm');
const useFV = X.vision ?? true;
const mem = allocBrainMemory(data, size, sign, params, 1, useFV ? vision : null);
const brain = await attachBrain(wasm, mem, 0, data, X.seed ?? 7); brain.reset();
const env = structuredClone(DEFAULT_ENV); if (X.env) Object.assign(env, X.env);
const SC = { open: [[0, 0], 0], wall: [[1.9, -0.9], -0.4], cube: [[-0.4, 0.55], Math.PI / 2], corner: [[-0.4, 0.8], Math.PI / 2 + 0.5] };
const [pos, yaw] = X.pos ? [X.pos, X.yaw ?? 0] : SC[scenario];
const fly = new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, brain, brainOpts: params, neuromod: loadNeuromod(), pos, yaw, intrinsic: X.intrinsic ?? true, seed: X.seed ?? 0, vision: useFV, flyvis: useFV ? { eyes: attachEyes(brain.instance, mem, 0), map: vision.map, gain: X.fvGain ?? 150 } : null });
if (X.mask) { const re = new RegExp(X.mask); const drop = new Set(D.bodymap.sensors.filter(s => re.test(s.name)).flatMap(s => s.idx)); console.log('masking', drop.size, 'sensory neurons');
  const up0 = fly.senses.update.bind(fly.senses); fly.senses.update = (...a) => { const r = up0(...a); for (const i of drop) r.delete(i); return r; }; }
if (X.P) Object.assign((await import('../src/sim/intrinsic.js')).INTRINSIC, X.P);
if (X.freeze) fly.motor.apply = function () { return this.cmd; };   // brain runs, body does not move (open loop)
const f = fs.openSync(out, 'w'); const t0 = Date.now(); const M = fly.motor;
for (let s = 1; s <= secs * 1000; s++) {
  if (X.threatAt) { const t0 = X.threatAt, dur = X.loomMs ?? 700;   // dark sphere looming from front-left (as scripts/run_fly.mjs)
    if (s === t0) { const st0 = fly.state(); globalThis.TH = { p: st0.pos, a: Math.atan2(fly.mjd.xmat[fly.bid.thorax * 9 + 3], fly.mjd.xmat[fly.bid.thorax * 9]) + 0.6 }; }
    const u = Math.min(1, Math.max(0, (s - t0) / dur)), k = u * u, H = globalThis.TH;
    env.threat = H && s >= t0 && s < t0 + dur + 600 ? { x: H.p[0] + Math.cos(H.a) * (3 * (1 - k) + 0.3 * k), y: H.p[1] + Math.sin(H.a) * (3 * (1 - k) + 0.3 * k), z: 1.6 * (1 - k) + 0.45 * k } : null;
    if (s === t0 + dur + 600) console.log(`threat at ${t0} ms: jumps ${fly.jumps}, cause ${fly.motor.jumpCause}`); }
  if (X.takeoffAt && s % X.takeoffAt === 0 && !fly.flight.active) fly.intrinsic.takeoffUntil = fly.intrinsic.t + 80;   // request a voluntary takeoff
  fly.step();
  if (s % 20 === 0) {
    const st = fly.state(), xm = fly.mjd.xmat, b = fly.bid.thorax * 9, c = fly.cmd;
    const rec = { t: s, x: +st.pos[0].toFixed(3), y: +st.pos[1].toFixed(3), z: +st.pos[2].toFixed(3), yaw: +Math.atan2(xm[b + 3], xm[b]).toFixed(3), up: +xm[b + 8].toFixed(2),
      fwd: +(c.drive ?? M.wmean(M.dn.forward)).toFixed(1), back: +(c.back ?? M.wmean(M.dn.backward)).toFixed(1), tL: +M.wmean(M.dn.turnL).toFixed(1), tR: +M.wmean(M.dn.turnR).toFixed(1),
      v: +(c.v ?? 0).toFixed(2), turn: +(c.turn ?? 0).toFixed(2), gf: +(c.escape ?? 0).toFixed(0), to: +(c.takeoff ?? 0).toFixed(0), groom: +(c.groom ?? 0).toFixed(0),
      bc: (st.bodyContact.left ? 'L' : '') + (st.bodyContact.right ? 'R' : ''), jump: M.jumpT >= 0 ? 1 : 0, beh: fly.behavior(st), intr: fly.intrinsic?.label(), po: st.proboscisOut ? 1 : 0, lz: +st.labellumZ.toFixed(3), sug: +(fly._sugar || 0).toFixed(1), ft: (st.frontTouch?.left ? 'L' : '') + (st.frontTouch?.right ? 'R' : ''), piv: M.pivot ? 1 : 0, why: fly.intrinsic?.avoid?.why, pu: +(st.pitchUp ?? 0).toFixed(2), gate: (fly.t - (fly.lastTouch ?? -1e9) < 500 ? "T" : "") + (fly.t - (fly.lastPivot ?? -1e9) < 300 ? "P" : ""), slow: +(M.toSlow ?? 0).toFixed(0), gfn: (M.gfTimes || []).length, spd: +Math.hypot(st.vel[0], st.vel[1]).toFixed(2), fl: fly.flight?.phase || '', roll: +Math.atan2(xm[b + 7], xm[b + 8]).toFixed(2), pitch: +Math.asin(xm[b + 6]).toFixed(2), vz: +fly.mjd.qvel[2].toFixed(1), vh: +Math.hypot(fly.mjd.qvel[0], fly.mjd.qvel[1]).toFixed(1) };
    if (X.probe) { const g = (ix) => [ix.reduce((a, i) => a + brain.v[i], 0) / ix.length, ix.reduce((a, i) => a + brain.gE[i], 0) / ix.length, ix.reduce((a, i) => a + brain.gI[i], 0) / ix.length, ix.reduce((a, i) => a + brain.bias[i], 0) / ix.length].map(x => +x.toFixed(2));
      rec.types = {}; for (const [i, w] of M.dn.forward) { const t = D.meta.types[i]; rec.types[t] = +((rec.types[t] || 0) + M.rate[i] / D.byType(t).length).toFixed(1); }
      rec.steer = {}; for (const [i] of [...M.dn.turnL, ...M.dn.turnR]) { const k = D.meta.types[i] + (D.side[i] === 1 ? 'L' : 'R'); rec.steer[k] = +((rec.steer[k] || 0) + M.rate[i]).toFixed(1); }
      rec.cmdn = {}; for (const i of fly.intrinsic.ix.fwd) rec.cmdn[D.meta.types[i] + (D.side[i] === 1 ? 'L' : 'R')] = [M.rate[i] ?? 0, brain.v[i], brain.gE[i], brain.gI[i]].map(x => +(+x).toFixed(0));
      const I = fly.intrinsic.ix; rec.pMDN = g(I.back); rec.pTL = g(I.turnL); rec.pTR = g(I.turnR); rec.pF = g(I.fwd); }
    fs.writeSync(f, JSON.stringify(rec) + '\n');
  }
}
console.log(`${scenario}: flights ${fly.flights}, alive ${fly.alive}, energy ${fly.energy.toFixed(2)}, eaten ${(fly.eaten*1000).toFixed(1)}, ${secs}s sim in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${out}; jumps ${fly.jumps}, dist ${fly.dist.toFixed(2)} cm`);
