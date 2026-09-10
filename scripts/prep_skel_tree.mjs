// Raw neuroglancer skeletons (data/skeletons/<bodyId>) -> public/data/skeletons.flys (FLYS v2).
// Per neuron: spanning tree rooted at the vertex nearest the soma (cycles broken), fragments shorter
// than PRUNE dropped, terminal twigs shorter than PRUNE removed (PASSES rounds), unbranched runs
// simplified with Douglas-Peucker to EPS, coordinates snapped to a RES grid.
// Usage: node --max-old-space-size=16000 scripts/prep_skel_tree.mjs [PRUNE_um=20] [EPS_nm=2000] [RES_nm=700] [PASSES=2]
import fs from 'fs';
import { encodeSkel, decodeSkel } from '../src/codec/skel.js';
const [PRUNE = 20, EPS = 2000, RES = 700, PASSES = 2] = process.argv.slice(2).map(Number);
const L = PRUNE * 1000, meta = JSON.parse(fs.readFileSync('public/data/meta.json')), N = meta.N;
const nb = new Uint8Array(fs.readFileSync('public/data/neurons.bin')).buffer;
const bodyIds = new BigInt64Array(nb, 8, N), soma = new Float32Array(nb, 8 + N * 8, N * 3);

function readRaw(path) {
  if (!fs.existsSync(path)) return null;
  const b = new Uint8Array(fs.readFileSync(path)).buffer; if (b.byteLength < 8) return null;
  const [nv, ne] = new Uint32Array(b, 0, 2); if (!nv) return null;
  return { nv, ne, v: new Float32Array(b, 8, nv * 3), e: new Uint32Array(b, 8 + nv * 12, ne * 2) };
}
const dist = (v, a, b) => Math.hypot(v[a * 3] - v[b * 3], v[a * 3 + 1] - v[b * 3 + 1], v[a * 3 + 2] - v[b * 3 + 2]);

// Douglas-Peucker over chain[] (vertex ids), marks keep[] for interior vertices that must stay
function rdp(v, chain, keep) {
  const st = [0, chain.length - 1];
  while (st.length) {
    const b = st.pop(), a = st.pop(); if (b <= a + 1) continue;
    const A = chain[a], B = chain[b], dx = v[B * 3] - v[A * 3], dy = v[B * 3 + 1] - v[A * 3 + 1], dz = v[B * 3 + 2] - v[A * 3 + 2], LL = Math.hypot(dx, dy, dz);
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const P = chain[i], px = v[P * 3] - v[A * 3], py = v[P * 3 + 1] - v[A * 3 + 1], pz = v[P * 3 + 2] - v[A * 3 + 2];
      const d = LL > 0 ? Math.hypot(py * dz - pz * dy, pz * dx - px * dz, px * dy - py * dx) / LL : Math.hypot(px, py, pz);
      if (d > best) { best = d; bi = i; }
    }
    if (best > EPS) { keep[chain[bi]] = 1; st.push(a, bi, bi, b); }
  }
}

