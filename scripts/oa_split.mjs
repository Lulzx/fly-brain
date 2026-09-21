// Spec S5.3: the octopamine discriminator assay. Four conditions x two hunger states x the oaMode
// operators of docs/40, on the same hunger pathway (AKH / insulin / OA-VUMa / OA-VPM). The split
// table it fills was written down before the first run -- docs/40 records both.
//
//   node scripts/oa_split.mjs [--seeds=1-3] [--modes=thrField,synFast,gainField,thrTyped]
//         [--conds=dnOpen,walkFrac,loomWalk,opticGain] [--ruleoff] [--out=public/data/oa_split.json]
//
// --ruleoff adds the S5.4 variant: every embodied condition rerun with the oaArousalRule scaffold
// off, which is the test of whether any OA operator produces hyperactivity on its own.
import fs from 'node:fs';
import { fork } from 'node:child_process';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
import { BRAIN_DEFAULTS } from '../src/brainmodel.js';

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
const OATARGETS = JSON.parse(fs.readFileSync('public/data/oa_targets.json'));

export const MODES = ['synFast', 'thrField', 'gainField', 'thrTyped'];
export const HUNGER = { fed: 1.0, starved: 0.1 };
// Readout sets. DN pools mirror the motor readout roles (docs/40: the question is whether the
// field reaches the locomotor channel); DNp01 is the giant fibre. T4/T5 over L2 is the optic-lobe
// gain ratio of Suver et al. 2012 -- L2 is the input stage the field does not target.
const DN_SETS = {
  forward: ['DNg100', 'DNg97', 'DNp09', 'DNa05', 'DNa07', 'DNp26', 'DNg25', 'DNa01', 'DNa02'],
  backward: ['MDN'],
  takeoff: ['DNp02', 'DNp04'],
  gf: ['DNp01'],
};
const DN_IDX = Object.fromEntries(Object.entries(DN_SETS).map(([k, ts]) => [k, ts.flatMap(t => D.byType(t))]));
// T4/T5 subtypes (a-d per column); all are flyvis-driven, which is itself part of the split: a
// threshold field cannot move a Poisson-forced neuron, a gain field still scales what it sends.
// Because T4/T5 rates are set by the eye, the spec's "optic-lobe gain" is measured two ways:
// T4/T5 over L2 (the literal spec row -- the flyvis model's own gain) and the visual projection
// neurons downstream of T4/T5 per unit T4/T5 input (where a postsynaptic gain field must appear).
const OPTIC_IDX = {
  t45: ['T4a', 'T4b', 'T4c', 'T4d', 'T5a', 'T5b', 'T5c', 'T5d'].flatMap(t => D.byType(t)),
  l2: D.byType('L2'),
  vpn: [...D.byType('LC4'), ...D.byType('LPLC2'), ...D.byType('LPLC4')],
};

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const flag = k => process.argv.includes(`--${k}`);
const WORKER = process.env.OA_WORKER === '1';
let MJ_WASM = null;
async function ensureLoaded() { if (!MJ_WASM) MJ_WASM = { mj: await loadMujoco(), wasm: fs.readFileSync('public/lif.wasm') }; }

const clearField = env => { env.obstacles = []; env.hazards = []; env.food = []; env.odors = []; env.bitterPatches = []; };

const rate = (brain, idx, prev, ms) => {
  let n = 0; for (const i of idx) n += brain.spikeCount[i] - prev[i];
  for (const i of idx) prev[i] = brain.spikeCount[i];
  return n / Math.max(1, idx.length) / (ms / 1000);
};

/** condition 1: tethered -- a standing fly (intrinsic off, so no bouts and no stepping; the senses
    still feed the brain, but locomotion never does -- no CPG effect on sensors). Measured: DN pool
    rates once the endocrine state has settled. A fully headless brain is silent (no sensory drive
    at all), which is a floor, not a measurement. */
