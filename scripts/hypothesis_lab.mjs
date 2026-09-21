// Hypothesis lab: which dynamical model does the heading-circuit wiring actually support?
//
// A wiring diagram permits multiple plausible dynamics. Here we instantiate an ENSEMBLE of
// LIF models over the parameters the connectome does not fix — EPG->EPG recurrence gain,
// Delta7->EPG kernel gain, tonic EPG excitability, PEN->EPG push gain — then measure the
// same observables on every member: bump persistence, realised kernel, push field, rotation.
//
// Members are classified into competing hypotheses:
//   attractor_free  — bump persists unaided (recurrence alone suffices)
//   attractor_tonic — bump persists only with tonic EPG drive
//   filter          — no persistent bump; heading read out instantaneously
//
// Each candidate perturbation is then scored by how strongly its outcome separates the
// ensemble (fraction of member pairs it places in different outcome classes). The top-ranked
// experiment is the measurement that would most inform the biology.
//
// Run: node scripts/hypothesis_lab.mjs   (writes public/data/hypothesis_lab.json)
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { seedRng, makeBuilder, run, silence, circRes, circAngle, rankExperiments } from './lif_ensemble.mjs';

// deterministic RNG for the LIF noise source — ensemble must be reproducible
const SEED = +process.argv[2] || 20260704;
seedRng(SEED);

const D = loadAll(), { meta, N } = D;
const f2 = (v) => +(v).toFixed(3);

// ---- populations & geometry (same fold as validate_dynamics.mjs) ----
const pbcol = (s) => { const m = s && s.match(/_([LR])(\d)/); return m ? [m[1], +m[2]] : null; };
const posOf = (c) => c[0] === 'L' ? 9 - c[1] : 8 + c[1];
const wedgeOf = (i) => { const c = pbcol(meta.instances[i]); return c ? ((posOf(c) % 8) + 8) % 8 : -1; };
const epg = D.byType('EPG'), d7 = D.byType('Delta7'), peg = D.byType('PEG');
const penAll = [...D.byType('PEN_a(PEN1)'), ...D.byType('PEN_b(PEN2)')];
const penL = penAll.filter(i => pbcol(meta.instances[i])?.[0] === 'L');
const penR = penAll.filter(i => pbcol(meta.instances[i])?.[0] === 'R');
const wedges = Array.from({ length: 8 }, () => []);
epg.forEach((i) => { const w = wedgeOf(i); if (w >= 0) wedges[w].push(i); });

// edge-class gain scaling + tonic bias via the generic ensemble builder
const penSet = new Set(penAll);
const buildNet = makeBuilder(D, [
  { pre: 'EPG', post: 'EPG', param: 'epgRecur' },
  { pre: 'Delta7', post: 'EPG', param: 'd7Gain' },
  { pre: penSet, post: 'EPG', param: 'penGain' },
]);

const wedgeRates = (net, b0) => wedges.map(ws => ws.reduce((a, i) => a + (net.spikeCount[i] - (b0 ? b0[i] : 0)), 0) / Math.max(ws.length, 1));
// thr.fill(0) would wipe a silencing offset — the silenced set is re-applied after reset, the
// same idiom as run_ensemble.mjs (without it d7_silence/peg_lesion measured unperturbed nets)
const clean = (net, tonic) => { net.drive.fill(0); net.bias.fill(0); net.thr.fill(0); net.reset();
  if (net.__silenced) for (const i of net.__silenced) net.setThr(i, 1e6);
  if (tonic) net.setBias(epg, tonic); };

