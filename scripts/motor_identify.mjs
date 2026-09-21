// M6: is motor-neuron activity a better individual fingerprint than the behaviour it produces?
//
// [doc 34](docs/34-individual-validation.md) freezes six *behavioural* observables for C1, on the
// argument that behaviour is what a body makes measurable. The motor neurons are where that behaviour
// is generated, and between them and the trajectory sit a 17 Hz force-frequency saturation, six legs
// and a supplied stepping generator -- a low-pass filter. If two models differ at their motor neurons
// and not in what the fly does, C1 should be recording motor neurons.
//
// That question is answerable in simulation now, and this script answers it. M simulated individuals
// are made by drawing a lognormal gain on every neuron -- the same quantity doc 33's adjoint fits and
// the one C1 varies between animals. Each individual is run twice with different noise seeds: the
// first run is the "animal" (observed) and the second is its model's prediction. Both vectors are read
// off the *same* runs, so the only thing that differs between the two observables is the read-out.
//
//   node scripts/motor_identify.mjs run [M] [sigma] [workers]   # the experiment; writes public/data/motor_identify.json
//   node scripts/motor_identify.mjs report                      # re-print from the saved json
//
// The statistic and the threshold are doc 34's, imported from scripts/identify_test.mjs rather than
// re-implemented, because the point of pre-registering them was that they do not get re-chosen.
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { identify, exactP, permutationNull } from './identify_test.mjs';

const OUT = 'public/data/motor_identify.json';
const argv = process.argv.slice(2);
const mode = argv[0] || 'run';
const M = +(argv[1] || 12), SIGMA = +(argv[2] || 0.25), NW = +(argv[3] || Math.min(6, M));

// doc 34's observables, as far as the arena carries them. Three of its six are here under their own
// names; optomotor gain and plume heading precision have no assay in this arena, and `flips` and
// `foodDist` stand in as the two other whole-animal measures scripts/behavior_eval.mjs does produce.
// The substitution is stated rather than hidden: M6 compares two read-outs of the same runs, and a
// read-out is not made fairer by being given assays the other one does not get.
const BEHAVIOUR = ['escapes', 'feedLatency', 'bodyBoutMedian', 'flipFrac', 'foodDist', 'boutMedian'];
const MOTOR_ALL = ['mn_wing_power', 'mn_wing_basalar', 'mn_wing_first', 'mn_wing_third', 'mn_wing_hg',
  'mn_wing_pitch', 'mn_leg_T1', 'mn_leg_T2', 'mn_leg_T3', 'mn_proboscis', 'mn_jump', 'mn_unmapped'];

const CAL = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const PARAMS = Object.fromEntries(Object.entries(CAL).filter(([k]) => !k.startsWith('_')));

