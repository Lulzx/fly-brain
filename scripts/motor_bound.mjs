// M5: how much motor output can this model structurally not express?
//
// 285 motor-neuron types -- 422 cells -- carry no muscle assignment in v1.0 (docs/09-bodymap.md).
// They are simulated, they spike, and nothing they do reaches the body. The roadmap asks for that as a
// *bound*, and a bound has to be measured rather than counted: the cell count says how many neurons
// are stranded, and the spike count says how much output is. Those are different numbers, because an
// abdominal motor neuron that never fires strands nothing.
//
//   node scripts/motor_bound.mjs [seconds] [seed]     # writes public/data/motor_bound.json
//
// The census is taken during ordinary foraging, with the brain in its calibrated state, because the
// question is what fraction of the motor output *of a behaving model* is unreachable -- not what
// fraction of a resting one is.
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll, loadNeuromod } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { DEFAULT_ENV } from '../src/sim/world.js';
import { allocBrainMemory, attachBrain, attachEyes } from '../src/brainsetup.js';
import { parseFlyVis } from '../src/flyvis.js';

const SECS = +(process.argv[2] || 20), SEED = +(process.argv[3] || 7);
const D = loadAll(); const data = { ...D, superclass: D.sc };
const bm = D.bodymap;
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));

// --- who is a motor neuron, and which of them the body can read -----------------------------------
const scName = i => D.meta.superclasses[D.sc[i]];
const MOTOR = []; for (let i = 0; i < D.N; i++) if (/motor/.test(scName(i))) MOTOR.push(i);
const reachable = new Set();
for (const m of bm.muscles) for (const i of m.idx) reachable.add(i);
for (const k of Object.keys(bm.wing)) for (const i of bm.wing[k]) reachable.add(i);
for (const i of bm.jump) reachable.add(i);
for (const i of bm.feeding) reachable.add(i);

// The bodymap's own list of unmapped motor-neuron types, resolved to cell indices. `type` is
// occasionally a comma-joined pair in the release ("MNad04,MNad48"), which is one type name and not
// two, so it is matched whole first and split only if that fails.
const byType = new Map();
for (let i = 0; i < D.N; i++) { const t = String(D.meta.types[i] || ''); if (!t) continue; if (!byType.has(t)) byType.set(t, []); byType.get(t).push(i); }
const sideOf = { left: 1, right: 2 };
const unmappedBySub = {}; const unmappedIdx = new Set(); let unresolved = 0;
for (const u of bm.unmappedMotor) {
  const names = byType.has(String(u.type)) ? [String(u.type)] : String(u.type).split(',');
  const want = sideOf[u.side];
  const hit = names.flatMap(t => (byType.get(t) || []).filter(i => !want || D.side[i] === want));
  if (!hit.length) { unresolved++; continue; }
  (unmappedBySub[u.subclass] ||= []).push(...hit);
  for (const i of hit) unmappedIdx.add(i);
}
// The bodymap's list and the reachability test disagree, and the disagreement has to be reported rather
// than averaged over: some cells appear under more than one type entry, some are not in the motor
// superclasses at all, and some -- the wing ones especially -- are listed as unmapped *and* reachable
// through `bodymap.wing`. The bound below is computed from reachability, which is the property that
// decides whether a spike can move the body; the subclass table is then restricted to the same set so
// its shares sum to 100%.
for (const k of Object.keys(unmappedBySub)) unmappedBySub[k] = [...new Set(unmappedBySub[k])].filter(i => !reachable.has(i));
const SUBCLASS = { ad: 'abdominal', nm: 'neck', wm: 'wing', hm: 'haltere', hl: 'haltere (hl)', ml: 'mesothoracic (ml)', pm: 'prothoracic (pm)', rm: 'rm', xm: 'xm' };

// --- one ordinary foraging run --------------------------------------------------------------------
const gait = JSON.parse(fs.readFileSync('public/body/gait.json'));
const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');
const mj = await loadMujoco();
const env = structuredClone(DEFAULT_ENV);
const calib = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const fb = fs.readFileSync('public/vision/flyvis.bin');
const vision = { model: parseFlyVis(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength),
  JSON.parse(fs.readFileSync('public/vision/flyvis.json')), JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'))),
  map: JSON.parse(fs.readFileSync('public/vision/flyvis_map.json')) };
