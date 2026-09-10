// Which descending neurons (the brain's motor commands) does each sensory stimulus recruit?
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { createBrain } from '../src/brainmodel.js';
const D = loadAll(); const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sensorsByName = Object.fromEntries(D.bodymap.sensors.map(s => [s.name, s.idx]));
const SIDE = ['?', 'L', 'R', 'M'];
const stimuli = {
  'sugar labellum': [...D.byType('LB3b'), ...D.byType('LB3c')],
  'bitter labellum': ['LB1a', 'LB1b', 'LB1c', 'LB1d'].flatMap(t => D.byType(t)),
  'vinegar odor L antenna': ['DM1', 'DM4', 'VA2', 'DP1m'].flatMap(g => sensorsByName[`ORN_${g} left`] || []),
  'vinegar odor R antenna': ['DM1', 'DM4', 'VA2', 'DP1m'].flatMap(g => sensorsByName[`ORN_${g} right`] || []),
  'CO2 (ORN_V) both': [...(sensorsByName['ORN_V left'] || []), ...(sensorsByName['ORN_V right'] || [])],
  'touch T1 left': sensorsByName['tactile T1 left'],
  'light R1-6 left eye dorsal': D.bodymap.eyes[0].idx.filter((_, k) => D.bodymap.eyes[0].kind[k] === 'R1-6'),
  'JO wind left': sensorsByName['JO wind/gravity left'],
};
const dn = []; for (let i = 0; i < D.N; i++) if (D.meta.superclasses[D.sc[i]] === 'descending_neuron') dn.push(i);
for (const [name, ix] of Object.entries(stimuli)) {
  const net = createBrain(D, size); net.setDrive(ix, 100);
  for (let s = 0; s < 1000; s++) net.step(); // 500 ms
  const act = dn.map(i => [i, net.spikeCount[i] / 0.5]).filter(x => x[1] >= 5).sort((a, b) => b[1] - a[1]);
  let total = 0; for (let i = 0; i < D.N; i++) if (net.spikeCount[i] > 0) total++;
  console.log(`\n${name} (${ix.length} sensory neurons @100Hz): ${total} neurons active, ${act.length} DNs >=5Hz`);
  console.log('  ' + act.slice(0, 24).map(([i, r]) => `${D.meta.types[i] || '?'}_${SIDE[D.side[i]]}:${r.toFixed(0)}`).join(' '));
}
