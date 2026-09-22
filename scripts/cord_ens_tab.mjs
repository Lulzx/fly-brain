// The per-cell and per-edge tables the Bend ensemble runner derives every member from.
//
//   node scripts/cord_ens_tab.mjs
//
// Five flat arrays, so that a lane can build its own configuration from its index with no
// config file: which leg pool a cell drives, whether it is a proprioceptor, which of the three
// premotor hemilineages it belongs to, its role, and which synapses cross the midline between
// cord interneurons. Writes public/data/cord_ens_tab.bin.
import fs from 'node:fs';
import { loadCord } from './cord_kernel_ref.mjs';
import { LEG_ORDER } from './prep_cord_ir.mjs';

const OUT = 'public/data/cord_ens_tab.bin';
const cord = loadCord();
const N = cord.N, E = cord.E;

const poolId = new Uint32Array(N).fill(6);          // 6 = not a leg motor neuron
LEG_ORDER.forEach((name, l) => { for (const i of cord.sets[`pool:${name}`]) poolId[i] = l; });
const proprio = new Uint32Array(N);
for (const i of cord.sets['sensory:proprioceptive']) proprio[i] = 1;
const hl = Uint32Array.from(cord.hl);               // bit 0 = 13A, 1 = 13B, 2 = 19B
const role = Uint32Array.from(cord.role);           // 0 interneuron, 1 motor, 2 descending, 3 sensory
const comm = new Uint32Array(E);
for (let k = 0; k < E; k++) comm[k] = cord.edgeClass[k] & 1;

const parts = [poolId, proprio, hl, role, comm];
const bytes = 32 + parts.reduce((a, p) => a + p.byteLength, 0);
const buf = Buffer.alloc(bytes); let o = 0;
const u = v => { buf.writeUInt32LE(v >>> 0, o); o += 4; };
u(0x42415443); u(1); u(N); u(E); u(LEG_ORDER.length); u(0); u(0); u(0);
for (const p of parts) { Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, o); o += p.byteLength; }
fs.writeFileSync(OUT, buf);

const counts = [0, 0, 0, 0, 0, 0, 0]; for (const p of poolId) counts[p]++;
console.log(`${OUT}: ${(bytes / 1e6).toFixed(2)} MB`);
console.log(`pools ${counts.slice(0, 6).join('/')} (${N - counts[6]} motor neurons), proprioceptors ${proprio.reduce((a, b) => a + b, 0)}`);
console.log(`hemilineage cells 13A/13B/19B ${[1, 2, 4].map(b => hl.reduce((a, h) => a + ((h & b) ? 1 : 0), 0)).join('/')}, commissural edges ${comm.reduce((a, b) => a + b, 0)}`);
console.log(`offsets poolId=32 proprio=${32 + 4 * N} hl=${32 + 8 * N} role=${32 + 12 * N} comm=${32 + 16 * N} total=${bytes}`);
