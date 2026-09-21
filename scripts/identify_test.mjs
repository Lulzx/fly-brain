// The frozen analysis for the individual-identifiability experiment (docs/34-individual-validation.md).
//
// C1 asks whether two models fitted to two animals' recordings are separated by a held-out assay in the
// direction that matches the animals. This script is the test, committed before there is anything to
// test, so that it cannot be tuned until it passes. Nothing here is specific to the fly: it takes a
// matrix of observed behaviours and a matrix of model predictions and returns an identification rate.
//
// The statistic. Every observable is z-scored across animals using the *observed* mean and standard
// deviation -- observed, not predicted, so that all M models are compared in one coordinate system and
// a model cannot buy an advantage by shrinking its own spread. Each animal is then assigned to the
// model whose predicted vector is nearest in that space, and is "identified" if that is its own model.
// Under the null that the models are exchangeable the argmin is uniform, so the identification rate is
// Binomial(M, 1/M) and the exact one-sided test is available in closed form. The permutation mode
// re-derives that null from the data, which catches the cases where z-scoring or ties break it.
//
//   node scripts/identify_test.mjs curve                       # power vs. observable reliability
//   node scripts/identify_test.mjs sim 12 0.5 6 2000 1 0       # M rho K trials kappa beta
//   node scripts/identify_test.mjs run data/identify.json      # score a real dataset
//
// Dataset format (see docs/34-individual-validation.md for what may and may not be in it):
//   { animals: ["A1", ...],
//     observables: ["escapeRate", ...],
//     observed: { A1: [0.43, ...], ... },
//     predicted: { A1: { A1: [0.41, ...], A2: [...] }, ... } }   // predicted[model][animal] = vector
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- the statistic ------------------------------------------------------------------------------
function stats(xs) { const m = xs.reduce((a, b) => a + b, 0) / xs.length; const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1); return [m, Math.sqrt(v) || 1]; }

// z-score both matrices against the observed mean/sd, and take the nearest predicted vector per animal.
export function identify(animals, observed, predicted) {
  const M = animals.length, K = observed[animals[0]].length;
  const mu = [], sd = [];
  for (let k = 0; k < K; k++) { const [m, s] = stats(animals.map(a => observed[a][k])); mu.push(m); sd.push(s); }
  const z = v => v.map((x, k) => (x - mu[k]) / sd[k]);
  const zo = Object.fromEntries(animals.map(a => [a, z(observed[a])]));
  const calls = {}, dist = {};
  for (const a of animals) {
    let best = null, bestD = Infinity; const d = {};
    for (const m of animals) { if (!predicted[m]) throw new Error(`no predictions from the model fitted to ${m}`);
      let s = 0; const pm = z(predicted[m][a]); for (let k = 0; k < K; k++) s += (zo[a][k] - pm[k]) ** 2; d[m] = s;
      if (s < bestD - 1e-12) { bestD = s; best = m; } }
    calls[a] = best; dist[a] = d;
  }
  const correct = animals.filter(a => calls[a] === a).length;
  return { M, K, correct, rate: correct / M, calls, dist };
}

// one-sided exact P(X >= k) for X ~ Binomial(M, 1/M)
export function exactP(k, M) {
  let s = 0, c = 1;
  for (let i = 0; i <= M; i++) {
    if (i >= k) s += c * (1 / M) ** i * (1 - 1 / M) ** (M - i);
    c = c * (M - i) / (i + 1);
  }
  return s;
}

