// Experiment spec schema (spec S7.3, docs/30-hypothesis-lab.md).
//
// An ExperimentSpec is the pre-registration for one experiment: the question, the operator family
// it discriminates, the ensemble over unmeasured gains, the perturbations that should split the
// ensemble, the observables measured at each site, and the rule that counts as a kill. Specs live
// in src/exp/specs/*.js and are plain data — the execution hooks live in src/exp/backends/.
//
//   interface ExperimentSpec {
//     id: string;
//     question: string;
//     operators: string[];           // e.g. ["oa.thrField","oa.gainField","oa.thrTyped"]
//     ensemble: {
//       params: string[];            // names from brain_params / plugin params / backend axes
//       n: number;                   // members sampled (default 32); axes smaller -> full grid
//       seed: number;
//       axes?: Record<string, unknown[]>;   // candidate values per param (backend may supply)
//     };
//     perturbations: Array<{ id: string; kind: PERTURB_KIND; target: string; args?: object }>;
//       ablateType     target = a neuron selector (src/exp/select.js): type:IN19B012, hemilineage:13B,
//                      hemilineage:19B@left, regex:^IN13, muscle:T3, superclass:..., class:...
//       offPlugin      target = a scaffold plugin id (docs/37)
//       scaleGain      args {param, factor}: multiplies an ensemble-addressable param
//       scaleEdges     target = an id in spec.edgeRules, args {factor}: multiplies one edge class
//       driveType      target = a neuron selector, args {mv, fromMs?, toMs?}: a constant depolarising
//                      bias on the population (the model's optogenetic activation), tonic unless windowed
//       swapCompartment  reserved (engram harness)
//     responses?: Array<{ id; row: string; observable: string; perturbations: string[] }>;
//                                    // bindings to the response battery (src/exp/responses.js): the
//                                    // battery row, the observable that reads it (its measure must be
//                                    // the row's measure; `also` clauses find their measures among the
//                                    // spec's observables), and the perturbation(s) that stand in for
//                                    // the experiment, in dose order for a series
//     edgeRules?: Record<id, { pre: selector, post: selector, cross?: 'contra'|'ipsi'|'any' }>;
//                                    // named edge classes; an ensemble axis 'edges.<id>' sweeps the
//                                    // class's multiplier and scaleEdges perturbs it
//     observables: Array<{ id: string; where: "circuit"|"arena"; measure: string; args?: object }>;
//     splitRule: string;             // "<obsId> <op> <expr> [&& ...]", expr may use baseline.<obsId>
//     seeds?: number[];              // assay seeds (arena backend); the seed is part of the
//                                    // pre-registration — a binary assay must not pick it ad hoc
//     status?: "ready" | "pending";  // pending: committed spec, backend not built yet (S2–S6)
//   }
//
// validateSpec throws on malformed input — a typo must not silently produce an empty experiment.
import { parseSelector } from './select.js';
import { RESPONSE_BY_ID } from './responses.js';
export const PERTURB_KINDS = ['ablateType', 'offPlugin', 'scaleGain', 'scaleEdges', 'driveType', 'swapCompartment'];
export const SITES = ['circuit', 'arena'];

