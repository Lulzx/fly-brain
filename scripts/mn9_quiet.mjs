// M3: the proboscis motor neuron that cannot be quieted (docs/20-roadmap.md).
//
// `quietMN9` is the only term in the physiological objective that sits at exactly zero in every seed
// and every rung of the ladder: MN9 idles at 26.6 Hz with no tastant against a target of 10.
// docs/19-limitations.md names a mechanism -- MN9 is partly driven by olfactory channels, so a fly in
// odour extends its proboscis while walking -- and A7 notes that quietMN9 is also the one term that
// punishes a busy baseline. Those are two different diagnoses and they predict different measurements.
//
// This script separates them before anything is fitted:
//
//   dose      MN9 against the ORN baseline drive the benchmark applies to every olfactory receptor
//             neuron. If the olfactory story is right, MN9 falls with it and reaches the target at 0.
//   sources   what is actually presynaptic to MN9 while it idles, as drive = weight x sign x rate,
//             aggregated by the source's class. Says which layer the baseline arrives through.
//   silence   cut one population at a time out of the baseline network and re-measure MN9. The
//             olfactory claim is that removing the antennal lobe's output quiets it; the excitability
//             claim is that nothing local does.
//   chain     the rates along that route, intact and with the antennal lobe's output cut.
//   fix       candidate parameter changes, each scored on the three terms that have to move together:
//             quietMN9 (baseline), sugar (sugarMN9) and tarsalPER (tarsalMN9).
//   combo     the same over a grid of lateral-inhibition and gustatory-chain gains.
//   refine    the two gustatory routes separated, to reach the criterion at a plausible sugar rate.
//   paired    the tarsal-evoked component of MN9, paired by seed. This is the measurement that turned
//             the item: it is -0.16 +- 1.57 Hz, so `tarsalPER` was scoring the baseline `quietMN9`
//             punishes, and no fit could ever satisfy both.
//
//   node scripts/mn9_quiet.mjs dose|sources|silence|chain|fix|combo|refine|paired [seed] [type, for sources]
import fs from 'node:fs';
import { D, sim, MN9, ORN_ALL, SUGAR, FRONT_SUGAR, RELAY } from './calib_eval.mjs';

// Rates come off the run's own `sp` snapshot, never off `net.spikeCount`. Every LIFWasm sits at the
// same base of the one shared WebAssembly.Memory, so a `net` read after a later `sim()` call reports
// the later network's counts -- the aliasing docs/20-roadmap.md A7 records, which makes three
// different stimuli look identical.
const hzOf = (r, ix, ms) => ix.reduce((a, i) => a + r.sp[i], 0) / ix.length / (ms / 1000);

const CAL = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const PARAMS = Object.fromEntries(Object.entries(CAL).filter(([k]) => !k.startsWith('_')));
const mode = process.argv[2] || 'dose';
const SEED = +(process.argv[3] || 1000);
const cfg = { ...PARAMS, seed: SEED };
const f2 = x => (+x).toFixed(2);

// class of every neuron, and a few named populations we can cut
const classOf = i => D.meta.classes[D.cls[i]];
const byClass = {};
for (let i = 0; i < D.N; i++) (byClass[classOf(i)] ||= []).push(i);
// `sources` defaults to MN9 but takes any type, so the chain can be walked upstream one step at a time.
const TARGET = process.argv[4] ? D.byType(process.argv[4]) : MN9;
const TARGETSET = new Set(TARGET);

