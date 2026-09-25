// Score the four-second follow-up after repairing the bilateral FFT.
//   bend cordx3.bend -o cordx3 && ./cordx3 && node scripts/cordx3_long.mjs
import fs from 'node:fs';
import { inPhase } from '../src/exp/spectrum.js';
import { poolMetrics, traceFromCounts } from '../src/exp/pools.js';

const path = 'ext/cord3_long.bin', oldPath = 'ext/cord2_search.bin';
const members = [62, 92, 260, 0, 329, 73, 265, 9];
const windows = [[0.5, 1], [1, 2], [2, 4], [0.5, 4]];
const buf = fs.readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const hdr = new Uint32Array(ab, 0, 8);
if (hdr[0] !== 0x48435553 || hdr[2] !== 8000 || hdr[3] !== 16 || hdr[4] !== 1 ||
    hdr[5] !== 8 || hdr[6] !== 8001 || hdr[7] !== 16) throw new Error(`bad long-run header: ${Array.from(hdr)}`);
const a = new Uint16Array(ab, 32), stride = 8001 * 8;
const old = fs.readFileSync(oldPath);
const oldCounts = new Uint16Array(old.buffer.slice(old.byteOffset, old.byteOffset + old.byteLength), 32);
const oldStride = 2001 * 8;
const rows = [];
const traces = [];
for (let i = 0; i < members.length; i++) for (let rep = 0; rep < 2; rep++) {
  const member = members[i], run = 2 * i + rep, off = run * stride;
  let prefixMatches = null;
  if (rep === 0) {
    const origRun = member % 2 ? 1280 + 5 * Math.floor(member / 2) : 5 * Math.floor(member / 2);
    prefixMatches = true;
    for (let k = 0; k < oldStride; k++) if (a[off + k] !== oldCounts[origRun * oldStride + k]) {
      prefixMatches = false; break;
    }
    if (!prefixMatches) throw new Error(`prefix differs from original member ${member}`);
  }
  // Output step 0 is the initial empty tally; steps 1+ are 0.5 ms counts.
  const oneMs = Array.from({ length: 4000 }, (_, t) => Array.from({ length: 8 }, (_, ch) =>
    a[off + (2 * t + 1) * 8 + ch] + a[off + (2 * t + 2) * 8 + ch]));
  traces.push(oneMs);
  const pool = new Uint16Array(8000 * 6);
  for (let t = 0; t < 8000; t++) for (let c = 0; c < 6; c++) pool[t * 6 + c] = a[off + (t + 1) * 8 + c];
  const gait = poolMetrics(traceFromCounts(pool, 8000, 0.5, 4), { startMs: 500 });
  const reads = windows.map(([lo, hi]) => {
    const x = oneMs.slice(lo * 1000, hi * 1000);
    const ch = c => x.map(row => row[c]);
    return { windowSec: [lo, hi], pop: inPhase(ch(6), ch(7)),
      legPairs: [0, 1, 2].map(c => inPhase(ch(c), ch(c + 3))) };
  });
  rows.push({ member, seed: rep === 0 ? 'original' : 'common fresh', prefixMatches,
    poolHz: +gait.meanHz.toFixed(1), periodicity: +gait.bestStrength.toFixed(3), reads });
}
const sustained = rows.filter(r => r.poolHz > 100 && r.reads[1].pop.inPhaseBand < 0.5 &&
  r.reads[2].pop.inPhaseBand < 0.5).map(r => ({ member: r.member, seed: r.seed }));
const crossSeedControl = members.map((member, i) => ({ member,
  bandInPhase: inPhase(traces[2 * i].slice(500).map(x => x[6]),
    traces[2 * i + 1].slice(500).map(x => x[7])).inPhaseBand }));
const report = { spec: '4 seconds at 0.5 ms, eight selected members x original and common fresh seed',
  windowsSec: windows, phaseBandHz: [2, 20], peak: 'largest total bilateral power (P+ + P-)',
  sustainedLiveAntiPhase: sustained, crossSeedControl, rows };
fs.writeFileSync('ext/cord3_long.json', JSON.stringify(report, null, 2));
const lines = ['# Four-second bilateral follow-up', '',
  'Band in-phase fraction is P+/(P+ + P-) summed over 2–20 Hz. Below 0.5 means odd power dominates.',
  'Original seeds reproduce the first second of the prior binary exactly. The second seed is shared across configurations.', '',
  '| member | seed | pool Hz | 0.5–1 s | 1–2 s | 2–4 s | 0.5–4 s |',
  '|---|---|---:|---:|---:|---:|---:|'];
for (const r of rows) lines.push(`| ${r.member} | ${r.seed} | ${r.poolHz} | ${r.reads.map(v => v.pop.inPhaseBand).join(' | ')} |`);
lines.push('', `Sustained live anti-phase (band <0.5 in both 1–2 and 2–4 s): ${sustained.length}.`, '');
lines.push('Cross-seed control, original left paired with fresh-seed right, 0.5–4 s:');
for (const c of crossSeedControl) lines.push(`- m=${c.member}: ${c.bandInPhase}`);
lines.push('');
fs.writeFileSync('ext/cord3_long.md', lines.join('\n'));
console.log(`scored ${rows.length} long runs; sustained live anti-phase: ${sustained.length}`);
for (const r of rows) console.log(`m=${r.member} ${r.seed}: band ${r.reads.map(x => x.pop.inPhaseBand).join(' / ')} pool ${r.poolHz} Hz`);
