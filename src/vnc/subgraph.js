// The VNC leg-premotor subgraph (spec S2.3).
//
// The object is everything between the descending commands and the leg muscles that the wiring
// itself supplies: the leg motor neurons, their presynaptic partners within two hops that live in
// the VNC or descend into it, and the named locomotion DNs that drive them. Brain-only populations
// (Kenyon cells, the optic lobe, the antennal lobe) are excluded by the superclass filter -- the
// two-hop walk never reaches them from leg MNs anyway, but the filter is the stated rule.
//
// The subgraph is its own index space. `origIdx[k]` maps a subgraph node back to the connectome;
// every array the fitter consumes (indptr/indices/weights, nt, sign, sizeLog, sc) is subgraph-local.
// Boundary inputs are the neurons the subgraph reads but that are not computed inside it: the
// descending neurons (command), and the proprioceptive + tactile sensor sets (the animal's own
// state). In the twin they are driven externally, exactly as flyvis-driven neurons are in the
// shipped model -- their incoming edges carry nothing.

import { EXC_SIGN } from '../lif.js';

// Named locomotion DNs already used in src/sim/motor.js (DN_ROLES), with the spec's aliases:
// BDN2 -> DNg100, oDN1 -> DNg97, P9 -> DNp09.
import fs from 'node:fs';

export const LOCOMOTION_DN_TYPES = [
  'DNg100', 'DNg97', 'DNp09', 'DNa05', 'DNa07', 'DNp26', 'DNg25', 'DNa01', 'DNa02', 'MDN'];

// Superclasses that count as "VNC / descending" for the two-hop ancestor walk.
const VNC_SUPERCLASSES = new Set([
  'vnc_motor', 'vnc_intrinsic', 'vnc_efferent', 'vnc_sensory', 'vnc_sensory_tbc', 'vnc_tbc',
  'vnc_endocrine', 'descending_neuron', 'sensory_descending', 'efferent_descending',
  'efferent_ascending', 'ascending_neuron']);

const LEG_MUSCLE = /\bT[123]\b/;

/** Extract the VNC leg-premotor subgraph from the loaded connectome.
 *  Returns {N, indptr, indices, weights, nt, sign, sizeLog, sc, cls, side, types, origIdx,
 *           role, mn: [{sub, muscle, actuator, dir, leg, side}], dn: {type: [subIdx]},
 *           sensors: {name: [subIdx]}, E}.
 *  role[i]: 0 interneuron, 1 motor (maps to a leg muscle), 2 descending, 3 sensory. */
