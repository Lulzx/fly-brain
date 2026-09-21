// Record the S2 fit data: a live descending-mode run, sampled per 20 ms epoch.
//
// For the VNC leg-premotor subgraph the boundary is every neuron whose live inputs the frozen
// edge set does not fully contain: descending command neurons, VNC sensory neurons, and every
// premotor node with an excised presynaptic partner. All are driven inputs in the twin -- so what
// the fit needs from the live animal is, per epoch:
//
//   in   per-neuron spike rate of every boundary node (DN + sensory; sensory spike counts equal
//        the rate the senses wrote, Poisson-sampled -- the same signal the graph saw)
//   out  the actuator ctrl the stepping generator wrote (the premotor map's target output)
//   ctx  joint angles, claw contacts, position -- for the kinematic loss and the eval
//
// The recorded ctrl is the CPG's output -- itself the FlySuite-fitted gait (body/gait/data_gait.json),
// which is how the spec's primary data enters: the target is the muscle command that produces real
// walking in this body, not the scaffold's internals. The fit then asks whether the VNC wiring can
// implement that map; the scramble control decides whether the wiring was load-bearing.
//
//   node scripts/record_vnc_fitdata.mjs --seeds=1-10 --secs=20 --out=public/data/vnc_fitdata
import fs from 'node:fs';
import { fork } from 'node:child_process';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
import { BRAIN_DEFAULTS } from '../src/brainmodel.js';
import { extractVncSubgraph } from '../src/vnc/subgraph.js';

const D = loadAll(); const DATA = { ...D, superclass: D.sc };
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const GAIT = JSON.parse(fs.readFileSync('public/body/gait.json'));
const FLYXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const FB = fs.readFileSync('public/vision/flyvis.bin');
const VISION = { model: parseFlyVis(FB.buffer.slice(FB.byteOffset, FB.byteOffset + FB.byteLength), JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))), map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();
const NEUROMOD = loadNeuromod();
const SUB = extractVncSubgraph(D);

const EPOCH_MS = 20;
const boundary = [];  for (let k = 0; k < SUB.N; k++) if (SUB.isBoundary[k]) boundary.push(k);
const boundaryOrig = boundary.map(k => SUB.origIdx[k]);
const mnList = [...new Set(SUB.mn.map(m => m.sub))];
const mnOrig = mnList.map(k => SUB.origIdx[k]);
// leg actuators the subgraph must be able to write: every actuator a leg muscle maps to
const legActuators = [...new Set(SUB.mn.map(m => m.actuator))].sort();
const JOINTS = /^(tibia|coxa|femur|tarsus|trochanter|coxa_abduct|coxa_twist|femur_twist)_T/;
const jointNames = [];   // filled per worker from the model

async function runOne(seed, secs) {
  const o = { ...BRAIN_DEFAULTS, ...BASE };
  const mem = allocBrainMemory(DATA, SIZE, SIGN, o, 1, VISION);
  const brain = await attachBrain(MJ_WASM.wasm, mem, 0, DATA, (seed * 2654435761) >>> 0); brain.reset();
  const env = structuredClone(DEFAULT_ENV);
  const fly = new FlyAgent({ mj: MJ_WASM.mj, flyXML: FLYXML, env, data: DATA, size: SIZE, sign: SIGN, bodymap: D.bodymap, gait: GAIT,
    brain, brainOpts: o, mode: 'descending', neuromod: o.neuromod === false ? null : NEUROMOD, pos: [-0.2, 0.6], yaw: 0,
    vision: true, intrinsic: true, seed, id: 1,
    flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: VISION.map, gain: 150 } });
  const joints = Object.keys(fly.jointAdr).filter(n => JOINTS.test(n)).sort();
  const actIdx = legActuators.map(n => fly.motor.act[n]).map((i, k) => i === undefined ? -1 : i);
  const missing = legActuators.filter((_, k) => actIdx[k] < 0);
  if (missing.length) throw new Error(`actuators missing from model: ${missing.join(', ')}`);
  const nEp = Math.floor(secs * 1000 / EPOCH_MS);
  const rates = new Float32Array(nEp * boundary.length);
  const mnRates = new Float32Array(nEp * mnList.length);
  const ctrl = new Float32Array(nEp * legActuators.length);
  const jointQ = new Float32Array(nEp * joints.length);
  const ctx = new Float32Array(nEp * 11);         // pos xyz, gyro z, stepping, 6 claw contact flags
  // per-step spike trains on the boundary: the premotor code is synchronous, so the fit replays
  // spike times, not just epoch rates. At 1 ms resolution a delta >1 is possible but rare; each
  // emitted pair is (fly step, boundary position).
  const trainStep = [], trainIdx = [];
  const prev = new Uint32Array(DATA.N), prevMn = new Uint32Array(DATA.N), prevStep = new Uint32Array(DATA.N);
  const ctrlAcc = new Float64Array(legActuators.length);
  for (let s = 1; s <= secs * 1000; s++) {
    fly.step();
    const cd = fly.motor.data.ctrl;
    for (let a = 0; a < legActuators.length; a++) ctrlAcc[a] += cd[actIdx[a]];
    for (let k = 0; k < boundary.length; k++) {
      const i = boundaryOrig[k], d0 = brain.spikeCount[i] - prevStep[i];
      if (d0 > 0) { prevStep[i] = brain.spikeCount[i]; for (let n = 0; n < d0; n++) { trainStep.push(s - 1); trainIdx.push(k); } }
    }
    if (s % EPOCH_MS === 0) {
      const ep = s / EPOCH_MS - 1, st = fly.state();
      for (let k = 0; k < boundary.length; k++) { const i = boundaryOrig[k]; rates[ep * boundary.length + k] = (brain.spikeCount[i] - prev[i]) * (1000 / EPOCH_MS); prev[i] = brain.spikeCount[i]; }
      for (let k = 0; k < mnList.length; k++) { const i = mnOrig[k]; mnRates[ep * mnList.length + k] = (brain.spikeCount[i] - prevMn[i]) * (1000 / EPOCH_MS); prevMn[i] = brain.spikeCount[i]; }
      for (let a = 0; a < legActuators.length; a++) { ctrl[ep * legActuators.length + a] = ctrlAcc[a] / EPOCH_MS; ctrlAcc[a] = 0; }
      for (let j = 0; j < joints.length; j++) jointQ[ep * joints.length + j] = st.joint[joints[j]] ?? 0;
      const claws = ['T1_left', 'T1_right', 'T2_left', 'T2_right', 'T3_left', 'T3_right'].map(k => (st.claw[k]?.[2] ?? 1) < 0.06 ? 1 : 0);
      ctx.set([st.pos[0], st.pos[1], st.pos[2], st.gyro[2], st.stepping, ...claws], ep * 11);
    }
  }
  fly.dispose();
  return { seed, nEp, joints, rates, mnRates, ctrl, jointQ, ctx,
    trainStep: Uint32Array.from(trainStep), trainIdx: Uint32Array.from(trainIdx) };
}

