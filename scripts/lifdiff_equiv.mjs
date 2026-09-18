// Is src/lifdiff.js the model that ships?
//
// src/lifdiff.js says it "runs the same dynamics as src/lif.js, with an adjoint", and everything built
// on it -- scripts/grad_fit.mjs, the whole-CNS fit in docs/33-differentiable-brain.md, and the joined
// visual chain in src/visdiff.js -- is only as meaningful as that claim. A gradient of the wrong model
// is not a weak gradient, it is the gradient of something else.
//
// This runs the benchmark's own sugar assay through both implementations at identical parameters and
// compares what the benchmark measures. scripts/vis_equiv.mjs does the same thing for the optic-lobe
// half and finds it bit-identical; this is the other half.
//
//   node --max-old-space-size=14000 scripts/lifdiff_equiv.mjs
//
// The two will not agree step for step -- they draw Poisson spikes from different generators -- so the
// comparison is of the benchmark's summary statistics, at a sample size where the seed is not the
// story. The protocol has to be the benchmark's protocol exactly, and the first version of this script
// got it wrong in a way worth recording: `sugarMN9` is not a rate over the stimulus. calib_eval runs
// 400 ms of sugar and then 300 ms with the drive switched off, counts spikes over the whole 700 ms and
// divides by 0.4 s, so it deliberately includes the persistent firing after the stimulus ends. Scoring
// a flat 400 ms against it charged the model for a tail it never ran and read as a 41% shortfall.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { LIFDiff } from '../src/lifdiff.js';
import { diffOptions, diffSummary } from '../src/diffsetup.js';
import { BRAIN_DEFAULTS } from '../src/brainmodel.js';

const SEEDS = +(process.argv[2] || 6);
// the benchmark's sugar protocol: 400 ms driven, 300 ms free, counts over all 700 ms scaled by 1/0.4 s
const ON = 800, OFF = 600, STEPS = ON + OFF, SCALE = 0.4;
const D = loadAll();
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  const bench = o._benchmarks; for (const k of Object.keys(o)) if (k[0] === '_') delete o[k];
  return { cfg: o, bench }; })();
const P = { ...BRAIN_DEFAULTS, ...BASE.cfg };

// BARE=1 reproduces the state this script was written to diagnose: the size scaling and the two fitted
// masks and nothing else, which is what src/lifdiff.js was given before src/diffsetup.js existed.
const BARE = !!process.env.BARE;
const SETUP = diffOptions(D, SIZE, P, SIGN);
const setup = BARE ? { sizeLog: SETUP.sizeLog, thrMask: SETUP.thrMask, biasMask: SETUP.biasMask,
  sensoryMask: SETUP.sensoryMask, preSign: SIGN } : SETUP;
if (!BARE) { const sm = diffSummary(SETUP);
  console.log(`setup: ${sm.thrShifted} neurons with a threshold offset, ${sm.signZeroed} with their fast`
    + ` synapses removed, ${sm.typeGained} with a type gain, ${sm.sensory} sensory`); }
else console.log('setup: BARE -- size scaling and the two fitted masks only');
const T = (...ts) => ts.flatMap(t => D.byType(t));
const SUGAR = T('LB3b', 'LB3c'), MN9 = T('MN9'), RELAY = T('GNG232'), RELAY2 = T('DNge080');
const ORN_ALL = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const MS = STEPS * 0.5;

console.log(`sugar assay, ${ON} steps driven + ${OFF} free (${MS} ms), ${SEEDS} seeds, calibrated parameters`);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const rate = (net, ix) => mean(ix.map(i => net.spikeCount[i])) / SCALE;
const got = { mn9: [], relay: [], relay2: [], net: [] };
for (let s = 1; s <= SEEDS; s++) {
  const net = new LIFDiff(D, { ...P, ...setup, soft: false });
  net.setDrive(ORN_ALL, 6); net.setDrive(SUGAR, 100);
  // the drive is switched off partway through, which `onEpoch` is the hook for
  // driveEpoch defaults to 1, so onEpoch runs every step and the switch-off lands exactly at ON
  net.forward(STEPS, { seed: s, record: false,
    onEpoch: (_, t) => { if (t === ON) net.setDrive(SUGAR, 0); } });
  got.mn9.push(rate(net, MN9)); got.relay.push(rate(net, RELAY)); got.relay2.push(rate(net, RELAY2));
  let tot = 0; for (let i = 0; i < D.N; i++) tot += net.spikeCount[i];
  got.net.push(tot / D.N / (MS / 1000));
}
const sem = a => Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / Math.max(1, a.length - 1) / a.length);
const b = BASE.bench || {};
const pad = (x, k) => String(x).padEnd(k);
console.log('');
console.log(pad('observable', 14), pad('src/lifdiff.js', 22), pad('the shipped kernel', 20), 'ratio');
const row = (name, mine, theirs) => {
  const m = mean(mine);
  console.log(pad(name, 14), pad(`${m.toFixed(2)} +- ${sem(mine).toFixed(2)} Hz`, 22),
    pad(theirs === undefined ? '-' : `${(+theirs).toFixed(2)} Hz`, 20),
    theirs ? (m / theirs).toFixed(3) : '-');
  return theirs ? m / theirs : null;
};
// the shipped numbers are brain_params.json's own _benchmarks block, written by scripts/calib_eval.mjs
// at this parameter set, so the comparison is against the model's recorded behaviour and not a rerun
const r1 = row('MN9 (sugar)', got.mn9, b.sugarMN9);
row('GNG232 relay', got.relay, b.relay);
row('DNge080 relay', got.relay2, b.relay2);
console.log(pad('network mean', 14), pad(`${mean(got.net).toFixed(3)} Hz`, 22), pad('-', 20), '-');
console.log('');
if (r1 !== null && (r1 < 0.8 || r1 > 1.25)) {
  console.log(`MISMATCH: the differentiable model reaches ${(100 * r1).toFixed(0)}% of the shipped model's`
    + ` MN9 rate on the assay both are meant to be running.`);
  console.log('scripts/calib_eval.mjs builds its network through makeBrain, which applies four things');
  console.log('src/lifdiff.js has no equivalent of:');
  console.log('  typeGains(DATA, o)          a per-cell-type gain on outgoing weights');
  console.log('  applyClassPhysiology(b,..)  per-class thresholds and physiology');
  console.log('  modulatorySign(...)         the sign of modulatory neurons');
  console.log('  new Neuromod(...).modulate()  octopamine tone, and `neuromod: true` is the fitted default');
  console.log('None of those is part of this comparison or of docs/33-differentiable-brain.md\'s fit.');
  console.log('The adjoint is correct for the model it differentiates; that model is not this one yet.');
  process.exit(1);
}
console.log('The differentiable model matches the shipped one on this assay.');
