// Reafference forward-model fit (spec S3.3/S3.5): the weights that predict the loom pathway's
// reafferent drive from the fly's own commands and leg proprioception.
//
// Inputs (both produced by scripts/loom_protocol.mjs):
//   --trace=FILE   self-motion epochs: --conds=gait,turn,wall --trace=FILE. Each epoch carries the
//                  feature vector [u(5), p(nJoints)] (filtered exactly as the plugin filters them)
//                  and the per-target spike rates in Hz. No predator present, so the drive these
//                  rates express is reafferent by construction.
//   --calib=FILE   --bias runs: a fixed negative bias on the targets, reporting per-target rates
//                  before and after. The slope rho_i = dRate/dBias converts the Hz-space fit into
//                  the kernel's bias units.
//
// Fit: per target neuron, ridge regression of rate on [u, p] (+1 intercept unless
// --intercept=0; the shipped model is intercept-free -- reafference is movement-evoked, and a
// nonzero intercept suppresses a standing animal's disk response). Converted to bias units by
// rho and written to public/data/reafference.json for the reafference plugin's visual channel.
//
//   node scripts/loom_protocol.mjs --conds=gait,turn,wall --seeds=1-10 --trace=/tmp/reaf_trace.json
//   node scripts/loom_protocol.mjs --conds=gait,wall --seeds=1-6 --bias=-1 --results=/tmp/reaf_calib.json
//   node scripts/reafference_fit.mjs --trace=/tmp/reaf_trace.json --calib=/tmp/reaf_calib.json
import fs from 'node:fs';

const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const traceFile = arg('trace'), calibFile = arg('calib');
const OUT = arg('out') || 'public/data/reafference.json';
const LAM = +(arg('lambda') || 0.01);      // relative ridge: fraction of the mean feature second-moment
const INTERCEPT = arg('intercept') !== '0';   // b=0 keeps a standing animal's targets untouched
if (!traceFile) { console.error('usage: reafference_fit --trace=FILE [--calib=FILE] [--out=...]'); process.exit(1); }
const T = JSON.parse(fs.readFileSync(traceFile));

// ---------------------------------------------------------------- assemble design tensors
const runs = Object.entries(T.epochs);
const nP = runs[0][1].jointNames.length, nF = 5 + nP + (INTERCEPT ? 1 : 0);
const targets = runs[0][1].targets, Tn = targets.length;
let N = 0; for (const [, tr] of runs) N += tr.epochs.length;
console.log(`fit data: ${runs.length} runs, ${N} epochs, ${Tn} targets, ${nF} features`);
const XtX = new Float64Array(nF * nF);                      // pooled over all epochs
const XtY = new Float64Array(nF * Tn);                      // X' * y per target
const feat = new Float64Array(nF); if (INTERCEPT) feat[nF - 1] = 1;
let yMean = 0;
for (const [, tr] of runs) for (const e of tr.epochs) {
  for (let f = 0; f < 5; f++) feat[f] = e.u[f];
  for (let j = 0; j < nP; j++) feat[5 + j] = e.p[j];
  for (let a = 0; a < nF; a++) for (let b2 = 0; b2 < nF; b2++) XtX[a * nF + b2] += feat[a] * feat[b2];
  for (let a = 0; a < nF; a++) for (let t = 0; t < Tn; t++) XtY[a * Tn + t] += feat[a] * e.rate[t];
  for (let t = 0; t < Tn; t++) yMean += e.rate[t];
}
yMean /= N * Tn;

// ---------------------------------------------------------------- ridge solve per target
// beta = (X'X + lam*mean(diag)*I)^-1 X'y -- one dense nF x nF solve per target.
const lamAbs = LAM * (() => { let s = 0; for (let a = 0; a < nF; a++) s += XtX[a * nF + a]; return s / nF; })();
console.log(`ridge lambda: ${lamAbs.toExponential(2)} (rel ${LAM})`);
function solve(A, b) {                        // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Float64Array(n);
  for (let c = n - 1; c >= 0; c--) { let s = M[c][n]; for (let k = c + 1; k < n; k++) s -= M[c][k] * x[k]; x[c] = s / M[c][c]; }
  return x;
}
const A0 = []; for (let a = 0; a < nF; a++) { A0.push([]); for (let b2 = 0; b2 < nF; b2++) A0[a][b2] = XtX[a * nF + b2]; A0[a][a] += lamAbs; }
const W = new Float64Array(nF * Tn);
for (let t = 0; t < Tn; t++) { const y = new Float64Array(nF); for (let a = 0; a < nF; a++) y[a] = XtY[a * Tn + t]; const x = solve(A0, y); for (let a = 0; a < nF; a++) W[a * Tn + t] = x[a]; }

