// Emit the frozen VNC leg-premotor subgraph (spec S2.3): the CSR edge set, per-node metadata and
// the boundary/motor/descending partitions, as one self-contained artifact the fit scripts load.
//
//   node scripts/prep_vnc_subgraph.mjs [--out=public/data/vnc_subgraph.json]
//
// The edge set is a value, not a pointer: once written, scripts/prep_vnc_subgraph.mjs must be
// re-run to change it, and every downstream artifact records this file's sha256.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadAll } from './lib_node.mjs';
import { extractVncSubgraph } from '../src/vnc/subgraph.js';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const outFile = arg('out', 'public/data/vnc_subgraph.json');

const D = loadAll();
const sub = extractVncSubgraph(D);
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

const roles = [0, 0, 0, 0];
for (let k = 0; k < sub.N; k++) roles[sub.role[k]]++;
const artifact = {
  version: 1,
  spec: 'S2.3 VNC leg-premotor subgraph: leg MNs + 2-hop VNC/descending ancestors, frozen edge set',
  counts: { N: sub.N, E: sub.E, interneuron: roles[0], motor: roles[1], descending: roles[2], sensory: roles[3] },
  csr: { indptr: b64(sub.indptr), indices: b64(sub.indices), weights: b64(sub.weights), dtype: 'uint32/uint32/uint16 LE' },
  nodes: { origIdx: b64(sub.origIdx), role: b64(sub.role), sign: b64(sub.sign), nt: b64(sub.nt),
    sc: b64(sub.sc), side: b64(sub.side), sizeArr: b64(sub.sizeArr), types: sub.types,
    excised: b64(sub.excised), isBoundary: b64(sub.isBoundary) },
  mn: sub.mn, dn: sub.dn, sensors: sub.sensors,
};
artifact.sha256 = crypto.createHash('sha256').update(JSON.stringify(artifact)).digest('hex');
fs.writeFileSync(outFile, JSON.stringify(artifact));
console.log(`${outFile}: ${sub.N} neurons, ${sub.E} edges, roles int/mn/dn/sens = ${roles.join('/')}, sha ${artifact.sha256.slice(0, 12)}`);
