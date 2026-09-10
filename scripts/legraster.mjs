import { loadAll } from './lib_node.mjs';
import { makeLIF } from './lifprobe.mjs';
const D = loadAll();
const [type, hz = 150, ms = 1000, extra = '{}', filter = 'T1 left|T2 left|T3 left'] = process.argv.slice(2);
const net = makeLIF(D, JSON.parse(extra));
net.setDrive(type.split('+').flatMap(t => D.byType(t)), +hz);
const groups = D.bodymap.muscles.filter(g => new RegExp(filter).test(g.name) && !/adhere/.test(g.actuator));
const seen = new Set(); const G = groups.filter(g => { if (seen.has(g.name)) return false; seen.add(g.name); return true; });
const BIN = 10, per = BIN / net.p.dt; const rows = G.map(() => []); let prev = new Uint32Array(D.N);
for (let s = 1; s <= ms / net.p.dt; s++) { net.step(); if (s % per === 0) { G.forEach((g, k) => rows[k].push(g.idx.reduce((a, i) => a + net.spikeCount[i] - prev[i], 0) / g.idx.length / (BIN / 1000))); prev = net.spikeCount.slice(); } }
const glyph = r => r <= 0 ? '·' : r < 20 ? '▁' : r < 50 ? '▃' : r < 100 ? '▅' : r < 200 ? '▇' : '█';
console.log(`${type}@${hz} ${extra} (10ms bins)`);
G.forEach((g, k) => { const m = rows[k].reduce((a, b) => a + b, 0) / rows[k].length; if (m > 0.5) console.log(`${g.name.padEnd(40)} ${m.toFixed(0).padStart(3)} ${rows[k].map(glyph).join('')}`); });
