// Emit the cord IR: the VNC leg-premotor subgraph in the form the Bend compiler reads
// (docs/46-cord-ir.md). One binary value, delta-encoded, with the named sets the perturbation
// laws act on, plus a JSON descriptor carrying the names and the hash.
//
//   node scripts/prep_cord_ir.mjs [--out=public/data/cord_ir]
//
// Rows are stored as gaps, not targets: row k's j-th entry sits at
// post_0 = gap_0 and post_{j+1} = post_j + gap_{j+1} + 1. A gap list cannot express a
// descending or duplicated target, so "the rows are sorted and duplicate-free" stops being a
// property to check and becomes a property of the representation — which is what makes the
// preservation theorem in LAWS.bend structural (docs/46).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadAll } from './lib_node.mjs';
import { extractVncSubgraph, LOCOMOTION_DN_TYPES } from '../src/vnc/subgraph.js';
import { hemilineagesOf } from '../src/exp/select.js';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'public/data/cord_ir');

// the six leg motor pools, in the gait instrument's order (src/exp/gait.js LEG_ORDER)
export const LEG_ORDER = ['T1_left', 'T2_left', 'T3_left', 'T1_right', 'T2_right', 'T3_right'];
// the three GABAergic premotor hemilineages the walking programme names (docs/44)
export const HEMILINEAGES = ['13A', '13B', '19B'];

const D = loadAll();
const sub = extractVncSubgraph(D);
const N = sub.N, E = sub.E;
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));

// ---------------------------------------------------------------- delta encoding
const gaps = new Uint32Array(E), counts = new Uint16Array(E);
let maxGap = 0;
for (let k = 0; k < N; k++) {
  let prev = -1;
  for (let e = sub.indptr[k]; e < sub.indptr[k + 1]; e++) {
    const post = sub.indices[e];
    if (post <= prev) throw new Error(`row ${k}: targets are not strictly ascending (${prev} -> ${post})`);
    const g = post - prev - 1; gaps[e] = g; counts[e] = sub.weights[e];
    if (g > maxGap) maxGap = g;
    prev = post;
  }
}

// ---------------------------------------------------------------- per-node tables
// hemilineage bits: 1 = 13A, 2 = 13B, 4 = 19B
const hl = new Uint8Array(N);
for (let k = 0; k < N; k++) {
  const hs = hemilineagesOf(String(sub.types[k]));
  for (let b = 0; b < HEMILINEAGES.length; b++) if (hs.includes(HEMILINEAGES[b])) hl[k] |= 1 << b;
}
const nsign = new Float32Array(N), nsize = new Float32Array(N);
for (let k = 0; k < N; k++) { const o = sub.origIdx[k]; nsign[k] = sign[o]; nsize[k] = size[o]; }

// ---------------------------------------------------------------- edge classes
// bit 0: commissural -- a midline-crossing synapse between two cord interneurons, the class the
// sibling programme's alternation route acts on (docs/44).
const SCN = D.meta.superclasses;
const isIntrinsic = k => SCN[sub.sc[k]] === 'vnc_intrinsic';
const edgeClass = new Uint8Array(E);
let nCommissural = 0;
for (let k = 0; k < N; k++) {
  const si = sub.side[k], pre = isIntrinsic(k);
  for (let e = sub.indptr[k]; e < sub.indptr[k + 1]; e++) {
    const j = sub.indices[e], sj = sub.side[j];
    if (pre && isIntrinsic(j) && (si === 1 || si === 2) && (sj === 1 || sj === 2) && si !== sj) { edgeClass[e] |= 1; nCommissural++; }
  }
}

