// The response battery (spec S9, docs/44-walking-compiler.md): real perturbation experiments on the
// walking fly, one row each, with the measured behavioural change encoded as something a rule can
// evaluate. The objective this serves is not "walk" but "respond to each perturbation the way the
// animal did": a model that reproduces the animal's response to a battery of manipulations shares
// its causal structure whether or not anyone has named the mechanism.
//
// Every row states where its number comes from. Rows are graded by what the source actually gives:
//   measured    a primary measurement with a delta a comparator can read
//   qualitative a primary measurement that gives a sign or an ordering, not a magnitude
//   prediction  a model prediction from the sibling programme with no animal anchor yet -- it is
//               evaluated and reported, never counted as agreement with the animal
//   pending     named by the programme, no source located; the row exists so the gap is on record
//
// A row does not choose a model perturbation. The spec binds a row to the perturbation(s) that
// stand in for the experiment (which cells, what drive) and to the observable that reads the
// behaviour; that binding is a homology hypothesis and lives in the spec, next to the seed.
//
// Comparators, on the baseline value b and the perturbed value(s) p (p is an array for a series):
//   sign        sign(p) === expect.sign and |p| >= expect.minAbs
//   direction   (p - b) has expect.sign and |p - b| >= expect.minFrac * |b|   (a slowdown, a speed-up)
//   ratio       p / b inside expect.range                                    (a measured fractional change)
//   unchanged   |p - b| <= expect.frac * max(|b|, expect.floor)               (the manipulation must not change it)
//   below       p <= expect.max                                              (an absolute ceiling)
//   monotonic   a series ordered by dose is non-decreasing (expect.sign +1) or non-increasing (-1),
//               with total change >= expect.minSpan, ties allowed
// A comparator on a null value (an undefined phase, a fly that never stepped) reports 'undefined'
// rather than false: a rule that cannot be evaluated is not a mismatch.