async function runDnOpen(seed, hunger, sugar, oaMode, ruleOff) {
  const o = { ...BRAIN_DEFAULTS, ...BASE, oaMode, oaTargets: OATARGETS };
  // cpg off freezes the legs (the generator is what turns DN drive into steps); intrinsic off
  // removes bouts. Senses still feed the brain -- a tethered preparation: open loop by construction.
  o.scaffolds = { ...(o.scaffolds || {}), cpg: false, ...(ruleOff ? { oaArousalRule: false } : {}) };
  const mem = allocBrainMemory(DATA, SIZE, SIGN, o, 1, VISION);
  const brain = await attachBrain(MJ_WASM.wasm, mem, 0, DATA, (seed * 2654435761) >>> 0); brain.reset();
  const env = structuredClone(DEFAULT_ENV); clearField(env);
  const fly = new FlyAgent({ mj: MJ_WASM.mj, flyXML: FLYXML, env, data: DATA, size: SIZE, sign: SIGN, bodymap: D.bodymap, gait: GAIT,
    brain, brainOpts: o, neuromod: NEUROMOD && { ...NEUROMOD, oaMode, oaTargets: OATARGETS }, pos: [0, 0], yaw: 0, vision: true, intrinsic: false, seed, id: 1,
    flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: VISION.map, gain: 150 } });
  fly.energy = sugar;
  const secs = 20, warm = 8;
  const sets = Object.keys(DN_IDX), prev = Object.fromEntries(sets.map(k => [k, new Uint32Array(brain.N)]));
  const out = { cond: 'dnOpen', seed, hunger, oaMode, ruleOff: !!ruleOff, walkMs: 0 };
  for (let s = 1; s <= secs * 1000; s++) {
    fly.step();
    if (s === warm * 1000) for (const k of sets) for (const i of DN_IDX[k]) prev[k][i] = brain.spikeCount[i];
    if ((fly.motor.stepAmp || 0) > 0.05) out.walkMs += 1;
  }
  for (const k of sets) out[k] = rate(brain, DN_IDX[k], prev[k], (secs - warm) * 1000);
  const rd = fly.neuromod?.readout();
  out.oaTone = rd?.oa; out.arousal = rd?.arousal;
  fly.dispose();
  return out;
}

