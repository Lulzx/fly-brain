// Arena backend for the experiment compiler (spec S7, walking site S8): measures observables on the
// embodied fly through scripts/behavior_eval.mjs, so an experiment's "arena" site is the same animal
// and the same assays the scaffold ledger uses.
//
// Ensemble params are named by where they land:
//   'scaffold.<plugin>.<param>'  -> brainOpts.scaffoldParams[plugin][param] (plugin knob sweep)
//   'scaffolds.<plugin>'         -> brainOpts.scaffolds[plugin]             (member-level kills)
//   'typeGain.<type|regex>'      -> brainOpts.typeGain[key]                 (per-type output gain)
//   'edges.<ruleId>'             -> an edge-class multiplier, the class defined in spec.edgeRules
//   'wiring'                     -> 'real' | 'weightShuffle' | 'signFree'   (null arms as members)
//   anything else                -> a brain_params field                    (e.g. laminaBias, inhGain)
//
// Perturbation kinds at this site:
//   offPlugin   -> cfg.scaffolds[target] = false
//   scaleGain   -> args {param, factor} multiplies a param (any of the addresses above)
//   ablateType  -> target is a neuron selector (src/exp/select.js); its outgoing synapses go to ~0
//   scaleEdges  -> target is a spec.edgeRules id, args {factor}
//   swapCompartment -> reported unimplemented (engram harness)
import fs from 'node:fs';
import { classifyGait } from '../gait.js';
import { parseSelector } from '../select.js';

const scen = (r, n) => r.obs.byScenario?.[n] || {};
// named measures over evaluate() output. `scenarios` lists the assays a member must run for the
// read to be defined; the backend unions them per spec. A measure may be a function of the
// observable's args (the gait reads take {assay}, default walk_cx).
export const MEASURES = {
  walkDist:    { scenarios: ['forage'],    read: r => scen(r, 'forage').dist ?? 0 },
  loomEscape:  { scenarios: ['loom_disk'], read: r => scen(r, 'loom_disk').escapes ?? 0 },
  forageJumps: { scenarios: ['forage'],    read: r => scen(r, 'forage').jumps ?? 0 },
  threatEscape:{ scenarios: ['threat'],    read: r => scen(r, 'threat').escapes ?? 0 },
  standUpright:{ scenarios: ['stand_2s'],  read: r => 1 - (scen(r, 'stand_2s').flipMs ?? 0) / (scen(r, 'stand_2s').ms || 1) },
  courtFrac:   { scenarios: ['court'],     read: r => (scen(r, 'court').courtMs ?? 0) / (scen(r, 'court').ms || 1) },
  rejectCount: { scenarios: ['reject'],    read: r => (scen(r, 'reject').rejections ?? 0) + (scen(r, 'reject').kicks ?? 0) },
  feedFrac:    { scenarios: ['onfood'],    read: r => scen(r, 'onfood').fed ?? 0 },
  groomFrac:   { scenarios: ['forage'],    read: r => (scen(r, 'forage').groomMs ?? 0) / (scen(r, 'forage').ms || 1) },
  steerFrac:   { scenarios: ['forage'],    read: r => (scen(r, 'forage').turnMs ?? 0) / (scen(r, 'forage').ms || 1) },
  starveDist:  { scenarios: ['starveWalk'],read: r => scen(r, 'starveWalk').dist ?? 0 },
  boutMedian:  { scenarios: ['forage'],    read: r => r.obs.boutMedian ?? 0 },
  score:       { scenarios: ['forage', 'onfood', 'threat', 'heat', 'bitter'], read: r => r.score },
};
// The gait instrument's fields (src/exp/gait.js), each a measure over a walking assay. `gait.<field>`
// reads walk_cx unless args.assay says otherwise; walk_cpg is the positive control.
export const GAIT_FIELDS = ['cadence', 'duty', 'swingMs', 'contraPhase', 'contraR', 'tripod', 'legsStepping', 'minLifts',
  'upright', 'support', 'bodyHeight', 'bodyHeightRel', 'speed', 'path', 'loadRhythm'];
export const WALK_ASSAYS = ['walk_cx', 'walk_cpg'];
for (const f of GAIT_FIELDS) MEASURES['gait.' + f] = {
  scenarios: args => [assayOf(args)],
  read: (r, args) => { const g = scen(r, assayOf(args)).gait; if (!g) throw new Error(`gait.${f}: assay ${assayOf(args)} carries no gait record`); return g[f] ?? null; },
  classify: v => classifyGait(f, v),
};
function assayOf(args) { const a = args?.assay || 'walk_cx'; if (!WALK_ASSAYS.includes(a)) throw new Error(`gait measure: assay must be ${WALK_ASSAYS.join('|')}`); return a; }
const scenariosOf = (M, args) => typeof M.scenarios === 'function' ? M.scenarios(args) : M.scenarios;