export const RESPONSES = [
  {
    id: 'mdn_backward', domain: 'walking', status: 'qualitative',
    experiment: 'Activate the moonwalker descending neurons (MDN) in a walking fly',
    animal: 'backward walking: the fly reverses for the duration of activation',
    measure: 'gait.forward', comparator: 'sign', expect: { sign: -1, minAbs: 0.02 },   // cm/s of fore-aft travel
    source: 'Bidaye, Machacek, Wu & Dickson 2014, Science 344:97 (moonwalker); the registry row cmd.MDN_direction carries the same reading as a sign on signed fore-aft displacement',
    note: 'Magnitude is not encoded: the paper reports backward walking bouts, not a speed band this body can be held to. Real backward walking is slow, about a third of forward top speed (the model readout already assumes this, src/sim/motor.js).',
  },
  {
    id: 'dng100_dose', domain: 'walking', status: 'qualitative',
    experiment: 'Drive the BDN2 / DNg100 descending pair at increasing rates',
    animal: 'walking speed and step frequency both increase with drive, with a threshold below which the fly does not walk',
    measure: 'gait.speed', comparator: 'monotonic', expect: { sign: +1, minSpan: 0.05 },   // cm/s across the series
    also: [{ measure: 'gait.cadence', comparator: 'monotonic', expect: { sign: +1, minSpan: 1 } }],
    source: 'Sapkal et al. 2024, Nature 634:191 (BDN2 optogenetic dose); Pugliese et al. 2025, bioRxiv 2025.09.12.675944 (constant BDN2 command in simulation); registry row cmd.DNg100_dose',
    note: 'The threshold half of the band (silent drive = standing) is a separate row on the rest site; this row is the monotone half.',
  },
  {
    id: 'b13_slowdown', domain: 'walking', status: 'measured',
    experiment: 'Optogenetic activation of 13B premotor interneurons (13Balpha driver, 720 ms pulse) during walking',
    animal: 'forward speed falls during the pulse: about 0.65 cm/s slowdown against about 0.1 cm/s in the no-driver control, a 40-80% reduction',
    measure: 'gait.speed', comparator: 'ratio', expect: { range: [0.2, 0.6] },
    source: 'Agrawal et al. 2020, eLife 9:e60299, Fig 8; registry row premotor.13b_activation_slows_walking (band text and units)',
    note: 'The driver covers a subset of 13B on both sides; a spec that drives the whole hemilineage or one neuromere is a homology hypothesis and must say so. The source pulse is 720 ms; a tonic drive is a protocol difference the spec records.',
  },
  {
    id: 'decapitated_stands', domain: 'standing', status: 'measured',
    experiment: 'Decapitation: the brain removed, the nerve cord and legs intact',
    animal: 'decapitated flies keep standing posture and do not locomote: 0 of 90 moved 1 mm or more in 2 min',
    measure: 'gait.displacement', comparator: 'below', expect: { max: 0.1 },   // cm net displacement over the assay
    also: [{ measure: 'gait.upright', comparator: 'unchanged', expect: { frac: 0.15, floor: 0.5 } }],
    source: 'Yellman, Tao, He & Hirsh 1997, PNAS 94:4131; registry row cord.decapitated_standing (band [0,0] on the locomoting fraction)',
    note: 'The assay window is seconds, the source window is minutes; a shorter window can only make locomotion harder to miss. On the generator site this row is satisfied by construction (no descending command, no stepping); it is informative only where the cord drives the legs.',
  },
  {
    id: 'no_command_stands', domain: 'standing', status: 'qualitative',
    experiment: 'Brain intact, no walking command delivered',
    animal: 'an undisturbed fly spends most of its time not walking; the descending command is required for sustained walking',
    measure: 'gait.speed', comparator: 'below', expect: { max: 0.05 },
    source: 'Sapkal et al. 2024 (BDN2 threshold); registry rows cmd.no_command_walking and brain.spontaneous_walking record that the sibling model walks without command and that the animal anchor is still a lead, not a citation',
    note: 'The animal fraction of non-walking time is not encoded as a number here; the row asks only that removing the command removes sustained walking in a short open-floor window.',
  },
  {
    id: 'dng93_stop', domain: 'standing', status: 'prediction',
    experiment: 'Drive the DNg93 descending pair (the largest direct descending projection onto leg motor neurons, GABA-predicted) during a walking command',
    animal: 'no animal measurement. Sibling-model prediction: walking does not start, the fly stays upright with the motor pool at a tenth of its walking rate',
    measure: 'gait.speed', comparator: 'direction', expect: { sign: -1, minFrac: 0.5 },
    source: 'registry row cmd.DNg93_stop (lane D, 2026-09-02): model prediction, real-fly anchor pending',
  },
  {
    id: 'dnge036_walks', domain: 'walking', status: 'prediction',
    experiment: 'Drive the DNge036 pair with no other walking command',
    animal: 'no animal measurement. Sibling-model prediction: walking starts within 0.2 s at command-class speed',
    measure: 'gait.speed', comparator: 'direction', expect: { sign: +1, minFrac: 1.0 },
    source: 'registry row cmd.DNge036_sufficiency (lane D, 2026-09-02): model prediction, real-fly anchor pending; the type takes 1,359 synapses from taste bristles and sends 1,907 directly onto motor neurons',
  },
  {
    id: 'mdn_silenced', domain: 'walking', status: 'pending',
    experiment: 'Silence MDN and evoke backward walking by contact',
    animal: 'backward walking on head-on contact is impaired (Bidaye et al. 2014, silencing arm); delta not yet read from the primary source',
    measure: 'gait.backFrac', comparator: 'direction', expect: { sign: -1, minFrac: 0.5 },
    source: null,
    note: 'The primary read of the silencing figure is owed before this row is scored.',
  },
  {
    id: 'load_removed', domain: 'walking', status: 'pending',
    experiment: 'Remove leg load feedback (campaniform sensilla silenced) during walking',
    animal: 'named by the programme as a target experiment; no primary measurement located',
    measure: 'gait.cadence', comparator: 'direction', expect: { sign: -1, minFrac: 0.2 },
    source: null,
  },
];

export const RESPONSE_BY_ID = Object.fromEntries(RESPONSES.map(r => [r.id, r]));

const num = v => typeof v === 'number' && !Number.isNaN(v);

