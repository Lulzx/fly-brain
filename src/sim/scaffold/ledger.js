// Ledger assembly (docs/37-scaffold-ledger.md): which behaviour needs which scaffolds.
//
// The registry (index.js) knows the modules; this module knows the measurements. Each behaviour
// reads a per-scenario observable from scripts/behavior_eval.mjs, the kill matrix supplies the
// deltas, and assembleRows() emits the spec's table:
//   behaviour | graphOnly | withScaffolds | required | kill
//
// "required" is computed, not declared: a scaffold is required for a behaviour when turning it off
// alone drops that behaviour's metric by more than DROP (relative) of the all-on value, or below
// FLOOR absolutely. A required set that comes back empty is a finding, not an error — it means the
// behaviour survives every single kill and only the joint graph_only condition removes it.
import { SCAFFOLD_IDS } from './index.js';

// metric(r) reads one condition's aggregated evaluate() result. Where possible the metric is the
// observable the behaviour is actually claimed to need, not the headline score.
export const BEHAVIOURS = {
  walk:       { metric: r => scen(r, 'forage').dist ?? 0, note: 'distance walked in the forage arena (cm)' },
  stand:      { metric: r => 1 - (scen(r, 'stand_2s').flipMs ?? 0) / (scen(r, 'stand_2s').ms || 1), note: 'fraction of stand_2s upright, connectome motor mode' },
  loomEscape: { metric: r => scen(r, 'loom_disk').escapes ?? 0, note: 'escape fraction vs an expanding disk in open space' },
  feed:       { metric: r => scen(r, 'onfood').fed ?? 0, note: 'fraction of seeds that fed on the patch' },
  bout:       { metric: r => r.obs.boutMedian ?? 0, note: 'median scheduler walk-bout (ms)' },
  starveWalk: { metric: r => scen(r, 'starveWalk').dist ?? 0, note: 'distance walked while starved (cm)' },
  court:      { metric: r => (scen(r, 'court').courtMs ?? 0) / (scen(r, 'court').ms || 1), note: 'fraction of the court assay spent courting' },
  groom:      { metric: r => (scen(r, 'forage').groomMs ?? 0) / (scen(r, 'forage').ms || 1), note: 'fraction of forage spent grooming' },
  steer:      { metric: r => (scen(r, 'forage').turnMs ?? 0) / (scen(r, 'forage').ms || 1), note: 'fraction of forage spent turning' },
  reject:     { metric: r => (scen(r, 'reject').rejections ?? 0) + (scen(r, 'reject').kicks ?? 0), note: 'decamps + kicks in the reject assay' },
};
const scen = (r, name) => r.obs.byScenario?.[name] || {};

// significance for "required": the off-condition must lose at least this much of the all-on metric,
// or land under the absolute floor. Metrics are heterogeneous (fractions, ms, cm, counts), so the
// test is relative plus a small absolute term.
export const DROP = 0.5, FLOOR = 0.02;

/** which scenarios each condition must run for every behaviour metric to be populated */
export const LEDGER_SCENARIOS = ['forage', 'onfood', 'loom_disk', 'heat', 'bitter', 'stand_2s', 'starveWalk', 'court', 'reject'];

/** the kill matrix as evaluate() configs: shipped, graph-only, and each plugin off alone */
export function conditions(ids = SCAFFOLD_IDS) {
  const allOff = Object.fromEntries(ids.map(id => [id, false]));
  return [
    { name: 'all_on', cfg: { scenarios: LEDGER_SCENARIOS } },
    { name: 'graph_only', cfg: { scenarios: LEDGER_SCENARIOS, scaffolds: allOff } },
    ...ids.map(id => ({ name: `off_${id}`, cfg: { scenarios: LEDGER_SCENARIOS, scaffolds: { [id]: false } } })),
  ];
}

/** assemble the spec's table from { conditionName: evaluateResult } */
export function assembleRows(runs, ids = SCAFFOLD_IDS) {
  const rows = [];
  for (const [behaviour, b] of Object.entries(BEHAVIOURS)) {
    const on = b.metric(runs.all_on), off = b.metric(runs.graph_only);
    const required = ids.filter(id => {
      const v = b.metric(runs['off_' + id]);
      return v < FLOOR && on > FLOOR || on - v > DROP * Math.abs(on);
    });
    rows.push({
      behaviour, graphOnly: +off.toFixed(4), withScaffolds: +on.toFixed(4),
      required, kill: required.length ? `--off=${required.join(',')}` : '(survives every single kill)',
      note: b.note,
    });
  }
  return rows;
}

/** greedy minimal enabling set: starting from graph-only, re-enable plugins in registry order until
 *  the score reaches `target` fraction of the all-on score (or plugins run out). `evaluate` is the
 *  injected async scorer so this module stays sim-free. */
export async function minimalEnablingSet(evaluate, baseCfg, allOnScore, seeds, ids = SCAFFOLD_IDS, target = 0.7) {
  const enabled = {}, steps = [];
  let best = -1;
  for (const id of ids) {
    const trial = { ...enabled, [id]: true };
    // re-enabling is expressed as "off everything except the trial set"
    const cfg = { ...baseCfg, scenarios: LEDGER_SCENARIOS, scaffolds: Object.fromEntries(ids.map(i => [i, !!trial[i]])) };
    const out = await evaluate(cfg, seeds);
    steps.push({ tried: id, enabled: Object.keys(trial), score: out.score });
    if (out.score >= best) { best = out.score; Object.assign(enabled, trial); }
    if (best >= target * allOnScore) break;
  }
  return { target, achieved: best, set: Object.keys(enabled).filter(k => enabled[k]), steps };
}
