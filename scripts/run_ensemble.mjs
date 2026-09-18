// Generic ensemble runner: executes a declarative ensemble spec against the
// connectome. The spec (from ensemble_spec.py / public/data/ensemble_specs.json)
// declares populations, uncertain gain axes, geometry, and perturbations; this
// runner instantiates the grid, measures observables, classifies hypotheses,
// ranks perturbations by pairwise outcome separation, and writes a lab artifact.
//
// Geometry plugins:
//   ring   — populations grouped by PB column (mod 8 wedges); observables are
//            bump persistence / kernel contrast / rotation under unilateral drive
//   linear — populations grouped by FB column (_C<n>); observables are centroid
//            offset of the driven transform, amplitude scaling, sweep rigidity
//
// Run: node scripts/run_ensemble.mjs <spec_name> [seed]
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { seedRng, makeBuilder, run, silence, circRes, circAngle, centroid, rankExperiments } from './lif_ensemble.mjs';

const f2 = (v) => +(v).toFixed(3);

// ============================== geometry plugins ==============================

// ring: group a population into 8 wedges by its PB column tag _L/_R<n>
function ringGeom(D, meta) {
  const pbcol = (s) => { const m = s && s.match(/_([LR])(\d)/); return m ? [m[1], +m[2]] : null; };
  const posOf = (c) => c[0] === 'L' ? 9 - c[1] : 8 + c[1];
  const wedgeOf = (i) => { const c = pbcol(meta.instances[i]); return c ? ((posOf(c) % 8) + 8) % 8 : -1; };
  return {
    group(pop) {
      const ws = Array.from({ length: 8 }, () => []);
      pop.forEach((i) => { const w = wedgeOf(i); if (w >= 0) ws[w].push(i); });
      return ws;
    },
    side: (i) => pbcol(meta.instances[i])?.[0],
  };
}

// linear: group a population by its FB column tag _C<n>
function linearGeom(D, meta) {
  const colOf = (i) => { const m = meta.instances[i].match(/_C(\d+)/); return m ? +m[1] : 0; };
  return {
    group(pop) {
      const cs = {};
      pop.forEach((i) => (cs[colOf(i)] ||= []).push(i));
      return cs;
    },
    colOf,
  };
}

// ============================== observables ===================================

function wedgeRates(net, wedges, b0) {
  return wedges.map(ws => ws.reduce((a, i) => a + (net.spikeCount[i] - (b0 ? b0[i] : 0)), 0) / Math.max(ws.length, 1));
}
function bumpWidth(r) {
  const pk = r.indexOf(Math.max(...r)), hi = r[pk] / 2;
  let hit = 0;
  for (let w = 0; w < 8; w++) if (r[((w + pk) % 8 + 8) % 8] > hi) hit++;
  return hit;
}
function clean(net, biasPops) {
  net.drive.fill(0); net.bias.fill(0); net.thr.fill(0); net.reset();
  for (const bp of biasPops) net.setBias(bp.pop, bp.val);
  // Threshold offsets are how a population is silenced, and clearing them here silently undid every
  // silencing perturbation in all three labs: the probes call clean() after the caller has raised the
  // thresholds. Silenced cells are recorded on the net so the reset cannot outlive them.
  if (net.__silenced) for (const i of net.__silenced) net.setThr(i, 1e6);
}
const silencePop = (net, idx) => { net.__silenced = idx; for (const i of idx) net.setThr(i, 1e6); return net; };

