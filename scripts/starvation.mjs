// Starvation-induced hyperactivity (Yang et al. 2015; Yu et al. 2016): an embodied fly in the default arena with
// no food patch or hot patches (the vinegar plume stays), its energy held fed (0.85) or starved (0.15), in several genotypes:
//   rules   neuromodulation off: the endogenous rules read energy directly (the old model)
//   wt      hunger -> AKH / insulin -> octopamine neurons -> octopamine tone
//   Tbh     no octopamine release (Tbh null): OA neurons fire but modulate nothing and signal no arousal
//   AKHR    no AKH receptor on the OA neurons
//   direct  neuromodulation on, but the rules are blind to arousal: only octopamine's action on the connectome remains
// Usage: node scripts/starvation.mjs [secs=40] [seeds=3]           (runs every condition in parallel child processes)
//        node scripts/starvation.mjs one <genotype> <energy> <seed> <secs>
import { spawn } from 'node:child_process';
import os from 'node:os';
const WARM = 10000;   // ms for hormones and octopamine to settle before measuring
if (process.argv[2] === 'one') {
  const [, , , geno, energy, seed, secs] = process.argv; const { makeFly } = await import('./neuromod_lib.mjs');
  const fly = await makeFly({ seed: +seed, neuromod: geno !== 'rules', block: { Tbh: 'OA', AKHR: 'AKHR' }[geno] ?? null });
  if (geno === 'direct') { const u = fly.intrinsic.update.bind(fly.intrinsic); fly.intrinsic.update = (dt, b, ctx) => u(dt, b, { ...ctx, arousal: 0 }); }
  const T = WARM + secs * 1000; let d0 = 0, moving = 0, walkState = 0, oa = 0, n = 0; const perOA = fly.neuromod ? new Float64Array(fly.neuromod.akhrPos.length) : null; const fwd = fly.motor.dn?.forward;
  for (let s = 1; s <= T; s++) {
    fly.energy = +energy; fly.step();
    if (s === WARM) d0 = fly.dist;
    if (s > WARM && s % 20 === 0) { n++; if (Math.abs(fly.cmd.v) > 0.05) moving++; if (fly.intrinsic.state === 'walk') walkState++; if (fly.neuromod) { oa += fly.neuromod.readout().oa; fly.neuromod.akhrPos.forEach((m, k) => perOA[k] += fly.neuromod.c[m]); } }
  }
  const r = fly.neuromod?.readout();
  console.log(JSON.stringify({ geno, energy: +energy, seed: +seed, dist: (fly.dist - d0) / secs, moving: moving / n, walkState: walkState / n, oaHz: fly.neuromod ? oa / n : null, akh: r?.akh, insulin: r?.dilp, arousal: r?.arousal, perOA: perOA && Array.from(perOA, x => +(x / n).toFixed(1)) }));
  process.exit(0);
}
const secs = +(process.argv[2] || 40), seeds = +(process.argv[3] || 3);
const jobs = []; for (const geno of (process.env.GENOS || 'rules,wt,Tbh,AKHR,direct').split(',')) for (const e of [0.85, 0.15]) for (let k = 1; k <= seeds; k++) jobs.push([geno, e, k]);
const res = []; let next = 0; const par = Math.max(1, os.cpus().length - 2);
await new Promise(done => { let running = 0;
  const launch = () => { while (running < par && next < jobs.length) { const [g, e, k] = jobs[next++]; running++; let out = '';
    const c = spawn(process.execPath, [process.argv[1], 'one', g, e, k, secs]); c.stdout.on('data', d => out += d); c.stderr.on('data', d => process.stderr.write(d));
    c.on('close', () => { try { const r = JSON.parse(out.trim().split('\n').pop()); res.push(r); process.stderr.write(`${g} ${e} seed ${k}: ${r.dist.toFixed(3)} cm/s\n`); } catch { process.stderr.write(`${g} ${e} seed ${k} failed: ${out}\n`); } running--; if (next >= jobs.length && !running) done(); else launch(); }); } };
  launch(); });
const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sd = a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)));
console.log(`\n${secs} s per run after ${WARM / 1000} s settling, ${seeds} seeds. mean ± sd`);
console.log('genotype  energy  cm/s          moving        walk state    OA Hz   AKH   insulin  arousal');
for (const geno of ['rules', 'wt', 'Tbh', 'AKHR', 'direct']) for (const e of [0.85, 0.15]) { const g = res.filter(r => r.geno === geno && r.energy === e); if (!g.length) continue;
  const f = (k, d = 2) => `${mean(g.map(r => r[k])).toFixed(d)} ± ${sd(g.map(r => r[k])).toFixed(d)}`.padEnd(14), m = k => g[0][k] == null ? '  –  ' : mean(g.map(r => r[k])).toFixed(2);
  console.log(`${geno.padEnd(9)} ${e.toFixed(2)}    ${f('dist', 3)}${f('moving')}${f('walkState')}${(g[0].oaHz == null ? '–' : mean(g.map(r => r.oaHz)).toFixed(1)).padEnd(8)}${m('akh')}  ${m('insulin')}     ${m('arousal')}`); }