export function extractVncSubgraph(D) {
  const { N, indptr, indices, weights, sc, cls, side, nt, meta, bodymap } = D;
  const SC = meta.superclasses, types = meta.types;
  const isVnc = i => VNC_SUPERCLASSES.has(SC[sc[i]]);

  // leg motor neurons: every neuron the bodymap assigns to a leg muscle group
  const legMN = new Set();
  const mnMuscle = new Map();   // neuron -> muscle entries (a neuron can serve one group per side)
  for (const m of bodymap.muscles) {
    if (!LEG_MUSCLE.test(m.name)) continue;
    for (const i of m.idx) {
      legMN.add(i);
      (mnMuscle.get(i) || mnMuscle.set(i, []).get(i)).push(m);
    }
  }

  // reverse adjacency for the ancestor walk
  const radj = Array.from({ length: N }, () => []);
  for (let s = 0; s < N; s++) for (let k = indptr[s]; k < indptr[s + 1]; k++) radj[indices[k]].push(s);

  // two hops of presynaptic partners, VNC/descending only
  const hop1 = new Set();
  for (const t of legMN) for (const s of radj[t]) if (isVnc(s)) hop1.add(s);
  const nodes = new Set(legMN);
  for (const t of hop1) { nodes.add(t); for (const s of radj[t]) if (isVnc(s)) nodes.add(s); }

  // named locomotion DNs are in the ancestor set already; tag every descending neuron in the
  // subgraph, and flag the named ones for the drive reconstruction
  const origIdx = Int32Array.from(nodes).sort();
  const subOf = new Int32Array(N).fill(-1);
  for (let k = 0; k < origIdx.length; k++) subOf[origIdx[k]] = k;
  const nSub = origIdx.length;

  // sensor sets -> subgraph membership (proprioception and leg touch are inputs to the subgraph)
  const sensors = {};
  for (const s of bodymap.sensors) {
    const idx = s.idx.filter(i => subOf[i] >= 0).map(i => subOf[i]);
    if (idx.length) sensors[s.name] = { idx, kind: s.kind, glomerulus: s.glomerulus, antenna: s.antenna };
  }

  // role tags + the muscle mapping
  const role = new Uint8Array(nSub);
  const mn = [];
  const dn = {};
  for (let k = 0; k < nSub; k++) {
    const i = origIdx[k], sname = SC[sc[i]], t = String(types[i]);
    if (legMN.has(i)) { role[k] = 1; for (const m of mnMuscle.get(i)) mn.push({ sub: k, orig: i, muscle: m.name, actuator: m.actuator, dir: m.dir }); }
    else if (sname === 'descending_neuron') { role[k] = 2; if (LOCOMOTION_DN_TYPES.some(n => t === n || t.startsWith(n + '_') || t.startsWith(n + ' '))) (dn[t] ||= []).push(k); }
    else if (sname === 'vnc_sensory' || sname === 'vnc_sensory_tbc' || sname === 'sensory_descending') role[k] = 3;
  }

  // subgraph-local CSR: keep only internal edges, and mark every node whose connectome inputs are
  // not fully internal -- those are the boundary of the frozen edge set, the neurons the rest of
  // the brain drives. At fit time they are replayed at their recorded live rates (sensory-masked,
  // exactly as flyvis inputs are); the computed core is the remainder. Motor neurons are never
  // boundary: they are the readout the graph must produce.
  const nptr = new Uint32Array(nSub + 1), nidx = [], nwts = [];
  const excised = new Uint8Array(nSub);
  for (let k = 0; k < nSub; k++) {
    const s = origIdx[k];
    let ex = 0;
    for (let e = indptr[s]; e < indptr[s + 1]; e++) {
      const t = subOf[indices[e]];
      if (t >= 0) { nidx.push(t); nwts.push(weights[e]); }
      else ex = 1;
    }
    excised[k] = ex;
    nptr[k + 1] = nidx.length;
  }
  // The boundary is every non-motor node: at fit time the whole premotor state is clamped to its
  // recorded live rates (Poisson-regenerated, the same convention the model already uses for every
  // driven population), because the 2-hop ball cannot self-ignite -- the live premotor layer's
  // ignition drive arrives from outside the ball (central-brain tonic drive, deeper-hop loops).
  // What the graph must still compute is the readout: motor neurons are never boundary. A driven
  // neuron's outgoing edges keep delivering through the frozen CSR with logGain applied, so the
  // fit shapes how the recorded premotor pattern lands on each MN -- and the degree-matched
  // scramble asks whether the edge identities, not just the activity, carry the signal.
  const isBoundary = new Uint8Array(nSub);
  for (let k = 0; k < nSub; k++) if (role[k] !== 1) isBoundary[k] = 1;

  // per-neuron arrays, subgraph-local
  const snt = new Uint8Array(nSub), ssign = new Float32Array(nSub), ssc = new Uint8Array(nSub), scls = new Uint16Array(nSub), sside = new Uint8Array(nSub), stypes = new Array(nSub);
  const soma = D.soma;
  const sizeArr = new Float32Array(nSub);
  for (let k = 0; k < nSub; k++) {
    const i = origIdx[k];
    snt[k] = nt[i]; ssign[k] = EXC_SIGN[nt[i]] || 0; ssc[k] = sc[i]; scls[k] = cls[i]; sside[k] = side[i]; stypes[k] = types[i];
    if (soma) { const x = soma[3 * i], y = soma[3 * i + 1], z = soma[3 * i + 2]; sizeArr[k] = Math.cbrt(Math.max(1e-9, x * y * z)); }
  }

  return {
    N: nSub, E: nidx.length,
    indptr: nptr, indices: Uint32Array.from(nidx), weights: Uint16Array.from(nwts),
    nt: snt, sign: ssign, sc: ssc, cls: scls, side: sside, types: stypes, role, origIdx,
    excised, isBoundary,
    mn, dn, sensors,
    sizeArr,
    meta: { superclasses: SC, classes: meta.classes, nts: meta.nts },
  };
}

