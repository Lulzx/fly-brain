import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain, brainScales, applyClassPhysiology, BRAIN_DEFAULTS } from '../src/brainmodel.js';
import { createWasmBrain } from '../src/lifwasm.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const cfg = { ...BRAIN_DEFAULTS, coba: true, wSyn: 0.7, sizeAlpha: 0.77, kcThreshold: 1.5, inhGain: 3.9, eInh: -66.6, minSyn: 4 };
const stim = ['LB3b', 'LB3c'].flatMap(t => D.byType(t)); const orn = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const js = createBrain(data, size, cfg, sign);
const { inScale, sensoryMask } = brainScales(data, size, cfg);
const { brains: [wb] } = await createWasmBrain(fs.readFileSync('public/lif.wasm'), data, cfg, inScale, sensoryMask, sign);
applyClassPhysiology(wb, data, cfg);
for (const b of [js, wb]) { b.setDrive(orn, 6); b.setDrive(stim, 100); }
for (const [name, b] of [['js', js], ['wasm', wb]]) { const t0 = performance.now(); let sp = 0; for (let s = 0; s < 1000; s++) sp += b.step().length; const dt = performance.now() - t0;
  let act = 0; for (let i = 0; i < D.N; i++) if (b.spikeCount[i] > 0) act++; const mn9 = D.byType('MN9').map(i => b.spikeCount[i] / 0.5);
  console.log(`${name}: ${(dt / 1000).toFixed(3)} ms per 0.5ms step, spikes ${sp}, active ${act}, MN9 ${mn9}, GNG232 ${D.byType('GNG232').map(i => b.spikeCount[i] / 0.5)}`); }