export function validateSpec(s) {
  const bad = m => { throw new Error(`experiment spec '${s?.id ?? '?'}': ${m}`); };
  if (!s || typeof s !== 'object') bad('not an object');
  for (const k of ['id', 'question']) if (typeof s[k] !== 'string' || !s[k]) bad(`missing ${k}`);
  if (!Array.isArray(s.operators) || !s.operators.length || s.operators.some(o => typeof o !== 'string'))
    bad('operators must be a non-empty string array');
  const e = s.ensemble;
  if (!e || !Array.isArray(e.params) || !e.params.length) bad('ensemble.params must be a non-empty array');
  if (e.n !== undefined && (!(e.n > 0) || !Number.isInteger(e.n))) bad('ensemble.n must be a positive integer');
  if (e.axes) for (const [p, vs] of Object.entries(e.axes)) {
    if (!e.params.includes(p)) bad(`ensemble.axes.${p} is not in ensemble.params`);
    if (!Array.isArray(vs) || !vs.length) bad(`ensemble.axes.${p} must be a non-empty array`);
  }
  if (!Array.isArray(s.perturbations) || !s.perturbations.length) bad('perturbations must be a non-empty array');
  const ids = new Set();
  for (const p of s.perturbations) {
    if (!p.id || ids.has(p.id)) bad(`perturbation id missing or duplicated: ${p.id}`);
    ids.add(p.id);
    if (!PERTURB_KINDS.includes(p.kind)) bad(`perturbation '${p.id}': kind must be one of ${PERTURB_KINDS.join('|')}`);
    if (typeof p.target !== 'string' || !p.target) bad(`perturbation '${p.id}': missing target`);
    // the arena site resolves ablateType targets as neuron selectors; other sites (heading's
    // population names, the engram harness's compartment slices) keep their own target vocabulary
    if (p.kind === 'ablateType' && s.backend === 'arena' && (s.status ?? 'ready') === 'ready') { try { parseSelector(p.target); } catch (e) { bad(`perturbation '${p.id}': ${e.message}`); } }
    if (p.kind === 'driveType') {
      try { parseSelector(p.target); } catch (e) { bad(`perturbation '${p.id}': ${e.message}`); }
      if (typeof p.args?.mv !== 'number') bad(`perturbation '${p.id}': driveType needs args.mv`);
    }
    if (p.kind === 'scaleEdges') {
      if (!s.edgeRules?.[p.target]) bad(`perturbation '${p.id}': scaleEdges target '${p.target}' is not in spec.edgeRules`);
      if (typeof p.args?.factor !== 'number') bad(`perturbation '${p.id}': scaleEdges needs args.factor`);
    }
  }
  if (s.edgeRules !== undefined) {
    if (typeof s.edgeRules !== 'object' || Array.isArray(s.edgeRules)) bad('edgeRules must be an object keyed by rule id');
    for (const [id, r] of Object.entries(s.edgeRules)) {
      for (const k of ['pre', 'post']) { try { parseSelector(r[k] ?? 'any'); } catch (e) { bad(`edgeRules.${id}.${k}: ${e.message}`); } }
      if (r.cross !== undefined && !['contra', 'ipsi', 'any'].includes(r.cross)) bad(`edgeRules.${id}.cross must be contra|ipsi|any`);
    }
  }
  if (e.axes) for (const p of Object.keys(e.axes)) { const m = p.match(/^edges\.(.+)$/); if (m && !s.edgeRules?.[m[1]]) bad(`ensemble axis '${p}' names no edge rule in spec.edgeRules`); }
  if (!Array.isArray(s.observables) || !s.observables.length) bad('observables must be a non-empty array');
  const oids = new Set();
  for (const o of s.observables) {
    if (!o.id || oids.has(o.id)) bad(`observable id missing or duplicated: ${o.id}`);
    oids.add(o.id);
    if (!SITES.includes(o.where)) bad(`observable '${o.id}': where must be ${SITES.join('|')}`);
    if (typeof o.measure !== 'string' || !o.measure) bad(`observable '${o.id}': missing measure`);
  }
  if (s.responses !== undefined) {
    if (!Array.isArray(s.responses)) bad('responses must be an array');
    const rids = new Set();
    const measureOf = Object.fromEntries(s.observables.map(o => [o.id, o]));
    for (const r of s.responses) {
      if (!r.id || rids.has(r.id)) bad(`response id missing or duplicated: ${r.id}`); rids.add(r.id);
      const row = RESPONSE_BY_ID[r.row]; if (!row) bad(`response '${r.id}': unknown battery row '${r.row}'`);
      const o = measureOf[r.observable]; if (!o) bad(`response '${r.id}': unknown observable '${r.observable}'`);
      if (o.measure !== row.measure) bad(`response '${r.id}': observable '${r.observable}' measures ${o.measure}, the row wants ${row.measure}`);
      for (const c of row.also || []) {
        const twin = s.observables.find(x => x.measure === c.measure && JSON.stringify(x.args || {}) === JSON.stringify(o.args || {}));
        if (!twin) bad(`response '${r.id}': row '${row.id}' also needs ${c.measure} on the same assay; declare that observable`);
      }
      if (!Array.isArray(r.perturbations) || !r.perturbations.length) bad(`response '${r.id}': perturbations must be a non-empty array`);
      for (const pid of r.perturbations) if (!ids.has(pid)) bad(`response '${r.id}': unknown perturbation '${pid}'`);
      if (row.comparator === 'monotonic' && r.perturbations.length < 2) bad(`response '${r.id}': a monotonic row needs a series of >= 2 perturbations`);
    }
  }
  if (typeof s.splitRule !== 'string' || !s.splitRule) bad('missing splitRule');
  // splitRule clauses must name declared observables — a typo there is a silent pass. Terms may
  // be dotted paths into an observable's record (baseline.persistence.concentration).
  for (const m of s.splitRule.matchAll(/[A-Za-z_][\w.]*/g)) {
    const tok = m[0];
    if (tok === 'baseline' || tok === 'member' || /^\d/.test(tok)) continue;
    const path = tok.startsWith('baseline.') || tok.startsWith('member.') ? tok.slice(tok.indexOf('.') + 1) : tok;
    if (!oids.has(path.split('.')[0])) bad(`splitRule references unknown observable '${tok}'`);
  }
  if (s.seeds !== undefined && (!Array.isArray(s.seeds) || !s.seeds.length || s.seeds.some(x => !Number.isInteger(x))))
    bad('seeds must be a non-empty integer array when present');
  if (s.status && !['ready', 'pending'].includes(s.status)) bad(`status must be ready|pending`);
  if ((s.status ?? 'ready') === 'ready' && typeof s.backend !== 'string') bad('missing backend');
  return s;
}

export function normalizeSpec(s) {
  validateSpec(s);
  return { ...s, status: s.status || 'ready',
    ensemble: { n: 32, seed: 1, ...s.ensemble } };
}

/** seeded sample of n parameter combos from ensemble.axes (or the full grid when smaller).
 *  mulberry32 so member sets are reproducible. */
export function ensembleMembers(e, fallbackAxes = {}) {
  const axes = e.axes || fallbackAxes;
  const params = e.params;
  if (params.some(p => !axes[p]?.length)) throw new Error(`ensemble: no axis values for ${params.filter(p => !axes[p]?.length).join(', ')}`);
  const grid = params.reduce((acc, p) => acc.flatMap(m => axes[p].map(v => ({ ...m, [p]: v }))), [{}]);
  if (grid.length <= e.n) return grid;
  let a = (e.seed ?? 1) >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const idx = [...grid.keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, e.n).map(i => grid[i]);
}