if (mode === 'dose') {
  // The benchmark's baseline is 6 Hz on every ORN. Sweep it, and carry the two terms that must survive
  // any fix along with it, so a fix that quiets MN9 by deafening the animal is visible immediately.
  console.log('MN9 against the ORN baseline drive (seed ' + SEED + '); target is baseline < 15 Hz with sugar held\n');
  console.log('ORN Hz   baseMN9   sugarMN9   tarsalMN9   relay Hz');
  for (const hz of [0, 1, 2, 3, 4.5, 6, 9, 12]) {
    const base = [[ORN_ALL, hz]];
    const b = sim(cfg, base, 400);
    const s = sim(cfg, [...base, [SUGAR, 100]], 400, 300);
    const t = sim(cfg, [...base, [FRONT_SUGAR, 150]], 400);
    console.log(`${String(hz).padStart(6)}   ${f2(hzOf(b, MN9, 400)).padStart(7)}   ${f2(hzOf(s, MN9, 400)).padStart(8)}   ${f2(hzOf(t, MN9, 400)).padStart(9)}   ${f2(hzOf(s, RELAY, 400)).padStart(8)}`);
  }
  console.log('\nIf MN9 tracks the ORN drive to near zero, the bleed is olfactory and M3 is an antennal-lobe item.');
  console.log('If it does not, the 26.6 Hz is intrinsic or network-wide and M3 is an excitability item.');
} else if (mode === 'sources') {
  // Who drives MN9 while it idles. Drive is weight x sign x presynaptic rate, which is the quantity
  // the LIF integrates, so summing it by class says which layer the baseline arrives through.
  const run = sim(cfg, [[ORN_ALL, 6]], 400);
  const pre = new Map();                      // presyn index -> summed signed weight onto MN9
  for (let p = 0; p < D.N; p++) for (let k = D.indptr[p]; k < D.indptr[p + 1]; k++)
    if (TARGETSET.has(D.indices[k])) pre.set(p, (pre.get(p) || 0) + D.weights[k]);
  const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
  const rows = [];
  for (const [p, w] of pre) rows.push({ p, w, sign: SIGN[p], hz: run.sp[p] / 0.4, type: D.meta.types[p], cls: classOf(p) });
  const drive = r => r.w * r.sign * r.hz;
  const tot = rows.reduce((a, r) => a + Math.abs(drive(r)), 0) || 1;
  const cls = {};
  // Grouped by superclass as well as class: the annotated `class` is empty for most interneurons, and
  // the question "how much of this cell's drive is descending" is a superclass question.
  for (const r of rows) { r.sc = D.meta.superclasses[D.sc[r.p]]; const c = cls[r.cls] ||= { n: 0, exc: 0, inh: 0, active: 0 }; c.n++; if (r.hz > 0) c.active++; const d = drive(r); if (d >= 0) c.exc += d; else c.inh += d; }
  const bySc = {};
  for (const r of rows) { const c = bySc[r.sc] ||= { n: 0, exc: 0, inh: 0, active: 0 }; c.n++; if (r.hz > 0) c.active++; const d = drive(r); if (d >= 0) c.exc += d; else c.inh += d; }
  console.log(`presynaptic drive onto ${process.argv[4] || 'MN9'} (${TARGET.length} cells) at the 6 Hz olfactory baseline, seed ${SEED}`);
  console.log(`${pre.size} presynaptic cells, total |drive| ${tot.toFixed(0)}\n`);
  console.log('class                         cells  active   excitatory    inhibitory    net    share');
  for (const [c, v] of Object.entries(cls).sort((a, b) => (Math.abs(b[1].exc) + Math.abs(b[1].inh)) - (Math.abs(a[1].exc) + Math.abs(a[1].inh)))) {
    const share = (Math.abs(v.exc) + Math.abs(v.inh)) / tot;
    if (share < 0.005) continue;
    console.log(`${(c || '(unlabelled)').padEnd(28)} ${String(v.n).padStart(5)} ${String(v.active).padStart(7)} ${v.exc.toFixed(0).padStart(12)} ${v.inh.toFixed(0).padStart(13)} ${(v.exc + v.inh).toFixed(0).padStart(6)}  ${(share * 100).toFixed(1)}%`);
  }
  console.log('\nby superclass:');
  console.log('superclass                    cells  active   excitatory    inhibitory    net    share');
  for (const [c, v] of Object.entries(bySc).sort((a, b) => (Math.abs(b[1].exc) + Math.abs(b[1].inh)) - (Math.abs(a[1].exc) + Math.abs(a[1].inh)))) {
    const share = (Math.abs(v.exc) + Math.abs(v.inh)) / tot;
    console.log(`${(c || '(unlabelled)').padEnd(28)} ${String(v.n).padStart(5)} ${String(v.active).padStart(7)} ${v.exc.toFixed(0).padStart(12)} ${v.inh.toFixed(0).padStart(13)} ${(v.exc + v.inh).toFixed(0).padStart(6)}  ${(share * 100).toFixed(1)}%`);
  }
  console.log('\ntop individual sources:');
  for (const r of rows.sort((a, b) => Math.abs(drive(b)) - Math.abs(drive(a))).slice(0, 15))
    console.log(`  ${(r.type || '?').padEnd(20)} ${(r.cls || '').padEnd(22)} w ${String(r.w).padStart(4)} sign ${f2(r.sign).padStart(5)} rate ${f2(r.hz).padStart(7)} Hz  drive ${drive(r).toFixed(0).padStart(7)}`);
} else if (mode === 'silence') {
  // Cut a population out of the baseline network -- clamp it to no output by zeroing its outgoing
  // weights -- and re-measure MN9. `clampOut` is applied to the graph the brain is built from.
  const cuts = [
    ['none', []],
    ['ALPN', byClass['ALPN']],
    ['ALLN', byClass['ALLN']],
    ['olfactory (ORN)', byClass['olfactory']],
    ['gustatory', byClass['gustatory']],
    ['Kenyon_Cell', byClass['Kenyon_Cell']],
    ['MBON', byClass['MBON']],
    ['CX', byClass['CX']],
    ['mechanosensory', [...(byClass['mechanosensory'] || []), ...(byClass['mechanosensory_tactile'] || []), ...(byClass['mechanosensory_proprioceptive'] || [])]],
    ['ALPN+ALLN+ORN', [...(byClass['ALPN'] || []), ...(byClass['ALLN'] || []), ...(byClass['olfactory'] || [])]],
  ];
  console.log(`MN9 baseline with one population cut out of the network (seed ${SEED}, 6 Hz ORN drive)\n`);
  console.log('cut                        cells   baseMN9   sugarMN9   tarsalMN9');
  for (const [name, ix] of cuts) {
    if (!ix) continue;
    const c = { ...cfg, cutOut: ix };
    const b = sim(c, [[ORN_ALL, 6]], 400);
    const s = sim(c, [[ORN_ALL, 6], [SUGAR, 100]], 400, 300);
    const t = sim(c, [[ORN_ALL, 6], [FRONT_SUGAR, 150]], 400);
    console.log(`${name.padEnd(24)} ${String(ix.length).padStart(6)}   ${f2(hzOf(b, MN9, 400)).padStart(7)}   ${f2(hzOf(s, MN9, 400)).padStart(8)}   ${f2(hzOf(t, MN9, 400)).padStart(9)}`);
  }
} else if (mode === 'chain') {
  // The rates along the route the `silence` cut implicates, with and without the antennal lobe's
  // output. A stage whose rate collapses when ALPN is cut is carrying the olfactory baseline; one
  // that does not is being driven by something else and is not part of the leak.
  const stages = ['ALPN', 'ALLN', 'GNG494', 'AN10B009', 'aSP22', 'GNG298', 'GNG017', 'GNG120', 'GNG232', 'DNge080', 'MN9'];
  const pops = stages.map(t => [t, t === 'ALPN' || t === 'ALLN' ? byClass[t] : D.byType(t)]);
  const runs = [['intact', {}], ['ALPN cut', { cutOut: byClass['ALPN'] }], ['ORN cut', { cutOut: byClass['olfactory'] }]];
  const out = runs.map(([name, extra]) => [name, sim({ ...cfg, ...extra }, [[ORN_ALL, 6]], 400)]);
  console.log(`rates along the olfactory-to-proboscis route at the 6 Hz baseline, seed ${SEED}\n`);
  console.log('stage        cells' + out.map(([n]) => n.padStart(12)).join(''));
  for (const [t, ix] of pops) {
    if (!ix || !ix.length) continue;
    console.log(`${t.padEnd(12)} ${String(ix.length).padStart(5)}` + out.map(([, r]) => f2(hzOf(r, ix, 400)).padStart(12)).join(''));
  }
} else if (mode === 'fix') {
  // Candidate interventions, each scored on the three terms that have to move together. quietMN9 is
  // the term at issue; sugar and tarsalPER are the two the fix is allowed to break and must not, and
  // `baseline` is carried because M3's mechanism -- the antennal lobe passing its own spontaneous
  // input straight through -- is also what makes the whole network busy.
  const SEEDS = [1000, 1001, 1002];
  const cands = [
    ['calibrated', {}],
    ['ALLN gain x2', { classGain: { ALLN: 2 } }],
    ['ALLN gain x4', { classGain: { ALLN: 4 } }],
    ['ALLN gain x8', { classGain: { ALLN: 8 } }],
    ['ALLN gain x16', { classGain: { ALLN: 16 } }],
    ['ALPN gain x0.5', { classGain: { ALPN: 0.5 } }],
    ['ALPN gain x0.25', { classGain: { ALPN: 0.25 } }],
    ['GNG120 gain x0.5', { typeGain: { GNG120: 0.5 } }],
    ['GNG120 gain x0.25', { typeGain: { GNG120: 0.25 } }],
    ['global inhGain x2', { inhGain: PARAMS.inhGain * 2 }],
    // Presynaptic gain control: the ALLN -> ORN-terminal synapses the connectome carries and the
    // sensory-input clause deletes (src/lifwasm.js), restored as a divisive scaling of receptor-neuron
    // release. 118,990 of the 121,683 units of inhibitory synapse mass onto olfactory receptor
    // neurons come from ALLNs, so this is one named circuit rather than a free parameter.
    ['preInh 0.25', { preInh: 0.25 }],
    ['preInh 0.5', { preInh: 0.5 }],
    ['preInh 1', { preInh: 1 }],
    ['preInh 2', { preInh: 2 }],
    ['preInh 4', { preInh: 4 }],
    ['preInh 8', { preInh: 8 }],
  ];
  const clamp = x => Math.max(0, Math.min(1, x));
  console.log(`candidate fixes for quietMN9, mean of ${SEEDS.length} seeds; MN9 target < 15 Hz baseline\n`);
  console.log('candidate              baseMN9  sugarMN9  tarsalMN9   quietMN9  sugarTerm  tarsalPER');
  for (const [name, extra] of cands) {
    const acc = { b: 0, s: 0, t: 0, r: 0, r2: 0 };
    for (const sd of SEEDS) {
      const c = { ...PARAMS, ...extra, seed: sd };
      const base = [[ORN_ALL, 6]];
      const b = sim(c, base, 400); acc.b += hzOf(b, MN9, 400);
      const su = sim(c, [...base, [SUGAR, 100]], 400, 300); acc.s += hzOf(su, MN9, 400); acc.r += hzOf(su, RELAY, 400);
      const t = sim(c, [...base, [FRONT_SUGAR, 150]], 400); acc.t += hzOf(t, MN9, 400);
    }
    const n = SEEDS.length, b = acc.b / n, su = acc.s / n, t = acc.t / n;
    const quiet = clamp(1 - b / 10), sugar = 0.6 * clamp(su / 60) + 0.2 * clamp(acc.r / n / 40), per = clamp(t / 30);
    console.log(`${name.padEnd(22)} ${f2(b).padStart(7)} ${f2(su).padStart(9)} ${f2(t).padStart(10)}   ${quiet.toFixed(3).padStart(8)}  ${sugar.toFixed(3).padStart(9)}  ${per.toFixed(3).padStart(9)}`);
  }
  console.log('\n(sugarTerm here omits the 0.2 relay2 share, so it is comparable across rows and not to the benchmark)');
} else if (mode === 'paired') {
  // The objective contains two terms that read MN9: `quietMN9` punishes it above 10 Hz with no tastant
  // and `tarsalPER` rewards it at 30 Hz with sugar on the front tarsi. Both are read from the same cell
  // over the same 400 ms window, so if the tarsal pathway contributes nothing the two terms are reading
  // one number with opposite signs -- and the one that is satisfied is being paid by the leak the other
  // one is trying to remove. This measures the tarsal-evoked component directly, paired by seed.
  const SEEDS = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007];
  console.log(`MN9 with and without tarsal sugar at the calibrated point, paired over ${SEEDS.length} seeds\n`);
  console.log('seed    baseMN9   tarsalMN9   evoked');
  const d = [];
  for (const sd of SEEDS) {
    const c = { ...PARAMS, seed: sd }, base = [[ORN_ALL, 6]];
    const b = hzOf(sim(c, base, 400), MN9, 400);
    const t = hzOf(sim(c, [...base, [FRONT_SUGAR, 150]], 400), MN9, 400);
    d.push(t - b);
    console.log(`${String(sd).padStart(4)}   ${f2(b).padStart(7)}   ${f2(t).padStart(9)}   ${(t - b >= 0 ? '+' : '') + f2(t - b)}`);
  }
  const mu = d.reduce((a, b) => a + b, 0) / d.length;
  const se = Math.sqrt(d.reduce((a, x) => a + (x - mu) ** 2, 0) / (d.length - 1) / d.length);
  console.log(`\ntarsal-evoked component: ${mu >= 0 ? '+' : ''}${mu.toFixed(2)} +- ${se.toFixed(2)} Hz`);
  console.log('tarsalPER scores clamp(tarsalMN9 / 30) and quietMN9 scores clamp(1 - baseMN9 / 10).');
  console.log('If the evoked component is zero, tarsalPER is scoring the baseline that quietMN9 punishes.');
} else if (mode === 'combo') {
  // The `fix` table says every intervention that quiets MN9 also shrinks its sugar response, because
  // both ride the same GNG120 channel. The objective wants a dynamic range: baseline under 10 Hz and a
  // 60 Hz sugar response, a ratio of 6, against 1.8 at the calibrated point. So the combination to try
  // is a lateral-inhibition gain that lowers the tonic drive together with a gain on the *gustatory*
  // chain to put the sugar response back. If no cell of this grid reaches both, the two are not
  // separable by gains at all and M3's negative is the answer.
  const SEEDS = [1000, 1001, 1002];
  const FEED = ['LB3b', 'LB3c', 'GNG232', 'DNge080'];
  const clamp = x => Math.max(0, Math.min(1, x));
  console.log(`quietMN9 against a gustatory-chain gain, mean of ${SEEDS.length} seeds`);
  console.log('success needs baseMN9 < 10, sugarMN9 >= 60, tarsalMN9 >= 30\n');
  console.log('ALLN gain  feed gain   baseMN9  sugarMN9  tarsalMN9   ratio   quietMN9  tarsalPER');
  for (const al of [1, 4, 6, 8, 10]) for (const fg of [1, 2, 4, 8]) {
    const extra = { classGain: { ALLN: al }, typeGain: Object.fromEntries(FEED.map(t => [t, fg])) };
    let b = 0, su = 0, t = 0;
    for (const sd of SEEDS) {
      const c = { ...PARAMS, ...extra, seed: sd }, base = [[ORN_ALL, 6]];
      b += hzOf(sim(c, base, 400), MN9, 400);
      su += hzOf(sim(c, [...base, [SUGAR, 100]], 400, 300), MN9, 400);
      t += hzOf(sim(c, [...base, [FRONT_SUGAR, 150]], 400), MN9, 400);
    }
    const n = SEEDS.length; b /= n; su /= n; t /= n;
    const ok = b < 10 && su >= 60 && t >= 30 ? '  <- meets M3' : '';
    console.log(`${String(al).padStart(9)}  ${String(fg).padStart(9)}   ${f2(b).padStart(7)}  ${f2(su).padStart(8)}  ${f2(t).padStart(9)}   ${(su / Math.max(b, 0.1)).toFixed(1).padStart(5)}   ${clamp(1 - b / 10).toFixed(3).padStart(8)}  ${clamp(t / 30).toFixed(3).padStart(9)}${ok}`);
  }
} else if (mode === 'refine') {
  // `combo` reaches M3's criterion at ALLN x8 with an x8 gain on the whole gustatory chain, and gets
  // there by driving the sugar response to 289 Hz -- the `sugar` term is a floor with no ceiling, so
  // an absurd rate scores the same as a plausible one. This grid separates the two routes into MN9,
  // to find whether the criterion is reachable at a physiological sugar rate: the labellar receptors
  // (LB3b/LB3c) and the tarsal ones (LgLG3/LgLG4/LgAG2) feed a shared relay (GNG232, DNge080), and
  // the tarsal route is the weak one. Gain the relay, not the receptors.
  const SEEDS = [1000, 1001, 1002];
  const clamp = x => Math.max(0, Math.min(1, x));
  console.log(`ALLN lateral-inhibition gain x8 with a gain on the shared feeding relay, ${SEEDS.length} seeds\n`);
  console.log('ALLN  relay  tarsal recep   baseMN9  sugarMN9  tarsalMN9   quietMN9  sugarTerm  tarsalPER');
  for (const al of [6, 8]) for (const rg of [1, 2, 3, 4]) for (const tg of [1, 2, 4]) {
    const extra = { classGain: { ALLN: al }, typeGain: { GNG232: rg, DNge080: rg, LgLG3: tg, LgLG4: tg, LgAG2: tg } };
    let b = 0, su = 0, t = 0, rel = 0;
    for (const sd of SEEDS) {
      const c = { ...PARAMS, ...extra, seed: sd }, base = [[ORN_ALL, 6]];
      b += hzOf(sim(c, base, 400), MN9, 400);
      const s2 = sim(c, [...base, [SUGAR, 100]], 400, 300); su += hzOf(s2, MN9, 400); rel += hzOf(s2, RELAY, 400);
      t += hzOf(sim(c, [...base, [FRONT_SUGAR, 150]], 400), MN9, 400);
    }
    const n = SEEDS.length; b /= n; su /= n; t /= n; rel /= n;
    const ok = b < 15 && su >= 60 && t >= 30 ? '  <- meets M3' : '';
    console.log(`${String(al).padStart(4)}  ${String(rg).padStart(5)}  ${String(tg).padStart(12)}   ${f2(b).padStart(7)}  ${f2(su).padStart(8)}  ${f2(t).padStart(9)}   ${clamp(1 - b / 10).toFixed(3).padStart(8)}  ${(0.6 * clamp(su / 60) + 0.2 * clamp(rel / 40)).toFixed(3).padStart(9)}  ${clamp(t / 30).toFixed(3).padStart(9)}${ok}`);
  }
} else {
  console.log('usage: mn9_quiet.mjs dose|sources|silence|chain|fix|combo|refine|paired [seed]');
}
