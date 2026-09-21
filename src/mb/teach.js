// The teaching rule (spec S6.4). Three factors, compartment-local, written down here so the
// equation lives next to the run that uses it:
//
//   tr_i   = sum over KC spikes of i, weighted by exp(-|t - t_US| / tauE)   -- eligibility trace
//   el_j   = the same trace over MBON j spikes                            -- postsynaptic tag
//   dan_c  = 1 for edges whose compartment overlaps the US field          -- the dopamine signal
//   Delta m_ij = -eta * tr_i/maxTr * el_j/maxEl * dan_c,   m <- clamp(m + Delta m, 0, mMax)
//
// tauE = 1500 ms: the KC->MBON eligibility window in Drosophila is seconds-scale (the CS trace must
// still be up when the US lands; Handler et al. 2019, Cell). The trace is centred on US onset, so
// spikes just after it still count -- the postsynaptic tag is what is active when dopamine arrives.
// PAM appetitive pairing *depresses* the KC->MBON synapse (Aso & Rubin 2016; Cognigni et al. 2018),
// hence the negative sign. Traces are normalised to their population max so eta reads as
// "fractional depression at the maximally tagged synapse", not an arbitrary unit.
//
// The US is a real event in the model, not just a flag: the compartment's DAN neurons are driven at
// danRate for the overlap window, so whatever else DANs do in the graph happens too. What the rule
// supplies is dan_c -- the spatial selectivity of the dopamine field -- which is the object under
// test.
//
// `net` is a stepping kernel: { step() -> fired indices for the step, setDrive(ix, rate), reset(),
// p.dt }. LIFWasm matches directly; the teach run therefore happens on the shipped kernel.

/**
 * Teach one compartment with one CS+/US pairing.
 * @param net   stepping kernel over the full CNS
 * @param mb    the table from buildMB()
 * @param opts  { csOrns, comp, csRate, danRate, csMs, usMs, settleMs, tailMs, tauMs, eta, mMax, m0 }
 * @returns { m, changed, maxTr, maxEl, dans, comp } -- m is the engram vector over mb.edges
 */
export function teach(net, mb, opts) {
  const { csOrns, comp = 'y4', csRate = 100, danRate = 120, csMs = 2000, usMs = 400,
    settleMs = 400, tailMs = 400, tauMs = 1500, eta = 0.7, mMax = 4, m0 = null } = opts;
  const dans = mb.compDans(comp);
  if (!dans.length) throw new Error(`no DANs innervate compartment '${comp}'`);
  const compE = mb.compEdges.get(mb.cIx.get(comp));
  if (!compE?.length) throw new Error(`no KC->MBON edges tagged '${comp}'`);
  const dt = net.p.dt;
  const sCs = Math.round(settleMs / dt), sUs = Math.round((settleMs + csMs - usMs) / dt),
    sEnd = Math.round((settleMs + csMs) / dt), steps = Math.round((settleMs + csMs + tailMs) / dt);
  const usStart = sUs * dt;
  const { kcPos, mbonPos } = mb;
  const tr = new Float32Array(mb.kc.length), el = new Float32Array(mb.mbon.length);
  net.reset();
  for (let t = 0; t < steps; t++) {
    if (t === sCs) net.setDrive(csOrns, csRate);
    if (t === sUs) net.setDrive(dans, danRate);
    if (t === sEnd) { net.setDrive(csOrns, 0); net.setDrive(dans, 0); }
    const fired = net.step();
    const w = Math.exp(-Math.abs(t * dt - usStart) / tauMs);
    if (w > 1e-3) for (const i of fired) {
      const k = kcPos.get(i);
      if (k !== undefined) tr[k] += w;
      else { const j = mbonPos.get(i); if (j !== undefined) el[j] += w; }
    }
  }
  net.setDrive(csOrns, 0); net.setDrive(dans, 0);
  let maxTr = 0, maxEl = 0;
  for (const x of tr) if (x > maxTr) maxTr = x;
  for (const x of el) if (x > maxEl) maxEl = x;
  const m = m0 ? Float32Array.from(m0) : new Float32Array(mb.edges.csr.length).fill(1);
  const { pre, post } = mb.edges;
  let changed = 0;
  for (const k of compE) {
    const dm = -eta * (tr[pre[k]] / (maxTr || 1)) * (el[post[k]] / (maxEl || 1));
    const v = Math.min(mMax, Math.max(0, m[k] + dm));
    if (v !== m[k]) { m[k] = v; changed++; }
  }
  return { m, changed, maxTr, maxEl, dans: dans.length, comp, tr, el };
}
