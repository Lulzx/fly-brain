// Loom-pathway protocol (spec S3.4): four conditions on the same seeds, measuring whether the
// takeoff channel separates self-motion from a predator.
//
//   gait   walking in an open arena -- reafferent flow only.   expect: takeoff < 70 Hz, no jump
//   turn   boxed in by obstacles, pivoting in place.           expect: no jump
//   disk   expanding dark disk on a standing animal.           expect: jump in >= 8/10
//   wall   walking toward the arena wall -- self-motion loom.  expect: no jump IF the cancel works
//
// The loom parameters are the behaviour eval's (threatAt 2000 ms, loomMs 700, the same 3 mm ->
// 0.3 mm swoop along the head axis), not retuned per seed (spec S3.4).
//
// The script doubles as its own worker (the behavior_eval protocol): the parent fans (condition x
// seed) jobs over forks and reports per-condition takeoff-DN statistics and jump counts.
// --trace=<file> additionally records, per 20 ms optic-lobe epoch, the feature vector the
// reafference forward model sees (u = filtered DN readouts, p = leg joint velocities) and the
// target-population spike rates -- the tensor scripts/reafference_fit.mjs fits against.
//
//   node scripts/loom_protocol.mjs --seeds=1-10 --off=escapeGate
//   node scripts/loom_protocol.mjs --conds=gait,turn --trace=/tmp/reafference_trace.json
import fs from 'node:fs';
import { fork } from 'node:child_process';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
import { BRAIN_DEFAULTS } from '../src/brainmodel.js';
import { cancelFeatures } from '../src/vision/cancel.js';

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

// The loom pathway's readout set (spec S3.2): the projection neurons the optic lobe converges on,
// the two non-GF escape DNs and the giant fibre itself. None is flyvis-driven -- the optic-lobe
// model stops at the columnar types -- so what reaches them is membrane drive through the graph,
// which is the level the S3 forward model predicts at.
export const TARGET_TYPES = ['LC4', 'LPLC2', 'DNp02', 'DNp04', 'DNp01'];
export const TARGETS = TARGET_TYPES.flatMap(t => D.byType(t));
const JOINT_RE = /^(tibia|coxa)_T/;

const clearField = env => { env.obstacles = []; env.hazards = []; env.food = []; env.odors = []; env.bitterPatches = []; };
// The four conditions of S3.4. `yaw` faces -y (toward the nearest point of the r = 2.5 arena wall)
// where a wall approach is wanted.
export const CONDITIONS = {
  // walking in an open arena: translational optic flow from the floor and walls, no looming object
  gait: { secs: 8, setup: env => { clearField(env); return [[0, 0], 0]; } },
  // a tight corral of posts: every forward step reaches an antenna, so the avoidance reflex keeps
  // the fly pivoting in place -- rotational self-flow
  turn: { secs: 8, setup: env => { clearField(env);
    for (const [x, y] of [[0.26, 0], [-0.26, 0], [0, 0.26], [0, -0.26]])
      env.obstacles.push({ type: 'cylinder', x, y, r: 0.05, sz: 0.3 });
    return [[0, 0], 0]; } },
  // the escape assay proper: the expanding dark disk of loom_disk, unchanged
  disk: { secs: 4, setup: env => { clearField(env); return [[0, 0], 0]; }, threatAt: 2000, loomMs: 700 },
  // facing the arena wall 0.8 m away: an approach bout makes the wall loom by self-motion alone
  wall: { secs: 8, setup: env => { clearField(env); return [[0, -1.7], -Math.PI / 2]; } },
};

