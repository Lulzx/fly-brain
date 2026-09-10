// Strongest excitatory paths from a source type set to a target (widest-path, max-min synapse count), up to K hops.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
const D = loadAll(); const SIGN = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const [srcT, tgtT, K = 4] = process.argv.slice(2);
const src = srcT.split('+').flatMap(t => D.byType(t)), tgt = new Set(D.byType(tgtT));
// forward BFS layers with best (bottleneck) strength, only through excitatory neurons
let frontier = new Map(src.map(i => [i, { w: 1e9, path: [i] }])); const best = new Map(frontier);
for (let h = 1; h <= K; h++) {
  const next = new Map();
  for (const [p, info] of frontier) { if (h > 1 && SIGN[p] <= 0.2) continue;
    for (let k = D.indptr[p]; k < D.indptr[p + 1]; k++) { const q = D.indices[k], w = Math.min(info.w, D.weights[k]); if (w < 5) continue;
      const cur = next.get(q); if (!cur || cur.w < w) next.set(q, { w, path: [...info.path, q] }); } }
  const hits = [...next].filter(([q]) => tgt.has(q)).sort((a, b) => b[1].w - a[1].w);
  console.log(`hop ${h}: reachable ${next.size}, target hits ${hits.length}`, hits.slice(0, 3).map(([q, i]) => `bottleneck ${i.w}: ` + i.path.map(x => D.meta.types[x] || '?').join(' > ')).join(' | '));
  // keep top by strength to limit explosion
  frontier = new Map([...next].sort((a, b) => b[1].w - a[1].w).slice(0, 4000));
}