// ---- the statistic, for one choice of observable ------------------------------------------------
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function mulberry(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/** Pack the per-individual runs into doc 34's { animals, observed, predicted } shape for one key set. */
function pack(runs, keys) {
  const animals = runs.map(r => r.name);
  const observed = Object.fromEntries(runs.map(r => [r.name, keys.map(k => r.observed[k])]));
  // The model fitted to animal a predicts the same vector for every animal, because in simulation the
  // assay is the same for all of them. That is the honest translation of doc 34's design to a case with
  // no per-animal stimulus: the statistic reduces to matching observed vectors to predicted ones.
  const predicted = Object.fromEntries(runs.map(r => [r.name, Object.fromEntries(animals.map(a => [a, keys.map(k => r.predicted[k])]))]));
  return { animals, observed, predicted };
}

/** Between-animal share of the variance, per observable: doc 34's rho, from the two replicate runs. */
function rhoOf(runs, keys) {
  return keys.map(k => {
    const a = runs.map(r => r.observed[k]), b = runs.map(r => r.predicted[k]);
    // One-way ANOVA with animal as the factor and two replicates each, which is what a pair of runs is.
    // MSW is the mean within-animal squared difference over two, MSB is twice the between-animal mean
    // square with n-1 in the denominator, and rho is the usual ICC (MSB - MSW) / (MSB + MSW).
    const n = a.length;
    const within = mean(a.map((x, i) => ((x - b[i]) ** 2) / 2));
    const grand = mean([...a, ...b]);
    const between = 2 * a.reduce((s2, x, i) => s2 + ((x + b[i]) / 2 - grand) ** 2, 0) / Math.max(1, n - 1);
    const tot = between + within;
    return { k, rho: tot > 0 ? Math.max(0, (between - within) / tot) : 0, between, within };
  });
}

/** Identification rate with an injected fit error beta, in units of the observed between-animal sd. */
function withBeta(runs, keys, beta, trials, seed) {
  const { animals, observed, predicted } = pack(runs, keys);
  const s = keys.map((_, k) => sd(animals.map(a => observed[a][k])) || 1);
  const r = mulberry(seed);
  let correct = 0, ge4 = 0;
  for (let t = 0; t < trials; t++) {
    const p = {};
    for (const m of animals) { const e = keys.map((_, k) => beta * s[k] * gauss(r));
      p[m] = Object.fromEntries(animals.map(a => [a, predicted[m][a].map((x, k) => x + e[k])])); }
    const c = identify(animals, observed, p).correct;
    correct += c; if (c >= 4) ge4++;
  }
  return { rate: correct / trials / animals.length, power: ge4 / trials };
}

function report(data) {
  const runs = data.runs, keysets = [['behaviour', BEHAVIOUR], ['motor (12 pools)', MOTOR_ALL],
    ['motor (6 pools)', ['mn_leg_T1', 'mn_leg_T2', 'mn_leg_T3', 'mn_proboscis', 'mn_wing_power', 'mn_unmapped']]];
  console.log(`M6: motor pools against behaviour as an individual fingerprint`);
  console.log(`${runs.length} simulated individuals, per-neuron gain sigma ${data.sigma}, two noise seeds each\n`);
  for (const [name, keys] of keysets) {
    const { animals, observed, predicted } = pack(runs, keys);
    const r = identify(animals, observed, predicted);
    const nul = permutationNull(animals, observed, predicted, 5000);
    console.log(`${name}  (K = ${keys.length})`);
    console.log(`  identified ${r.correct}/${r.M}   exact one-sided p = ${exactP(r.correct, r.M).toFixed(4)}   permutation null ${nul.rate.toFixed(3)} per animal`);
    const rh = rhoOf(runs, keys);
    console.log('  rho per observable: ' + rh.map(x => `${x.k.replace(/^mn_/, '')} ${x.rho.toFixed(2)}`).join('  '));
    console.log(`  mean rho ${mean(rh.map(x => x.rho)).toFixed(3)}`);
    // doc 34's beta axis: how much fit error the read-out survives. This is the quantity M6 asks for --
    // "which separates the models at a smaller fit error" -- read as which one still identifies when
    // the model's own error is larger.
    const bs = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];
    console.log('  beta:      ' + bs.map(b => b.toFixed(2).padStart(7)).join(''));
    const res = bs.map(b => withBeta(runs, keys, b, 400, 7));
    console.log('  rate:      ' + res.map(x => x.rate.toFixed(3).padStart(7)).join(''));
    console.log('  power>=4:  ' + res.map(x => x.power.toFixed(2).padStart(7)).join(''));
    const lim = bs.filter((b, i) => res[i].power >= 0.9).pop();
    console.log(`  largest beta with power >= 0.9: ${lim === undefined ? 'none (fails at beta = 0)' : lim}\n`);
  }
  console.log('doc 34 gates C1 at rho >= 0.4 and beta <= 0.5. The read-out that keeps power at the larger');
  console.log('beta is the one C1 should record, and the rho column says whether either is worth recording.');
}

if (mode === 'report') {
  report(JSON.parse(fs.readFileSync(OUT)));
} else {
  // Two runs per individual: seed 1 is the animal, seed 2 is the model's prediction of it. The gain
  // draw (the individual) is held fixed across the two; only the simulation noise differs.
  const jobs = [];
  for (let m = 0; m < M; m++) for (const [tag, seed] of [['observed', 101], ['predicted', 202]])
    jobs.push({ m, tag, cfg: { ...PARAMS, neuronGain: { sigma: SIGMA, seed: 1000 + m }, seed: seed + m } });
  console.log(`M6: ${M} individuals x 2 runs = ${jobs.length} embodied evaluations on ${NW} workers`);
  console.log(`per-neuron gain sigma ${SIGMA}; this is ~40 s per evaluation\n`);
  const results = new Array(jobs.length);
  const workers = [...Array(NW)].map(() => fork('scripts/behavior_eval.mjs'));
  let next = 0, done = 0;
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    const feed = (w) => { if (next >= jobs.length) { if (done === jobs.length) resolve(); return; }
      const id = next++; w.send({ id, cfg: jobs[id].cfg }); };
    for (const w of workers) {
      w.on('message', (msg) => {
        if (msg.error) { reject(new Error(msg.error)); return; }
        results[msg.id] = msg.out.obs; done++;
        process.stdout.write(`\r  ${done}/${jobs.length} done, ${((Date.now() - t0) / 1000).toFixed(0)}s elapsed   `);
        if (done === jobs.length) { resolve(); return; }
        feed(w);
      });
      feed(w);
    }
  });
  for (const w of workers) w.kill();
  console.log('');
  const runs = [];
  for (let m = 0; m < M; m++) {
    const o = results[jobs.findIndex(j => j.m === m && j.tag === 'observed')];
    const p = results[jobs.findIndex(j => j.m === m && j.tag === 'predicted')];
    runs.push({ name: 'A' + m, observed: o, predicted: p });
  }
  const data = { _source: 'scripts/motor_identify.mjs', M, sigma: SIGMA, behaviour: BEHAVIOUR, motor: MOTOR_ALL, runs };
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1));
  console.log(`wrote ${OUT}\n`);
  report(data);
}
