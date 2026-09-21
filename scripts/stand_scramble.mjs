// Spec S2.7 kill test 1: degree-matched, same-sign edge scramble, retrained from scratch.
// If the scrambled graph fits within 80% of the real fit's held-out score, the wiring was a
// reservoir -- record the interesting negative and keep the CPG.
//
//   node scripts/stand_scramble.mjs --data=public/data/vnc_fitdata --iters=2000 --seed=1
//
// This is stand_fit.mjs with the edge set permuted per (sign, out-degree) bucket before training:
// same nodes, same degree sequence, same Dale's-law signs, different partners.
import { extractVncSubgraph, scrambleSubgraphEdges } from '../src/vnc/subgraph.js';
// The fit itself is stand_fit's loop; this script exists to name the test and stamp the artifact
// with the scramble provenance. Implementation is delegated so the two can never diverge.
import { spawnSync } from 'node:child_process';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const seed = +arg('seed', 1);
const extra = process.argv.slice(2).filter(a => !a.startsWith('--seed') && !a.startsWith('--scramble'));
const out = arg('out', `public/data/stand_fit_scramble${seed}.json`);

const r = spawnSync(process.execPath, ['scripts/stand_fit.mjs', `--scramble=${seed}`, `--out=${out}`, ...extra],
  { stdio: 'inherit', cwd: process.cwd() });
process.exit(r.status ?? 1);