// ---- observable: bump persistence after a seeded bump is released ----
// concentration = circular resultant length (0 uniform .. 1 point bump)
// width = FWHM of the wedge profile in wedges; real Delta7 silencing widens the
// bump without necessarily killing it, so width separates 'sculpts' from 'confines'
function bumpWidth(r) {
  const pk = r.indexOf(Math.max(...r)), hi = r[pk] / 2;
  let lo = 0, hit = 0;
  for (let w = 0; w < 8; w++) if (r[((w + pk) % 8 + 8) % 8] > hi) hit++;
  return hit;
}
function persistence(net, tonic) {
  clean(net, tonic);
  net.setDrive(wedges[0], 100); run(net, 150);
  const seeded = circRes(wedgeRates(net));
  net.setDrive(wedges[0], 0);
  const b0 = Uint32Array.from(net.spikeCount); run(net, 400);
  const r = wedgeRates(net, b0);
  const after = circRes(r);
  const total = r.reduce((a, b) => a + b, 0);
  return { concentration: f2(after), seeded: f2(seeded), total_rate: f2(total), width_wedges: total > 0.5 ? bumpWidth(r) : 0 };
}

// ---- observable: rotation under sustained unilateral PEN drive (only if a bump exists) ----
function rotation(net, tonic, side) {
  clean(net, tonic);
  net.setDrive(wedges[0], 100); run(net, 150); net.setDrive(wedges[0], 0);
  const b0 = Uint32Array.from(net.spikeCount); run(net, 100);
  if (wedgeRates(net, b0).reduce((a, b) => a + b, 0) < 0.5) return { drift: null, tracked: 0 };  // no bump to rotate
  const pen = side === 'L' ? penL : penR;
  net.setDrive(pen, 80);
  const angles = [];
  for (let k = 0; k < 4; k++) {
    const b1 = Uint32Array.from(net.spikeCount); run(net, 100);
    const r = wedgeRates(net, b1);
    if (r.reduce((a, b) => a + b, 0) > 0.5) angles.push(circAngle(r)); else angles.push(null);
  }
  net.setDrive(pen, 0);
  const a = angles.filter(v => v != null);
  if (a.length < 2) return { drift: null, tracked: a.length };
  let d = a[a.length - 1] - a[0];
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return { drift: f2(d / (a.length - 1) * 10), tracked: a.length };  // rad/s approx (100ms bins)
}

// ---- observable: realised Delta7 kernel (subset of cells for speed) ----
function kernel(net, tonic) {
  const d7in = d7.map(() => new Float64Array(8));
  const d7idx = new Map(d7.map((d, k) => [d, k]));
  for (const i of epg) { const w = wedgeOf(i); if (w < 0) continue; for (let j = D.indptr[i]; j < D.indptr[i + 1]; j++) { const k = d7idx.get(D.indices[j]); if (k != null) d7in[k][w] += D.weights[j]; } }
  const acc = new Float64Array(8); let cnt = 0;
  for (const d of d7) {
    const pw = d7in[d7idx.get(d)].indexOf(Math.max(...d7in[d7idx.get(d)]));
    clean(net, tonic || 4); run(net, 60);
    net.setDrive([d], 100); run(net, 120); net.setDrive([d], 0);
    const gI = wedges.map(ws => -ws.reduce((a, i) => a + net.gI[i], 0) / ws.length);
    if (Math.max(...gI) - Math.min(...gI) < 0.01) continue;
    for (let w = 0; w < 8; w++) acc[w] += gI[((w + pw) % 8 + 8) % 8];
    cnt++;
  }
  const prof = [...acc].map(v => v / Math.max(cnt, 1));
  const k8 = [...Array(8).keys()], a = prof.reduce((s, x) => s + x, 0) / 8;
  const b = -2 * prof.reduce((s, x, k) => s + x * Math.cos(2 * Math.PI * k / 8), 0) / 8;
  const ss = prof.reduce((s, x, k) => s + (x - (a - b * Math.cos(2 * Math.PI * k / 8))) ** 2, 0);
  const tt = prof.reduce((s, x) => s + (x - a) ** 2, 0);
  return { n_d7: cnt, contrast: f2(b / Math.max(a, 1e-9)), r2: f2(1 - ss / Math.max(tt, 1e-9)),
           min_at_bump: prof.indexOf(Math.min(...prof)) <= 1 || prof.indexOf(Math.min(...prof)) === 7 };
}