/** embodied conditions: one FlyAgent per run. `kind` picks the observable set. */
async function runEmbodied(kind, seed, hunger, sugar, oaMode, ruleOff) {
  const o = { ...BRAIN_DEFAULTS, ...BASE, oaMode, oaTargets: OATARGETS };
  if (ruleOff) o.scaffolds = { ...(o.scaffolds || {}), oaArousalRule: false };
  const mem = allocBrainMemory(DATA, SIZE, SIGN, o, 1, VISION);
  const brain = await attachBrain(MJ_WASM.wasm, mem, 0, DATA, (seed * 2654435761) >>> 0); brain.reset();
  const env = structuredClone(DEFAULT_ENV); clearField(env);
  const fly = new FlyAgent({ mj: MJ_WASM.mj, flyXML: FLYXML, env, data: DATA, size: SIZE, sign: SIGN, bodymap: D.bodymap, gait: GAIT,
    brain, brainOpts: o, neuromod: NEUROMOD && { ...NEUROMOD, oaMode, oaTargets: OATARGETS }, pos: [0, 0], yaw: 0, vision: true, intrinsic: true, seed, id: 1,
    flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: VISION.map, gain: 150 } });
  fly.energy = sugar;
  // starved animals are settled at the hunger level before observables start (the endocrine ramp
  // is ~15 s); the loom is thrown after the settle so the GF sees the aroused state
  const settle = 8000;
  const secs = kind === 'loomWalk' ? 12 : 16;
  const threatAt = kind === 'loomWalk' ? settle + 1000 : 0, loomMs = 700;
  const prev = {}; const sets = { ...DN_IDX, t45: OPTIC_IDX.t45, l2: OPTIC_IDX.l2, vpn: OPTIC_IDX.vpn };
  for (const k of Object.keys(sets)) prev[k] = new Uint32Array(brain.N);

  let H = null, gfPrev = 0;
  const r = { cond: kind, seed, hunger, oaMode, ruleOff: !!ruleOff, walkMs: 0, standMs: 0, gfSpikes: 0, gfLoom: 0, takeoffMax: 0, jumps0: fly.jumps,
    t45Walk: 0, t45Stand: 0, l2Walk: 0, l2Stand: 0, vpnWalk: 0, vpnStand: 0, fwdWalk: 0, fwdSum: 0 };
  for (let s = 1; s <= secs * 1000; s++) {
    if (threatAt) {
      if (s === threatAt) { const st = fly.state(); H = { p: st.pos, a: Math.atan2(fly.mjd.xmat[fly.bid.thorax * 9 + 3], fly.mjd.xmat[fly.bid.thorax * 9]) + 0.6 }; }
      const u = H ? Math.min(1, (s - threatAt) / loomMs) : 0, k = u * u;
      env.threat = H && s < threatAt + loomMs + 600 ? { x: H.p[0] + Math.cos(H.a) * (3 * (1 - k) + 0.3 * k), y: H.p[1] + Math.sin(H.a) * (3 * (1 - k) + 0.3 * k), z: 1.6 * (1 - k) + 0.45 * k } : null;
    }
    fly.step();
    if (s > settle && s % 20 === 0) {
      const st = fly.state(), b = fly.behavior(st);
      const walking = /^walking/.test(b) || (fly.motor.stepAmp || 0) > 0.05;
      if (walking) r.walkMs += 20; else r.standMs += 20;
      const gfNow = DN_IDX.gf.reduce((a, i) => a + brain.spikeCount[i], 0);
      r.gfSpikes = Math.max(r.gfSpikes, gfNow);
      if (threatAt && s > threatAt && s <= threatAt + 1500) r.gfLoom += gfNow - gfPrev;
      gfPrev = gfNow;
      r.takeoffMax = Math.max(r.takeoffMax, rate(brain, sets.takeoff, prev.takeoff, 20));
      const r45 = rate(brain, sets.t45, prev.t45, 20), r2 = rate(brain, sets.l2, prev.l2, 20), rv = rate(brain, sets.vpn, prev.vpn, 20);
      if (walking) { r.t45Walk += r45; r.l2Walk += r2; r.vpnWalk += rv; r.fwdWalk++; r.fwdSum += rate(brain, sets.forward, prev.forward, 20); }
      else { r.t45Stand += r45; r.l2Stand += r2; r.vpnStand += rv; }
      rate(brain, sets.backward, prev.backward, 20); rate(brain, sets.gf, prev.gf, 20);   // keep the counters honest
    }
  }
  r.jumps = fly.jumps - r.jumps0;
  r.walkFrac = r.walkMs / (r.walkMs + r.standMs || 1);
  r.t45WalkHz = r.fwdWalk ? r.t45Walk / r.fwdWalk : 0; r.t45StandHz = (r.standMs / 20) ? r.t45Stand / (r.standMs / 20) : 0;
  r.l2WalkHz = r.fwdWalk ? r.l2Walk / r.fwdWalk : 0; r.l2StandHz = (r.standMs / 20) ? r.l2Stand / (r.standMs / 20) : 0;
  r.vpnWalkHz = r.fwdWalk ? r.vpnWalk / r.fwdWalk : 0; r.vpnStandHz = (r.standMs / 20) ? r.vpnStand / (r.standMs / 20) : 0;
  r.opticGainWalk = r.l2WalkHz > 0.5 ? r.t45WalkHz / r.l2WalkHz : null;
  r.opticGainStand = r.l2StandHz > 0.5 ? r.t45StandHz / r.l2StandHz : null;
  r.vpnGainWalk = r.t45WalkHz > 0.5 ? r.vpnWalkHz / r.t45WalkHz : null;
  r.vpnGainStand = r.t45StandHz > 0.5 ? r.vpnStandHz / r.t45StandHz : null;
  r.fwdDnWalkHz = r.fwdWalk ? r.fwdSum / r.fwdWalk : 0;
  const rd = fly.neuromod?.readout(); r.oaTone = rd?.oa; r.arousal = rd?.arousal;
  fly.dispose();
  return r;
}

async function runJob(job) {
  const { cond, seed, hunger, oaMode, ruleOff } = job;
  if (cond === 'dnOpen') return runDnOpen(seed, hunger, HUNGER[hunger], oaMode, ruleOff);
  return runEmbodied(cond, seed, hunger, HUNGER[hunger], oaMode, ruleOff);
}

