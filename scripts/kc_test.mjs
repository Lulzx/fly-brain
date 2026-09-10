import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain } from '../src/brainmodel.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const S = D.bodymap.sensors; const allORN = S.filter(s => s.kind === 'odor').flatMap(s => s.idx);
const dm1 = S.filter(s => s.name.startsWith('ORN_DM1 ')).flatMap(s => s.idx), va2 = S.filter(s => s.name.startsWith('ORN_VA2 ')).flatMap(s => s.idx);
const KC = [], PN = []; for (let i = 0; i < D.N; i++) { const c = D.meta.classes[D.cls[i]]; if (c === 'Kenyon_Cell') KC.push(i); if (c === 'ALPN') PN.push(i); }
for (const kct of JSON.parse(process.argv[2] || '[0,10,20]')) {
  const res = [];
  for (const [label, odor] of [['spont', []], ['DM1', dm1], ['VA2', va2]]) {
    const net = createBrain(D, size, { wSyn: 0.4, kcThreshold: kct }, sign); net.setDrive(allORN, 6); net.setDrive(odor, 80);
    for (let s = 0; s < 600; s++) net.step();
    let tot = 0; for (let i = 0; i < D.N; i++) if (net.spikeCount[i] > 0) tot++;
    const kcOn = new Set(KC.filter(i => net.spikeCount[i] > 1)); res.push([label, kcOn]);
    console.log(`kcThr ${kct} ${label.padEnd(5)}: active ${tot}, KC ${(kcOn.size / KC.length * 100).toFixed(1)}%, PN ${PN.filter(i => net.spikeCount[i] > 1).length}`);
  }
  const a = res[1][1], b = res[2][1]; let inter = 0; for (const x of a) if (b.has(x)) inter++;
  console.log(`   DM1 vs VA2 KC overlap: ${inter} (Jaccard ${(inter / (a.size + b.size - inter || 1)).toFixed(2)})`);
}
