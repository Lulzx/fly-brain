// The reference the Bend cord kernel is gated against (docs/46-cord-ir.md).
//
//   node scripts/cord_kernel_ref.mjs [--steps=1000] [--seed=1]
//
// Builds the cord subgraph's compiled brain with the shipped code path -- `brainScales`,
// `modulatorySign` and `writeGraph` over the full connectome, then restricted to the cord's
// cells -- runs the shipped WebAssembly kernel `lif_step` for `steps`, and writes
// public/data/cord_kernel.bin: the float32 constants the header carries, the compiled weights
// and signs, the drive, and the answer (spikes fired per step, and spikes per neuron).
//
// The Bend kernel reads that file, runs its own port of `lif_step`, and must reproduce the
// answer exactly. The compiled weights are handed over rather than recomputed because
// `writeGraph` multiplies in double and rounds once at the end, which float32 arithmetic
// cannot reproduce; what Bend checks about the compile is the part that is exact -- which
// edges are cut -- against `connectome.bend`'s `Compile.syn`.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { LIFWasm, writeGraph, graphBytes, brainBytes } from '../src/lifwasm.js';
import { brainScales, modulatorySign, BRAIN_DEFAULTS } from '../src/brainmodel.js';
import { DEFAULTS } from '../src/lif.js';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? +a.slice(k.length + 3) : d; };
const STEPS = arg('steps', 1000), SEED = arg('seed', 1);
const sarg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ABLATE = sarg('ablate', ''), OUT = sarg('out', 'public/data/cord_kernel.bin');

// ---------------------------------------------------------------- the cord IR
export function loadCord(file = 'public/data/cord_ir.bin', desc = 'public/data/cord_ir.json') {
  const d = JSON.parse(fs.readFileSync(desc)), b = fs.readFileSync(file);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const at = (name, T) => { const L = d.layout[name]; return new T(ab, L.off, L.n); };
  const N = d.counts.N, E = d.counts.E;
  const gaps = at('gaps', Uint32Array), indptr = at('indptr', Uint32Array);
  const indices = new Uint32Array(E);
  for (let k = 0; k < N; k++) { let prev = -1; for (let e = indptr[k]; e < indptr[k + 1]; e++) { prev = prev + gaps[e] + 1; indices[e] = prev; } }
  const sets = {};
  const setPtr = at('setPtr', Uint32Array), setIdx = at('setIdx', Uint32Array);
  d.sets.forEach((s, i) => { sets[s.name] = setIdx.subarray(setPtr[i], setPtr[i + 1]); });
  return { desc: d, N, E, indptr, indices, gaps, weights: at('counts', Uint16Array), edgeClass: at('edgeClass', Uint8Array),
    origIdx: at('origIdx', Uint32Array), role: at('role', Uint8Array), nt: at('nt', Uint8Array), side: at('side', Uint8Array),
    hl: at('hl', Uint8Array), sign: at('sign', Float32Array), size: at('size', Float32Array), sets };
}

/** brain parameters, merged the way the shipped build merges them */
export function cordParams() {
  const bp = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  return { ...DEFAULTS, ...BRAIN_DEFAULTS, ...bp };
}

