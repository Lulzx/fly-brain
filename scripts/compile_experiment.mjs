// Experiment compiler facade (spec S7.2).
//
//   node scripts/compile_experiment.mjs [spec-id ...]      # default: all specs in src/exp/specs/
//
// One command runs spec -> ensemble -> ranked perturbation -> two-site measurement -> the
// pre-registered observables table, and writes JSON + Markdown to public/data/experiments/.
// A spec with status:'pending' (S2–S6 machinery not built yet) still emits its artifacts —
// the spec is on record, the measurements are marked pending rather than faked.
import fs from 'node:fs';
import { normalizeSpec, ensembleMembers } from '../src/exp/spec.js';
import { runExperiment, renderMarkdown } from '../src/exp/run.js';
import { loadAll } from './lib_node.mjs';

const OUT = 'public/data/experiments';
const ids = process.argv.slice(2).filter(a => !a.startsWith('--'));
const quiet = process.argv.includes('--quiet');

// backends are lazy: an arena spec pays MuJoCo load time only when it actually runs,
// and a pending spec never touches a backend at all
const BACKENDS = {
  heading: async () => (await import('../src/exp/backends/heading.js')).makeBackend(loadAll()),
  arena: async () => (await import('../src/exp/backends/arena.js')).makeBackend(),
};

const specsDir = new URL('../src/exp/specs/', import.meta.url);
const files = ids.length ? ids.map(i => `${i}.js`) : fs.readdirSync(specsDir).filter(f => f.endsWith('.js')).sort();
fs.mkdirSync(OUT, { recursive: true });

for (const f of files) {
  let spec;
  try {
    const { default: raw } = await import(new URL(f, specsDir));
    spec = normalizeSpec(raw);                     // malformed spec -> hard fail, nothing written
  } catch (e) {
    console.error(`${f}: ${e.message}`);
    process.exitCode = 1;
    continue;
  }
  let result;
  if (spec.status === 'pending') {
    // pre-registered, not yet executable: the observables table is on record with no numbers
    result = {
      spec: { id: spec.id, question: spec.question, operators: spec.operators, splitRule: spec.splitRule, status: 'pending' },
      ensemble: { n: Math.min(spec.ensemble.n, ensembleMembers(spec.ensemble).length), params: spec.ensemble.params, seed: spec.ensemble.seed },
      observables: spec.observables.map(o => ({ ...o, value: 'pending' })),
      members: [], skipped: spec.perturbations.map(p => ({ perturbation: p.id, reason: 'pending: backend lands with its spec section' })),
      ranked: [],
    };
  } else {
    const backend = await BACKENDS[spec.backend]?.();
    if (!backend) { console.error(`${spec.id}: no backend '${spec.backend}'`); process.exitCode = 1; continue; }
    console.log(`${spec.id}: ${spec.ensemble.n} members x ${spec.perturbations.length} perturbations (${spec.backend})`);
    result = await runExperiment(spec, backend, { progress: quiet ? null : s => console.log(s) });
  }
  fs.writeFileSync(`${OUT}/${spec.id}.json`, JSON.stringify(result, null, 1));
  fs.writeFileSync(`${OUT}/${spec.id}.md`, renderMarkdown(result));
  console.log(`${spec.id}: wrote ${OUT}/${spec.id}.{json,md}${spec.status === 'pending' ? ' (pending)' : ''}`);
}