// ---- ring probes ----
function ringPersistence(net, wedges, biasPops) {
  clean(net, biasPops);
  net.setDrive(wedges[0], 100); run(net, 150);
  const seeded = circRes(wedgeRates(net, wedges));
  net.setDrive(wedges[0], 0);
  const b0 = Uint32Array.from(net.spikeCount); run(net, 400);
  const r = wedgeRates(net, wedges, b0);
  const total = r.reduce((a, b) => a + b, 0);
  return { concentration: f2(circRes(r)), seeded: f2(seeded), total_rate: f2(total),
           width_wedges: total > 0.5 ? bumpWidth(r) : 0 };
}
function ringRotation(net, wedges, drivePop, biasPops) {
  clean(net, biasPops);
  net.setDrive(wedges[0], 100); run(net, 150); net.setDrive(wedges[0], 0);
  const b0 = Uint32Array.from(net.spikeCount); run(net, 100);
  if (wedgeRates(net, wedges, b0).reduce((a, b) => a + b, 0) < 0.5) return { drift: null, tracked: 0 };
  net.setDrive(drivePop, 80);
  const angles = [];
  for (let k = 0; k < 4; k++) {
    const b1 = Uint32Array.from(net.spikeCount); run(net, 100);
    const r = wedgeRates(net, wedges, b1);
    angles.push(r.reduce((a, b) => a + b, 0) > 0.5 ? circAngle(r) : null);
  }
  net.setDrive(drivePop, 0);
  const a = angles.filter(v => v != null);
  if (a.length < 2) return { drift: null, tracked: a.length };
  let d = a[a.length - 1] - a[0];
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return { drift: f2(d / (a.length - 1) * 10), tracked: a.length };
}

// ---- linear probes ----
function colProbe(net, colMap, hcol, targetPop, colOf, driveCol, ms = 250) {
  net.drive.fill(0); net.reset();
  const ix = colMap[driveCol]; if (!ix) return null;
  net.setDrive(ix, 100); run(net, ms); net.setDrive(ix, 0);
  const prof = hcol.map(c => targetPop.filter(i => colOf(i) === c).reduce((a, i) => a + net.spikeCount[i], 0));
  const cen = centroid(prof);
  if (cen == null || prof.reduce((a, b) => a + b, 0) < 10) return { offset: null, rate: 0 };
  return { offset: f2(hcol[Math.round(cen)] - driveCol), cen_offset: f2(cen - driveCol), rate: prof.reduce((a, b) => a + b, 0) };
}

// ============================== spec execution ================================

const specName = process.argv[2] || 'ring_attractor';
const SEED = +process.argv[3] || 20260704;
seedRng(SEED);
const D = loadAll(), { meta } = D;
const specs = JSON.parse(fs.readFileSync('public/data/ensemble_specs.json', 'utf8'));
const spec = specs[specName];
if (!spec) { console.error(`no spec '${specName}' in ensemble_specs.json`); process.exit(1); }
console.log(`spec: ${specName} (geometry=${spec.geometry})`);

// 'KC*' = type prefix, 'class:ALPN' = every cell of that annotated class, 'pool:kc' = every
// presynaptic cell of population kc (the graph's own answer to "what feeds this layer?").
// Every member is re-seeded from its own index before it runs. Without this the labs share one
// global RNG stream, so anything that changes one trajectory shifts every member after it: two runs of
// the same spec and seed disagreed on the *baseline* of 18 of 48 ring members, by more than the
// Delta7-silencing effect being measured. Perturbation results were partly reading that drift.
const memberSeed = (i) => seedRng(SEED + 1000003 * (i + 1));

const byPattern = (t) => t.startsWith('class:')
  ? Array.from({ length: D.N }, (_, i) => i).filter(i => meta.classes[D.cls[i]] === t.slice(6))
  : t.endsWith('*')
    ? Array.from({ length: D.N }, (_, i) => i).filter(i => meta.types[i]?.startsWith(t.slice(0, -1)))
    : D.byType(t);
const pop = {};
for (const [k, t] of Object.entries(spec.populations))
  if (!String(t).startsWith('pool:')) pop[k] = [...new Set((Array.isArray(t) ? t : [t]).flatMap(byPattern))];
