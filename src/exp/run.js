// The experiment pipeline (spec S7): spec -> ensemble -> ranked perturbation -> two-site
// measurement -> pre-registered observables table.
//
// runExperiment(spec, backend) is backend-agnostic: the spec is declarative (src/exp/spec.js), the
// backend supplies the site hooks:
//   seed(ensembleSeed)      -> optional; seed the backend's noise source before any draws
//   axes(ensemble)          -> optional fallback value grid per ensemble param
//   build(params, spec)     -> member context (async ok)
//   perturb(params, pert, spec) -> member context under the perturbation (fresh build, async ok)
//   measure(ctx, observable)-> number | object (async ok)
//   prepareAll(members, spec) -> optional; pre-build every ctx and fan out work (e.g. a worker
//                              pool) so the sequential member loop only awaits results
//   classify(obsId, value)  -> optional outcome-class label for ranking
//   describeMember(ctx)     -> optional {hypothesis, mechanism, ...} carried into the report
//
// A perturbation that a backend cannot express reports { unimplemented: true } and is excluded
// from ranking with the reason recorded — a pending mechanism shows up in the report, not in
// the numbers.
import { ensembleMembers } from './spec.js';
import { rankExperiments } from './rank.js';

/** tiny evaluator for splitRule clauses: "<obs> <op> <expr>" joined by &&.
 *  expr: number, obsId (or a dotted path into its record), baseline.<path>, member.<param>,
 *  and products like "0.5 * baseline.persistence.concentration". An unqualified path reads the
 *  perturbed condition first, then the baseline. */
const dig = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function evalExpr(expr, env) {
  const term = t => {
    t = t.trim();
    const m = t.match(/^(baseline|member)\.([\w.]+)$/);
    if (m) return m[1] === 'baseline' ? dig(env.baseline, m[2]) : env.member[m[2]];
    if (dig(env.pert, t) !== undefined) return dig(env.pert, t);
    if (dig(env.baseline, t) !== undefined) return dig(env.baseline, t);
    const n = Number(t); if (!Number.isNaN(n)) return n;
    throw new Error(`splitRule: unknown term '${t}'`);
  };
  return expr.split('*').map(term).reduce((a, b) => a * b, 1);
}
export function evalSplitRule(rule, env) {
  return rule.split('&&').every(clause => {
    const m = clause.trim().match(/^([\w.]+)\s*(<=|>=|<|>|==|!=)\s*(.+)$/);
    if (!m) throw new Error(`splitRule: unparseable clause '${clause.trim()}'`);
    const l = evalExpr(m[1], env), r = evalExpr(m[3], env);
    switch (m[2]) {
      case '<': return l < r; case '>': return l > r;
      case '<=': return l <= r; case '>=': return l >= r;
      case '==': return l === r; case '!=': return l !== r;
    }
  });
}

