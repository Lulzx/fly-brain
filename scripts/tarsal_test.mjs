import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { allocBrainMemory, attachBrain } from '../src/brainsetup.js';
import { DN_ROLES } from '../src/sim/motor.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const mem = allocBrainMemory(data, size, sign, params, 1); const wasm = fs.readFileSync('public/lif.wasm');
const S = Object.fromEntries(D.bodymap.sensors.map(s => [s.name, s.idx]));
const legSugar = (legs) => legs.flatMap(k => (S[`taste ${k}`] || []).filter(i => ['LgLG3', 'LgLG4', 'LgAG2'].includes(D.meta.types[i])));
const fwdPop = Object.entries(DN_ROLES.forward).flatMap(([t, w]) => D.byType(t).map(i => [i, w]));
const orn = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const tests = { 'none': [], 'front legs sugar': legSugar(['T1 left', 'T1 right']), 'all legs sugar': legSugar(['T1 left', 'T1 right', 'T2 left', 'T2 right', 'T3 left', 'T3 right']),
  'labellum sugar': [...D.byType('LB3b'), ...D.byType('LB3c')], 'all legs bitter': ['T1 left', 'T1 right', 'T2 left', 'T2 right', 'T3 left', 'T3 right'].flatMap(k => (S[`taste ${k}`] || []).filter(i => D.meta.types[i] === 'LgAG1')) };
for (const [name, ix] of Object.entries(tests)) {
  const b = await attachBrain(wasm, mem, 0, data, 11); b.setDrive(orn, 6); b.setDrive(ix, 150);
  for (let s = 0; s < 1000; s++) b.step();
  const r = t => D.byType(t).reduce((a, i) => a + b.spikeCount[i], 0) / D.byType(t).length / 0.5;
  const fwd = fwdPop.reduce((a, [i, w]) => a + w * b.spikeCount[i], 0) / fwdPop.reduce((a, [, w]) => a + w, 0) / 0.5;
  console.log(`${name.padEnd(18)} (${ix.length}): MN9 ${r('MN9').toFixed(0)}Hz MN11D ${r('MN11D').toFixed(0)} MN6 ${r('MN6').toFixed(0)} | fwd pop ${fwd.toFixed(1)}Hz | MDN ${r('MDN').toFixed(0)} | pump CEM ${r('CEM').toFixed(0)}`);
}
