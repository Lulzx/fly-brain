// Fit the VNC leg-premotor subgraph (spec S2): per-neuron outgoing logGain on the frozen edge set,
// by adjoint, so the subgraph's MN rates produce the muscle commands a real run needed.
//
//   node scripts/stand_fit.mjs [--data=public/data/vnc_fitdata] [--sub=public/data/vnc_subgraph.json]
//                              [--iters=200] [--out=public/data/stand_fit.json] [--scramble=N]
//
// Windows: a fit window is W epochs of one recorded run. The twin replays the recorded boundary
// spike train (exact forced spikes at fly-step resolution; epoch-rate Poisson drive is the v1
// fallback), the loss is the per-epoch ctrl MSE plus the logGain L1 budget, and backward returns
// dL/dlogGain for every subgraph neuron. Adam over windows. Scramble mode (--scramble=seed)
// permutes the edge set first -- spec S2.7 kill test 1: if a degree-matched scramble fits as
// well, the wiring was a reservoir.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { extractVncSubgraph, scrambleSubgraphEdges, loadSubgraphArtifact } from '../src/vnc/subgraph.js';
import { LIFDiff } from '../src/lifdiff.js';
import { diffOptions } from '../src/diffsetup.js';
import { brainScales } from '../src/brainmodel.js';
import { buildReadout, ctrlLoss, budgetGrad } from '../src/vnc/loss.js';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };

const dataBase = arg('data', 'public/data/vnc_fitdata');
const subFile = arg('sub', 'public/data/vnc_subgraph.json');
const iters = +arg('iters', 200);
const outFile = arg('out', 'public/data/stand_fit.json');
const scrambleSeed = arg('scramble') ? +arg('scramble') : 0;
const holdoutFrac = +arg('holdout', 0.2);
const WIN_EPOCHS = 10;                 // 200 ms per window at the 20 ms epoch cadence
const WARMUP_EPOCHS = 2;               // first 40 ms of a window settles the reset
const EPOCH_STEPS = 40;                // 20 ms at dt = 0.5 ms
const LR = +arg('lr', 0.03);
const LAMBDA_BUDGET = +arg('lbudget', 0.02);
const CLIP = 1.0;                      // gradient clip on logGain steps

// ---------------------------------------------------------------- load
const D = loadAll(); const DATA = { ...D, superclass: D.sc };
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
for (const k of Object.keys(o)) if (k[0] === '_') delete o[k];

// The frozen artifact is the auditable edge set; fall back to live extraction only when absent.
let sub = fs.existsSync(subFile) ? loadSubgraphArtifact(subFile) : extractVncSubgraph(D);
if (sub.sha256) console.log(`subgraph: ${subFile} sha ${sub.sha256.slice(0, 12)}`);
if (scrambleSeed) { sub = scrambleSubgraphEdges(sub, scrambleSeed); console.log(`scrambled edge set (seed ${scrambleSeed})`); }

const meta = JSON.parse(fs.readFileSync(dataBase + '.json'));
const buf = fs.readFileSync(dataBase + '.bin');
const F = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const nb = meta.boundary.length, nm = meta.mnOrig.length, na = meta.legActuators.length, nj = meta.jointNames.length;

// boundary order must match the recorder: isBoundary nodes in subgraph-index order
const boundary = []; for (let k = 0; k < sub.N; k++) if (sub.isBoundary[k]) boundary.push(k);
if (boundary.length !== nb) throw new Error(`boundary mismatch: ${boundary.length} vs recorded ${nb}`);
const mnSet = new Set(sub.mn.map(m => m.sub));
const subOf = new Map(); for (let k = 0; k < sub.N; k++) subOf.set(sub.origIdx[k], k);
const mnSub = Int32Array.from(meta.mnOrig.map(i => { const s = subOf.get(i); if (s == null) throw new Error(`recorded MN ${i} not in subgraph`); return s; }));
const LAMBDA_RATE = +arg('lrate', 0.1);

