// The recall probe (spec S6.4). One odor presentation: settle, drive the odor's ORN set, count
// spikes over the stimulus window for the KC, MBON, and downstream DN pools. The readout layer
// (decoder, preference index) is the caller's -- this function only simulates and counts.
// `net` is the same stepping-kernel interface teach() uses.

/**
 * Probe one odor.
 * @param net    stepping kernel over the full CNS, already carrying the condition's weights
 * @param mb     the table from buildMB()
 * @param pools  { fwd, bwd } -- neuron index lists for the approach / avoid DN readout
 * @param ornIdx odor ORN indices to drive
 * @param opts   { settleMs, stimMs, rate }
 * @returns { kcHz, mbonHz, fwdHz, bwdHz } Hz arrays in mb/pool order
 */
export function probe(net, mb, pools, ornIdx, { settleMs = 400, stimMs = 800, rate = 100 } = {}) {
  const dt = net.p.dt, s0 = Math.round(settleMs / dt), steps = Math.round((settleMs + stimMs) / dt);
  net.reset();
  const count = new Map();
  for (let t = 0; t < steps; t++) {
    if (t === s0) net.setDrive(ornIdx, rate);
    const fired = net.step();
    if (t >= s0) for (const i of fired) count.set(i, (count.get(i) || 0) + 1);
  }
  net.setDrive(ornIdx, 0);
  const sec = stimMs / 1000;
  const hz = idx => Float32Array.from(idx, i => (count.get(i) || 0) / sec);
  return { kcHz: hz(mb.kc), mbonHz: hz(mb.mbon), fwdHz: hz(pools.fwd), bwdHz: hz(pools.bwd) };
}

/** Downstream preference for one probe: (fwd - bwd) / (fwd + bwd) on the mean DN pool rates.
 *  Positive = approach-ward, negative = avoid-ward, 0 at silence. */
export function preference(p) {
  const mean = a => { let s = 0; for (const x of a) s += x; return s / (a.length || 1); };
  const f = mean(p.fwdHz), b = mean(p.bwdHz);
  return (f - b) / (f + b + 1e-9);
}