export function makeBackend({ basePath = 'public/data/brain_params.json', seeds = [7] } = {}) {
  const BASE = (() => { const o = JSON.parse(fs.readFileSync(basePath));
    for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();
  let evaluate = null;   // lazy: MuJoCo only loads when an arena experiment actually runs
  const evalOf = async () => (evaluate ||= (await import('../../../scripts/behavior_eval.mjs')).evaluate);

  const applyParam = (cfg, name, value, spec) => {
    let m;
    if ((m = name.match(/^scaffold\.(\w+)\.(\w+)$/))) { (cfg.scaffoldParams ||= {})[m[1]] = { ...(cfg.scaffoldParams[m[1]] || {}), [m[2]]: value }; return; }
    if ((m = name.match(/^scaffolds\.(\w+)$/))) { (cfg.scaffolds ||= {})[m[1]] = !!value; return; }
    if ((m = name.match(/^typeGain\.(.+)$/))) { (cfg.typeGain ||= {})[m[1]] = value; return; }
    if ((m = name.match(/^edges\.(.+)$/))) {
      const rule = spec?.edgeRules?.[m[1]];
      if (!rule) throw new Error(`ensemble param '${name}': no edge rule '${m[1]}' in spec.edgeRules`);
      (cfg.edgeRules ||= []).push({ id: m[1], pre: rule.pre ?? 'any', post: rule.post ?? 'any', cross: rule.cross ?? 'any', factor: value }); return;
    }
    if (name === 'wiring') { cfg.wiring = value; return; }
    cfg[name] = value;
  };
  // the current value of an addressable param, for scaleGain
  const readParam = (cfg, name, spec) => {
    let m;
    if ((m = name.match(/^scaffold\.(\w+)\.(\w+)$/))) return cfg.scaffoldParams?.[m[1]]?.[m[2]] ?? null;
    if ((m = name.match(/^typeGain\.(.+)$/))) return cfg.typeGain?.[m[1]] ?? 1;
    if ((m = name.match(/^edges\.(.+)$/))) return 1;   // rules compose multiplicatively; a scale is a new rule
    return cfg[name];
  };
  const toCfg = (params, scenarios, spec) => {
    // structuredClone, not a spread: nested tables (scaffolds, scaffoldParams, neuromod) must be
    // fresh per ctx or a perturbation's `cfg.scaffolds[target] = false` edits BASE's shared object
    // and silently lands in every baseline too — the bug that made loom-vs-gait report a uniform
    // no-escape run: by dispatch time every ctx had all three kills applied.
    const cfg = structuredClone({ ...BASE, scenarios });
    for (const [k, v] of Object.entries(params)) applyParam(cfg, k, v, spec);
    return cfg;
  };
  const scenariosFor = (spec) => [...new Set(spec.observables.flatMap(o => { const M = MEASURES[o.measure]; return M ? scenariosOf(M, o.args) : []; }))];
  // spec.seeds is part of the pre-registration (a binary assay must not pick it ad hoc);
  // the backend default is the ledger's calibrated seed
  const newCtx = (params, spec) => ({ params, cfg: toCfg(params, scenariosFor(spec), spec), seeds: spec.seeds ?? seeds });
  const pertCtx = (params, pert, spec) => {
    const ctx = newCtx(params, spec);
    if (pert.kind === 'offPlugin') { (ctx.cfg.scaffolds ||= {})[pert.target] = false; return ctx; }
    if (pert.kind === 'scaleGain') {
      const { param, factor } = pert.args || {};
      if (typeof param !== 'string' || typeof factor !== 'number')
        return { unimplemented: true, reason: 'scaleGain needs args {param, factor}' };
      const cur = readParam(ctx.cfg, param, spec);
      applyParam(ctx.cfg, param, (cur ?? 1) * factor, spec);
      return ctx;
    }
    if (pert.kind === 'ablateType') {
      try { parseSelector(pert.target); } catch (e) { return { unimplemented: true, reason: e.message }; }
      (ctx.cfg.ablate ||= []).push(pert.target); return ctx;
    }
    if (pert.kind === 'scaleEdges') {
      const rule = spec.edgeRules?.[pert.target];
      if (!rule) return { unimplemented: true, reason: `scaleEdges: no edge rule '${pert.target}'` };
      (ctx.cfg.edgeRules ||= []).push({ id: pert.target, pre: rule.pre ?? 'any', post: rule.post ?? 'any', cross: rule.cross ?? 'any', factor: pert.args.factor });
      return ctx;
    }
    return { unimplemented: true, reason: `kind '${pert.kind}' has no arena backend yet` };
  };
  // dispatch the whole ctx set to forked behavior_eval workers — the same pool the scaffold
  // ledger uses, because a member x perturbation arena eval is ~2 min in-process
  const JOB_TIMEOUT = +process.env.ARENA_JOB_TIMEOUT_MS || 20 * 60 * 1000;
  const poolEval = async (jobs, progress) => {
    const { fork } = await import('node:child_process');
    const NW = Math.max(1, Math.min(+process.env.NW || 10, jobs.length));
    const workers = [...Array(NW)].map(() => fork('scripts/behavior_eval.mjs'));
    const out = new Array(jobs.length);
    let next = 0, done = 0;
    const t0 = Date.now();
    await new Promise(res => {
      // a worker that dies mid-job must not hang the run: its job reports the exit as the result
      const give = w => { if (next >= jobs.length) return; const id = next++;
        const timer = setTimeout(() => {
          out[id] = { error: `job ${id} timed out after ${JOB_TIMEOUT / 60000}min` };
          if (++done === jobs.length) res(); else give(w);
        }, JOB_TIMEOUT);
        w.once('message', m => {
          clearTimeout(timer);
          out[id] = m.error ? { error: m.error } : m.out;
          progress?.(`  eval ${++done}/${jobs.length} (${((Date.now() - t0) / 60000).toFixed(1)}min)`);
          done === jobs.length ? res() : give(w);
        });
        w.send({ id, cfg: jobs[id].cfg, seeds: jobs[id].seeds }, undefined, err => {
          if (err) { clearTimeout(timer); out[id] = { error: 'send failed: ' + err.message };
            if (++done === jobs.length) res(); else give(w); }
        });
        w.once('exit', code => {
          if (out[id] !== undefined || code === null) return;
          clearTimeout(timer); out[id] = { error: `worker exited (code ${code}) mid-job` };
          progress?.(`  eval ${++done}/${jobs.length} [worker exit]`);
          done === jobs.length ? res() : null;   // dead worker takes no further jobs
        });
      };
      workers.forEach(give);
    });
    workers.forEach(w => w.kill());
    return out;
  };
  return {
    /** pre-build every member x perturbation ctx and fan the evals out to workers */
    async prepareAll(members, spec, progress) {
      const mi = new Map(members.map((p, i) => [p, i]));
      const base = new Map(), pert = new Map(), ctxs = [];
      for (const params of members) {
        const i = mi.get(params), b = newCtx(params, spec);
        base.set(i, b); ctxs.push(b);
        for (const p of spec.perturbations) {
          const c = pertCtx(params, p, spec);
          if (c?.unimplemented) continue;
          pert.set(i + '|' + p.id, c); ctxs.push(c);
        }
      }
      const results = await poolEval(ctxs.map(c => ({ cfg: c.cfg, seeds: c.seeds })), progress);
      ctxs.forEach((c, i) => c._result = results[i]);
      this._prep = { mi, base, pert };
    },
    build(params, spec) {
      const i = this._prep?.mi.get(params);
      return i !== undefined ? this._prep.base.get(i) : newCtx(params, spec);
    },
    perturb(params, pert, spec) {
      const i = this._prep?.mi.get(params);
      if (i !== undefined) {
        const c = this._prep.pert.get(i + '|' + pert.id);
        if (c) return c;
      }
      return pertCtx(params, pert, spec);
    },
    async measure(ctx, obs) {
      const M = MEASURES[obs.measure];
      if (!M) throw new Error(`arena backend: unknown measure '${obs.measure}' (known: ${Object.keys(MEASURES).join(', ')})`);
      if (!ctx._result) { const ev = await evalOf(); ctx._result = await ev(ctx.cfg, ctx.seeds); }
      if (ctx._result?.error) throw new Error(`arena eval failed: ${String(ctx._result.error).split('\n')[0]}`);
      return M.read(ctx._result, obs.args);
    },
    classify(obsId, v, obs) {
      const M = obs && MEASURES[obs.measure];
      const c = M?.classify ? M.classify(v) : null;
      if (c != null) return c;
      return typeof v === 'number' ? (v > 0.5 ? 'high' : v > 0.05 ? 'low' : 'none') : String(v);
    },
    /** what the ctx actually ran with, for the report: the resolved cfg deltas a reader can replay */
    describeMember(ctx) {
      const { scaffolds, scaffoldParams, typeGain, edgeRules, wiring, ablate } = ctx.cfg;
      return { cfg: { scaffolds, scaffoldParams, typeGain, edgeRules, wiring, ablate } };
    },
  };
}