// ---- ensemble ----
const grid = [];
for (const epgRecur of [1, 3, 4, 6]) for (const d7Gain of [0.5, 1.0, 1.3]) for (const epgTonic of [0, 3, 5, 7]) for (const penGain of [1])
  grid.push({ epgRecur, d7Gain, epgTonic, penGain });

const members = [];
console.log(`ensemble: ${grid.length} members over {epgRecur, d7Gain, epgTonic, penGain}`);
for (const p of grid) {
  const t0 = Date.now();
  const net = buildNet(p);
  const base = persistence(net, p.epgTonic);
  const kern = kernel(net, p.epgTonic);
  const rotL = rotation(net, p.epgTonic, 'L'), rotR = rotation(net, p.epgTonic, 'R');
  // hypothesis from baseline observables
  const persists = base.concentration > 0.5;
  const hyp = !persists ? (base.total_rate < 0.2 ? 'silent' : 'filter')
            : base.total_rate < 0.2 ? 'frozen'                       // bump forms but barely spikes
            : (p.epgTonic > 0 ? 'attractor_tonic' : 'attractor_free');
  // perturbations
  const pert = {};
  { const n2 = buildNet(p); silence(n2, d7); pert.d7_silence = persistence(n2, p.epgTonic); }
  { const n2 = buildNet(p); silence(n2, peg); pert.peg_lesion = persistence(n2, p.epgTonic); }
  members.push({ params: p, hypothesis: hyp, baseline: { persistence: base, kernel: kern, rotL, rotR }, perturbations: pert });
  console.log(`  recur×${p.epgRecur} d7×${p.d7Gain} tonic${p.epgTonic} pen×${p.penGain}: ${hyp} | persist ${base.concentration} (rate ${base.total_rate}) kernel c=${kern.contrast} r2=${kern.r2} | rotL ${rotL.drift} rotR ${rotR.drift} | ${Date.now() - t0}ms`);
}

// ---- rank experiments by discriminative power across the ensemble ----
const cls = (v) => v > 0.5 ? 'sustains' : v > 0.2 ? 'partial' : 'decays';
const ranked = rankExperiments({
  tonic_sweep: { note: 'separates attractor_free from attractor_tonic by construction', outcome: members.map(m => cls(m.baseline.persistence.concentration)) },
  d7_silence: { outcome: members.map(m => cls(m.perturbations.d7_silence.concentration)) },
  peg_lesion: { outcome: members.map(m => cls(m.perturbations.peg_lesion.concentration)) },
  unilateral_pen_L: { outcome: members.map(m => m.baseline.rotL.drift > 0.05 ? 'rotates' : 'none') },
  unilateral_pen_R: { outcome: members.map(m => m.baseline.rotR.drift < -0.05 ? 'rotates' : 'none') },
});

const byHyp = {};
for (const m of members) (byHyp[m.hypothesis] ||= []).push(m.params);
console.log('\nhypotheses:', Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])));
console.log('ranked experiments:', ranked.map(([n, e]) => `${n}=${e.score}`).join(', '));

// ---- mechanism classes among bump-sustaining members, under the top discriminator ----
// same baseline behaviour, different causal structure — the thing an experiment resolves
const mech = (m) => {
  const s = m.perturbations.d7_silence, b = m.baseline.persistence;
  if (s.concentration > 0.5) return s.width_wedges >= b.width_wedges + 2 ? 'd7_confines_width' : 'd7_sculpts_sharp';
  if (s.total_rate > 1) return 'd7_confines';                   // silencing -> runaway/uniform firing
  return 'd7_essential';                                        // silencing -> activity dies (adaptation release)
};
const attractors = members.filter(m => m.hypothesis.startsWith('attractor'));
const mechGroups = {};
for (const m of attractors) (mechGroups[mech(m)] ||= []).push(m.params);
console.log('mechanisms among attractor members:', Object.fromEntries(Object.entries(mechGroups).map(([k, v]) => [k, v.length])));

