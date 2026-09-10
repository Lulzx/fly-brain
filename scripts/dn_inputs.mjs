import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { allocBrainMemory, attachBrain } from '../src/brainsetup.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const mem = allocBrainMemory(data, size, sign, params, 1);
const b = await attachBrain(fs.readFileSync('public/lif.wasm'), mem, 0, data, 5);
const orn = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx); b.setDrive(orn, 6); b.setBackground(50, 1);
for (let s = 0; s < 2000; s++) b.step();
for (const t of ['DNg100', 'DNg97', 'DNp09']) {
  const tg = D.byType(t)[0]; const rows = [];
  for (let p = 0; p < D.N; p++) for (let k = D.indptr[p]; k < D.indptr[p + 1]; k++) if (D.indices[k] === tg && D.weights[k] >= 5) rows.push([p, D.weights[k], sign[p], b.spikeCount[p]]);
  const exc = rows.filter(r => r[2] > 0).sort((a, c) => c[1] - a[1]), inh = rows.filter(r => r[2] < 0).sort((a, c) => c[1] - a[1]);
  const sum = (rs) => rs.reduce((a, r) => a + r[1], 0);
  console.log(`\n${t}: exc syn ${sum(exc)} from ${exc.length} partners (${exc.filter(r => r[3] > 0).length} active); inh syn ${sum(inh)} from ${inh.length} (${inh.filter(r => r[3] > 0).length} active)`);
  console.log('  top exc:', exc.slice(0, 10).map(r => `${D.meta.types[r[0]] || '?'}[${D.meta.superclasses[D.sc[r[0]]].replace('_intrinsic', '')}]:${r[1]}syn:${r[3]}sp`).join(' '));
  console.log('  top inh:', inh.slice(0, 6).map(r => `${D.meta.types[r[0]] || '?'}:${r[1]}syn:${r[3]}sp`).join(' '));
}