/** evaluate one comparator. base: number|null, pert: number|null or an ordered array for 'monotonic'.
 *  returns { outcome: 'match'|'mismatch'|'undefined', detail } */
export function compare(comparator, expect, base, pert) {
  const und = detail => ({ outcome: 'undefined', detail });
  switch (comparator) {
    case 'sign': {
      if (!num(pert)) return und('perturbed value undefined');
      const ok = Math.sign(pert) === expect.sign && Math.abs(pert) >= (expect.minAbs ?? 0);
      return { outcome: ok ? 'match' : 'mismatch', detail: `value ${pert.toFixed(3)}, expected sign ${expect.sign} with |v| >= ${expect.minAbs ?? 0}` };
    }
    case 'direction': {
      if (!num(pert) || !num(base)) return und('baseline or perturbed value undefined');
      const d = pert - base, need = (expect.minFrac ?? 0) * Math.abs(base);
      const ok = Math.sign(d) === expect.sign && Math.abs(d) >= need && (base !== 0 || Math.abs(d) > 0);
      return { outcome: ok ? 'match' : 'mismatch', detail: `delta ${d.toFixed(3)} (base ${base.toFixed(3)}), expected sign ${expect.sign} with |delta| >= ${need.toFixed(3)}` };
    }
    case 'ratio': {
      if (!num(pert) || !num(base)) return und('baseline or perturbed value undefined');
      if (base === 0) return und('baseline is zero, ratio undefined');
      const r = pert / base, [lo, hi] = expect.range;
      return { outcome: r >= lo && r <= hi ? 'match' : 'mismatch', detail: `ratio ${r.toFixed(3)}, expected in [${lo}, ${hi}]` };
    }
    case 'unchanged': {
      if (!num(pert) || !num(base)) return und('baseline or perturbed value undefined');
      const tol = (expect.frac ?? 0.1) * Math.max(Math.abs(base), expect.floor ?? 0);
      return { outcome: Math.abs(pert - base) <= tol ? 'match' : 'mismatch', detail: `|delta| ${Math.abs(pert - base).toFixed(3)} against tolerance ${tol.toFixed(3)}` };
    }
    case 'below': {
      if (!num(pert)) return und('perturbed value undefined');
      return { outcome: pert <= expect.max ? 'match' : 'mismatch', detail: `value ${pert.toFixed(3)}, expected <= ${expect.max}` };
    }
    case 'monotonic': {
      const series = Array.isArray(pert) ? pert : [pert];
      if (series.length < 2 || series.some(v => !num(v))) return und('series needs >= 2 defined values');
      const s = expect.sign ?? 1;
      let ok = true; for (let i = 1; i < series.length; i++) if (s * (series[i] - series[i - 1]) < 0) ok = false;
      const span = s * (series[series.length - 1] - series[0]);
      if (span < (expect.minSpan ?? 0)) ok = false;
      return { outcome: ok ? 'match' : 'mismatch', detail: `series ${series.map(v => v.toFixed(3)).join(' -> ')}, expected ${s > 0 ? 'non-decreasing' : 'non-increasing'} with span >= ${expect.minSpan ?? 0}` };
    }
  }
  throw new Error(`unknown comparator '${comparator}'`);
}

/** evaluate a battery row. values: { base: {measure: v}, pert: [{measure: v}, ...] in dose order }.
 *  The primary comparator and every `also` clause must match for the row to match. */
export function evaluateResponse(row, values) {
  const clauses = [{ measure: row.measure, comparator: row.comparator, expect: row.expect }, ...(row.also || [])];
  const results = clauses.map(c => {
    const base = values.base?.[c.measure];
    const ps = values.pert.map(p => p?.[c.measure]);
    const pert = c.comparator === 'monotonic' ? ps : ps[ps.length - 1];
    return { measure: c.measure, comparator: c.comparator, ...compare(c.comparator, c.expect, base, pert) };
  });
  const outcome = results.some(r => r.outcome === 'undefined') ? 'undefined' : results.every(r => r.outcome === 'match') ? 'match' : 'mismatch';
  return { outcome, status: row.status, clauses: results };
}
