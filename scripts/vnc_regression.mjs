// Regression tests for the S2 VNC-readout pipeline (docs/39). The failure modes that produced a
// plausible-looking dead model instead of an error:
//   1. Int32Array.map truncating picked physiology to integers (inScale 0.55 -> 0).
//   2. Buffer.from(b64).buffer returning the whole decode pool, not the decoded slice.
//   3. Forced spike-train replay never delivering conductance downstream.
// Plus the deployment contract: neuronGainTable must reach typeGains' outScale, and a fitted
// gain must measurably change a forced-replay forward pass.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { extractVncSubgraph, loadSubgraphArtifact } from '../src/vnc/subgraph.js';
import { brainScales, typeGains } from '../src/brainmodel.js';
import { LIFDiff } from '../src/lifdiff.js';

const DATA = loadAll();
const SIZE = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); };

// 1. Artifact roundtrip: decoded arrays must have exact byteLength (the pool-slice bug appended
//    pool noise), and the sha must verify if the loader checks it.
const sub = loadSubgraphArtifact('public/data/vnc_subgraph.json');
check('artifact origIdx length', sub.origIdx.length === sub.N, `${sub.origIdx.length} vs ${sub.N}`);
check('artifact indptr length', sub.indptr.length === sub.N + 1);
check('artifact weights length', sub.weights.length === sub.indptr[sub.N], `${sub.weights.length} vs ${sub.indptr[sub.N]}`);

// 2. Float preservation: mapping full-brain inScale through origIdx must keep fractions. The buggy
//    `sub.origIdx.map(i => arr[i])` returned Int32Array and zeroed every value < 1, silently
//    gating all synaptic input to most of the subgraph.
{
  const { inScale } = brainScales(DATA, SIZE, {});
  const picked = Float32Array.from(Array.from(sub.origIdx, i => inScale[i]));
  const frac = picked.reduce((a, v) => a + (v !== Math.round(v) ? 1 : 0), 0);
  const zeros = picked.reduce((a, v) => a + (v === 0 ? 1 : 0), 0);
  // under the truncation bug: frac -> 0 (all integers) and zeros -> thousands (all values < 1 -> 0)
  check('picked inScale keeps fractions', frac > 1000 && zeros === 0, `${frac} fractional, ${zeros} zero of ${sub.N}`);
}

// 3. Forced spike replay delivers conductance: replay a burst on a source neuron, observe gE on its
//    postsynaptic target and a target spike.
{
  const indptr = Uint32Array.from([0, 1, 1]);       // neuron 0 -> neuron 1
  const indices = Uint32Array.from([1]);
  const counts = Uint16Array.from([10]);
  // nt=1 (excitatory): nt=0 is the unknown-transmitter class with EXC_SIGN 0 -- it delivers nothing,
  // which is itself a silent-dead-model footgun worth remembering.
  const net = new LIFDiff(
    { N: 2, indptr, indices, weights: counts, nt: Uint8Array.from([1, 1]) },
    { wSyn: 5, minSyn: 1 });
  // a 20 Hz burst for 10 steps, then quiet; arrivals land `delay` later
  const train = Array.from({ length: 60 }, (_, t) => (t % 5 === 0 && t < 50) ? [0] : null);
  let gmax = 0;
  const tape = net.forward(60, {
    spikeTrain: train,
    onEpoch: () => { gmax = Math.max(gmax, net.gE[1]); },
  });
  const tgtSpikes = tape.spikes.reduce((a, s) => a + (s.idx.includes(1) ? 1 : 0), 0);
  check('forced replay delivers gE', gmax > 0, `gE max ${gmax.toFixed(2)}`);
  check('forced replay fires target', tgtSpikes > 0, `${tgtSpikes} target spikes`);
  check('forced spikes recorded on tape', tape.spikeTrain === train);
}

// 4. logGain on the source modulates delivery (the fitted parameter actually reaches the edges).
{
  const indptr = Uint32Array.from([0, 1, 1]);
  const indices = Uint32Array.from([1]);
  const counts = Uint16Array.from([10]);
  const mk = lg => {
    const n = new LIFDiff({ N: 2, indptr, indices, weights: counts, nt: Uint8Array.from([1, 1]) }, { wSyn: 1, minSyn: 1 });
    n.logGain = lg;
    let gmax = 0;
    n.forward(30, { spikeTrain: Array.from({ length: 30 }, (_, t) => t === 0 ? [0] : null), onEpoch: () => { gmax = Math.max(gmax, n.gE[1]); } });
    return gmax;
  };
  const g0 = mk(new Float32Array(2));
  const gUp = mk(Float32Array.from([Math.log(4), 0]));
  check('logGain scales delivery', gUp > 3 * g0 && g0 > 0, `g0 ${g0.toFixed(3)} -> gUp ${gUp.toFixed(3)}`);
}

// 5. neuronGainTable deploys through typeGains -> outScale, keyed by original connectome index.
{
  const target = sub.origIdx[0];
  const gt = typeGains(DATA, { neuronGainTable: { [target]: Math.log(2) } });
  check('gain table applied at orig idx', Math.abs(gt[target] - 2) < 1e-6, `outScale ${gt[target]}`);
  const other = sub.origIdx.find(i => i !== target);
  check('gain table leaves others at 1', gt[other] === 1);
}

// 6. Extraction is deterministic and origIdx is injective (scramble/ablate comparisons depend on it).
{
  const seen = new Set(sub.origIdx);
  check('origIdx injective', seen.size === sub.N, `${seen.size} distinct`);
  const re = extractVncSubgraph(DATA);
  check('extraction deterministic', re.N === sub.N && re.origIdx.every((v, i) => v === sub.origIdx[i]),
    `re-extracted N ${re.N}`);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