const quantile = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/** one condition on one seed. opts: { cfg, trace, model }. Returns observables (+ trace). */
export async function runCondition(name, seed, opts = {}) {
  const sc = CONDITIONS[name];
  if (!sc) throw new Error(`unknown condition '${name}'`);
  const o = { ...BRAIN_DEFAULTS, ...BASE, ...(opts.cfg || {}) };
  if (opts.model) o.scaffoldParams = { ...(o.scaffoldParams || {}), reafference: { ...(o.scaffoldParams?.reafference || {}), model: opts.model } };
  const mem = allocBrainMemory(DATA, SIZE, SIGN, o, 1, VISION);
  const brain = await attachBrain(MJ_WASM.wasm, mem, 0, DATA, (seed * 2654435761) >>> 0); brain.reset();
  const env = structuredClone(DEFAULT_ENV);
  const [pos, yaw] = sc.setup(env);
  const fly = new FlyAgent({ mj: MJ_WASM.mj, flyXML: FLYXML, env, data: DATA, size: SIZE, sign: SIGN, bodymap: D.bodymap, gait: GAIT,
    brain, brainOpts: o, neuromod: o.neuromod === false ? null : NEUROMOD, pos, yaw, vision: !opts.novision, intrinsic: true, seed, id: 1,
    // --novision: no eye at all -- splits self-motion takeoff noise into visual vs intrinsic drive
    flyvis: opts.novision ? null : { eyes: attachEyes(brain.instance, mem, 0), map: VISION.map, gain: 150 } });
  const jointNames = Object.keys(fly.jointDof).filter(n => JOINT_RE.test(n)).sort();
  const takeoffs = [], gfs = [], behaves = {};
  const trace = opts.trace ? { jointNames, targets: TARGETS, epochs: [] } : null;
  // the feature filter runs at the step cadence, exactly as the plugin's -- the fit then sees the
  // signal the model will see, not a coarser resample of it
  const filt = trace || opts.biasDelta ? { jointNames, p: new Float64Array(jointNames.length) } : null;
  const spikePrev = new Uint32Array(TARGETS.length);
  const ratePre = new Float64Array(TARGETS.length), ratePost = new Float64Array(TARGETS.length);
  let nPre = 0, nPost = 0, lastU = [0, 0, 0, 0, 0];
  let H = null, escaped = false;
  for (let s = 1; s <= sc.secs * 1000; s++) {
    // the sensitivity-calibration mode: a fixed negative bias on the targets from 3 s on, measuring
    // dRate/dBias in the live animal. The bias persists in the kernel state (nothing else writes it
    // when the reafference model is unloaded).
    if (opts.biasDelta && s === 3000) brain.setBias(TARGETS, opts.biasDelta);
    if (filt) {   // features are read from the state fly.step() is about to see
      const qv = {}; const q = fly.mjd.qvel, dof = fly.jointDof;
      for (const n of jointNames) qv[n] = q[dof[n]];
      lastU = cancelFeatures(fly, { jointVel: qv }, 1, filt).u;
    }
    if (sc.threatAt) {
      if (s === sc.threatAt) { const st = fly.state(); H = { p: st.pos, a: Math.atan2(fly.mjd.xmat[fly.bid.thorax * 9 + 3], fly.mjd.xmat[fly.bid.thorax * 9]) + 0.6 }; }
      const u = H ? Math.min(1, (s - sc.threatAt) / sc.loomMs) : 0, k = u * u;
      env.threat = H && s < sc.threatAt + sc.loomMs + 600 ? { x: H.p[0] + Math.cos(H.a) * (3 * (1 - k) + 0.3 * k), y: H.p[1] + Math.sin(H.a) * (3 * (1 - k) + 0.3 * k), z: 1.6 * (1 - k) + 0.45 * k } : null;
    }
    fly.step();
    if (s % 20 === 0) {
      const cmd = fly.motor.cmd, st = fly.state();
      takeoffs.push(cmd.takeoff || 0); gfs.push(cmd.escape || 0);
      const b = fly.behavior(st); behaves[b] = (behaves[b] || 0) + 20;
      if (!escaped && (fly.jumps > 0 || fly.flight.active)) escaped = true;
      if (trace || opts.biasDelta) {
        const rate = TARGETS.map((tg, k) => { const n = brain.spikeCount[tg] - spikePrev[k]; spikePrev[k] = brain.spikeCount[tg]; return n * 50; });
        if (opts.biasDelta) {   // pre window 1.5-3 s, post window after a 200 ms settle
          if (s > 1500 && s <= 3000) { nPre++; for (let k = 0; k < rate.length; k++) ratePre[k] += rate[k]; }
          if (s > 3200) { nPost++; for (let k = 0; k < rate.length; k++) ratePost[k] += rate[k]; }
        }
        if (trace) trace.epochs.push({ t: s, u: lastU.slice(), p: Array.from(filt.p), takeoff: cmd.takeoff || 0, rate });
      }
    }
  }
  fly.dispose();
  const r = { cond: name, seed, takeoffMax: Math.max(...takeoffs), takeoffP95: quantile(takeoffs, 0.95),
    takeoffMean: takeoffs.reduce((a, x) => a + x, 0) / takeoffs.length,
    gfMax: Math.max(...gfs), jumps: fly.jumps, escaped: escaped ? 1 : 0, dist: fly.dist, behaves };
  if (trace) r.trace = trace;
  if (opts.biasDelta) { for (let k = 0; k < TARGETS.length; k++) { ratePre[k] /= Math.max(1, nPre); ratePost[k] /= Math.max(1, nPost); }
    r.ratePre = Array.from(ratePre); r.ratePost = Array.from(ratePost); r.biasDelta = opts.biasDelta; }
  return r;
}

// ------------------------------------------------------------------ driver
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const flag = k => process.argv.includes(`--${k}`);
const WORKER = !!process.env.LOOM_WORKER;
let MJ_WASM = null;
async function ensureLoaded() { if (!MJ_WASM) MJ_WASM = { mj: await loadMujoco(), wasm: fs.readFileSync('public/lif.wasm') }; }

