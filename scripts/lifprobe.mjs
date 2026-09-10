// Spiking (LIF) model probe with size normalisation: taste -> proboscis, walking DN -> legs, stability.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { LIFNetwork } from '../src/lif.js';
import { regionSizeRef } from '../src/ratenet.js';
export function makeLIF(D, extra = {}) {
  const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
  const { ref, region } = regionSizeRef(D.meta.superclasses, D.sc, size);
  const maxS = extra.maxSizeScale || 20;
  const alpha = extra.sizeAlpha ?? 1;
  const inScale = Float32Array.from(size, (v, i) => v > 0 ? Math.pow(Math.min(maxS, Math.max(1 / maxS, v / ref[i])), -alpha) : 1);
  if (extra.vncGain) for (let i = 0; i < D.N; i++) if (region[i] === 2) inScale[i] *= extra.vncGain;
  if (extra.olGain) for (let i = 0; i < D.N; i++) if (region[i] === 0) inScale[i] *= extra.olGain;
  const sensoryMask = Uint8Array.from(D.sc, k => /sensory/.test(D.meta.superclasses[k]) ? 1 : 0);
  return new LIFNetwork(D.N, D.indptr, D.indices, D.weights, D.nt, { inScale: extra.noSize ? null : inScale, sensoryMask, ...extra });
}
if (process.argv[1].endsWith('lifprobe.mjs')) {
  const D = loadAll();
  const [types, hz = 100, watch = 'MN9', ms = 500, extra = '{}'] = process.argv.slice(2);
  const net = makeLIF(D, JSON.parse(extra));
  const stim = types.split('+').flatMap(t => D.byType(t)); net.setDrive(stim, +hz);
  const W = watch.split('+').map(t => [t, D.byType(t)]);
  const prev = new Uint32Array(D.N); const hist = []; const wh = W.map(() => []); let acc = 0; const t0 = Date.now();
  const steps = ms / net.p.dt, per = 50 / net.p.dt;
  for (let s = 1; s <= steps; s++) { acc += net.step().length; if (s % per === 0) {
    let act = 0; for (let i = 0; i < D.N; i++) { if (net.spikeCount[i] !== prev[i]) act++; }
    hist.push(act); W.forEach(([t, ix], k) => wh[k].push(ix.reduce((a, i) => a + net.spikeCount[i] - prev[i], 0) / ix.length / 0.05)); prev.set(net.spikeCount); } }
  console.log(`${types} @${hz}Hz (${stim.length}) ${extra} | neurons spiking per 50ms: ${hist.join(' ')} | wall ${Date.now() - t0}ms`);
  W.forEach(([t, ix], k) => console.log(`  ${t.padEnd(10)} (${ix.length}) Hz: ${wh[k].map(x => x.toFixed(0)).join(' ')}`));
}