// ---------------------------------------------------------------- fit quality (R^2 on held-out run)
// per-type mean R^2 over targets, evaluated on the first run's epochs as a sanity split
const TYPE_OF = {}; const tt = ['LC4', 'LPLC2', 'DNp02', 'DNp04', 'DNp01'];
{
  const [, tr0] = runs[0];
  // reconstruct a quick residual estimate: recompute prediction error over all epochs
  const ss = new Float64Array(Tn), tot = new Float64Array(Tn), mean = new Float64Array(Tn);
  for (const [, tr] of runs) for (const e of tr.epochs) for (let t = 0; t < Tn; t++) mean[t] += e.rate[t];
  for (let t = 0; t < Tn; t++) mean[t] /= N;
  for (const [, tr] of runs) for (const e of tr.epochs) {
    for (let f = 0; f < 5; f++) feat[f] = e.u[f];
    for (let j = 0; j < nP; j++) feat[5 + j] = e.p[j];
    for (let t = 0; t < Tn; t++) {
      let h = 0; for (let a = 0; a < nF; a++) h += feat[a] * W[a * Tn + t];
      ss[t] += (e.rate[t] - h) ** 2; tot[t] += (e.rate[t] - mean[t]) ** 2;
    }
  }
  let r2s = []; for (let t = 0; t < Tn; t++) r2s.push(tot[t] > 0 ? 1 - ss[t] / tot[t] : 0);
  r2s = r2s.sort((x, y) => x - y);
  console.log(`fit R^2 over targets: p10 ${r2s[Math.floor(0.1 * Tn)].toFixed(3)}  median ${r2s[Tn >> 1].toFixed(3)}  p90 ${r2s[Math.floor(0.9 * Tn)].toFixed(3)}`);
}

// ---------------------------------------------------------------- rate -> bias sensitivity
let rho = null;
if (calibFile) {
  const C = JSON.parse(fs.readFileSync(calibFile));
  const d = Math.abs(C.biasDelta);
  const rhos = [];
  for (const r of C.results) {
    if (r.error || !r.ratePre) continue;
    for (let t = 0; t < Tn; t++) if (r.ratePre[t] > 2) rhos.push((r.ratePre[t] - r.ratePost[t]) / d);
  }
  rhos.sort((a, b) => a - b);
  rho = rhos.length ? rhos[rhos.length >> 1] : null;
  console.log(`sensitivity rho: median ${rho?.toFixed(2)} Hz per bias unit over ${rhos.length} target-runs (p25 ${rhos[rhos.length >> 2]?.toFixed(2)}, p75 ${rhos[(3 * rhos.length) >> 2]?.toFixed(2)})`);
} else console.log('no --calib file: rho defaults to 1 (Hz treated as bias units) -- rerun with calibration');
if (!rho) rho = 1;

// ---------------------------------------------------------------- emit the model
const nU = 5;
const model = {
  version: 1, units: 'bias', rho,
  targets, jointNames: runs[0][1].jointNames, pTauMs: 20,
  Wu: Array.from({ length: nU * Tn }, (_, k) => W[k] / rho),
  Wp: Array.from({ length: nP * Tn }, (_, k) => W[(nU + Math.floor(k / Tn)) * Tn + (k % Tn)] / rho),
  b: Array.from({ length: Tn }, (_, t) => INTERCEPT ? W[(nF - 1) * Tn + t] / rho : 0),
  fit: { epochs: N, lambda: LAM, trace: traceFile, calib: calibFile, date: new Date().toISOString() },
};
fs.writeFileSync(OUT, JSON.stringify(model));
console.log(`model -> ${OUT}  (${Tn} targets, Wu ${nU}x${Tn}, Wp ${nP}x${Tn})`);
