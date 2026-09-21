// Arena backend for the experiment compiler (spec S7): measures observables on the embodied fly
// through scripts/behavior_eval.mjs, so an experiment's "arena" site is the same animal and the
// same assays the scaffold ledger uses.
//
// Ensemble params are named by where they land:
//   'scaffold.<plugin>.<param>'  -> brainOpts.scaffoldParams[plugin][param] (plugin knob sweep)
//   'scaffolds.<plugin>'         -> brainOpts.scaffolds[plugin]             (member-level kills)
//   anything else                -> a brain_params field                    (e.g. laminaBias)
//
// Perturbation kinds at this site:
//   offPlugin   -> cfg.scaffolds[target] = false
//   scaleGain   -> args {param, factor} multiplies a param (scaffold.* or brain param)
//   ablateType / swapCompartment -> reported unimplemented (no per-type silencing in the arena)
import fs from 'node:fs';

const scen = (r, n) => r.obs.byScenario?.[n] || {};
// named measures over evaluate() output. `scenarios` lists the assays a member must run for the
// read to be defined; the backend unions them per spec.
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

export function makeBackend({ basePath = 'public/data/brain_params.json', seeds = [7] } = {}) {
  const BASE = (() => { const o = JSON.parse(fs.readFileSync(basePath));
    for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();
  let evaluate = null;   // lazy: MuJoCo only loads when an arena experiment actually runs
  const evalOf = async () => (evaluate ||= (await import('../../../scripts/behavior_eval.mjs')).evaluate);

  const applyParam = (cfg, name, value) => {
    const m = name.match(/^scaffold\.(\w+)\.(\w+)$/);
    if (m) { (cfg.scaffoldParams ||= {})[m[1]] = { ...(cfg.scaffoldParams[m[1]] || {}), [m[2]]: value }; return; }
    const t = name.match(/^scaffolds\.(\w+)$/);
    if (t) { (cfg.scaffolds ||= {})[t[1]] = !!value; return; }
    cfg[name] = value;
  };
  const toCfg = (params, scenarios) => {
    // structuredClone, not a spread: nested tables (scaffolds, scaffoldParams, neuromod) must be
    // fresh per ctx or a perturbation's `cfg.scaffolds[target] = false` edits BASE's shared object
    // and silently lands in every baseline too — the bug that made loom-vs-gait report a uniform
    // no-escape run: by dispatch time every ctx had all three kills applied.
    const cfg = structuredClone({ ...BASE, scenarios });
    for (const [k, v] of Object.entries(params)) applyParam(cfg, k, v);
    return cfg;
  };
  const scenariosFor = (spec) => [...new Set(spec.observables.flatMap(o => MEASURES[o.measure]?.scenarios || []))];
  // spec.seeds is part of the pre-registration (a binary assay must not pick it ad hoc);
  // the backend default is the ledger's calibrated seed
  const newCtx = (params, spec) => ({ params, cfg: toCfg(params, scenariosFor(spec)), seeds: spec.seeds ?? seeds });
  const pertCtx = (params, pert, spec) => {
    const ctx = newCtx(params, spec);
    if (pert.kind === 'offPlugin') { (ctx.cfg.scaffolds ||= {})[pert.target] = false; return ctx; }
    if (pert.kind === 'scaleGain') {
      const { param, factor } = pert.args || {};
      if (typeof param !== 'string' || typeof factor !== 'number')
        return { unimplemented: true, reason: 'scaleGain needs args {param, factor}' };
      const m = param.match(/^scaffold\.(\w+)\.(\w+)$/);
      const cur = m ? (ctx.cfg.scaffoldParams?.[m[1]]?.[m[2]] ?? null) : ctx.cfg[param];
      applyParam(ctx.cfg, param, (cur ?? 1) * factor);
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
      return M.read(ctx._result);
    },
    classify(obsId, v) { return typeof v === 'number' ? (v > 0.5 ? 'high' : v > 0.05 ? 'low' : 'none') : String(v); },
  };
}
