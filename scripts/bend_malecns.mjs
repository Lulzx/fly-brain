// The JavaScript side of the Bend formalization (docs/45-bend-formalization.md).
//
//   node scripts/bend_malecns.mjs prep     # write public/data/cellflags.bin for malecns.bend
//   node scripts/bend_malecns.mjs expect   # the numbers the shipped brain build produces
//   node scripts/bend_malecns.mjs check    # build + run ./malecns and compare, line by line
//
// `expect` computes, with the code the browser and the node scripts use (brainScales,
// modulatorySign, writeGraph's edge rule), the same summary malecns.bend prints from the
// proven functions; `check` diffs the two. Integer keys must agree exactly; the three
// regional medians are float32 and are compared to 1e-6.
import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { loadAll } from './lib_node.mjs';
import { BRAIN_DEFAULTS, brainScales, modulatorySign } from '../src/brainmodel.js';
import { regionSizeRef, REGION_OF } from '../src/ratenet.js';
import { isOctopaminergic } from '../src/sim/neuromod.js';

const FLAGS = 'public/data/cellflags.bin';
const cmd = process.argv[2] || 'check';

function params() {
  const bp = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
  const o = { ...BRAIN_DEFAULTS, ...bp };
  return { minSyn: o.minSyn, neuromod: !!o.neuromod, preInh: (o.preInh || 0) > 0, kcThreshold: o.kcThreshold, laminaBias: o.laminaBias,
    inhGain: o.inhGain, wSyn: o.wSyn, sizeAlpha: o.sizeAlpha, maxSizeScale: o.maxSizeScale, boostCap: o.boostCap };
}

function flagsOf(data) {
  const { meta, N, cls, sc } = data, types = meta.types, classes = meta.classes, scn = meta.superclasses;
  const f = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const s = scn[sc[i]];
    f[i] = (/sensory/.test(s) ? 1 : 0) | (/motor|efferent|endocrine/.test(s) ? 2 : 0) | (classes[cls[i]] === 'Kenyon_Cell' ? 4 : 0)
      | (/^L[1-5]$/.test(types[i]) ? 8 : 0) | (isOctopaminergic(types[i]) ? 16 : 0) | (REGION_OF(s) << 5);
  }
  return f;
}

function expected() {
  const data = loadAll(); const { N, E, indptr, indices, weights, sc, cls } = data;
  const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
  const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
  const p = params(); const o = { ...BRAIN_DEFAULTS, ...p, neuromod: p.neuromod };
  const flags = flagsOf(data);
  const { inScale, sensoryMask } = brainScales(data, size, o);
  const { medians } = regionSizeRef(data.meta.superclasses, sc, size);
  const csign = modulatorySign(data, sign, o);
  const out = {};
  out.param_minSyn = p.minSyn; out.param_neuromod = p.neuromod ? 'True' : 'False'; out.param_preInh = p.preInh ? 'True' : 'False';
  out.param_kcThreshold = p.kcThreshold; out.param_laminaBias = p.laminaBias; out.param_inhGain = p.inhGain; out.param_sizeAlpha = p.sizeAlpha;
  out.f32_one = 1;
  out.graph_bytes = fs.statSync('public/data/graph_w3.bin').size; out.graph_bytes_expected = 8 + 4 * (N + 1) + 4 * E + 2 * E;
  out.neurons_bytes = fs.statSync('public/data/neurons.bin').size; out.neurons_bytes_expected = 8 + 33 * N;
  out.header_n = N; out.header_e = E; out.cells = N;
  // the flag bits that the Bend loader re-derives from the code tables
  let consistent = true;
  for (let i = 0; i < N; i++) {
    const s = data.meta.superclasses[sc[i]];
    if (((flags[i] & 1) !== 0) !== /sensory/.test(s) || ((flags[i] >> 5) & 3) !== REGION_OF(s) || ((flags[i] & 4) !== 0) !== (data.meta.classes[cls[i]] === 'Kenyon_Cell')) consistent = false;
  }
  out.flags_consistent = consistent ? 'True' : 'False';
  out.median_optic = medians[0]; out.median_central = medians[1]; out.median_cord = medians[2];
  const c = { exc: 0, inh: 0, mod: 0, kc: 0, lam: 0, oa: 0, sens: 0, motor: 0, one: 0, zero: 0 };
  for (let i = 0; i < N; i++) {
    if (csign[i] > 0) c.exc++; else if (csign[i] < 0) c.inh++; else c.mod++;
    if (flags[i] & 4) c.kc++; if (flags[i] & 8) c.lam++; if (flags[i] & 16) c.oa++; if (flags[i] & 1) c.sens++; if (flags[i] & 2) c.motor++;
    if (inScale[i] === 1) c.one++; if (!(size[i] > 0)) c.zero++;
  }
  out.cells_exc = c.exc; out.cells_inh = c.inh; out.cells_mod = c.mod; out.cells_kenyon = c.kc; out.cells_lamina = c.lam; out.cells_oa = c.oa;
  out.cells_sensory = c.sens; out.cells_motor = c.motor; out.cells_scale_one = c.one; out.cells_size_zero = c.zero;
  let ipOk = indptr[0] === 0; for (let i = 1; i <= N; i++) if (indptr[i] < indptr[i - 1]) ipOk = false;
  out.indptr_ok = ipOk ? 'True' : 'False'; out.indptr_last = indptr[N];
  // writeGraph's rule (src/lifwasm.js): keep = !sensory[q] || (preInh > 0 && s < 0); w = (c >= minSyn && keep) ? ... : 0
  let kept = 0, cutMin = 0, cutSens = 0, keptSyn = 0, self = 0, rowsOk = true, edges = 0;
  for (let j = 0; j < N; j++) {
    const s = csign[j], keep = p.preInh && s < 0; let prev = -1;
    for (let k = indptr[j]; k < indptr[j + 1]; k++) {
      const q = indices[k], cnt = weights[k]; edges++;
      if (q === j) self++;
      if (!(q > prev) || q >= N || cnt < 3) rowsOk = false; prev = q;
      if (sensoryMask[q] && !keep) cutSens++; else if (cnt >= p.minSyn) { kept++; keptSyn += cnt; } else cutMin++;
    }
  }
  out.rows = N; out.edges = edges; out.rows_ok = rowsOk ? 'True' : 'False'; out.self_loops = self;
  out.edges_kept = kept; out.edges_cut_min = cutMin; out.edges_cut_sensory = cutSens; out.kept_synapses = keptSyn;
  return { out, flags };
}

