// The scaffold ledger (docs/37-scaffold-ledger.md, spec S1).
//
//   node scripts/scaffold_ledger.mjs              -> print the manifest: every named module, its
//                                                    claim, params and kill switch. This is the
//                                                    artifact CI diffs against — an unnamed
//                                                    mechanism shows up as a missing row.
//   node scripts/scaffold_ledger.mjs --run [n]    -> evaluate the kill matrix on n seeds:
//                                                    all scaffolds on (the calibrated animal),
//                                                    all off (graph-only), each off alone; then
//                                                    assemble the spec's behaviour table and the
//                                                    greedy minimal enabling set. Writes
//                                                    public/data/scaffold_ledger.json.
//   --off=id1,id2                                 -> evaluate one specific off-set only.
//   NW=10                                         -> worker count (same pool as behavior_ladder).
//
// Conditions run through forked behavior_eval workers, one (condition, seed) job each; scores are
// the mean over seeds of evaluate()'s per-seed result. "graph_only" is the honest reference — the
// standing claim is that the graph alone cannot yet hold the animal up — and is not expected to
// be pretty.
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { scaffoldManifest } from '../src/sim/scaffold/index.js';
import { BEHAVIOURS, LEDGER_SCENARIOS, conditions, assembleRows } from '../src/sim/scaffold/ledger.js';
import { INTRINSIC } from '../src/sim/intrinsic.js';
import { READOUT } from '../src/sim/motor.js';

const args = process.argv.slice(2);
const offArg = args.find(a => a.startsWith('--off='));
const run = args.includes('--run') || offArg;
const N = +(args.find(a => /^\d+$/.test(a)) || 4);
const NW = +(process.env.NW || 10);
const SEEDS = [...Array(N)].map((_, i) => 1000 + i * 7919);
const BASE = (() => { const o = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; })();

const manifest = scaffoldManifest(null, { INTRINSIC, READOUT });
if (!run) { console.log(JSON.stringify(manifest, null, 1)); process.exit(0); }

const conds = offArg
  ? [{ name: 'off:' + offArg.slice(6), cfg: { scenarios: LEDGER_SCENARIOS, scaffolds: Object.fromEntries(offArg.slice(6).split(',').map(id => [id.trim(), false])) } }]
  : conditions();

const jobs = conds.flatMap(c => SEEDS.map(seed => ({ cond: c.name, seed, cfg: { ...BASE, ...c.cfg, seed }, seeds: [seed] })));
console.log(`${conds.length} conditions x ${N} seeds = ${jobs.length} evaluations on ${NW} workers`);

const workers = [...Array(NW)].map(() => fork('scripts/behavior_eval.mjs'));
const out = new Array(jobs.length);
let next = 0, done = 0, failed = 0; const t0 = Date.now();
await new Promise(res => {
  const give = w => { if (next >= jobs.length) return; const id = next++;
    w.once('message', m => {
      out[id] = m; done++;
      if (m.error) { failed++; console.error(`\nFAIL ${jobs[id].cond} seed ${jobs[id].seed}: ${m.error.split('\n')[0]}`); }
      process.stdout.write(`\r${done}/${jobs.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)   `);
      done === jobs.length ? res() : give(w);
    });
    w.send({ id, cfg: jobs[id].cfg, seeds: jobs[id].seeds }); };
  workers.forEach(give);
});
workers.forEach(w => w.kill());
console.log();
if (failed) { console.error(`${failed} of ${jobs.length} evaluations failed`); process.exit(1); }

// pool the per-seed runs back into one aggregated result per condition (same shape as evaluate's)
const mergeByScenario = runs => {
  const out = {};
  for (const r of runs) for (const [n, so] of Object.entries(r.obs.byScenario || {})) {
    const acc = out[n] ||= {};
    for (const [k, v] of Object.entries(so)) if (v != null) acc[k] = (acc[k] || 0) + (typeof v === 'boolean' ? +v : v) / runs.length;
  }
  return out;
};
const runs = {};
for (const c of conds) {
  const rs = out.filter((m, i) => jobs[i].cond === c.name && m?.out).map(m => m.out);
  const pick = f => rs.reduce((s, r) => s + f(r), 0) / rs.length;
  runs[c.name] = {
    score: pick(r => r.score),
    terms: Object.fromEntries(Object.keys(rs[0].terms).map(k => [k, pick(r => r.terms[k])])),
    obs: Object.fromEntries(Object.keys(rs[0].obs).map(k => [k,
      k === 'byScenario' ? mergeByScenario(rs) : pick(r => r.obs[k])])),
  };
  console.log(`${c.name.padEnd(22)} score ${runs[c.name].score.toFixed(4)}`);
}

const ledger = {
  _source: 'scripts/scaffold_ledger.mjs --run',
  generated: new Date().toISOString(), seeds: SEEDS, scenarios: LEDGER_SCENARIOS,
  manifest, runs,
  behaviours: Object.fromEntries(Object.entries(BEHAVIOURS).map(([k, b]) => [k, { note: b.note }])),
  table: offArg ? null : assembleRows(runs),
};
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/scaffold_ledger.json', JSON.stringify(ledger, null, 1));

if (args.includes('--minimal') && runs.all_on) {
  // sequential in-process trials: each step is one more evaluate() of the trial set
  const { evaluate } = await import('./behavior_eval.mjs');
  const { minimalEnablingSet } = await import('../src/sim/scaffold/ledger.js');
  const mes = await minimalEnablingSet(evaluate, BASE, runs.all_on.score, SEEDS);
  ledger.minimalEnablingSet = mes;
  fs.writeFileSync('public/data/scaffold_ledger.json', JSON.stringify(ledger, null, 1));
  console.log(`\nminimal enabling set -> ${mes.set.join(', ') || '(none)'} (score ${mes.achieved.toFixed(3)} of ${(mes.target * runs.all_on.score).toFixed(3)} needed)`);
}

if (ledger.table) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('behaviour', 12), pad('graphOnly', 10), pad('allOn', 8), pad('required', 40), 'kill');
  for (const r of ledger.table)
    console.log(pad(r.behaviour, 12), pad(r.graphOnly, 10), pad(r.withScaffolds, 8), pad(r.required.join(', ') || '-', 40), r.kill);
}
console.log('\nwrote public/data/scaffold_ledger.json');