if (WORKER) {
  await ensureLoaded();
  process.on('message', async ({ job }) => {
    try { process.send({ result: await runJob(job) }); }
    catch (e) { process.send({ result: { cond: job.cond, seed: job.seed, hunger: job.hunger, oaMode: job.oaMode, ruleOff: job.ruleOff, error: String(e.stack || e) } }); }
  });
  process.send({ ready: true });
} else if (process.argv[1] && process.argv[1].endsWith('oa_split.mjs')) {
  await ensureLoaded();
  const seedSpec = arg('seeds') || '1-3';
  const seeds = seedSpec.includes('-') ? Array.from({ length: +seedSpec.split('-')[1] - +seedSpec.split('-')[0] + 1 }, (_, i) => i + +seedSpec.split('-')[0]) : seedSpec.split(',').map(Number);
  const modes = (arg('modes') || MODES.join(',')).split(',');
  const conds = (arg('conds') || 'dnOpen,walkFrac,loomWalk,opticGain').split(',');
  const hungers = (arg('hunger') || 'fed,starved').split(',');
  const ruleOff = flag('ruleoff');
  const jobs = [];
  for (const cond of conds) for (const oaMode of modes) for (const hunger of hungers) for (const seed of seeds)
    jobs.push({ cond, seed, hunger, oaMode, ruleOff });
  const njobs = +(arg('jobs') || 10);
  console.log(`oa_split: ${jobs.length} jobs (${conds.join('/')} x ${modes.join('/')} x ${hungers.join('/')})${ruleOff ? '  oaArousalRule OFF' : ''}`);
  const t0 = Date.now();
  const results = await new Promise(res => {
    const out = new Array(jobs.length); let done = 0, next = 0;
    const workers = Array.from({ length: Math.min(njobs, jobs.length) }, () =>
      fork(process.argv[1], { env: { ...process.env, OA_WORKER: '1' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], serialization: 'advanced' }));
    const give = w => { if (next >= jobs.length) return; const id = next++;
      w._job = id; w.send({ job: jobs[id] }); };
    for (const w of workers) w.on('message', m => {
      if (m.ready) return give(w);
      out[w._job] = m.result; done++;
      process.stdout.write(`\r  ${done}/${jobs.length} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
      done === jobs.length ? (res(out), workers.forEach(x => x.kill())) : give(w);
    });
  });
  console.log('');
  const outFile = arg('out') || 'public/data/oa_split.json';
  const artifact = { version: 1, spec: 'S5.3 octopamine discriminator', seeds, modes, conds, hungers, ruleOff, oaTargetsVersion: OATARGETS.version, results };
  fs.writeFileSync(outFile, JSON.stringify(artifact));
  console.log(`-> ${outFile}`);

  // split table, aggregated over seeds
  const agg = (cond, oaMode, hunger) => results.filter(r => r.cond === cond && r.oaMode === oaMode && r.hunger === hunger && !r.error);
  const mean = (a, f) => a.length ? a.reduce((s, r) => s + (f(r) || 0), 0) / a.length : NaN;
  const f2 = x => Number.isFinite(x) ? x.toFixed(2) : 'n/a';
  console.log('\n== split table (mean over seeds) ==');
  console.log('mode       | walkFrac stv/fed | fwdDN stv/fed | GFloom stv/fed | T45/L2 walk | T45/L2 stand | jumps stv/fed');
  for (const m of modes) {
    const wfs = agg('walkFrac', m, 'starved'), wff = agg('walkFrac', m, 'fed');
    const dnS = agg('dnOpen', m, 'starved'), dnF = agg('dnOpen', m, 'fed');
    const lwS = agg('loomWalk', m, 'starved'), lwF = agg('loomWalk', m, 'fed');
    const ogW = agg('opticGain', m, 'starved'), ogF = agg('opticGain', m, 'fed');
    const ogw = mean([...ogW, ...ogF], r => r.opticGainWalk), ogs = mean([...ogW, ...ogF], r => r.opticGainStand);
    const vgw = mean([...ogW, ...ogF], r => r.vpnGainWalk), vgs = mean([...ogW, ...ogF], r => r.vpnGainStand);
    const row = [
      f2(mean(wfs, r => r.walkFrac) / Math.max(1e-9, mean(wff, r => r.walkFrac))),
      f2(mean(dnS, r => r.forward) / Math.max(1e-9, mean(dnF, r => r.forward))),
      `${f2(mean(lwS, r => r.gfLoom))}/${f2(mean(lwF, r => r.gfLoom))}`,
      `${f2(ogw)}/${f2(ogs)}  vpn:${f2(vgw)}/${f2(vgs)}`,
      `${f2(mean(lwS, r => r.jumps))}/${f2(mean(lwF, r => r.jumps))}`,
    ];
    console.log(`${m.padEnd(10)} | ${row.join(' | ')}`);
  }
  const errors = results.filter(r => r.error);
  if (errors.length) { console.log(`\n${errors.length} job errors:`); for (const e of errors.slice(0, 5)) console.log(`  ${e.cond}/${e.oaMode}/${e.hunger}/s${e.seed}: ${e.error.split('\n')[0]}`); }
  process.exit(errors.length === results.length ? 1 : 0);
}