function processNeuron(r, sx, sy, sz) {
  const { nv, ne, v, e } = r;
  // undirected CSR
  const deg = new Uint32Array(nv + 1);
  for (let i = 0; i < ne; i++) { const a = e[2 * i], b = e[2 * i + 1]; if (a !== b) { deg[a + 1]++; deg[b + 1]++; } }
  for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
  const adj = new Uint32Array(deg[nv]), fill = deg.slice(0, nv);
  for (let i = 0; i < ne; i++) { const a = e[2 * i], b = e[2 * i + 1]; if (a !== b) { adj[fill[a]++] = b; adj[fill[b]++] = a; } }
  // root: nearest vertex to soma
  let root = 0;
  if (Number.isFinite(sx)) { let bd = Infinity; for (let i = 0; i < nv; i++) { const d = (v[i * 3] - sx) ** 2 + (v[i * 3 + 1] - sy) ** 2 + (v[i * 3 + 2] - sz) ** 2; if (d < bd) { bd = d; root = i; } } }
  // BFS spanning forest; order[] lists vertices parents-first
  const parent = new Int32Array(nv).fill(-2), order = new Uint32Array(nv), comps = [];
  let no = 0;
  for (let s0 = -1; s0 < nv; s0++) {
    const s = s0 < 0 ? root : s0; if (parent[s] !== -2) continue;
    const start = no; parent[s] = -1; order[no++] = s; let len = 0;
    for (let h = start; h < no; h++) { const x = order[h]; for (let j = deg[x]; j < deg[x + 1]; j++) { const y = adj[j]; if (parent[y] === -2) { parent[y] = x; order[no++] = y; len += dist(v, x, y); } } }
    comps.push({ start, end: no, len });
  }
  const alive = new Uint8Array(nv), nkids = new Uint32Array(nv);
  const maxLen = Math.max(...comps.map(c => c.len));
  for (const c of comps) if (c.len >= L || c.len === maxLen) for (let h = c.start; h < c.end; h++) alive[order[h]] = 1;
  for (let i = 0; i < nv; i++) if (alive[i] && parent[i] >= 0) nkids[parent[i]]++;
  // twig pruning: a leaf's run up to the nearest branch point is removed if shorter than L
  for (let pass = 0; pass < PASSES; pass++) {
    let changed = false;
    for (let h = no - 1; h >= 0; h--) {
      const leaf = order[h]; if (!alive[leaf] || nkids[leaf] !== 0 || parent[leaf] < 0) continue;
      let x = leaf, len = 0;
      while (parent[x] >= 0 && nkids[parent[x]] === 1) { len += dist(v, x, parent[x]); x = parent[x]; }
      const j = parent[x]; if (j < 0) continue;          // unbranched all the way to the root: keep
      len += dist(v, x, j);
      if (len >= L) continue;
      for (let y = leaf; y !== j; y = parent[y]) alive[y] = 0;
      nkids[j]--; changed = true;
    }
    if (!changed) break;
  }
  // keep roots, branch points, leaves, and Douglas-Peucker points of each unbranched run
  const keep = new Uint8Array(nv), kids = [];
  for (let i = 0; i < nv; i++) if (alive[i] && (parent[i] < 0 || nkids[i] !== 1)) keep[i] = 1;
  for (let h = 0; h < no; h++) {
    const x = order[h]; if (!alive[x] || !keep[x] || parent[x] < 0 && nkids[x] === 0) continue;
    // walk down each child's run to the next kept vertex (runs are unbranched: nkids == 1)
    for (let j = deg[x]; j < deg[x + 1]; j++) {
      let y = adj[j]; if (parent[y] !== x || !alive[y]) continue;
      const chain = [x, y];
      while (!keep[y]) { let nx = -1; for (let t = deg[y]; t < deg[y + 1]; t++) if (parent[adj[t]] === y && alive[adj[t]]) nx = adj[t]; y = nx; chain.push(y); }
      rdp(v, chain, keep);
    }
  }
  // emit kept vertices in DFS preorder per tree; parent = nearest kept ancestor
  const trees = [];
  const kparent = new Int32Array(nv).fill(-1), kchildren = new Map();
  for (let h = 0; h < no; h++) {
    const x = order[h]; if (!alive[x] || !keep[x]) continue;
    let p = parent[x]; while (p >= 0 && !keep[p]) p = parent[p];
    kparent[x] = p; if (p >= 0) { if (!kchildren.has(p)) kchildren.set(p, []); kchildren.get(p).push(x); }
  }
  for (let h = 0; h < no; h++) {
    const s = order[h]; if (!alive[s] || !keep[s] || kparent[s] >= 0) continue;
    const xyz = [], kidsArr = [], st = [s];
    while (st.length) { const x = st.pop(), ch = kchildren.get(x) || []; xyz.push(v[x * 3], v[x * 3 + 1], v[x * 3 + 2]); kidsArr.push(ch.length); for (let c = ch.length - 1; c >= 0; c--) st.push(ch[c]); }
    trees.push({ xyzf: Float32Array.from(xyz), kids: Uint32Array.from(kidsArr) });
  }
  return trees;
}

const t0 = performance.now(); const neurons = []; let rawV = 0, outV = 0, missing = 0;
const lo = [Infinity, Infinity, Infinity];
for (let n = 0; n < N; n++) {
  const r = readRaw(`data/skeletons/${bodyIds[n]}`);
  if (!r) { neurons.push([]); missing++; continue; }
  rawV += r.nv;
  const trees = processNeuron(r, soma[n * 3] * 8, soma[n * 3 + 1] * 8, soma[n * 3 + 2] * 8);
  for (const t of trees) { outV += t.kids.length; for (let i = 0; i < t.xyzf.length; i++) if (t.xyzf[i] < lo[i % 3]) lo[i % 3] = t.xyzf[i]; }
  neurons.push(trees);
  if (n % 20000 === 0) console.log(n, `raw ${(rawV / 1e6).toFixed(1)}M -> ${(outV / 1e6).toFixed(2)}M vertices, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
const bmin = lo.map(x => Math.floor(x) - RES);
for (const trees of neurons) for (const t of trees) { t.xyz = new Int32Array(t.xyzf.length); for (let i = 0; i < t.xyz.length; i++) t.xyz[i] = Math.round((t.xyzf[i] - bmin[i % 3]) / RES); delete t.xyzf; }
const bytes = encodeSkel(neurons, bmin, RES);
console.log(`PRUNE ${PRUNE} µm, EPS ${EPS} nm, RES ${RES} nm: ${(rawV / 1e6).toFixed(1)}M raw -> ${(outV / 1e6).toFixed(2)}M vertices (${missing} neurons without skeleton), ${(bytes.length / 1e6).toFixed(2)} MB, ${(bytes.length * 8 / outV).toFixed(2)} bits/vertex`);
// verify: decoded grid positions equal the encoded ones
let t = performance.now(); const dec = decodeSkel(bytes); console.log(`decode ${((performance.now() - t) / 1000).toFixed(2)} s`);
let bad = 0, i = 0;
for (const trees of neurons) for (const tr of trees) for (let j = 0; j < tr.xyz.length; j++, i++) if (Math.abs(dec.pos[i] - (bmin[i % 3] + tr.xyz[j] * RES) / 1000) > 1e-3) bad++;
console.log(`verify: V ${dec.V} === ${outV}: ${dec.V === outV}, position mismatches ${bad}`);
if (bad || dec.V !== outV) process.exit(1);
fs.writeFileSync(process.env.OUT || 'public/data/skeletons.flys', bytes);