if (WORKER) {
  await ensureLoaded();
  process.on('message', async ({ job }) => {
    try { process.send({ result: await runCondition(job.cond, job.seed, job.opts) }); }
    catch (e) { process.send({ result: { cond: job.cond, seed: job.seed, error: String(e.stack || e) } }); }
  });
  process.send({ ready: true });
} else if (process.argv[1] && process.argv[1].endsWith('loom_protocol.mjs')) {
  const seedSpec = arg('seeds') || '1-10';
  const seeds = seedSpec.includes('-') ? Array.from({ length: +seedSpec.split('-')[1] - +seedSpec.split('-')[0] + 1 }, (_, i) => i + +seedSpec.split('-')[0]) : seedSpec.split(',').map(Number);
  const conds = (arg('conds') || 'gait,turn,disk,wall').split(',');
  const off = (arg('off') || '').split(',').filter(Boolean);
  const modelFile = arg('model');
  const traceFile = arg('trace');
  const biasDelta = arg('bias') ? +arg('bias') : 0;
  // auto-load the fitted model once it exists; --nomodel and calibration runs (--bias) stay clean
  const model = modelFile ? JSON.parse(fs.readFileSync(modelFile))
    : (biasDelta || flag('nomodel') ? null : (fs.existsSync('public/data/reafference.json') ? JSON.parse(fs.readFileSync('public/data/reafference.json')) : null));
  const njobs = +(arg('jobs') || 10);
  const jobs = []; for (const cond of conds) for (const seed of seeds) jobs.push({ cond, seed });
  const cfg = off.length ? { scaffolds: Object.fromEntries(off.map(id => [id, false])) } : {};
  const t0 = Date.now();
  console.log(`loom protocol: ${jobs.length} jobs (${conds.join('/')} x seeds ${seeds.join(',')})` +
    `${off.length ? ' off=' + off.join(',') : ''}${model ? ' +reafference model' : ''}${flag('novision') ? ' NO-VISION' : ''}${biasDelta ? ' bias=' + biasDelta : ''}`);
  const results = await new Promise(res => {
    const out = new Array(jobs.length); let done = 0, next = 0;
    const workers = Array.from({ length: Math.min(njobs, jobs.length) }, () =>
      fork(process.argv[1], { env: { ...process.env, LOOM_WORKER: '1' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }));
    const give = w => { if (next >= jobs.length) return; const id = next++;
      w._job = id; w.send({ job: { ...jobs[id], opts: { cfg, trace: !!traceFile, model, biasDelta, novision: flag('novision') } } }); };
    for (const w of workers) w.on('message', m => {
      if (m.ready) return give(w);
      out[w._job] = m.result; done++;
      process.stdout.write(`\r  ${done}/${jobs.length} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
      done === jobs.length ? (res(out), workers.forEach(x => x.kill())) : give(w);
    });
  });
  console.log('');
  // per-condition table
  console.log('cond   seed  takeoffMax  p95   mean   gfMax  jumps  escaped  walkMs  turnMs  dist');
  for (const r of results) {
    if (r.error) { console.log(`${r.cond}  ${r.seed}  ERROR ${r.error.split('\n')[0]}`); continue; }
    const walk = Object.entries(r.behaves).filter(([b]) => /^walking/.test(b)).reduce((a, [, v]) => a + v, 0);
    const turn = Object.entries(r.behaves).filter(([b]) => /^turning/.test(b)).reduce((a, [, v]) => a + v, 0);
    console.log(`${r.cond.padEnd(6)} ${String(r.seed).padEnd(4)} ${r.takeoffMax.toFixed(1).padStart(8)} ${r.takeoffP95.toFixed(1).padStart(6)} ${r.takeoffMean.toFixed(1).padStart(6)} ${r.gfMax.toFixed(1).padStart(6)} ${String(r.jumps).padStart(5)} ${String(r.escaped).padStart(7)} ${String(walk).padStart(6)} ${String(turn).padStart(6)} ${r.dist.toFixed(2)}`);
  }
  // acceptance summary per spec S3.7
  const byCond = c => results.filter(r => r.cond === c && !r.error);
  const jumps = c => byCond(c).filter(r => r.jumps > 0 || r.escaped).length;
  const n = c => byCond(c).length;
  console.log('\n-- acceptance (S3.7): disk >= 8/10 escapes; gait/turn/wall <= 1/10 false jumps --');
  for (const c of conds) console.log(`  ${c.padEnd(5)} ${jumps(c)}/${n(c)} jumped`);
  if (traceFile) {
    const tr = { conditions: conds.filter(c => c !== 'disk'), seeds, off, epochs: {} };
    for (const r of results) if (r.trace) tr.epochs[`${r.cond}:${r.seed}`] = r.trace;
    fs.writeFileSync(traceFile, JSON.stringify(tr));
    console.log(`traces -> ${traceFile}`);
  }
  const resultsFile = arg('results');
  if (resultsFile) {   // raw per-run rows (incl. ratePre/ratePost for --bias calibrations)
    fs.writeFileSync(resultsFile, JSON.stringify({ conds, seeds, off, biasDelta, results }));
    console.log(`results -> ${resultsFile}`);
  }
}