/** Scramble the subgraph's connectivity in place: permute each neuron's outgoing edge list within
 *  degree-matched, same-sign buckets (spec S2.7 kill test 1). A bucket is (postsynaptic sign of the
 *  presynaptic neuron, out-degree rounded to the same minSyn-gated count) -- preserving both the
 *  Dale's-law structure and the degree distribution, so the scrambled graph is a reservoir built of
 *  the same parts. Returns a new subgraph object sharing the node metadata. */
export function scrambleSubgraphEdges(sub, seed = 1) {
  let a = (seed * 2654435761) | 0;
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const { N, indptr, indices, weights } = sub;
  // sign per presynaptic neuron (EXC_SIGN table, stored at extraction)
  const signOf = i => sub.sign[i];
  const degs = [];
  for (let i = 0; i < N; i++) degs.push({ i, d: indptr[i + 1] - indptr[i], s: signOf(i) });
  // bucket by (sign, degree) -- degree-matched by construction
  const buckets = new Map();
  for (const x of degs) {
    const key = x.s + '|' + x.d;
    (buckets.get(key) || buckets.set(key, []).get(key)).push(x.i);
  }
  const nidx = new Uint32Array(indices.length), nwts = new Uint16Array(weights.length);
  // for each bucket, gather all edges and redistribute their targets+weights across members
  for (const members of buckets.values()) {
    const edges = [];
    for (const i of members) for (let k = indptr[i]; k < indptr[i + 1]; k++) edges.push([indices[k], weights[k]]);
    // shuffle edges, then deal each member exactly its own degree -- same multiset of synapses,
    // same degrees, different wiring
    for (let k = edges.length - 1; k > 0; k--) { const j = (rnd() * (k + 1)) | 0; [edges[k], edges[j]] = [edges[j], edges[k]]; }
    let at = 0;
    for (const i of members) {
      const d = indptr[i + 1] - indptr[i];
      for (let k = 0; k < d; k++) { const e = edges[at++]; nidx[indptr[i] + k] = e[0]; nwts[indptr[i] + k] = e[1]; }
    }
  }
  return { ...sub, indices: nidx, weights: nwts, scrambled: seed };
}

/** Load the frozen artifact written by scripts/prep_vnc_subgraph.mjs. The edge set in that file is
 *  the value the fit is audited against; re-extraction is for regeneration, not consumption. */
export function loadSubgraphArtifact(file) {
  const a = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Buffer.from reuses a pool: its .buffer is larger than the decoded bytes. Slice by offset.
  const un = (s, T) => { const b = Buffer.from(s, 'base64'); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  return {
    N: a.counts.N, E: a.counts.E,
    indptr: un(a.csr.indptr, Uint32Array), indices: un(a.csr.indices, Uint32Array),
    weights: un(a.csr.weights, Uint16Array), nt: un(a.nodes.nt, Uint8Array),
    sign: un(a.nodes.sign, Float32Array), sc: un(a.nodes.sc, Uint8Array),
    cls: null, side: un(a.nodes.side, Uint8Array), types: a.nodes.types,
    role: un(a.nodes.role, Uint8Array), origIdx: un(a.nodes.origIdx, Int32Array),
    excised: un(a.nodes.excised, Uint8Array), isBoundary: un(a.nodes.isBoundary, Uint8Array),
    sizeArr: un(a.nodes.sizeArr, Float32Array),
    mn: a.mn, dn: a.dn, sensors: a.sensors,
    meta: { superclasses: [], classes: [], nts: [] },
    sha256: a.sha256,
  };
}
