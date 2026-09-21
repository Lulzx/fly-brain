// Worker process: runs the embodied behavioural assays for one parameter set (roadmap item A1).
//
// The physiological benchmark (scripts/calib_eval.mjs) scores firing rates and sparseness fractions.
// This scores what the whole animal does in the arena, which is the set of substitutions doc 31 says
// cannot break there: posture, stepping and bout structure are supplied by machinery outside the
// connectome, so a graph ablation has to travel through the body to show up at all. The six observables
// are flips, deaths, distance to food, feeding latency, walk-bout length and escape rate; see
// docs/35-behaviour-ladder.md for where each target comes from.
//
// Exports evaluate(cfg) and doubles as a forkable worker, the same protocol as calib_eval.mjs.
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';
import { BRAIN_DEFAULTS } from '../src/brainmodel.js';
import { motorPools } from './motor_pools.mjs';

const D = loadAll(); const DATA = { ...D, superclass: D.sc };
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const ALL_EXC = new Float32Array(D.N).fill(1);
const GAIT = JSON.parse(fs.readFileSync('public/body/gait.json'));
const FLYXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const FB = fs.readFileSync('public/vision/flyvis.bin');
const VISION = { model: parseFlyVis(FB.buffer.slice(FB.byteOffset, FB.byteOffset + FB.byteLength), JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))), map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
const MJ = await loadMujoco(); const WASM = fs.readFileSync('public/lif.wasm');
// Motor-pool rates are read out of the same runs as the behaviour, which is what makes roadmap item M6
// a fair comparison: the two observables come from one animal on one trial, so the only thing that
// differs between them is the read-out. They are reported as `mn_<pool>` and never scored.
const POOLS = motorPools(D);
const NEUROMOD = loadNeuromod();

// Weight-vector variants. Same definitions as scripts/calib_eval.mjs: the physiological benchmark needs
// these to build the graph, and the embodied path reaches them by transforming the data object before
// the graph is written, because src/brainsetup.js writes data.weights straight through.
const mulberry32 = a => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function weightsFor(o) {
  if (o.wEB) { const b = fs.readFileSync('public/data/edge_w_shrunk.u16');
    const w = new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    if (w.length !== DATA.weights.length) throw new Error('edge_w_shrunk.u16 does not match the graph'); return w; }
  if (!o.wBinary && !o.wShuffle) return DATA.weights;
  const min = o.minSyn ?? 1, src = DATA.weights, kept = [];
  for (let k = 0; k < src.length; k++) if (src[k] >= min) kept.push(k);
  const w = Float32Array.from(src);
  if (o.wBinary) { let m = 0; for (const k of kept) m += src[k]; m /= Math.max(1, kept.length); for (const k of kept) w[k] = m; }
  else { const vals = kept.map(k => src[k]), rnd = mulberry32((o.seed ?? 1) >>> 0);
    for (let i = vals.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [vals[i], vals[j]] = [vals[j], vals[i]]; }
    kept.forEach((k, i) => { w[k] = vals[i]; }); }
  return w;
}

// The five scenarios of scripts/behavior_report.mjs, with the six observables A1 asks for pulled out of
// them. `forage` supplies the bout statistics and the food approach; `onfood` the feeding latency;
// `threat` the escape; `heat` and `bitter` the two ways the animal can lose health.
const SCENARIOS = {
  forage: { secs: 20, setup: env => [[-0.2, 0.6], 0] },
  onfood: { secs: 4, setup: env => [[env.food[0].x - 0.05, env.food[0].y], 0] },
  threat: { secs: 4, setup: env => [[0, 0], 0], threatAt: 2000, loomMs: 700 },
  heat: { secs: 4, setup: env => [[env.hazards[0].x, env.hazards[0].y], 0] },
  bitter: { secs: 4, setup: env => [[env.bitterPatches[0].x - 0.05, env.bitterPatches[0].y], 0] },
};

const clamp = x => Math.max(0, Math.min(1, x));
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