for (const [k, t] of Object.entries(spec.populations)) {
  if (!String(t).startsWith('pool:')) continue;
  const target = new Set(pop[String(t).slice(5)]);
  const hits = new Map();                       // presynaptic cell -> how many target cells it reaches
  for (let i = 0; i < D.N; i++)
    for (let e = D.indptr[i]; e < D.indptr[i + 1]; e++)
      if (D.weights[e] >= 3 && target.has(D.indices[e])) hits.set(i, (hits.get(i) || 0) + 1);
  // the pool is the operator's *external* input, so cells already named as parts of the operator
  // (its feedback interneuron, its teaching neurons, its readout) do not belong in it
  const own = new Set(Object.entries(spec.populations)
    .filter(([k2, t2]) => k2 !== k && !String(t2).startsWith('pool:'))
    .flatMap(([k2]) => pop[k2]));
  pop[k] = [...hits.entries()].filter(([i, c]) => c >= 2 && !target.has(i) && !own.has(i)).map(([i]) => i);
  console.log(`  pool ${k} = ${pop[k].length} presynaptic cells of ${String(t).slice(5)}`);
}

const resolve = (x) => x instanceof Set ? x : new Set((Array.isArray(x) ? x : [x]).flatMap(tt => pop[tt] || byPattern(tt)));
const build = makeBuilder(D, spec.edge_params.map(r => ({
  pre: resolve(r.pre), post: resolve(r.post), param: r.param,
})), spec.tonics.map(t => ({ pop: pop[t.pop], param: t.param })));

const axes = Object.keys(spec.grid);
const grid = [{}];
for (const ax of axes) {
  const next = [];
  for (const g of grid) for (const v of spec.grid[ax]) next.push({ ...g, [ax]: v });
  grid.splice(0, grid.length, ...next);
}
for (const g of grid) for (const dp of spec.defaults || []) if (g[dp.param] == null) g[dp.param] = dp.value;

const biasOf = (params) => spec.tonics.filter(t => params[t.param]).map(t => ({ pop: pop[t.pop], val: params[t.param] }));
const cls = (v) => v > 0.5 ? 'sustains' : v > 0.2 ? 'partial' : 'decays';

const members = [];
console.log(`ensemble: ${grid.length} members over {${axes.join(', ')}}`);

