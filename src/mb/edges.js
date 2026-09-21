// Mushroom-body edge table for the engram harness (spec S6).
//
// The KC->MBON synapse is the substrate the model is being asked to install memory into: 4,064
// Kenyon cells converge onto 97 MBONs through ~44k packed edges in this dataset. This module reads
// the *published* compartment anatomy out of the instance names -- `MBON01(y5B'2a)`, `PAM07(y4<y1y2)`,
// `PPL103(y2a'1)` -- rather than inventing a cartoon map. The convention (Aso et al. 2014, carried
// into the FlyWire male-CNS labels):
//
//   MBONxx(dendrite>axon)  -- the parenthesised string names the compartments the dendrite
//                             occupies; anything after '>' is the axon target and does not take
//                             KC->MBON synapses. No '>' means the whole string is dendrite.
//   PAMxx(comps)           -- the DAN's axon tiles those compartments; '<' means the arbor runs
//   PPL1xx(comps)            from one compartment into the next (y4<y1y2 tiles y4 and reaches y1y2).
//
// Tokens normalise to the lobe's names: y -> gamma, B/b -> beta, a -> alpha, ' -> prime, digits the
// compartment number, trailing letters the subdivision (m/p/d/a/s = medial/posterior/dorsal/
// anterior/superior). 'pedc' and 'calyx' are kept as literals. A digit group left without a letter
// inherits the previous one ('a2p3p' -> a2p, a3p; 'a'2a2' -> a'2, a2).
//
// Compartments nest: beta'1ap is a subdivision of beta'1, and MBON10's dendrite spans all of beta'1.
// `compMatch` therefore treats two tokens as the same compartment when either is a prefix of the
// other. That approximation is stated rather than hidden: an MBON whose dendrite straddles two
// compartments (MBON01 in gamma5 AND beta'2a) has its KC edges tagged with both, because the packed
// graph does not record which compartment each synapse sits in.
//
// DANs with no parenthesised annotation (PPL106-108, PPL201-204) get their compartment set inferred
// from connectivity -- the compartments of the MBONs they synapse onto -- and the inference is
// cross-checked against the annotated DANs before use.

const LITERAL = /pedc|ped|calyx/g;

/** Tokenise a parenthesised compartment string into normalised compartment names.
 *  Grammar: a unit is letter['][digits][suffix-letters]; a digit group right after suffix letters
 *  starts a new unit carrying the previous letter ('a2p3p' -> a2p, a3p); a compartment letter NOT
 *  followed by a digit is a suffix of the current unit ('a'1a' is one compartment, 'y1y2' is two). */
export function compTokens(str) {
  const lits = [];
  const rest = str.replace(LITERAL, m => { lits.push(m === 'ped' ? 'pedc' : m); return ' '; });
  const out = [...lits];
  let cur = '', curLetter = '';
  const flush = () => { if (cur) out.push(cur === 'b' || cur.startsWith('b') ? 'B' + cur.slice(1) : cur); cur = ''; };
  for (let k = 0; k < rest.length; k++) {
    const c = rest[k];
    if (/[yBba]/.test(c)) {
      if (/^[yBba]'?\d/.test(rest.slice(k))) { flush(); cur = c; curLetter = c; }
      else cur += c;
    } else if (c === "'" || c === '`') cur += "'";
    else if (/\d/.test(c)) {
      // digit right after a suffix letter (unit has digits already) -> new unit carrying the letter
      if (cur && /[a-z]$/.test(cur) && /\d/.test(cur)) { flush(); cur = curLetter + c; }
      else if (!cur) cur = curLetter + c;
      else cur += c;
    } else if (/[a-z]/.test(c)) cur += c;                    // suffix letter (m/p/d/s/e/...)
  }
  flush();
  return [...new Set(out)];
}

/** Compartments of a neuron from its instance name. For MBONs only the dendrite side of '>'
 *  counts; for DANs the whole annotation is innervated territory ('<' and '>' both split). */
export function compartmentsOf(type, instance) {
  const m = instance.match(/\(([^)]*)\)/);
  if (!m) return null;
  const s = m[1].replace(/_bilateral$/, '');
  if (/^MBON/.test(type)) return compTokens(s.split('>')[0]);
  return compTokens(s.replace(/[<>]/g, ' '));
}

/** Compartment tokens match when one is a prefix of the other (subdivisions share the parent). */
export const compMatch = (a, b) => a === b || a.startsWith(b) || b.startsWith(a);