const runs = [];
let off = 0;
const U = new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
for (const r of meta.runs) {
  const n = r.nEp;
  const take = k => { const v = F.subarray(off, off + k); off += k; return v; };
  const run = { seed: r.seed, nEp: n,
    rates: take(n * nb), mnRates: take(n * nm), ctrl: take(n * na), jointQ: take(n * nj), ctx: take(n * 11) };
  if (r.nSpike) {                              // v2+: per-fly-step boundary spike trains
    const uoff = off;                          // aligned: Float32 and Uint32 share the buffer
    run.trainStep = U.subarray(uoff, uoff + r.nSpike);
    run.trainIdx = U.subarray(uoff + r.nSpike, uoff + 2 * r.nSpike);
    off += 2 * r.nSpike;
    // per-fly-step spike list, grouped once
    const nFly = n * meta.epochMs;
    run.train = Array.from({ length: nFly }, () => []);
    for (let k = 0; k < r.nSpike; k++) run.train[run.trainStep[k]].push(boundary[run.trainIdx[k]]);
  }
  runs.push(run);
}
runs.sort((a, b) => a.seed - b.seed);
const nHold = Math.min(runs.length - 1, Math.max(0, Math.round(runs.length * holdoutFrac)));
const holdout = new Set(nHold > 0 ? runs.slice(-nHold).map(r => r.seed) : []);
const trainRuns = runs.filter(r => !holdout.has(r.seed));
console.log(`data: ${runs.length} runs (${trainRuns.length} train / ${nHold} holdout seeds ${[...holdout]}), ${nb} boundary, ${nm} MNs, ${na} actuators`);

// actuator ctrlrange from the flybody model -- the same numbers muscleCtrl clamps to
import loadMujoco from '@mujoco/mujoco';
const MJ = await loadMujoco();
const model = MJ.MjModel.from_xml_string(fs.readFileSync('public/body/fly_physics.xml', 'utf8'));
const ranges = {};
for (let i = 0; i < model.nu; i++) { const n = model.actuator(i).name; ranges[n] = [model.actuator_ctrlrange[2 * i], model.actuator_ctrlrange[2 * i + 1]]; }
const readout = buildReadout(sub, ranges);
console.log(`readout: ${readout.units.length} muscles -> ${readout.actuators.length} actuators`);

// ---------------------------------------------------------------- twin
const opts = diffOptions(DATA, SIZE, o, SIGN);
// NOTE: origIdx is an Int32Array -- .map on it would truncate floats to integers (every inScale<1
// would become 0). Go through Array.from first.
const pick = arr => arr ? Float32Array.from(Array.from(sub.origIdx, i => arr[i])) : null;
const { inScale } = brainScales(DATA, SIZE, o);
const net = new LIFDiff({ N: sub.N, indptr: sub.indptr, indices: sub.indices, weights: sub.weights, nt: sub.nt }, {
  ...o,
  sensoryMask: sub.isBoundary,
  inScale: pick(inScale),
  sizeLog: pick(opts.sizeLog), thrOffset: pick(opts.thrOffset), outScale: pick(opts.outScale),
  preSign: pick(opts.preSign), thrMask: pick(opts.thrMask), biasMask: pick(opts.biasMask),
  driveIdx: Int32Array.from(boundary), driveEpoch: EPOCH_STEPS,
});

const logGain = new Float32Array(sub.N);
const mAdam = new Float32Array(sub.N), vAdam = new Float32Array(sub.N);
const dL = new Float32Array(sub.N), bg = new Float32Array(sub.N);
const N = sub.N, epochSecs = meta.epochMs / 1000;
// The second spec-allowed parameter class: one global inhibitory gain. The recorded premotor
// pattern arrives sign-balanced onto the MNs (the live animal resolves it with temporal structure
// the rate replay smooths away); inhGain is the single scalar that can move the operating point.
let inhGain = +arg('inhGain', 1);            // fitted when --fitInh=1
const FIT_INH = !!+arg('fitInh', 1);
let inhM = 0, inhV = 0;
net.p.inhGain = inhGain;

