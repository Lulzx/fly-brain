// Neuron selectors for experiment specs (spec S8, docs/44-walking-compiler.md).
//
// A perturbation names a population; this resolves the name to connectome indices, once, in the
// process that builds the graph. Selectors are strings so they survive a fork boundary and read
// the same in a spec, a report and a ledger row:
//
//   type:IN19B012            one annotated cell type (exact)
//   hemilineage:19B          every VNC interneuron whose type name carries the hemilineage
//                            (IN19B012, IN20A.22A039 carries both 20A and 22A; _a/_b suffixes fold)
//   superclass:vnc_intrinsic an annotated superclass (meta.superclasses)
//   class:mechanosensory     an annotated class (meta.classes)
//   regex:^IN13[AB]          a regular expression over the type name
//   muscle:T3                every leg motor neuron of a bodymap muscle group matching the regex
//   any                      everything
//
// Any selector may take a side suffix: `hemilineage:19B@left`, `type:IN19B012@right`.
// Side is the release's soma side (1 left, 2 right); `@left` on a midline cell selects nothing.
//
// resolveSelector returns a Uint8Array mask over the N neurons; a selector that matches nothing
// throws, because an ablation of an empty set is the silent-zero failure this file exists to stop.

const HL = /^IN((?:\d{2}[AB]|XXX)(?:\.\d{2}[AB])*)\d+(?:_[a-z])?$/;
/** hemilineages named in a type string, e.g. 'IN20A.22A039' -> ['20A','22A']; non-IN types -> [] */
export function hemilineagesOf(type) {
  const m = typeof type === 'string' ? type.match(HL) : null;
  return m ? m[1].split('.') : [];
}

export function parseSelector(sel) {
  if (typeof sel !== 'string' || !sel) throw new Error(`selector must be a non-empty string, got ${JSON.stringify(sel)}`);
  let side = 0, s = sel;
  const at = s.lastIndexOf('@');
  if (at > 0) { const sd = s.slice(at + 1); s = s.slice(0, at);
    side = sd === 'left' ? 1 : sd === 'right' ? 2 : (() => { throw new Error(`selector '${sel}': side must be left|right`); })(); }
  if (s === 'any') return { kind: 'any', arg: '', side };
  const m = s.match(/^(type|hemilineage|superclass|class|regex|muscle):(.+)$/);
  if (!m) throw new Error(`selector '${sel}': expected <type|hemilineage|superclass|class|regex|muscle>:<name>[@left|@right] or 'any'`);
  return { kind: m[1], arg: m[2], side };
}

/** Uint8Array mask over D.N for a selector string. D is the loadAll() bundle (meta, side, sc, cls, bodymap). */
export function resolveSelector(D, sel) {
  const { kind, arg, side } = parseSelector(sel);
  const N = D.N, types = D.meta.types, mask = new Uint8Array(N);
  let n = 0;
  const take = i => { if (!side || D.side[i] === side) { mask[i] = 1; n++; } };
  switch (kind) {
    case 'any': for (let i = 0; i < N; i++) take(i); break;
    case 'type': for (let i = 0; i < N; i++) if (types[i] === arg) take(i); break;
    case 'hemilineage': {
      const cache = new Map();
      for (let i = 0; i < N; i++) { const t = types[i]; let h = cache.get(t); if (!h) cache.set(t, h = hemilineagesOf(t)); if (h.includes(arg)) take(i); }
      break;
    }
    case 'superclass': {
      const k = D.meta.superclasses.indexOf(arg);
      if (k < 0) throw new Error(`selector '${sel}': unknown superclass (known: ${D.meta.superclasses.join(', ')})`);
      for (let i = 0; i < N; i++) if (D.sc[i] === k) take(i); break;
    }
    case 'class': {
      const k = D.meta.classes.indexOf(arg);
      if (k < 0) throw new Error(`selector '${sel}': unknown class (known: ${D.meta.classes.join(', ')})`);
      for (let i = 0; i < N; i++) if (D.cls[i] === k) take(i); break;
    }
    case 'regex': { const re = new RegExp(arg); for (let i = 0; i < N; i++) if (re.test(String(types[i]))) take(i); break; }
    case 'muscle': {
      const re = new RegExp(arg);
      for (const m of D.bodymap?.muscles || []) if (re.test(m.name)) for (const i of m.idx) take(i);
      break;
    }
  }
  if (!n) throw new Error(`selector '${sel}' matches no neuron`);
  mask.count = n;
  return mask;
}

/** per-edge multiplier for a list of edge rules, or null when there are none.
 *  rule: { pre: selector, post: selector, cross?: 'contra'|'ipsi'|'any', factor: number }
 *  `cross` reads the release's soma sides; an edge with an unknown side on either end matches
 *  only 'any'. Rules compose multiplicatively, so two rules on one edge both apply. */
export function edgeGainFor(D, rules) {
  if (!rules?.length) return null;
  const g = new Float32Array(D.E).fill(1);
  const applied = [];
  for (const r of rules) {
    if (typeof r.factor !== 'number') throw new Error(`edge rule ${JSON.stringify(r)}: factor must be a number`);
    const pre = resolveSelector(D, r.pre || 'any'), post = resolveSelector(D, r.post || 'any');
    const cross = r.cross || 'any';
    if (!['contra', 'ipsi', 'any'].includes(cross)) throw new Error(`edge rule: cross must be contra|ipsi|any`);
    let hit = 0;
    for (let i = 0; i < D.N; i++) {
      if (!pre[i]) continue;
      const si = D.side[i];
      for (let k = D.indptr[i]; k < D.indptr[i + 1]; k++) {
        const j = D.indices[k]; if (!post[j]) continue;
        if (cross !== 'any') { const sj = D.side[j]; if (!(si === 1 || si === 2) || !(sj === 1 || sj === 2)) continue;
          if ((cross === 'contra') !== (si !== sj)) continue; }
        g[k] *= r.factor; hit++;
      }
    }
    if (!hit) throw new Error(`edge rule ${JSON.stringify(r)} matches no edge`);
    applied.push({ ...r, edges: hit, pre: pre.count, post: post.count });
  }
  g.applied = applied;
  return g;
}
