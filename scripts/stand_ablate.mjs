// Spec S2.7 kill test 2: named ablations of the fitted premotor readout.
// Load a stand_fit.json, replay each holdout run's boundary spike train through the frozen
// subgraph, and re-score the ctrl loss with named groups knocked out. Two kinds of knockout:
//
//   gain:<group>   logGain of the group's nodes reset to 0 -- the fitted channel contributes
//                  nothing, edges still carry their raw weight
//   edge:<group>   the group's outgoing edges culled outright (logGain -> -inf)
//
// Groups: role (dn / sensory / interneuron), side (left / right), and each locomotion DN type.
// If removing a group costs nothing, the fit does not depend on it -- the ledger wants to know.
//
//   node scripts/stand_ablate.mjs --fit=public/data/stand_fit.json --data=public/data/vnc_fitdata
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { loadSubgraphArtifact, extractVncSubgraph, scrambleSubgraphEdges } from '../src/vnc/subgraph.js';
import { LIFDiff } from '../src/lifdiff.js';
import { diffOptions } from '../src/diffsetup.js';
import { brainScales } from '../src/brainmodel.js';
import { buildReadout, ctrlLoss } from '../src/vnc/loss.js';
import loadMujoco from '@mujoco/mujoco';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const fitFile = arg('fit', 'public/data/stand_fit.json');
const dataBase = arg('data', 'public/data/vnc_fitdata');
const subFile = arg('sub', 'public/data/vnc_subgraph.json');
const WIN_EPOCHS = 10, WARMUP_EPOCHS = 2, EPOCH_STEPS = 40;
const holdoutFrac = +arg('holdout', 0.2);

const D = loadAll(); const DATA = { ...D, superclass: D.sc };
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
for (const k of Object.keys(o)) if (k[0] === '_') delete o[k];

const fit = JSON.parse(fs.readFileSync(fitFile, 'utf8'));
let sub = fs.existsSync(subFile) ? loadSubgraphArtifact(subFile) : extractVncSubgraph(D);
// --scramble=N: evaluate a scrambled-graph fit against its own (scrambled) edge set -- the kill
// comparison needs fitted-vs-raw under the same wiring, not a scrambled fit on the intact graph.
const scr = +arg('scramble', 0);
if (scr) sub = scrambleSubgraphEdges(sub, scr);

const meta = JSON.parse(fs.readFileSync(dataBase + '.json'));
const buf = fs.readFileSync(dataBase + '.bin');
const F = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const U = new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const nb = meta.boundary.length, nm = meta.mnOrig.length, na = meta.legActuators.length, nj = meta.jointNames.length;
const boundary = []; for (let k = 0; k < sub.N; k++) if (sub.isBoundary[k]) boundary.push(k);
if (boundary.length !== nb) throw new Error(`boundary mismatch: ${boundary.length} vs recorded ${nb}`);
const mnSet = new Set(sub.mn.map(m => m.sub));
const subOf = new Map(); for (let k = 0; k < sub.N; k++) subOf.set(sub.origIdx[k], k);
const mnSub = Int32Array.from(meta.mnOrig.map(i => subOf.get(i)));

const runs = [];
let off = 0;
for (const r of meta.runs) {
  const n = r.nEp;
  const take = k => { const v = F.subarray(off, off + k); off += k; return v; };
  const run = { seed: r.seed, nEp: n,
    rates: take(n * nb), mnRates: take(n * nm), ctrl: take(n * na), jointQ: take(n * nj), ctx: take(n * 11) };
  if (r.nSpike) {
    run.trainStep = U.subarray(off, off + r.nSpike);
    run.trainIdx = U.subarray(off + r.nSpike, off + 2 * r.nSpike);
    off += 2 * r.nSpike;
    run.train = Array.from({ length: n * meta.epochMs }, () => []);
    for (let k = 0; k < r.nSpike; k++) run.train[run.trainStep[k]].push(boundary[run.trainIdx[k]]);
  }
  runs.push(run);
}
// same split convention as stand_fit: sorted seeds, last `holdoutFrac` scored
runs.sort((a, b) => a.seed - b.seed);
const nHold = Math.min(runs.length - 1, Math.max(0, Math.round(runs.length * holdoutFrac)));
const holdout = new Set(nHold > 0 ? runs.slice(-nHold).map(r => r.seed) : []);
const scoredRuns = nHold ? runs.filter(r => holdout.has(r.seed)) : runs;
console.log(`scoring ${scoredRuns.length} ${nHold ? 'holdout' : ''} runs (seeds ${scoredRuns.map(r => r.seed)})`);

const MJ = await loadMujoco();
const model = MJ.MjModel.from_xml_string(fs.readFileSync('public/body/fly_physics.xml', 'utf8'));
const ranges = {};
for (const name of meta.legActuators) {
  const a = model.actuator(name); if (!a) continue;
  ranges[name] = [a.ctrlrange[0], a.ctrlrange[1]];
}
const readout = buildReadout(sub, ranges);

