// Heading-circuit backend for the experiment compiler (spec S7), and the shared machinery for
// scripts/hypothesis_lab.mjs — the geometry, the ensemble builder, and the three observables were
// extracted verbatim from that script so the two cannot drift apart.
//
// The wiring diagram permits several plausible dynamics; the ensemble spans the parameters the
// connectome does not fix (EPG->EPG recurrence, Delta7->EPG kernel gain, tonic EPG excitability,
// PEN->EPG push). Each member is classified by which hypothesis its baseline observables support:
//   attractor_free  — bump persists unaided
//   attractor_tonic — bump persists only with tonic EPG drive
//   filter          — no persistent bump; heading read out instantaneously
//   frozen/silent   — degenerate members, counted separately
import { makeBuilder, run, silence, circRes, circAngle, seedRng } from '../../../scripts/lif_ensemble.mjs';

// ---- populations & geometry -----------------------------------------------------------
export function headingCtx(D) {
  const { meta } = D;
  const pbcol = (s) => { const m = s && s.match(/_([LR])(\d)/); return m ? [m[1], +m[2]] : null; };
  const posOf = (c) => c[0] === 'L' ? 9 - c[1] : 8 + c[1];
  const wedgeOf = (i) => { const c = pbcol(meta.instances[i]); return c ? ((posOf(c) % 8) + 8) % 8 : -1; };
  const epg = D.byType('EPG'), d7 = D.byType('Delta7'), peg = D.byType('PEG');
  const penAll = [...D.byType('PEN_a(PEN1)'), ...D.byType('PEN_b(PEN2)')];
  const penL = penAll.filter(i => pbcol(meta.instances[i])?.[0] === 'L');
  const penR = penAll.filter(i => pbcol(meta.instances[i])?.[0] === 'R');
  const wedges = Array.from({ length: 8 }, () => []);
  epg.forEach((i) => { const w = wedgeOf(i); if (w >= 0) wedges[w].push(i); });

  const penSet = new Set(penAll);
  const buildNet = makeBuilder(D, [
    { pre: 'EPG', post: 'EPG', param: 'epgRecur' },
    { pre: 'Delta7', post: 'EPG', param: 'd7Gain' },
    { pre: penSet, post: 'EPG', param: 'penGain' },
  ]);

  const wedgeRates = (net, b0) => wedges.map(ws => ws.reduce((a, i) => a + (net.spikeCount[i] - (b0 ? b0[i] : 0)), 0) / Math.max(ws.length, 1));
  // thr.fill(0) would wipe a silencing offset, so the silenced set is re-applied after reset —
  // same idiom as run_ensemble.mjs's clean (without it every "silenced" measurement is unperturbed)
  const clean = (net, tonic) => { net.drive.fill(0); net.bias.fill(0); net.thr.fill(0); net.reset();
    if (net.__silenced) for (const i of net.__silenced) net.setThr(i, 1e6);
    if (tonic) net.setBias(epg, tonic); };
  return { D, epg, d7, peg, penL, penR, wedges, wedgeOf, buildNet, wedgeRates, clean };
}

const f2 = (v) => +(v).toFixed(3);

// ---- observable: bump persistence after a seeded bump is released ----------------------
// concentration = circular resultant length (0 uniform .. 1 point bump); width = FWHM of the
// wedge profile — real Delta7 silencing widens the bump without necessarily killing it
export function bumpWidth(r) {
  const pk = r.indexOf(Math.max(...r)), hi = r[pk] / 2;
  let hit = 0;
  for (let w = 0; w < 8; w++) if (r[((w + pk) % 8 + 8) % 8] > hi) hit++;
  return hit;
}
export function persistence(C, net, tonic) {
  C.clean(net, tonic);
  net.setDrive(C.wedges[0], 100); run(net, 150);
  const seeded = circRes(C.wedgeRates(net));
  net.setDrive(C.wedges[0], 0);
  const b0 = Uint32Array.from(net.spikeCount); run(net, 400);
  const r = C.wedgeRates(net, b0);
  const after = circRes(r);
  const total = r.reduce((a, b) => a + b, 0);
  return { concentration: f2(after), seeded: f2(seeded), total_rate: f2(total), width_wedges: total > 0.5 ? bumpWidth(r) : 0 };
}