async function runSeed(cfg, seed) {
  const o = { ...BRAIN_DEFAULTS, ...cfg };
  const data = (o.wBinary || o.wShuffle || o.wEB) ? { ...DATA, weights: weightsFor({ ...o, seed }) } : DATA;
  const mem = allocBrainMemory(data, SIZE, o.signFree ? ALL_EXC : SIGN, o, 1, VISION);
  const brain = await attachBrain(WASM, mem, 0, data, (seed * 2654435761) >>> 0); brain.reset();
  const obs = { flipMs: 0, totalMs: 0, alive: 1, foodDist: 1e9, feedLatency: null, escapes: 0, walkBouts: [], schedBouts: [] };
  const mnSpikes = Object.fromEntries(Object.keys(POOLS).map(k => [k, 0]));   // spikes per pool, summed over scenarios
  let mnMs = 0;
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    // Each scenario starts from a clean brain and fresh eyes, as scripts/behavior_report.mjs does by
    // building a new fly per scenario: a stale membrane potential or a stale eye state would make the
    // scenarios order-dependent, and the order is an implementation detail.
    brain.reset();
    const mnPrev = Uint32Array.from(brain.spikeCount);   // reset() zeroes the counts; kept explicit
    const env = structuredClone(DEFAULT_ENV);
    const [pos, yaw] = sc.setup(env);
    const fly = new FlyAgent({ mj: MJ, flyXML: FLYXML, env, data, size: SIZE, sign: SIGN, bodymap: D.bodymap, gait: GAIT,
      brain, brainOpts: o, neuromod: o.neuromod === false ? null : NEUROMOD, pos, yaw, vision: true, intrinsic: true, seed, id: 1,
      flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: VISION.map, gain: 150 } });
    fly.others = [];
    let H = null, fed = false, escaped = false, running = 0, lastMoving = false, schedRun = 0, lastSchedWalk = false;
    for (let s = 1; s <= sc.secs * 1000; s++) {
      if (sc.threatAt) {
        if (s === sc.threatAt) { const st = fly.state(); H = { p: st.pos, a: Math.atan2(fly.mjd.xmat[fly.bid.thorax * 9 + 3], fly.mjd.xmat[fly.bid.thorax * 9]) + 0.6 }; }
        const u = H ? Math.min(1, (s - sc.threatAt) / sc.loomMs) : 0, k = u * u;
        env.threat = H && s < sc.threatAt + sc.loomMs + 600 ? { x: H.p[0] + Math.cos(H.a) * (3 * (1 - k) + 0.3 * k), y: H.p[1] + Math.sin(H.a) * (3 * (1 - k) + 0.3 * k), z: 1.6 * (1 - k) + 0.45 * k } : null;
      }
      fly.step();
      if (s % 20 === 0) {
        const st = fly.state(), b = fly.behavior(st);
        obs.totalMs += 20;
        if (b === 'righting') obs.flipMs += 20;
        if (b === 'feeding' && !fed) { fed = true; if (name === 'onfood') obs.feedLatency = s; }
        if (name === 'forage') obs.foodDist = Math.min(obs.foodDist, Math.hypot(st.pos[0] - env.food[0].x, st.pos[1] - env.food[0].y));
        // Two bout measurements, and the gap between them is the point. `sched` is the supplied
        // scheduler's own walk state, which is the quantity docs/23-behaviour.md calibrates to a 2.2 s
        // median. `body` is what the animal actually did, read off the motor command, which is also
        // where the brain has its say. The term is scored on the scheduler (that is the claim being
        // tested); the body version is reported next to it.
        //
        // Both run over every scenario, not just `forage`. A bout is a property of the fly rather than
        // of the context, and pooling the five scenarios more than triples the number of bouts a single
        // seed contributes -- which matters, because a median over the two or three bouts that fit in a
        // 20 s forage is noise.
        const moving = /^(walking|turning)/.test(b);
        if (moving) running += 20;
        else if (lastMoving && running > 0) { obs.walkBouts.push(running); running = 0; }
        lastMoving = moving;
        const sw = fly.intrinsic?.state === 'walk';
        if (sw) schedRun += 20;
        else if (lastSchedWalk && schedRun > 0) { obs.schedBouts.push(schedRun); schedRun = 0; }
        lastSchedWalk = sw;
        if (name === 'threat' && !escaped && (fly.jumps > 0 || fly.flight.active)) escaped = true;
      }
    }
    for (const [k, p] of Object.entries(POOLS)) { let n = 0; for (const i of p.idx) n += brain.spikeCount[i] - mnPrev[i]; mnSpikes[k] += n; }
    mnMs += sc.secs * 1000;
    if (running > 0) obs.walkBouts.push(running);
    if (schedRun > 0) obs.schedBouts.push(schedRun);
    if (!fly.alive) obs.alive = 0;
    if (name === 'threat') obs.escapes = escaped ? 1 : 0;
    // The agent owns ~28 MB of emscripten heap that the collector never sees; five scenarios per
    // evaluation and dozens of evaluations per worker reach the 2 GB heap limit without this.
    fly.dispose();
  }
  if (obs.foodDist > 1e8) obs.foodDist = 1.2;
  // "never fed" is the length of the assay, not null. It scored the same either way -- clamp(1 - 4000/2000)
  // is 0, which is what the null branch returned -- and as a number it survives being averaged across
  // seeds and being read as an observable, which scripts/motor_identify.mjs does.
  if (obs.feedLatency == null) obs.feedLatency = SCENARIOS.onfood.secs * 1000;
  obs.flipFrac = obs.flipMs / Math.max(1, obs.totalMs);
  obs.boutMedian = median(obs.schedBouts);
  obs.boutMean = mean(obs.schedBouts);
  obs.boutN = obs.schedBouts.length;
  obs.bodyBoutMedian = median(obs.walkBouts);
  obs.bodyBoutN = obs.walkBouts.length;
  delete obs.walkBouts; delete obs.schedBouts;
  for (const [k, n] of Object.entries(mnSpikes)) obs['mn_' + k] = n / POOLS[k].n / (mnMs / 1000);
  return obs;
}