// ---- the null that holds for this data, whatever z-scoring did to it ----------------------------
// Permute which animal each observed vector belongs to, leaving the models where they are. The true
// pairing is destroyed; the marginal spread of every model, every tie, and the z-scoring (which is
// invariant to the permutation) all survive, so whatever chance level comes out is the one this
// dataset actually has rather than the Binomial(M, 1/M) the ideal would give.
export function permutationNull(animals, observed, predicted, trials = 20000, seed = 1) {
  const rnd = mulberry(seed);
  let sum = 0, max = 0;
  for (let t = 0; t < trials; t++) {
    const perm = animals.slice();
    for (let i = perm.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const shuffled = Object.fromEntries(animals.map((an, i) => [perm[i], observed[an]]));
    const c = identify(animals, shuffled, predicted).correct;
    sum += c; max = Math.max(max, c);
  }
  return { trials, mean: sum / trials, rate: sum / trials / animals.length, max };
}

// ---- simulation: how reliable must an observable be for this to have power? ---------------------
// theta ~ N(0, rho) is the animal's phenotype with total variance normalised to 1, observed as
// theta + N(0, 1-rho). rho is the between-animal share of the observable: the one number here that a
// recording yields on its own, before any model exists. Model m predicts kappa*theta_m + beta*e_m for
// every animal it is asked about, and the two coefficients are the two ways the design fails.
//
//   kappa -- the readout's sensitivity. kappa = 1 means the animal's fitted parameters reach the
//   behaviour undiminished; kappa = 0 means the behaviour is produced by supplied machinery and every
//   model predicts the same thing. This is the failure A1 would expose, and it is specific to the
//   behavioural readout: a neural observable has kappa near 1 by construction.
//   beta  -- the fit's own error, constant across the animals a given model is asked about, because it
//   is that model's fingerprint rather than a per-comparison noise. This is the failure B1 would
//   expose: a fit that absorbed the recording rather than the circuit looks like every other bad fit.
//
// Neither is directly measurable, so neither appears in the pre-registered test; they are here to say
// what the test can detect if it works and what it silently cannot if it does not.
function gauss(a) { let u = 0, v = 0; while (u === 0) u = a(); while (v === 0) v = a(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function simOnce(M, K, rho, kappa, beta, rnd) {
  const sb = Math.sqrt(rho), sw = Math.sqrt(1 - rho);
  const theta = [], err = [], observed = {}, predicted = {};
  const names = Array.from({ length: M }, (_, i) => 'A' + i);
  for (let m = 0; m < M; m++) { theta.push(Array.from({ length: K }, () => sb * gauss(rnd))); err.push(Array.from({ length: K }, () => beta * gauss(rnd))); }
  for (let a = 0; a < M; a++) observed[names[a]] = theta[a].map(t => t + sw * gauss(rnd));
  for (let m = 0; m < M; m++) predicted[names[m]] = Object.fromEntries(names.map(a => [a, theta[m].map((t, k) => kappa * t + err[m][k])]));
  return identify(names, observed, predicted).correct;
}
function mulberry(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function sim(M, K, rho, trials, seed = 1, kappa = 1, beta = 0) {
  const rnd = mulberry(seed); let ge = 0, sum = 0;
  for (let t = 0; t < trials; t++) { const c = simOnce(M, K, rho, kappa, beta, rnd); sum += c; if (c >= 4) ge++; }
  return { M, K, rho, kappa, beta, trials, meanCorrect: sum / trials, rate: sum / trials / M, power: ge / trials };
}

// ---- CLI ----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = argv[0];
  if (mode === 'curve') {
    const M = +(argv[1] || 12), Ks = argv[2] ? [ +argv[2] ] : [1, 3, 6], trials = +(argv[3] || 4000), beta = +(argv[4] || 0);
    console.log(`identification rate and power (>=4 correct) against observable reliability, M=${M}, ${trials} trials, model error beta=${beta}\n`);
    process.stdout.write('rho    ' + Ks.map(k => `K=${k}: rate  power`).join('   ') + '\n');
    for (const rho of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      process.stdout.write(rho.toFixed(2) + '   ' + Ks.map(k => { const r = sim(M, k, rho, trials, 1, 1, beta); return `${r.rate.toFixed(3)} ${r.power.toFixed(3)}`; }).join('   ') + '\n');
    }
    console.log('\nrho = between-animal variance / (between + within). Below ~0.3 the assay cannot individuate\nno matter how good the fit is, and the study reports inconclusive-by-design rather than negative.');
  } else if (mode === 'grid') {
    const M = +(argv[1] || 12), K = +(argv[2] || 6), trials = +(argv[3] || 3000);
    const axis = argv[4] === 'kappa' ? 'kappa' : 'beta';
    const xs = axis === 'kappa' ? [0, 0.25, 0.5, 0.75, 1] : [0.25, 0.5, 0.75, 1, 1.5];
    console.log(`identification rate and power at >=4/${M}, K=${K}, ${trials} trials; rows rho, columns ${axis}\n`);
    process.stdout.write(`rho  \\ ${axis} `.padEnd(12) + xs.map(b => b.toFixed(2).padStart(12)).join('') + '\n');
    for (const rho of [0.2, 0.4, 0.6, 0.8]) {
      process.stdout.write(rho.toFixed(2).padEnd(12) + xs.map(x => {
        const r = axis === 'kappa' ? sim(M, K, rho, trials, 1, x, 0.25) : sim(M, K, rho, trials, 1, 1, x);
        return `${r.rate.toFixed(3)} ${r.power.toFixed(2)}`.padStart(12);
      }).join('') + '\n');
    }
    console.log(axis === 'kappa'
      ? '\nbeta held at 0.25. kappa near 0 is scaffolded behaviour: the readout never carries the animal.'
      : '\nkappa held at 1. beta is the fit\'s own error; rho is the only one of the three a recording yields.');
  } else if (mode === 'sim') {
    // sim M rho K trials [kappa] [beta]. The two coefficients used to be collapsed into one positional
    // argument that was passed to `sim` in `kappa`'s slot, so `sim ... 1` set the readout sensitivity
    // and never the fit error. Nothing in docs/34-individual-validation.md's numbers came through this
    // path -- the tables are from `curve` and `grid`, which always passed both -- but the null example
    // in that document was passing beta as kappa and getting the right answer for the wrong reason.
    const [M, rho, K, trials, kappa, beta] = [+(argv[1] || 12), +(argv[2] || 0.5), +(argv[3] || 6), +(argv[4] || 2000), argv[5] === undefined ? 1 : +argv[5], +(argv[6] || 0)];
    console.log(JSON.stringify(sim(M, K, rho, trials, 1, kappa, beta)));
  } else if (mode === 'run') {
    const d = JSON.parse(fs.readFileSync(argv[1]));
    const r = identify(d.animals, d.observed, d.predicted);
    console.log(`M=${r.M} K=${r.K}  identified ${r.correct}/${r.M} (${(r.rate * 100).toFixed(0)}%)`);
    for (const a of d.animals) console.log(`  ${a} -> ${r.calls[a]}${r.calls[a] === a ? '' : '   MISS'}`);
    const p = exactP(r.correct, r.M), thr = Math.min(...d.animals.map((_, k) => exactP(k, r.M) <= 0.05 ? k : Infinity));
    console.log(`exact one-sided p = ${p.toFixed(4)}   threshold ${thr}/${r.M}, alpha ${exactP(thr, r.M).toFixed(4)}`);
    const nul = d.predictionsFrom ? null : permutationNull(d.animals, d.observed, d.predicted);
    if (nul) console.log(`permutation null: ${nul.rate.toFixed(4)} per animal over ${nul.trials} shuffles (max ${nul.max}); ` +
      `a permutation p is (#shuffles >= ${r.correct}) / ${nul.trials}`);
    const zs = d.observables.map((o, k) => { const v = d.animals.map(a => d.observed[a][k]); const [m, s] = stats(v); return `${o}: mean ${m.toPrecision(4)} sd ${s.toPrecision(4)}`; });
    console.log('observed spread (this is the rho input):\n  ' + zs.join('\n  '));
  } else {
    console.log('usage: identify_test.mjs curve|grid [M] [K] [trials] | sim [M] [rho] [K] [trials] [kappa] [beta] | run <file.json>');
  }
}
