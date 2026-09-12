// Calibrates the neuromodulation module (src/sim/neuromod.js): holds an embodied fly fed (energy 0.85) in the
// default arena without the food patch or hot patches (the food odour plume stays; it drives the OA neurons)
// while the resting thresholds of the octopaminergic neurons and of the insulin-producing cells move
// homeostatically until they fire at their fed rates (NEUROMOD.oaFed, ipcFed). Rates swing between walking and
// standing, so the adaptation rate is annealed and the thresholds are averaged over the last third.
// Writes public/data/neuromod.json. Rerun after changing NEUROMOD drives. Usage: node scripts/neuromod_calib.mjs [seconds=60]
import fs from 'node:fs';
import { makeFly } from './neuromod_lib.mjs';
const secs = +(process.argv[2] || 60), FED = 0.85, T = secs * 1000;
const fly = await makeFly({ seed: 3, calib: null });
const nm = fly.neuromod, nC = nm.cells.length;
// 1. silence the cells and measure their free membrane potential; start each resting threshold 1 mV above it
const vSum = new Float64Array(nC); nm.base.fill(100); nm.setCellThr();
for (let s = 1; s <= 3000; s++) { fly.energy = FED; fly.step(); if (s > 1000) nm.cells.forEach((i, n) => vSum[n] += fly.brain.v[i]); }
nm.cells.forEach((i, n) => nm.base[n] = vSum[n] / 2000 - fly.brain.p.vThresh + 1); nm.r.fill(0);
// 2. homeostatic thresholds
const avg = new Float64Array(nC); let nAvg = 0; const q = a => { const b = Array.from(a).sort((x, y) => x - y); return `${b[b.length >> 1].toFixed(1)} (${b[0].toFixed(1)}-${b.at(-1).toFixed(1)})`; };
for (let s = 1; s <= T; s++) {
  nm.adapt = { eta: s < T / 3 ? 1 : s < 2 * T / 3 ? 0.5 : 0.2 };
  fly.energy = FED; fly.step();
  if (s > 2 * T / 3 && s % 50 === 0) { avg.forEach((_, n) => avg[n] += nm.base[n]); nAvg++; }
  if (s % 2000 === 0) console.log(`t=${s / 1000}s OA Hz ${q(nm.c)} AKHR mean ${nm.oaTone.toFixed(1)} | IPC Hz ${q(nm.r.subarray(nm.nOA))} | OA thr ${q(nm.base.subarray(0, nm.nOA))} | insulin ${nm.dilp.toFixed(2)} | ${fly.behavior(fly.state())}`);
}
nm.base.set(Float32Array.from(avg, x => x / nAvg));
fs.writeFileSync('public/data/neuromod.json', JSON.stringify({ note: 'written by scripts/neuromod_calib.mjs', fedEnergy: FED, secs, ...nm.thresholds() }));
console.log('wrote public/data/neuromod.json');
