// Generic ensemble machinery for connectome-constrained LIF hypothesis labs.
// A wiring diagram underdetermines dynamics; these helpers instantiate an
// ensemble of plausible models by scaling edge classes and excitability, apply
// perturbations, and score experiments by how many model pairs they separate.
import { loadAll } from './lib_node.mjs';
import { makeLIF } from './lifprobe.mjs';

// deterministic RNG for the LIF noise source (mulberry32)
export function seedRng(seed) {
  let rs = seed;
  Math.random = () => { rs |= 0; rs = rs + 0x6D2B79F5 | 0; let t = Math.imul(rs ^ rs >>> 15, 1 | rs); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// scaleRules: [{ pre: typeName|Set(idx), post: typeName|Set(idx), param: 'name' }]
// params[param] multiplies every edge matching that class; tonic: {pop: idx[], param: 'name'} -> bias
export function makeBuilder(D, scaleRules, tonics = []) {
  const asSet = (x) => x instanceof Set ? x : new Set(D.byType(x));
  const rules = scaleRules.map(r => ({ pre: asSet(r.pre), post: asSet(r.post), param: r.param }));
  const tns = tonics.map(t => ({ pop: asSet(t.pop), param: t.param }));
  return (params) => {
    const net = makeLIF(D, {});
    for (const r of rules) {
      const g = params[r.param]; if (g == null || g === 1) continue;
      for (let i = 0; i < D.N; i++) {
        if (!r.pre.has(i)) continue;
        for (let j = D.indptr[i]; j < D.indptr[i + 1]; j++) if (r.post.has(D.indices[j])) net.weights[j] *= g;
      }
    }
    for (const t of tns) { const b = params[t.param]; if (b) net.setBias([...t.pop], b); }
    return net;
  };
}

export const run = (net, ms) => { for (let s = 0; s < Math.round(ms / net.p.dt); s++) net.step(); };
export const silence = (net, idx) => { net.__silenced = idx; for (const i of idx) net.setThr(i, 1e6); };

export const circRes = (r, k = 8) => { let x = 0, y = 0, n = 0; r.forEach((v, w) => { x += v * Math.cos(w * 2 * Math.PI / k); y += v * Math.sin(w * 2 * Math.PI / k); n += v; }); return n > 1e-9 ? Math.hypot(x, y) / n : 0; };
export const circAngle = (r, k = 8) => { let x = 0, y = 0; r.forEach((v, w) => { x += v * Math.cos(w * 2 * Math.PI / k); y += v * Math.sin(w * 2 * Math.PI / k); }); return Math.atan2(y, x); };
export const centroid = (v) => { const s = v.reduce((a, b) => a + b, 0); return s > 1e-9 ? v.reduce((a, x, i) => a + i * x, 0) / s : null; };

// generic experiment ranking: fraction of member pairs placed in different outcome classes
export function rankExperiments(experiments) {
  for (const e of Object.values(experiments)) {
    let diff = 0, tot = 0;
    for (let i = 0; i < e.outcome.length; i++) for (let j = i + 1; j < e.outcome.length; j++) { tot++; if (e.outcome[i] !== e.outcome[j]) diff++; }
    e.score = +(diff / Math.max(tot, 1)).toFixed(3);
  }
  return Object.entries(experiments).sort((a, b) => b[1].score - a[1].score);
}