// ---------------------------------------------------------------- named sets
const sets = [];
const legOf = m => { const t = /\bT([123])\b/.exec(m.muscle), s = /\b(left|right)\b/.exec(m.muscle) || /_(left|right)$/.exec(m.actuator || ''); return t && s ? `T${t[1]}_${s[1]}` : null; };
const pools = Object.fromEntries(LEG_ORDER.map(l => [l, new Set()]));
for (const m of sub.mn) { const l = legOf(m); if (l) pools[l].add(m.sub); }
for (const l of LEG_ORDER) sets.push({ name: `pool:${l}`, idx: [...pools[l]].sort((a, b) => a - b) });
for (let b = 0; b < HEMILINEAGES.length; b++) {
  const o = []; for (let k = 0; k < N; k++) if (hl[k] & (1 << b)) o.push(k);
  sets.push({ name: `hemilineage:${HEMILINEAGES[b]}`, idx: o });
}
for (const t of LOCOMOTION_DN_TYPES) {
  const o = []; for (let k = 0; k < N; k++) if (String(sub.types[k]) === t) o.push(k);
  if (o.length) sets.push({ name: `dn:${t}`, idx: o });
}
{ const o = []; for (let k = 0; k < N; k++) if (sub.role[k] === 1) o.push(k); sets.push({ name: 'role:motor', idx: o }); }
{ const o = []; for (let k = 0; k < N; k++) if (sub.role[k] === 2) o.push(k); sets.push({ name: 'role:descending', idx: o }); }
{ const o = []; for (let k = 0; k < N; k++) if (sub.role[k] === 3) o.push(k); sets.push({ name: 'role:sensory', idx: o }); }
{ // proprioceptors: the sensor sets the bodymap marks as proprioceptive that live in the subgraph
  const o = new Set();
  for (const [name, s] of Object.entries(sub.sensors)) if (/proprio|chordotonal|hair_plate|campaniform|club|claw|hook/i.test(name + ' ' + (s.kind || ''))) for (const i of s.idx) o.add(i);
  sets.push({ name: 'sensory:proprioceptive', idx: [...o].sort((a, b) => a - b) });
}
for (const s of sets) if (!s.idx.length) throw new Error(`named set '${s.name}' is empty`);

// ---------------------------------------------------------------- pack
const setPtr = new Uint32Array(sets.length + 1);
for (let i = 0; i < sets.length; i++) setPtr[i + 1] = setPtr[i] + sets[i].idx.length;
const setIdx = new Uint32Array(setPtr[sets.length]);
{ let at = 0; for (const s of sets) for (const i of s.idx) setIdx[at++] = i; }

const HDR = 32;
const parts = [
  ['origIdx', Uint32Array.from(sub.origIdx)], ['indptr', Uint32Array.from(sub.indptr)],
  ['gaps', gaps], ['counts', counts], ['edgeClass', edgeClass],
  ['role', sub.role], ['nt', sub.nt], ['side', sub.side], ['hl', hl],
  ['sign', nsign], ['size', nsize], ['setPtr', setPtr], ['setIdx', setIdx],
];
const pad4 = n => (n + 3) & ~3;
let total = HDR, layout = {};
for (const [name, a] of parts) { layout[name] = { off: total, bytes: a.byteLength, n: a.length }; total = pad4(total + a.byteLength); }
const buf = Buffer.alloc(total);
buf.writeUInt32LE(0x44524f43, 0); buf.writeUInt32LE(1, 4);
buf.writeUInt32LE(N, 8); buf.writeUInt32LE(E, 12); buf.writeUInt32LE(D.N, 16);
buf.writeUInt32LE(sets.length, 20); buf.writeUInt32LE(LEG_ORDER.length, 24); buf.writeUInt32LE(maxGap, 28);
for (const [name, a] of parts) Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(buf, layout[name].off);
fs.writeFileSync(`${out}.bin`, buf);

const roles = [0, 0, 0, 0]; for (let k = 0; k < N; k++) roles[sub.role[k]]++;
const desc = {
  version: 1,
  spec: 'cord IR: VNC leg-premotor subgraph (leg MNs + 2-hop VNC/descending ancestors), rows delta-encoded',
  counts: { N, E, Nfull: D.N, interneuron: roles[0], motor: roles[1], descending: roles[2], sensory: roles[3], commissural: nCommissural, maxGap },
  header: { magic: 'CORD', bytes: HDR, fields: ['magic', 'version', 'N', 'E', 'Nfull', 'nSets', 'nPools', 'maxGap'] },
  layout, legOrder: LEG_ORDER, hemilineages: HEMILINEAGES,
  sets: sets.map((s, i) => ({ name: s.name, from: setPtr[i], to: setPtr[i + 1], n: s.idx.length })),
  bin: { file: `${out.split('/').pop()}.bin`, bytes: total, sha256: crypto.createHash('sha256').update(buf).digest('hex') },
};
fs.writeFileSync(`${out}.json`, JSON.stringify(desc, null, 1));
console.log(`${out}.bin: ${(total / 1e6).toFixed(2)} MB, N=${N} E=${E}, roles int/mn/dn/sens=${roles.join('/')}`);
console.log(`commissural edges ${nCommissural}, max gap ${maxGap}, sets ${sets.length}, sha ${desc.bin.sha256.slice(0, 12)}`);
for (const s of desc.sets) console.log(`  ${s.name.padEnd(28)} ${s.n}`);