/** the cord's compiled sign and per-target input scale, taken from the full-connectome build */
export function cordScales(cord, p) {
  const D = loadAll();
  const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
  const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
  const { inScale, sensoryMask } = brainScales(D, size, p);
  const csign = modulatorySign(D, sign, p);
  const N = cord.N;
  const cInScale = new Float32Array(N), cMask = new Uint8Array(N), cSign = new Float32Array(N);
  for (let k = 0; k < N; k++) { const o = cord.origIdx[k]; cInScale[k] = inScale[o]; cMask[k] = sensoryMask[o]; cSign[k] = csign[o]; }
  return { inScale: cInScale, sensoryMask: cMask, sign: cSign };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cord = loadCord(), p = cordParams();
  if (p.depU !== 0) throw new Error(`the Bend kernel assumes depU = 0, got ${p.depU}`);
  const { inScale, sensoryMask, sign } = cordScales(cord, p);
  const N = cord.N, E = cord.E;
  // the sensory-role partition must be exactly the superclass sensory mask the brain build uses
  let maskDiff = 0; for (let k = 0; k < N; k++) if (!!sensoryMask[k] !== (cord.role[k] === 3)) maskDiff++;
  if (maskDiff) throw new Error(`${maskDiff} cells disagree between role==3 and the brain build's sensory mask`);

  const data = { N, E, indptr: cord.indptr, indices: cord.indices, weights: cord.weights, nt: cord.nt };
  const gb = graphBytes(N, E), bb = brainBytes(N);
  const memory = new WebAssembly.Memory({ initial: Math.ceil((gb + bb + (1 << 20)) / 65536), maximum: Math.ceil((gb + bb + (1 << 20)) / 65536), shared: true });
  const { instance } = await WebAssembly.instantiate(fs.readFileSync('public/lif.wasm'), { env: { memory } });
  const graph = writeGraph(memory, 1024, data, p, inScale, sensoryMask, sign, null);
  const brain = new LIFWasm({ instance, memory, graph, base: (graph.end + 63) & ~63, N, params: p, seed: SEED });

  // drive: the descending command, and the proprioceptors that report the legs' own state
  const drive = new Float32Array(N);
  for (const i of cord.sets['role:descending']) drive[i] = 60;
  for (const i of cord.sets['sensory:proprioceptive']) drive[i] = 20;
  const driven = [];
  for (let i = 0; i < N; i++) if (drive[i] > 0) driven.push(i);
  brain.setDrive(Int32Array.from(driven), 0);
  for (const i of driven) brain.setDriveOne(i, drive[i]);

  // ablation, the way the arena backend does it: the cells are silenced by threshold
  const alive = new Uint32Array(N).fill(1);
  if (ABLATE) {
    const set = cord.sets[ABLATE];
    if (!set) throw new Error(`no named set '${ABLATE}' (known: ${Object.keys(cord.sets).join(', ')})`);
    for (const i of set) { brain.setThr(i, 1e6); alive[i] = 0; }
    console.log(`ablated ${ABLATE}: ${set.length} cells silenced by threshold`);
  }

  const fired = new Uint32Array(STEPS);
  const t0 = Date.now();
  for (let s = 0; s < STEPS; s++) fired[s] = brain.step().length;
  const ms = Date.now() - t0;
  const spikes = Uint32Array.from(brain.spikeCount);
  let total = 0; for (const f of fired) total += f;

  const W = new Float32Array(memory.buffer, graph.weights, E);
  const SG = new Float32Array(memory.buffer, graph.sign, N);
  let cut = 0; for (let k = 0; k < E; k++) if (W[k] === 0) cut++;

  const HDRN = 16, CONSTS = 16;
  const consts = Float32Array.from([p.dt, p.vRest, p.vThresh, p.vReset, p.tRef, p.adaptInc, p.depU,
    Math.exp(-p.dt / p.tauSyn), Math.exp(-p.dt / p.adaptTau), p.dt / p.depTau, p.dt / p.tauM, p.dt / 1000,
    p.eExc, p.eInh, 1 / (p.eExc - p.vRest), 1 / (p.vRest - p.eInh)]);
  const bytes = 4 * HDRN + 4 * CONSTS + 4 * E + 4 * N + 4 * N + 4 * N + 4 * driven.length + 4 * STEPS + 4 * N;
  const buf = Buffer.alloc(bytes); let o = 0;
  const u = v => { buf.writeUInt32LE(v >>> 0, o); o += 4; };
  u(0x4b44524f); u(1); u(N); u(E); u(STEPS); u(driven.length); u(brain._seed); u(brain.nslots);
  u(cut); u(0); u(0); u(0); u(0); u(0); u(0); u(0);
  const put = (a, T) => { Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(buf, o); o += a.byteLength; };
  put(consts); put(W); put(SG); put(drive); put(alive); put(Uint32Array.from(driven)); put(fired); put(spikes);
  if (o !== bytes) throw new Error(`layout: wrote ${o} of ${bytes}`);
  fs.writeFileSync(OUT, buf);

  console.log(`${OUT}: ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(`N=${N} E=${E} cut=${cut} (${(100 * cut / E).toFixed(1)}%) driven=${driven.length} nslots=${brain.nslots} seed=${brain._seed}`);
  console.log(`${STEPS} steps in ${ms} ms, ${total} spikes, ${(total / STEPS).toFixed(1)} per step`);
  console.log(`fired[0..7] = ${Array.from(fired.subarray(0, 8)).join(' ')}`);
  let nz = 0; for (const s of spikes) if (s) nz++;
  console.log(`neurons that spiked: ${nz} of ${N}`);
  const B = 4 * HDRN + 4 * CONSTS + 4 * E;
  console.log(`offsets consts=${4 * HDRN} weights=${4 * HDRN + 4 * CONSTS} sign=${B} drive=${B + 4 * N} alive=${B + 8 * N} driven=${B + 12 * N} fired=${B + 12 * N + 4 * driven.length} spikes=${B + 12 * N + 4 * driven.length + 4 * STEPS} total=${bytes}`);
}