// ---- observable: rotation under sustained unilateral PEN drive --------------------------
export function rotation(C, net, tonic, side) {
  C.clean(net, tonic);
  net.setDrive(C.wedges[0], 100); run(net, 150); net.setDrive(C.wedges[0], 0);
  const b0 = Uint32Array.from(net.spikeCount); run(net, 100);
  if (C.wedgeRates(net, b0).reduce((a, b) => a + b, 0) < 0.5) return { drift: null, tracked: 0 };  // no bump to rotate
  const pen = side === 'L' ? C.penL : C.penR;
  net.setDrive(pen, 80);
  const angles = [];
  for (let k = 0; k < 4; k++) {
    const b1 = Uint32Array.from(net.spikeCount); run(net, 100);
    const r = C.wedgeRates(net, b1);
    if (r.reduce((a, b) => a + b, 0) > 0.5) angles.push(circAngle(r)); else angles.push(null);
  }
  net.setDrive(pen, 0);
  const a = angles.filter(v => v != null);
  if (a.length < 2) return { drift: null, tracked: a.length };
  let d = a[a.length - 1] - a[0];
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return { drift: f2(d / (a.length - 1) * 10), tracked: a.length };  // rad/s approx (100ms bins)
}

// ---- observable: realised Delta7 kernel (subset of cells for speed) ----------------------
export function kernel(C, net, tonic) {
  const { D, d7, epg, wedgeOf, wedges } = C;
  const d7in = d7.map(() => new Float64Array(8));
  const d7idx = new Map(d7.map((d, k) => [d, k]));
  for (const i of epg) { const w = wedgeOf(i); if (w < 0) continue; for (let j = D.indptr[i]; j < D.indptr[i + 1]; j++) { const k = d7idx.get(D.indices[j]); if (k != null) d7in[k][w] += D.weights[j]; } }
  const acc = new Float64Array(8); let cnt = 0;
  for (const d of d7) {
    const pw = d7in[d7idx.get(d)].indexOf(Math.max(...d7in[d7idx.get(d)]));
    C.clean(net, tonic || 4); run(net, 60);
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

// ---- classification ------------------------------------------------------------------
export const cls = (v) => v > 0.5 ? 'sustains' : v > 0.2 ? 'partial' : 'decays';

export function hypothesisOf(params, base) {
  const persists = base.concentration > 0.5;
  return !persists ? (base.total_rate < 0.2 ? 'silent' : 'filter')
       : base.total_rate < 0.2 ? 'frozen'
       : (params.epgTonic > 0 ? 'attractor_tonic' : 'attractor_free');
}

// mechanism classes among bump-sustaining members, under Delta7 silencing: same baseline
// behaviour, different causal structure
export function mechanismOf(base, d7sil) {
  const s = d7sil;
  if (s.concentration > 0.5) return s.width_wedges >= base.width_wedges + 2 ? 'd7_confines_width' : 'd7_sculpts_sharp';
  if (s.total_rate > 1) return 'd7_confines';
  return 'd7_essential';
}

// ---- compiler backend -------------------------------------------------------------------
// ctx: { params, net, C } — one LIF instance per build; perturbation rebuilds, then modifies.
export function makeBackend(D) {
  const C = headingCtx(D);
  const MEASURES = {
    bumpPersistence: (ctx) => persistence(C, ctx.net, ctx.params.epgTonic),
    d7Kernel: (ctx) => kernel(C, ctx.net, ctx.params.epgTonic),
    'penRotation:L': (ctx) => rotation(C, ctx.net, ctx.params.epgTonic, 'L'),
    'penRotation:R': (ctx) => rotation(C, ctx.net, ctx.params.epgTonic, 'R'),
  };
  return {
    // the LIF noise source draws Math.random — seed the stream or nothing is replayable
    seed(s) { seedRng(s); },
    axes() { return { epgRecur: [1, 3, 4, 6], d7Gain: [0.5, 1.0, 1.3], epgTonic: [0, 3, 5, 7], penGain: [1] }; },
    build(params) { return { params, net: C.buildNet(params) }; },
    perturb(params, pert) {
      const ctx = { params, net: C.buildNet(params) };
      if (pert.kind === 'ablateType') silence(ctx.net, C.D.byType(pert.target));
      else if (pert.kind === 'scaleGain') { /* edge-class scaling is a buildNet param; args: {param, value} */
        ctx.net = C.buildNet({ ...params, [pert.args.param]: pert.args.value });
      }
      else return { unimplemented: true, reason: `kind '${pert.kind}' not implemented at the circuit site` };
      return ctx;
    },
    measure(ctx, obs) { const f = MEASURES[obs.measure]; if (!f) throw new Error(`heading backend: unknown measure '${obs.measure}'`); return f(ctx); },
    classify(obsId, v) {
      if (obsId === 'persistence') return cls(v.concentration);
      if (obsId === 'rotL') return v.drift > 0.05 ? 'rotates' : 'none';
      if (obsId === 'rotR') return v.drift < -0.05 ? 'rotates' : 'none';
      return JSON.stringify(v);
    },
    finalize(member) {
      member.hypothesis = hypothesisOf(member.params, member.baseline.persistence);
      member.mechanism = member.hypothesis.startsWith('attractor') && member.perturbations.d7_silence
        ? mechanismOf(member.baseline.persistence, member.perturbations.d7_silence.values) : null;
    },
    ctx: C,
  };
}