const opts = diffOptions(DATA, SIZE, o, SIGN);
const pick = arr => arr ? Float32Array.from(Array.from(sub.origIdx, i => arr[i])) : null;
const { inScale } = brainScales(DATA, SIZE, o);
const net = new LIFDiff({ N: sub.N, indptr: sub.indptr, indices: sub.indices, weights: sub.weights, nt: sub.nt }, {
  ...o, sensoryMask: sub.isBoundary, inScale: pick(inScale),
  sizeLog: pick(opts.sizeLog), thrOffset: pick(opts.thrOffset), outScale: pick(opts.outScale),
  preSign: pick(opts.preSign), driveEpoch: EPOCH_STEPS,
});
net.p.inhGain = fit.inhGain ?? 1;
const logGainFit = new Float32Array(sub.N);
for (const g of fit.gains) logGainFit[g.sub] = g.logGain;

// named groups
const groups = { all: null };
const roleName = { 0: 'interneuron', 2: 'descending', 3: 'sensory' };
for (const [rn, name] of Object.entries(roleName)) groups[`role:${name}`] = k => sub.role[k] === +rn;
groups['side:left'] = k => sub.side[k] === 1;
groups['side:right'] = k => sub.side[k] === 2;
for (const t of Object.keys(sub.dn)) groups[`dn:${t}`] = k => sub.types[k] === t || sub.types[k].startsWith(t + '_') || sub.types[k].startsWith(t + ' ');

function windowCtrl(run, w0, gainArr, edgeOff) {
  const nEp = Math.min(WIN_EPOCHS, run.nEp - w0), steps = nEp * EPOCH_STEPS;
  const spikeTrain = new Array(steps);
  for (let fs = w0 * meta.epochMs; fs < (w0 + nEp) * meta.epochMs; fs++) {
    const lst = run.train[fs];
    if (lst.length) spikeTrain[(fs - w0 * meta.epochMs) * 2] = lst;
  }
  net.logGain = gainArr;
  const edgeMask = edgeOff ? new Set(edgeOff) : null;
  // edge knockout: temporarily zero this.gate for the group's outgoing edges is heavy; instead
  // drive logGain to -20 (e^-20 ~ 2e-9) which is the same operator in this model's algebra.
  if (edgeMask) for (const i of edgeMask) gainArr[i] = -20;
  const tape = net.forward(steps, { seed: (run.seed * 7919 + w0) >>> 0, spikeTrain });
  if (edgeMask) for (const i of edgeMask) gainArr[i] = logGainFit[i];
  const mnCounts = new Float32Array(nEp * sub.N);
  for (let t = 0; t < tape.spikes.length; t++) {
    const ep = (t / EPOCH_STEPS) | 0, f = tape.spikes[t];
    for (let k = 0; k < f.idx.length; k++) if (mnSet.has(f.idx[k])) mnCounts[ep * sub.N + f.idx[k]] += f.amp[k];
  }
  const tgt = run.ctrl.subarray(w0 * na, (w0 + nEp) * na);
  const { lossCtrl } = ctrlLoss(sub, readout, ranges, mnCounts, tgt, nEp, meta.epochMs / 1000,
    { scoreFromEpoch: WARMUP_EPOCHS });
  return lossCtrl;
}

const STRIDE = +arg('stride', 10);       // evaluate every `stride`-th window
function evalAll(gainArr, edgeOff = null) {
  let s = 0, m = 0;
  for (const run of scoredRuns) {
    let w = 0;
    for (let w0 = 0; w0 + WARMUP_EPOCHS < run.nEp; w0 += WIN_EPOCHS, w++)
      if (w % STRIDE === 0) { s += windowCtrl(run, w0, gainArr, edgeOff); m++; }
  }
  return s / Math.max(1, m);
}

const base = evalAll(new Float32Array(logGainFit));
console.log(`baseline (fitted): ctrl MSE ${base.toFixed(4)}`);
const none = evalAll(new Float32Array(sub.N));
console.log(`gains off (raw graph): ctrl MSE ${none.toFixed(4)}  -> fitted gain contribution ${(none - base).toFixed(4)}`);

const rows = [];
for (const [name, pred] of Object.entries(groups)) {
  if (name === 'all') continue;
  const members = []; for (let k = 0; k < sub.N; k++) if (pred(k)) members.push(k);
  if (!members.length) continue;
  // gain ablation: fitted contribution of the group removed
  const g2 = new Float32Array(logGainFit); for (const i of members) g2[i] = 0;
  const lg = evalAll(g2);
  // edge ablation: group's outgoing edges off entirely
  const g3 = new Float32Array(logGainFit);
  const le = evalAll(g3, members);
  rows.push({ group: name, n: members.length, gainOff: +(lg - base).toFixed(4), edgeOff: +(le - base).toFixed(4) });
}
rows.sort((a, b) => Math.abs(b.edgeOff) - Math.abs(a.edgeOff));
console.log('\ngroup            n      Δctrl(gain off)  Δctrl(edges off)');
for (const r of rows) console.log(`${r.group.padEnd(18)}${String(r.n).padEnd(7)}${String(r.gainOff).padEnd(17)}${r.edgeOff}`);
fs.writeFileSync(fitFile.replace(/\.json$/, '') + '_ablate.json', JSON.stringify({ fit: fitFile, data: dataBase, baseline: base, gainsOff: none, rows }, null, 1));