const mem = allocBrainMemory(data, size, sign, calib, 1, vision);
const brain = await attachBrain(fs.readFileSync('public/lif.wasm'), mem, 0, data, SEED);
const fly = new FlyAgent({ mj, flyXML, env, data, size, sign, bodymap: bm, gait, pos: [-0.2, 0.6], yaw: 0,
  brainOpts: calib, neuromod: loadNeuromod(), vision: true, intrinsic: true, brain, seed: SEED,
  flyvis: { eyes: attachEyes(brain.instance, mem, 0), map: vision.map, gain: 150 } });

for (let s = 1; s <= SECS * 1000; s++) fly.step();
const sp = Uint32Array.from(brain.spikeCount);
const hz = ix => ix.length ? [...ix].reduce((a, i) => a + sp[i], 0) / ix.length / SECS : 0;
const spikes = ix => [...ix].reduce((a, i) => a + sp[i], 0);

const mapped = MOTOR.filter(i => reachable.has(i));
const stranded = MOTOR.filter(i => !reachable.has(i));
const spMapped = spikes(mapped), spStranded = spikes(stranded);

const out = {
  _source: 'scripts/motor_bound.mjs', seconds: SECS, seed: SEED,
  cells: { motorTotal: MOTOR.length, reachable: mapped.length, stranded: stranded.length,
    strandedFraction: +(stranded.length / MOTOR.length).toFixed(4) },
  spikes: { reachable: spMapped, stranded: spStranded,
    strandedFraction: +(spStranded / Math.max(1, spMapped + spStranded)).toFixed(4),
    rateReachableHz: +hz(mapped).toFixed(2), rateStrandedHz: +hz(stranded).toFixed(2) },
  bodymapUnmapped: { typeEntries: bm.unmappedMotor.length, cellsClaimed: bm.unmappedMotor.reduce((a, u) => a + u.n, 0),
    cellsResolved: unmappedIdx.size, typeEntriesUnresolved: unresolved,
    resolvedAndReachable: [...unmappedIdx].filter(i => reachable.has(i)).length,
    resolvedNotInMotorSuperclass: [...unmappedIdx].filter(i => !/motor/.test(scName(i))).length,
    subclassTableCells: Object.values(unmappedBySub).reduce((a, x) => a + x.length, 0) },
  bySubclass: Object.fromEntries(Object.entries(unmappedBySub).map(([k, ix]) => {
    const u = [...new Set(ix)];
    return [k, { name: SUBCLASS[k] || k, cells: u.length, rateHz: +hz(u).toFixed(2), spikes: spikes(u),
      shareOfStrandedSpikes: +(spikes(u) / Math.max(1, spStranded)).toFixed(4) }];
  })),
};
fs.writeFileSync('public/data/motor_bound.json', JSON.stringify(out, null, 1));

console.log(`motor census over ${SECS} s of foraging, seed ${SEED}\n`);
console.log(`motor neurons               ${out.cells.motorTotal}`);
console.log(`  the body can read         ${out.cells.reachable}`);
console.log(`  stranded                  ${out.cells.stranded}  (${(out.cells.strandedFraction * 100).toFixed(1)}% of cells)\n`);
console.log(`mean rate, reachable        ${out.spikes.rateReachableHz} Hz`);
console.log(`mean rate, stranded         ${out.spikes.rateStrandedHz} Hz`);
console.log(`bodymap 'unmappedMotor': ${out.bodymapUnmapped.cellsClaimed} cells claimed, ${out.bodymapUnmapped.cellsResolved} resolved,`);
console.log(`  of which ${out.bodymapUnmapped.resolvedAndReachable} are reachable after all (wing, via bodymap.wing) and`);
console.log(`  ${out.bodymapUnmapped.resolvedNotInMotorSuperclass} are not in a motor superclass; the subclass table below holds the ${out.bodymapUnmapped.subclassTableCells} that are neither.`);
console.log(`\nspikes the body can read    ${out.spikes.reachable}`);
console.log(`spikes it cannot            ${out.spikes.stranded}`);
console.log(`THE BOUND                   ${(out.spikes.strandedFraction * 100).toFixed(1)}% of motor-neuron spikes cannot reach the body\n`);
console.log('subclass            cells   rate Hz    spikes   share of stranded output');
for (const [k, v] of Object.entries(out.bySubclass).sort((a, b) => b[1].spikes - a[1].spikes))
  console.log(`${(v.name).padEnd(20)} ${String(v.cells).padStart(4)}  ${String(v.rateHz).padStart(8)}  ${String(v.spikes).padStart(8)}   ${(v.shareOfStrandedSpikes * 100).toFixed(1)}%`);
console.log(`\nwrote public/data/motor_bound.json`);