if (spec.geometry === 'ring') {
  const G = ringGeom(D, meta);
  const wedges = G.group(pop[spec.roles.bump]);
  const shifterL = pop[spec.roles.shifter].filter(i => G.side(i) === 'L');
  const shifterR = pop[spec.roles.shifter].filter(i => G.side(i) === 'R');
  for (const [mi, p] of grid.entries()) {
    memberSeed(mi);
    const net = build(p), bp = biasOf(p);
    const base = ringPersistence(net, wedges, bp);
    const rotL = ringRotation(net, wedges, shifterL, bp), rotR = ringRotation(net, wedges, shifterR, bp);
    // a second draw of the same member, from a different stream: the floor any perturbation has to clear
    seedRng(SEED + 7777771 * (mi + 1));
    const baseRepeat = ringPersistence(build(p), wedges, bp);
    memberSeed(mi);                        // perturbations start from the member's own stream again
    const persists = base.concentration > 0.5;
    const hyp = !persists ? (base.total_rate < 0.2 ? 'silent' : 'filter')
              : base.total_rate < 0.2 ? 'frozen'
              : (spec.tonics.some(t => p[t.param] > 0) ? 'attractor_tonic' : 'attractor_free');
    const pert = {};
    for (const pt of spec.perturbations) {
      const n2 = build(p);
      if (pt.silence) silencePop(n2, pop[pt.silence]);
      pert[pt.name] = ringPersistence(n2, wedges, bp);
    }
    members.push({ params: p, hypothesis: hyp, baseline: { persistence: base, rotL, rotR },
      baseline_repeat: baseRepeat, perturbations: pert });
    console.log(`  ${JSON.stringify(p)}: ${hyp} | persist ${base.concentration} w${base.width_wedges} | rotL ${rotL.drift} rotR ${rotR.drift}`);
  }
  var ranked = rankExperiments({
    tonic_sweep: { outcome: members.map(m => cls(m.baseline.persistence.concentration)) },
    ...Object.fromEntries(spec.perturbations.map(pt => [pt.name, { outcome: members.map(m => cls(m.perturbations[pt.name].concentration)) }])),
    unilateral_L: { outcome: members.map(m => m.baseline.rotL.drift > 0.05 ? 'rotates' : 'none') },
    unilateral_R: { outcome: members.map(m => m.baseline.rotR.drift < -0.05 ? 'rotates' : 'none') },
  });
  var mech = (m) => {
    if (!m.hypothesis.startsWith('attractor')) return null;
    const s = m.perturbations[spec.mech_perturbation || spec.perturbations[0]?.name], b = m.baseline.persistence;
    if (!s) return null;
    if (s.concentration > 0.5) return s.width_wedges >= b.width_wedges + 2 ? 'confines_width' : 'sculpts_sharp';
    if (s.total_rate > 1) return 'confines';
    return 'essential';
  };
} else if (spec.geometry === 'memory') {
  // random-projection content-addressable memory: drive a random subset of the
  // input population (an "odor"), measure whether the output population's
  // response separates overlapping inputs better than the inputs overlap.
  const kc = pop[spec.roles.input], out = pop[spec.roles.output];
  // The odour is injected into whatever the spec says the stimulus arrives on. Driving the
  // expansion layer itself makes its sparseness unmeasurable: the active fraction is then the
  // stimulus size divided by the layer size, identical in every member and under every
  // perturbation, which is what the first version of this lab reported (0.049, always).
  const drivePop = spec.roles.drive ? pop[spec.roles.drive] : kc;
  const nOdor = spec.odor_size || 200, shared = Math.floor(nOdor * (spec.odor_overlap ?? 0.5));
  const shuffled = [...drivePop].sort(() => Math.random() - 0.5);     // deterministic (seeded)
  const odorA = shuffled.slice(0, nOdor);
  const odorB = [...shuffled.slice(0, shared), ...shuffled.slice(nOdor, nOdor + nOdor - shared)];
  const inSim = shared / nOdor;                                      // input overlap
  const profOf = (net) => out.map(i => net.spikeCount[i]);
  const cosSim = (a, b) => {
    let d = 0, na = 0, nb = 0;
    for (let k = 0; k < a.length; k++) { d += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; }
    return na * nb > 0 ? d / Math.sqrt(na * nb) : 0;
  };
  const DR = spec.drive_rate || 60;        // stimulus rate; the gain-control probe doubles it
  function odorProbe(net, odor, drive = DR, ms = 200) {
    net.drive.fill(0); net.reset();
    net.setDrive(odor, drive); run(net, ms); net.setDrive(odor, 0);
    return { prof: profOf(net), kc_active: kc.filter(i => net.spikeCount[i] > 0).length / kc.length,
             kc_spikes: kc.reduce((a, i) => a + net.spikeCount[i], 0) };
  }
  for (const [mi, p] of grid.entries()) {
    memberSeed(mi);
    const net = build(p), bp = biasOf(p);
    clean(net, bp);
    const A = odorProbe(net, odorA), B = odorProbe(net, odorB);
    seedRng(SEED + 7777771 * (mi + 1));
    const A2 = odorProbe(build(p), odorA), B2 = odorProbe(build(p), odorB);
    const repeat = { kc_active: f2(A2.kc_active),
                     expansion: f2((1 - cosSim(A2.prof, B2.prof)) / Math.max(1 - (shared / nOdor), 1e-9)) };
    memberSeed(mi);
    const outSim = cosSim(A.prof, B.prof);
    const expansion = f2((1 - outSim) / Math.max(1 - inSim, 1e-9));  // >1 = decorrelation
    const rate = A.prof.reduce((a, b) => a + b, 0) + B.prof.reduce((a, b) => a + b, 0);
    // gain control: double the odor drive — does KC output scale sub-linearly?
    // APL feedback should compress; without it KC spikes ~2x.
    const A2x = odorProbe(net, odorA, 2 * DR);
    const compression = f2(A2x.kc_spikes / Math.max(A.kc_spikes, 1));
    const hyp = rate < 10 ? 'silent'
      : compression < 1.5 ? 'gain_controlled'
      : expansion > 0.7 ? 'linear_passthrough' : 'collapsed';
    const pert = {};
    for (const pt of spec.perturbations) {
      const n2 = build(pt.set != null ? { ...p, [pt.param]: pt.set } : p);
      if (pt.silence) silencePop(n2, pop[pt.silence]);
      clean(n2, bp);
      const Ap = odorProbe(n2, odorA), Bp = odorProbe(n2, odorB), Ap2x = odorProbe(n2, odorA, 2 * DR);
      pert[pt.name] = { expansion: f2((1 - cosSim(Ap.prof, Bp.prof)) / Math.max(1 - inSim, 1e-9)),
                        compression: f2(Ap2x.kc_spikes / Math.max(Ap.kc_spikes, 1)),
                        kc_active: f2(Ap.kc_active), rate: Ap.prof.reduce((a, b) => a + b, 0) + Bp.prof.reduce((a, b) => a + b, 0) };
    }
    members.push({ params: p, hypothesis: hyp,
      baseline: { expansion, compression, in_sim: inSim, out_sim: f2(outSim), kc_active: f2(A.kc_active), rate },
      baseline_repeat: repeat, perturbations: pert });
    console.log(`  ${JSON.stringify(p)}: ${hyp} | expansion ${expansion} compression ${compression} kc_act ${f2(A.kc_active)}`);
  }
  var ranked = rankExperiments({
    baseline_gain_control: { outcome: members.map(m => m.baseline.rate < 10 ? 'silent' : m.baseline.compression < 1.5 ? 'controlled' : 'uncontrolled') },
    ...Object.fromEntries(spec.perturbations.map(pt => [pt.name, {
      outcome: members.map(m => { const t = m.perturbations[pt.name];
        return t.rate < 10 ? 'silent' : t.compression < 1.5 ? 'controlled' : 'uncontrolled'; }),
    }])),
  });
  var mech = (m) => {
    if (m.hypothesis !== 'gain_controlled') return null;
    const broken = spec.perturbations.filter(pt => m.perturbations[pt.name].compression >= 1.5).map(pt => pt.name);
    return broken.length ? `needs_${broken.join('+')}` : 'robust';
  };
} else {   // linear
  const G = linearGeom(D, meta);
  const target = pop[spec.roles.target];
  const hcol = [...new Set(target.map(G.colOf))].sort((a, b) => a - b);
  const srcMaps = {};
  for (const src of spec.roles.sources) srcMaps[src] = G.group(pop[src]);
  const driveCol = spec.drive_column;
  const expect = spec.structural_offsets;
  const src0 = spec.roles.sources[0];
  const offCls = (o, e) => o == null || o.offset == null ? 'silent' : Math.abs(o.offset - e) <= 1 ? 'shift' : Math.abs(o.offset) <= 1 ? 'pass' : 'other';
  for (const [mi, p] of grid.entries()) {
    memberSeed(mi);
    const net = build(p), bp = biasOf(p);
    clean(net, bp);
    const offs = {}, arms = {};
    for (const src of spec.roles.sources) {
      offs[src] = colProbe(net, srcMaps[src], hcol, target, G.colOf, driveCol);
      const e = expect[src];
      arms[src] = offs[src].offset == null ? 'silent'
        : Math.abs(offs[src].offset - e) <= 1 ? 'wired_shift'
        : Math.abs(offs[src].offset) <= 1 ? 'passthrough' : 'other';
    }
    const hyp = Object.values(arms).every(a => a === 'silent') ? 'silent'
      : Object.values(arms).includes('wired_shift') ? 'wired_shift'
      : Object.values(arms).includes('passthrough') ? 'passthrough' : 'distorted';
    // column sweep on the first source
    const sweep = {};
    for (const c of Object.keys(srcMaps[spec.roles.sources[0]]).map(Number).sort((a, b) => a - b)) {
      const o = colProbe(net, srcMaps[spec.roles.sources[0]], hcol, target, G.colOf, c);
      if (o?.offset != null) sweep[c] = o.offset;
    }
    const sv = Object.values(sweep);
    const rigid = sv.length > 2 && (Math.max(...sv) - Math.min(...sv)) <= 1;
    // amplitude channel: response should scale sub-linearly with drive rate
    const ampProfile = [];
    for (const r of [40, 80, 160]) {
      net.drive.fill(0); net.reset();
      const ix = srcMaps[src0][driveCol];
      if (ix) { net.setDrive(ix, r); run(net, 200); net.setDrive(ix, 0); }
      ampProfile.push(target.reduce((a, i) => a + net.spikeCount[i], 0));
    }
    const ampScale = ampProfile[0] > 5 ? f2(ampProfile[2] / ampProfile[0]) : null;
    const pert = {};
    for (const pt of spec.perturbations) {
      const n2 = build(pt.set ? { ...p, [pt.param]: pt.set } : p);
      if (pt.silence) silencePop(n2, pop[pt.silence]);
      clean(n2, bp);
      pert[pt.name] = {};
      for (const src of spec.roles.sources) pert[pt.name][src] = colProbe(n2, srcMaps[src], hcol, target, G.colOf, driveCol);
    }
    members.push({ params: p, hypothesis: hyp, arms, offsets: offs, col_sweep: sweep, sweep_rigid: rigid,
      amp: { profile: ampProfile, scale_160v40: ampScale }, perturbations: pert });
    console.log(`  ${JSON.stringify(p)}: ${hyp} | ${spec.roles.sources.map(s => `${s} off ${offs[s]?.offset} (${arms[s]})`).join(' ')} | rigid=${rigid} amp×${ampScale}`);
  }
  var ranked = rankExperiments({
    sweep_rigidity: { outcome: members.map(m => Object.keys(m.col_sweep).length < 3 ? 'silent' : m.sweep_rigid ? 'rigid' : 'warped') },
    amp_scaling: { outcome: members.map(m => m.amp.scale_160v40 == null ? 'silent' : m.amp.scale_160v40 > 1.3 ? 'scales' : 'flat') },
    ...Object.fromEntries(spec.roles.sources.map(s => [`measure_${s}_offset`, { outcome: members.map(m => offCls(m.offsets[s], expect[s])) }])),
    ...Object.fromEntries(spec.perturbations.map(pt => [pt.name, { outcome: members.map(m => offCls(m.perturbations[pt.name][src0], expect[src0])) }])),
  });
  var mech = (m) => {
    if (m.arms[src0] !== 'wired_shift') return null;
    const needs = spec.perturbations.filter(pt => {
      const o = m.perturbations[pt.name][src0];
      return o?.offset == null || Math.abs(o.offset - expect[src0]) > 1;
    }).map(pt => pt.name);
    return needs.length ? `needs_${needs.join('+')}` : 'wired_only';
  };
}

const byHyp = {};
for (const m of members) (byHyp[m.hypothesis] ||= []).push(m.params);
const mechGroups = {};
for (const m of members) { const k = mech(m); if (k) (mechGroups[k] ||= []).push(m.params); }
console.log('hypotheses:', Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])));
console.log('mechanisms:', Object.fromEntries(Object.entries(mechGroups).map(([k, v]) => [k, v.length])));
console.log('ranked:', ranked.map(([n, e]) => `${n}=${e.score}`).join(', '));

fs.writeFileSync(`public/data/${specName}_lab.json`, JSON.stringify({
  seed: SEED, spec: specName,
  summary: {
    ensemble_size: members.length,
    hypotheses: Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])),
    mechanisms: Object.fromEntries(Object.entries(mechGroups).map(([k, v]) => [k, v.length])),
    best_experiment: ranked[0][0], best_experiment_separation: ranked[0][1].score,
  },
  spec_def: spec,
  members: members.map(m => ({ ...m, mechanism: mech(m) })),
  ranked_experiments: ranked.map(([name, e]) => ({ experiment: name, separation: e.score, outcomes: e.outcome })),
}, null, 1));
console.log(`wrote public/data/${specName}_lab.json`);
