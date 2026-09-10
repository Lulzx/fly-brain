// Which baseline sensory stream drives whole-brain activity? Drive each stream alone at its resting rate.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain } from '../src/brainmodel.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const S = D.bodymap.sensors;
const photo = D.bodymap.eyes.flatMap(e => e.idx);
const lamina = []; for (let i = 0; i < D.N; i++) if (/^L[1-5]$/.test(D.meta.types[i])) lamina.push(i);
const streams = {
  'photoreceptors 40Hz': [[photo, 40]],
  'lamina bias 9mV': [], 'photo 40Hz + lamina bias': [[photo, 40]],
  'ORN spontaneous 6Hz': [[S.filter(s => s.kind === 'odor').flatMap(s => s.idx), 6]],
  'proprioceptors ~60Hz': [[S.filter(s => /joint_angle|load/.test(s.kind)).flatMap(s => s.idx).filter((_, k) => k % 3 === 0), 60]],
  'tactile legs 80Hz': [[S.filter(s => s.kind === 'contact').flatMap(s => s.idx), 80]],
};
for (const [name, dr] of Object.entries(streams)) {
  const net = createBrain(D, size, { wSyn: 0.4 }, sign);
  for (const [ix, hz] of dr) net.setDrive(ix, hz);
  if (/lamina/.test(name)) net.setBias(lamina, 9);
  const hist = []; let prev = new Uint32Array(D.N);
  for (let s = 1; s <= 800; s++) { net.step(); if (s % 200 === 0) { let a = 0; for (let i = 0; i < D.N; i++) if (net.spikeCount[i] !== prev[i]) a++; hist.push(a); prev = net.spikeCount.slice(); } }
  const act = []; for (let i = 0; i < D.N; i++) if (net.spikeCount[i] > 0) act.push(i);
  const c = {}; for (const i of act) { const k = D.meta.superclasses[D.sc[i]]; c[k] = (c[k] || 0) + 1; }
  console.log(`${name.padEnd(28)} active/100ms: ${hist.join(' ')} | ${Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + ':' + v).join(' ')}`);
}
