import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { allocBrainMemory, attachBrain } from '../src/brainsetup.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const mem = allocBrainMemory(data, size, sign, params, 1); const wasm = fs.readFileSync('public/lif.wasm');
const T = (t, s) => D.byType(t).filter(i => !s || D.side[i] === s);
const OUT = { fwd: [...T('DNg100'), ...T('DNg97'), ...T('DNp09')], MDN: T('MDN'), DNa: [...T('DNa02'), ...T('DNa01')], GF: T('DNp01'), MN9: T('MN9') };
const orn = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const DN = []; for (let i = 0; i < D.N; i++) if (D.meta.superclasses[D.sc[i]] === 'descending_neuron') DN.push(i);
for (const [rate, amp] of JSON.parse(process.argv[2] || '[[0,0],[20,1],[50,1],[100,1],[50,2],[100,2]]')) {
  const b = await attachBrain(wasm, mem, 0, data, 5); b.setDrive(orn, 6); b.setBackground(rate, amp);
  const t0 = performance.now(); for (let s = 0; s < 2000; s++) b.step(); const wall = performance.now() - t0;
  let act = 0, tot = 0; for (let i = 0; i < D.N; i++) { if (b.spikeCount[i] > 0) act++; tot += b.spikeCount[i]; }
  const r = Object.entries(OUT).map(([k, v]) => `${k} ${(v.reduce((a, i) => a + b.spikeCount[i], 0) / v.length).toFixed(1)}Hz`).join(' ');
  const dnOn = DN.filter(i => b.spikeCount[i] >= 2).length;
  console.log(`bg ${rate}Hz x ${amp}mV: active ${act}, mean rate ${(tot / D.N).toFixed(2)}Hz, DNs>=2Hz ${dnOn}/${DN.length} | ${r} | ${(wall / 2000).toFixed(3)} ms/step`);
}
