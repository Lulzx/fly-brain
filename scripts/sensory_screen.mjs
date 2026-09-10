// Screen every sensory channel for the motor commands it evokes (the brain's "decisions").
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { allocBrainMemory, attachBrain } from '../src/brainsetup.js';
const D = loadAll(); const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0)); const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const params = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const mem = allocBrainMemory(data, size, sign, params, 1); const wasm = fs.readFileSync('public/lif.wasm');
const T = (t, s) => D.byType(t).filter(i => !s || D.side[i] === s);
const OUT = { groom: [...T('DNg07'), ...T('DNg08'), ...T('DNg12')], fwd: [...T('DNg100'), ...T('DNg97'), ...T('DNp09')], MDN: T('MDN'), steerL: [...T('DNa02', 1), ...T('DNa01', 1)], steerR: [...T('DNa02', 2), ...T('DNa01', 2)], GF: T('DNp01'), MN9: T('MN9') };
const channels = D.bodymap.sensors.filter(s => s.kind !== 'odor').map(s => [s.name, s.idx]);
const orn = {}; for (const s of D.bodymap.sensors) if (s.kind === 'odor') (orn[s.glomerulus] ||= []).push(...s.idx);
for (const [g, ix] of Object.entries(orn)) channels.push([`ORN ${g} (both)`, ix]);
for (const e of D.bodymap.eyes) for (const [lab, f] of [['frontal', (az) => Math.abs(az) < 45], ['lateral', (az) => Math.abs(az) >= 45 && Math.abs(az) < 110], ['rear', (az) => Math.abs(az) >= 110]])
  channels.push([`eye ${e.side} ${lab} (dimming)`, e.idx.filter((_, k) => f(e.az[k]))]);
const lamina = []; for (let i = 0; i < D.N; i++) if (/^L[1-5]$/.test(D.meta.types[i])) lamina.push(i);
const res = [];
for (const [name, ix] of channels) {
  const b = await attachBrain(wasm, mem, 0, data, 3);
  b.setBias(lamina, params.laminaBias ?? 9);
  if (name.startsWith('eye')) continue;
  b.setDrive(ix, 100);
  for (let s = 0; s < 800; s++) b.step();
  const r = Object.fromEntries(Object.entries(OUT).map(([k, v]) => [k, v.reduce((a, i) => a + b.spikeCount[i], 0) / v.length / 0.4]));
  res.push([name, ix.length, r]);
}
const show = (k, n = 12) => console.log(`\nTop for ${k}:`, res.filter(x => x[2][k] > 2).sort((a, b) => b[2][k] - a[2][k]).slice(0, n).map(([nm, n2, r]) => `${nm}(${n2}):${r[k].toFixed(0)}`).join(' | ') || 'none');
for (const k of ['MN9', 'GF', 'groom', 'MDN', 'fwd']) show(k, 10);
const steer = res.map(([nm, n, r]) => [nm, r.steerL - r.steerR]).filter(x => Math.abs(x[1]) > 3).sort((a, b) => b[1] - a[1]);
console.log('\nSteering asymmetry (L-R DNa01/02):', steer.slice(0, 8).map(x => `${x[0]}:${x[1].toFixed(0)}`).join(' | '), ' ... ', steer.slice(-8).map(x => `${x[0]}:${x[1].toFixed(0)}`).join(' | '));