export async function runExperiment(spec, backend, { progress } = {}) {
  backend.seed?.(spec.ensemble.seed);   // a backend that draws RNG must seed it or nothing replays
  const members = ensembleMembers(spec.ensemble, backend.axes ? backend.axes(spec.ensemble) : undefined);
  await backend.prepareAll?.(members, spec, progress);   // e.g. arena evals fan out to workers
  const obs = spec.observables;
  const out = [], skipped = [];
  const classify = (o, v) => backend.classify ? backend.classify(o.id, v, o) : v;
  for (let mi = 0; mi < members.length; mi++) {
    const params = members[mi], t0 = Date.now();
    const ctx = await backend.build(params, spec);
    const baseline = {};
    for (const o of obs) baseline[o.id] = await backend.measure(ctx, o);
    const member = { params, baseline };
    if (backend.describeMember) Object.assign(member, backend.describeMember(ctx, baseline));
    member.perturbations = {};
    for (const p of spec.perturbations) {
      const pctx = await backend.perturb(params, p, spec);
      if (pctx?.unimplemented) { skipped.push({ member: mi, perturbation: p.id, reason: pctx.reason || 'no backend for kind ' + p.kind }); continue; }
      const pv = {};
      for (const o of obs) pv[o.id] = await backend.measure(pctx, o);
      member.perturbations[p.id] = { values: pv, kills: evalSplitRule(spec.splitRule, { baseline, pert: pv, member: params }) };
    }
    backend.finalize?.(member);   // post-hoc classification needing perturbed values (e.g. mechanism)
    out.push(member);
    progress?.(`  ${mi + 1}/${members.length} ${JSON.stringify(params)} ${Date.now() - t0}ms`);
  }
  // ranking: each perturbation's outcome class per member, and each baseline observable as an
  // experiment in its own right (the observable that already separates the ensemble wins nothing
  // new to measure — that is the ranking's point)
  const experiments = {};
  for (const p of spec.perturbations) {
    const oc = out.map(m => {
      const r = m.perturbations[p.id];
      return r === undefined ? 'skipped'
        : r.kills ? 'kills'
        : 'spares';
    });
    if (oc.some(c => c !== 'skipped')) experiments[p.id] = { outcome: oc };
  }
  for (const o of obs) experiments['obs:' + o.id] = { outcome: out.map(m => String(classify(o, m.baseline[o.id]))) };
  const ranked = rankExperiments(experiments);
  // the observables table carries the ensemble median of each baseline read, so the report's
  // headline numbers come from the same members as the ranking
  const med = a => { const s = a.filter(v => typeof v === 'number' && !Number.isNaN(v)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const observables = spec.observables.map(o => ({ ...o, value: med(out.map(m => m.baseline[o.id])) }));
  return { spec: { id: spec.id, question: spec.question, operators: spec.operators, splitRule: spec.splitRule, backend: spec.backend, status: spec.status, seeds: spec.seeds, edgeRules: spec.edgeRules },
    ensemble: { n: members.length, params: spec.ensemble.params, seed: spec.ensemble.seed },
    observables,
    members: out, skipped,
    ranked: ranked.map(([name, e]) => ({ experiment: name, separation: e.score })) };
}

/** one-command report: the pre-registered observables table as markdown */
export function renderMarkdown(result) {
  const { spec, ensemble, members, ranked, skipped } = result;
  const L = [];
  L.push(`# ${spec.id}`, '', `**Question:** ${spec.question}`, '',
    `**Operators:** ${spec.operators.join(', ')}`, '',
    `**Split rule:** \`${spec.splitRule}\``, '',
    `Ensemble: ${ensemble.n} members over ${ensemble.params.join(', ')} (seed ${ensemble.seed})`, '');
  if (result.observables) {
    L.push('## Pre-registered observables', '', '| observable | site | measure | value |', '|---|---|---|---|');
    for (const o of result.observables) L.push(`| ${o.id} | ${o.where} | ${o.measure}${o.args ? ' ' + JSON.stringify(o.args) : ''} | ${o.value == null ? '—' : fmt(o.value)} |`);
    L.push('');
  }
  L.push('## Ranked perturbations', '', '| experiment | separation |', '|---|---|');
  for (const r of ranked) L.push(`| ${r.experiment} | ${r.separation} |`);
  if (skipped.length) { L.push('', 'Skipped (no backend yet): ' + [...new Set(skipped.map(s => s.perturbation))].join(', ')); }
  L.push('', '## Members', '', '| member | params | baseline | kills |', '|---|---|---|---|');
  members.forEach((m, i) => {
    const base = Object.entries(m.baseline).map(([k, v]) => `${k}=${fmt(v)}`).join(' ');
    const kills = Object.entries(m.perturbations).filter(([, r]) => r.kills).map(([k]) => k).join(',') || '-';
    L.push(`| ${i} | ${JSON.stringify(m.params)} | ${base} | ${kills} |`);
  });
  // the perturbed reads themselves, one table per perturbation, so a kill can be checked against
  // the numbers that produced it rather than taken from the flag
  const pids = [...new Set(members.flatMap(m => Object.keys(m.perturbations)))];
  if (pids.length && result.observables) {
    L.push('', '## Perturbed reads', '');
    for (const p of pids) {
      L.push(`### ${p}`, '', '| member | ' + result.observables.map(o => o.id).join(' | ') + ' | kills |', '|---|' + result.observables.map(() => '---').join('|') + '|---|');
      members.forEach((m, i) => { const r = m.perturbations[p]; if (!r) return;
        L.push(`| ${i} | ` + result.observables.map(o => fmt(r.values[o.id])).join(' | ') + ` | ${r.kills ? 'yes' : ''} |`); });
      L.push('');
    }
  }
  return L.join('\n') + '\n';
}
const fmt = v => typeof v === 'number' ? +v.toFixed(3) : v == null ? '—' : JSON.stringify(v);