// ------------------------------------------------------------------ driver
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const WORKER = !!process.env.RECFIT_WORKER;
let MJ_WASM = null;

if (WORKER) {
  MJ_WASM = { mj: await loadMujoco(), wasm: fs.readFileSync('public/lif.wasm') };
  process.on('message', async ({ job }) => {
    try { const r = await runOne(job.seed, job.secs);
      process.send({ result: { seed: r.seed, nEp: r.nEp, joints: r.joints }, arrays: {
        rates: r.rates, mnRates: r.mnRates, ctrl: r.ctrl, jointQ: r.jointQ, ctx: r.ctx,
        trainStep: r.trainStep, trainIdx: r.trainIdx } });
    } catch (e) { process.send({ result: { seed: job.seed, error: String(e.stack || e) } }); }
  });
  process.send({ ready: true });
} else {
  const seeds = (arg('seeds') || '1-10').includes('-')
    ? Array.from({ length: +arg('seeds').split('-')[1] - +arg('seeds').split('-')[0] + 1 }, (_, i) => i + +arg('seeds').split('-')[0])
    : arg('seeds').split(',').map(Number);
  const secs = +(arg('secs') || 20);
  const outBase = arg('out') || 'public/data/vnc_fitdata';
  const njobs = +(arg('jobs') || Math.min(10, seeds.length));
  const t0 = Date.now();
  console.log(`record_vnc_fitdata: ${seeds.length} seeds x ${secs}s, ${boundary.length} boundary nodes, ${mnList.length} MNs, ${legActuators.length} leg actuators`);
  const results = await new Promise(res => {
    const out = []; let done = 0, next = 0;
    const workers = Array.from({ length: Math.min(njobs, seeds.length) }, () =>
      fork(process.argv[1], { env: { ...process.env, RECFIT_WORKER: '1' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], serialization: 'advanced', maxOldSpaceSize: 8192 }));
    const give = w => { if (next >= seeds.length) return; w._job = next; w.send({ job: { seed: seeds[next++], secs } }); };
    for (const w of workers) w.on('message', m => {
      if (m.ready) return give(w);
      out[w._job] = m; done++;
      process.stdout.write(`\r  ${done}/${seeds.length} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
      done === seeds.length ? (res(out), workers.forEach(x => x.kill())) : give(w);
    });
  });
  console.log('');
  // layout meta + one concatenated binary: [rates | mnRates | ctrl | jointQ | ctx | trainStep | trainIdx] per run
  const meta = { version: 2, epochMs: EPOCH_MS, secs, seeds,
    boundary: boundaryOrig, mnOrig, legActuators, jointNames: results[0]?.result.joints,
    layout: 'Float32 LE per run in seed order: rates nEp*nboundary, mnRates nEp*nMn, ctrl nEp*nAct, jointQ nEp*nJoint, ctx nEp*11; then Uint32 trainStep/trainIdx (nSpike pairs, fly-step 1ms resolution)' };
  const chunks = [];
  for (const r of results) {
    if (r.result.error) throw new Error(`seed ${r.result.seed}: ${r.result.error}`);
    for (const k of ['rates', 'mnRates', 'ctrl', 'jointQ', 'ctx'])
      chunks.push(Buffer.from(r.arrays[k].buffer, r.arrays[k].byteOffset, r.arrays[k].byteLength));
    chunks.push(Buffer.from(r.arrays.trainStep.buffer, r.arrays.trainStep.byteOffset, r.arrays.trainStep.byteLength));
    chunks.push(Buffer.from(r.arrays.trainIdx.buffer, r.arrays.trainIdx.byteOffset, r.arrays.trainIdx.byteLength));
    (meta.runs ||= []).push({ seed: r.result.seed, nEp: r.result.nEp, nSpike: r.arrays.trainStep.length });
  }
  fs.writeFileSync(outBase + '.bin', Buffer.concat(chunks));
  fs.writeFileSync(outBase + '.json', JSON.stringify(meta, null, 1));
  console.log(`-> ${outBase}.bin + .json`);
}