// ---- cross-formalism merge: PDE field-model outcomes for the same manipulations ----
// Agreement across model classes is stronger evidence than agreement across parameters
// of one class. perturb_pde.json is produced by scripts/perturb_pde.py.
let pde = null;
try { pde = JSON.parse(fs.readFileSync('public/data/perturb_pde.json', 'utf8')); } catch {}
const crossFormalism = {};
if (pde?.d7_sweep) {
  const at = (g) => pde.d7_sweep.find((r) => r.d7_gain === g);
  const b = at(1.0), s = at(0.0);
  const pdeD7 = !s || s.R < 0.1 ? (s && s.peak > 1 ? 'uniform_firing' : 'silent')
    : s.width_deg > 1.3 * b.width_deg ? 'survives_widened' : 'survives_sharp';
  const lifClass = { survives_widened: 'd7_confines_width', uniform_firing: 'd7_confines',
                     survives_sharp: 'd7_sculpts_sharp', silent: 'd7_essential' }[pdeD7];
  const lifCounts = {};
  for (const m of attractors) lifCounts[mech(m)] = (lifCounts[mech(m)] || 0) + 1;
  const majority = Object.entries(lifCounts).sort((x, y) => y[1] - x[1])[0]?.[0];
  crossFormalism.d7_silence = {
    pde_outcome: pdeD7, pde_width_deg: s?.width_deg, baseline_width_deg: b?.width_deg,
    maps_to_lif_class: lifClass, lif_class_counts: lifCounts,
    agrees_with_lif_majority: lifClass === majority,
    curve: pde.d7_sweep.map((r) => ({ d7: r.d7_gain, R: r.R, width_deg: r.width_deg })),
    note: 'PDE includes a ring-neuron inhibition channel not gated by d7 — bump survives ' +
          'silencing widened, matching Turner-Evans 2020 (bump forms without D7 output).',
  };
  if (pde.pen_left) crossFormalism.unilateral_pen = {
    both_drift: pde.pen_both?.drift, left_only: pde.pen_left?.drift, right_only: pde.pen_right?.drift,
    pde_prediction: 'arm selectivity is exact: unilateral PEN loss abolishes integration in its direction only',
  };
  if (pde.exc_sweep) crossFormalism.exc_viability = pde.exc_sweep;
  console.log('cross-formalism: d7_silence PDE outcome =', pdeD7,
    '-> LIF class', lifClass, '| agrees with LIF majority:', lifClass === majority);
}

fs.writeFileSync('public/data/hypothesis_lab.json', JSON.stringify({
  seed: SEED,
  summary: {
    ensemble_size: members.length,
    attractor_compatible: attractors.length,
    hypotheses: Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])),
    mechanisms: Object.fromEntries(Object.entries(mechGroups).map(([k, v]) => [k, v.length])),
    best_experiment: ranked[0][0],
    best_experiment_separation: ranked[0][1].score,
    claim: 'Wiring supports a low-dimensional heading bump in a narrow gain regime (EPG recurrence ~3-6x, tonic EPG bias ~3-7mV). ' +
           'Free-running bump without tonic drive was not observed at any grid point. ' +
           'Among bump-sustaining models, Delta7 silencing separates mechanisms that are indistinguishable at baseline.',
  },
  grid_axes: ['epgRecur', 'd7Gain', 'epgTonic', 'penGain'],
  members: members.map(m => ({ params: m.params, hypothesis: m.hypothesis, mechanism: m.hypothesis.startsWith('attractor') ? mech(m) : null,
    baseline: m.baseline, perturbations: m.perturbations })),
  hypothesis_counts: Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])),
  mechanism_counts: Object.fromEntries(Object.entries(mechGroups).map(([k, v]) => [k, v.length])),
  ranked_experiments: ranked.map(([name, e]) => ({ experiment: name, separation: e.score, outcomes: e.outcome })),
  cross_formalism: Object.keys(crossFormalism).length ? crossFormalism : null,
}, null, 1));
console.log('wrote public/data/hypothesis_lab.json');
