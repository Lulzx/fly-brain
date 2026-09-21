// The motor read-out, in one place: which neurons count as which motor pool.
//
// Part M of the roadmap treats motor-neuron activity as the model's last stage before the body, and
// three items read it: M1 drives flight from the wing pools, M5 bounds what the unmapped pools cannot
// express, and M6 asks whether the pools individuate a model better than its behaviour does. They
// were reading three different definitions of "a motor pool" -- wing_mn.mjs its own type list,
// probe_motor.mjs the 170 muscle groups, behavior_eval.mjs nothing at all -- so the definitions live
// here and the scripts import them.
//
// Two groupings, because the two questions differ:
//   POOLS    a dozen functional pools, coarse enough that a rate over one is not mostly noise. This is
//            the vector M6 scores, and it is deliberately the same size as doc 34's behavioural one.
//   muscles  the bodymap's 170 annotated muscle groups, for anything that needs the fine grain.

// Wing motor pools, from scripts/wing_mn.mjs. Power is asynchronous and sets flight power; the rest
// are synchronous steering muscles, one spike a cycle.
export const WING_POOLS = {
  power: ['DLMn a, b', 'DLMn c-f', 'DVMn 1a-c', 'DVMn 2a, b', 'DVMn 3a, b'],
  basalar: ['b1 MN', 'b2 MN', 'b3 MN'],              // amplitude and stroke timing
  first: ['i1 MN', 'i2 MN', 'hi1 MN', 'hi2 MN'],     // first axillary group
  third: ['iii1 MN', 'iii3 MN', 'hiii2 MN'],         // third axillary group
  hg: ['hg1 MN', 'hg2 MN', 'hg3 MN', 'hg4 MN'],      // large turns
  pitch: ['ps1 MN', 'tp1 MN', 'tp2 MN', 'tpn MN', 'hDVM MN'],
};

/** Index every pool for a loaded connectome. Returns { name: {idx, left, right, n} }. */
export function motorPools(D) {
  const types = D.meta.types, side = D.side, bm = D.bodymap;
  const out = {};
  const add = (name, idx) => { if (!idx || !idx.length) return;
    out[name] = { idx: Int32Array.from(idx), left: Int32Array.from(idx.filter(i => side[i] === 1)), right: Int32Array.from(idx.filter(i => side[i] === 2)), n: idx.length }; };

  // wing, by pool
  for (const [pool, names] of Object.entries(WING_POOLS)) {
    const idx = []; for (let i = 0; i < D.N; i++) if (names.includes(String(types[i]))) idx.push(i);
    add('wing_' + pool, idx);
  }
  // legs, by segment. The bodymap names every leg muscle group `<muscle> T<n> <side>`; ltm groups are
  // the long tendon muscle and are pooled with their segment rather than split out.
  for (const seg of ['T1', 'T2', 'T3']) {
    const idx = []; for (const m of bm.muscles) if (new RegExp(`\\b${seg}\\b`).test(m.name)) idx.push(...m.idx);
    add('leg_' + seg, [...new Set(idx)]);
  }
  // proboscis and the rest of the feeding motor neurons
  add('proboscis', bm.feeding);
  // the jump muscle: two tergotrochanteral motor neurons, the escape output
  add('jump', bm.jump);
  // the 422 cells with no muscle assignment, as one pool -- M5's bound, read as activity that cannot
  // reach the body at all
  { const byType = new Map(); for (let i = 0; i < D.N; i++) { const t = String(types[i]); if (!t) continue; if (!byType.has(t)) byType.set(t, []); byType.get(t).push(i); }
    const idx = []; for (const u of bm.unmappedMotor) for (const t of String(u.type).split(',')) {
      for (const i of (byType.get(t) || [])) if ((u.side === 'left' && D.side[i] === 1) || (u.side === 'right' && D.side[i] === 2) || !u.side) idx.push(i); }
    add('unmapped', [...new Set(idx)]); }
  return out;
}

/** Spikes per cell per second in each pool, from a spike-count snapshot and the window in ms. */
export function poolRates(pools, sp, ms, prev = null) {
  const o = {};
  for (const [name, p] of Object.entries(pools)) {
    let n = 0; for (const i of p.idx) n += sp[i] - (prev ? prev[i] : 0);
    o[name] = p.n ? n / p.n / (ms / 1000) : 0;
  }
  return o;
}

/** Left-right difference in each pool, the quantity a steering read-out would see. */
export function poolAsym(pools, sp, ms, prev = null) {
  const o = {};
  for (const [name, p] of Object.entries(pools)) {
    if (!p.left.length || !p.right.length) continue;
    const r = (ix) => { let n = 0; for (const i of ix) n += sp[i] - (prev ? prev[i] : 0); return n / ix.length / (ms / 1000); };
    o[name] = r(p.left) - r(p.right);
  }
  return o;
}

// Descending candidates for a flight command (roadmap M1). scripts/dn_flight.mjs drives every one of
// the 480 descending types in turn and ranks them by what they do to the wing power pool: DNa08 comes
// first (+30.7 Hz, 85% of the change on the wings rather than the legs) and DNg02_a second (+30.4 Hz,
// 79%). DNg02 is also the population the literature assigns to wing-amplitude control in flight
// (Namiki et al. 2018), which the screen was not told. The whole DNg02 family is taken, because that is
// the unit the literature names, with the two subtypes the screen finds unselective left out.
export const FLIGHT_DN = ['DNa08', 'DNg02_a', 'DNg02_b', 'DNg02_c', 'DNg02_e', 'DNg02_g'];