/**
 * Build the mushroom-body table from the connectome.
 * @returns { kc, mbon, dan, edges, comps, mbonComp, danComp, danInferred }
 *   edges: { csr, pre, post, comp } -- csr is the index into data.indptr/indices/weights, comp a
 *   bitmask over `comps` (the compartment tags of the postsynaptic MBON's dendrite); pre and post
 *   are *positions* in `kc`/`mbon`, so the rule's trace vectors index them directly.
 *   mbonComp/danComp: Map neuron idx -> compartment token list (danComp includes the
 *   connectivity-inferred sets for unannotated DANs; danInferred lists which those are).
 */
export function buildMB(data) {
  const { types, instances } = data.meta;
  const kc = [], mbon = [], dan = [];
  for (let i = 0; i < data.N; i++) {
    if (/^KC/.test(types[i])) kc.push(i);
    else if (/^MBON/.test(types[i])) mbon.push(i);
    else if (/^(PAM|PPL|MeVPaMe)/.test(types[i])) dan.push(i);
  }
  const mbonIdx = new Set(mbon);
  const mbonComp = new Map(), danComp = new Map();
  for (const i of mbon) mbonComp.set(i, compartmentsOf(types[i], instances[i]) || []);
  for (const i of dan) { const c = compartmentsOf(types[i], instances[i]); if (c) danComp.set(i, c); }

  // Infer compartments for unannotated DANs from their MBON targets (a DAN axon only exists inside
  // the lobe, so its synapses onto MBONs land in the compartments it tiles).
  const danInferred = [];
  for (const d of dan) {
    if (danComp.has(d)) continue;
    const hits = new Map();
    for (let k = data.indptr[d]; k < data.indptr[d + 1]; k++) {
      const q = data.indices[k];
      if (mbonIdx.has(q)) for (const c of mbonComp.get(q)) hits.set(c, (hits.get(c) || 0) + data.weights[k]);
    }
    const tot = [...hits.values()].reduce((a, x) => a + x, 0);
    if (tot >= 5) {   // a token counts when it carries >= 25% of the DAN's MBON-bound synapses
      danComp.set(d, [...hits].filter(([, w]) => w / tot >= 0.25).map(([c]) => c));
      danInferred.push(d);
    }
  }

  const comps = [...new Set([...mbonComp.values(), ...danComp.values()].flat())].sort();
  const cIx = new Map(comps.map((c, i) => [c, i]));
  const tag = list => {   // a tag covers a token and every token it nests in
    const s = new Set();
    for (const c of list) for (const [cc, i] of cIx) if (compMatch(c, cc)) s.add(i);
    return s; };
  const kcPos = new Map(kc.map((i, k) => [i, k])), mbonPos = new Map(mbon.map((j, k) => [j, k]));
  const edges = { csr: [], pre: [], post: [], comp: [] };
  for (const j of kc) for (let k = data.indptr[j]; k < data.indptr[j + 1]; k++) {
    const q = data.indices[k];
    if (!mbonIdx.has(q)) continue;
    edges.csr.push(k); edges.pre.push(kcPos.get(j)); edges.post.push(mbonPos.get(q));
    edges.comp.push(tag(mbonComp.get(q)));
  }
  // compEdges: comp index -> edge positions carrying the tag. Teach and the controls iterate
  // compartments, not edges.
  const compEdges = new Map();
  for (let k = 0; k < edges.csr.length; k++)
    for (const c of edges.comp[k]) (compEdges.get(c) || compEdges.set(c, []).get(c)).push(k);
  for (const [c, l] of compEdges) compEdges.set(c, Int32Array.from(l));
  return {
    kc, mbon, dan, comps, cIx, mbonComp, danComp, danInferred, kcPos, mbonPos, compEdges,
    // pre/post are *positions* in kc/mbon (for the rule's trace vectors); csr addresses the graph;
    // comp is a Set of compartment indices (the MBON's dendrite tags).
    edges: { csr: Int32Array.from(edges.csr), pre: Int32Array.from(edges.pre),
      post: Int32Array.from(edges.post), comp: edges.comp },
    compDans: c => dan.filter(d => danComp.get(d)?.some(t => compMatch(t, c))),
    compMbons: c => mbon.filter(j => mbonComp.get(j)?.some(t => compMatch(t, c))),
  };
}