if (cmd === 'prep') {
  const data = loadAll(); fs.writeFileSync(FLAGS, flagsOf(data)); console.log(`wrote ${FLAGS} (${data.N} bytes)`);
} else if (cmd === 'expect') {
  const { out } = expected(); for (const [k, v] of Object.entries(out)) console.log(`${k} ${v}`);
} else if (cmd === 'check') {
  const { out, flags } = expected();
  if (!fs.existsSync(FLAGS) || Buffer.compare(fs.readFileSync(FLAGS), Buffer.from(flags)) !== 0) { fs.writeFileSync(FLAGS, flags); console.log(`wrote ${FLAGS}`); }
  const srcs = ['malecns.bend', 'connectome.bend', 'dataset.bend'];
  const stale = !fs.existsSync('malecns') || srcs.some(f => fs.statSync(f).mtimeMs > fs.statSync('malecns').mtimeMs);
  if (stale) { console.log('building ./malecns'); execSync('bend malecns.bend -o malecns', { stdio: 'inherit' }); }
  const t0 = Date.now();
  const run = spawnSync('./malecns', [], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.status !== 0) { console.error(run.stdout, run.stderr); process.exit(1); }
  const got = {}; for (const line of run.stdout.split('\n')) { const m = line.match(/^(\S+) (\S+)$/); if (m) got[m[1]] = m[2]; }
  let fail = 0;
  const FLOAT = new Set(['median_optic', 'median_central', 'median_cord', 'param_kcThreshold', 'param_laminaBias', 'param_inhGain', 'param_sizeAlpha', 'f32_one']);
  for (const [k, v] of Object.entries(out)) {
    const g = got[k]; let ok;
    if (g === undefined) ok = false;
    else if (FLOAT.has(k)) ok = Math.abs(parseFloat(g) - v) <= 1e-6 * Math.max(1, Math.abs(v));
    else ok = String(g) === String(v);
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${k.padEnd(24)} bend=${String(g).padEnd(14)} js=${v}`);
  }
  console.log(`bend ${got.ms_total ?? '?'} ms (cells ${got.ms_cells ?? '?'} ms); node wall ${Date.now() - t0} ms incl. run`);
  console.log(fail ? `${fail} mismatches` : 'all keys agree');
  process.exit(fail ? 1 : 0);
} else {
  console.error('usage: node scripts/bend_malecns.mjs prep|expect|check'); process.exit(2);
}