// one fit window: replay the recorded boundary spike trains (recorded at 1 ms fly steps -> the
// twin's 0.5 ms steps 2*t), score the post-warmup epochs. Falls back to epoch-rate Poisson drive
// for v1 recordings without trains.
function windowLoss(run, w0) {
  const nEp = Math.min(WIN_EPOCHS, run.nEp - w0), steps = nEp * EPOCH_STEPS;
  let spikeTrain = null;
  if (run.train) {
    spikeTrain = new Array(steps);
    for (let fs = w0 * meta.epochMs; fs < (w0 + nEp) * meta.epochMs; fs++) {
      const lst = run.train[fs];
      if (lst.length) spikeTrain[(fs - w0 * meta.epochMs) * 2] = lst;
    }
  }
  const tape = net.forward(steps, { seed: (run.seed * 7919 + w0) >>> 0, spikeTrain, onEpoch: spikeTrain ? null : (ep) => {
    const ro = (w0 + ep) * nb;
    for (let k = 0; k < nb; k++) net.setDriveOne(boundary[k], run.rates[ro + k]);
  } });
  // per-epoch MN counts from the taped spikes (spikeCount is cumulative; tape.spikes is per step)
  const mnCounts = new Float32Array(nEp * N);
  for (let t = 0; t < tape.spikes.length; t++) {
    const ep = (t / EPOCH_STEPS) | 0, f = tape.spikes[t];
    for (let k = 0; k < f.idx.length; k++) if (mnSet.has(f.idx[k])) mnCounts[ep * N + f.idx[k]] += f.amp[k];
  }
  const tgt = run.ctrl.subarray(w0 * na, (w0 + nEp) * na);
  const rt = run.mnRates.subarray(w0 * nm, (w0 + nEp) * nm);
  const { loss, lossCtrl, lossRate, dLdSpikePerEpoch } = ctrlLoss(sub, readout, ranges, mnCounts, tgt, nEp, epochSecs,
    { scoreFromEpoch: WARMUP_EPOCHS, lambdaRate: LAMBDA_RATE, rateTarget: rt, mnSub });
  return { tape, loss: loss + LAMBDA_RATE * lossRate, lossCtrl, lossRate, dLdSpikePerEpoch };
}

// ---------------------------------------------------------------- fit loop
const t0 = Date.now();
let emaLoss = null;
for (let it = 1; it <= iters; it++) {
  const run = trainRuns[(it - 1) % trainRuns.length];
  const w0 = ((it * 7) % Math.max(1, run.nEp - WIN_EPOCHS)) | 0;
  const { tape, loss, lossCtrl, lossRate, dLdSpikePerEpoch } = windowLoss(run, w0);
  const grads = net.backward(tape, dL, { lossFrom: WARMUP_EPOCHS * EPOCH_STEPS, dLdSpikePerEpoch });
  const g = grads.logGain;
  budgetGrad(logGain, LAMBDA_BUDGET, bg);
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  let moved = 0;
  for (let i = 0; i < N; i++) {
    const gi = g[i] + bg[i];
    mAdam[i] = b1 * mAdam[i] + (1 - b1) * gi;
    vAdam[i] = b2 * vAdam[i] + (1 - b2) * gi * gi;
    const step = LR * (mAdam[i] / (1 - Math.pow(b1, it))) / (Math.sqrt(vAdam[i] / (1 - Math.pow(b2, it))) + eps);
    logGain[i] -= Math.max(-CLIP, Math.min(CLIP, step));
    if (Math.abs(logGain[i]) > 0.05) moved++;
  }
  net.logGain = logGain;
  if (FIT_INH) {
    const gi = grads.params.inhGain || 0;
    inhM = b1 * inhM + (1 - b1) * gi;
    inhV = b2 * inhV + (1 - b2) * gi * gi;
    const step = LR * (inhM / (1 - Math.pow(b1, it))) / (Math.sqrt(inhV / (1 - Math.pow(b2, it))) + eps);
    inhGain = Math.max(0.05, Math.min(4, inhGain - Math.max(-CLIP, Math.min(CLIP, step))));
    net.p.inhGain = inhGain;
  }
  emaLoss = emaLoss === null ? loss : 0.95 * emaLoss + 0.05 * loss;
  if (it % 10 === 0 || it === 1)
    console.log(`it ${it}  ctrl ${lossCtrl.toFixed(4)}  rate ${lossRate.toFixed(2)}  (ema ${emaLoss.toFixed(4)})  moved ${moved}  inh ${inhGain.toFixed(3)}  ${(Date.now() - t0) / 60000 | 0}min  seed ${run.seed} w${w0}${grads.clamped.logGain ? `  CLAMPED ${grads.clamped.logGain}` : ''}`);
}

// ---------------------------------------------------------------- save + holdout readout
const gains = [];
for (let i = 0; i < N; i++) if (Math.abs(logGain[i]) > 0.05) gains.push({ sub: i, orig: sub.origIdx[i], logGain: +logGain[i].toFixed(5), type: sub.types[i], role: sub.role[i] });
const artifact = {
  version: 1, spec: 'S2 premotor fit: per-neuron outgoing logGain on the frozen VNC subgraph',
  subgraph: subFile, data: dataBase, iters, lr: LR, lambdaRate: LAMBDA_RATE, lambdaBudget: LAMBDA_BUDGET, scrambleSeed,
  epochsMs: meta.epochMs, gains, inhGain,
};
fs.writeFileSync(outFile, JSON.stringify(artifact));
console.log(`-> ${outFile}: ${gains.length} gains moved | final ema ctrl MSE ${emaLoss.toFixed(4)}`);