// Targets, with sources. Anything not sourced below is reported and not scored, which is deliberate:
// doc 31's lesson is that a term scored against an unmeasured number hides whatever it is scored
// against. Walk-bout median 2.2 s is the lognormal the supplied scheduler in src/sim/intrinsic.js is
// calibrated to (docs/23-behaviour.md, Maye et al. 2007); the rest are set by the assay itself.
export function scoreObs(obs) {
  const t = {
    alive: clamp(obs.alive),
    flips: clamp(1 - obs.flipFrac / 0.05),
    food: clamp(1 - obs.foodDist / 1.2),
    feed: clamp(1 - obs.feedLatency / 2000),
    bout: obs.boutMedian > 0 ? clamp(1 - Math.abs(Math.log(obs.boutMedian / 2200)) / 2) : 0,
    escape: clamp(obs.escapes),
  };
  const W = { alive: 2, flips: 1, food: 1.5, feed: 1.5, bout: 1, escape: 1.5 };
  const score = Object.entries(t).reduce((s, [k, v]) => s + W[k] * v, 0) / Object.values(W).reduce((a, b) => a + b, 0);
  return { score, terms: t, obs };
}

export async function evaluate(cfg, seeds = [cfg.seed ?? 1000]) {
  const runs = [];
  for (const s of seeds) runs.push(scoreObs(await runSeed(cfg, s)));
  const pick = f => mean(runs.map(f));
  return {
    score: pick(r => r.score),
    terms: Object.fromEntries(Object.keys(runs[0].terms).map(k => [k, pick(r => r.terms[k])])),
    obs: Object.fromEntries(Object.keys(runs[0].obs).map(k => [k, pick(r => r.obs[k])])),
  };
}

process.on('message', async msg => {
  try { const out = await evaluate(msg.cfg, msg.seeds); process.send({ id: msg.id, cfg: msg.cfg, out }); }
  catch (e) { process.send({ id: msg.id, cfg: msg.cfg, error: String(e.stack) }); }
});
if (process.argv[2]) {
  const t0 = Date.now();
  const cfg = JSON.parse(process.argv[2]);
  const seeds = cfg.seeds || [cfg.seed ?? 1000];
  const o = await evaluate(cfg, seeds);
  console.log(JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  process.exit(0);
}
