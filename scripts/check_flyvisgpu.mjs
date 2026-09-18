// Checks the WebGPU flyvis kernel (src/flyvisgpu.js) against the model it reimplements, on the shipped
// 45,669-node export, and checks that two eyes on one device share one parameter buffer.
//
// The reference here is a direct JS transcription of fv_step (src/wasm/lif.c), which doc 11 records as
// matching the trained PyTorch model to 2e-6 — so agreeing with it closes the chain to the paper's model.
// The GPU kernel accumulates in fixed point (WGSL has no f32 atomics), so exact equality is not the bar;
// the test reports the largest disagreement and fails if it exceeds a tolerance the fixed-point step size
// explains.
//
//   node scripts/check_flyvisgpu.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/') { r.setHeader('content-type', 'text/html'); r.end('<html></html>'); return; }
  fs.readFile(path.join(ROOT, u), (e, d) => {
    if (e) { r.statusCode = 404; r.end(); return; }
    r.setHeader('content-type', MIME[path.extname(u)] || 'application/octet-stream'); r.end(d);
  });
}).listen(8901);

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { const t = m.text(), url = m.location()?.url || '';
  if (/favicon/i.test(url) || /favicon/i.test(t)) return;   // the blank test page has none; not a failure
  if (m.type() === 'error' || /validation/i.test(t)) errors.push(`${t} ${url}`.trim()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:8901/');

const out = await page.evaluate(async () => {
  const { parseFlyVis } = await import('/src/flyvis.js');
  const { FlyVisGpu, flyvisSharedStats } = await import('/src/flyvisgpu.js');
  const [bin, json, inputs] = await Promise.all([
    fetch('/public/vision/flyvis.bin').then(r => r.arrayBuffer()),
    fetch('/public/vision/flyvis.json').then(r => r.json()),
    fetch('/public/vision/flyvis_inputs.json').then(r => r.json()),
  ]);
  const model = parseFlyVis(bin, json, inputs);
  const { N, E, indptr, target, weight, bias, tau, dt } = model;

  // reference: fv_step, transcribed
  const kdt = Float32Array.from(tau, t => dt / Math.max(t, dt));
  const v = new Float32Array(bias), acc = new Float32Array(N), x = new Float32Array(N);
  const refStep = () => {
    acc.fill(0);
    for (let j = 0; j < N; j++) { const r = v[j]; if (r <= 0) continue;
      for (let k = indptr[j], e = indptr[j + 1]; k < e; k++) acc[target[k]] += weight[k] * r; }
    for (let i = 0; i < N; i++) v[i] += kdt[i] * (-v[i] + bias[i] + acc[i] + x[i]);
  };
  const setInput = (arr, lum) => { for (const t in model.inputIdx) { const ix = model.inputIdx[t];
    for (let k = 0; k < ix.length; k++) arr[ix[k]] = lum[k]; } };

  // a structured stimulus rather than a flat field: a bright bar across the column array
  const nCol = model.inputIdx.R1.length;
  const lum = new Float32Array(nCol);
  for (let c = 0; c < nCol; c++) lum[c] = (c % 27) < 9 ? 0.9 : 0.1;

  const t0 = performance.now();
  const eyeL = await FlyVisGpu.create({ model });
  const eyeR = await FlyVisGpu.create({ model });          // second eye: must reuse the parameter pack
  const created = performance.now() - t0;
  const shared = flyvisSharedStats();

  setInput(x, lum); eyeL.setInput(lum);
  const STEPS = 25;                                        // 0.5 s of model time at dt = 20 ms
  for (let s = 0; s < STEPS; s++) refStep();
  const tg = performance.now();
  eyeL.step(STEPS);
  const gv = await eyeL.sync();
  const gpuMs = performance.now() - tg;

  let maxAbs = 0, maxRel = 0, sum = 0, nz = 0, argmax = -1;
  for (let i = 0; i < N; i++) {
    const d = Math.abs(gv[i] - v[i]);
    if (d > maxAbs) { maxAbs = d; argmax = i; }
    const den = Math.max(Math.abs(v[i]), 1e-3);
    maxRel = Math.max(maxRel, d / den);
    sum += d; if (Math.abs(v[i]) > 1e-6) nz++;
  }
  // an untouched second eye must sit at rest, which also proves the eyes do not share state
  const rv = await eyeR.sync();
  let restMax = 0;
  for (let i = 0; i < N; i++) restMax = Math.max(restMax, Math.abs(rv[i] - bias[i]));

  const aliveL = gv.reduce((a, z) => a + (z > 0 ? 1 : 0), 0);
  return { N, E, steps: STEPS, maxAbs, maxRel, meanAbs: sum / N, nonzeroRef: nz, argmax,
           refAtArgmax: v[argmax], gpuAtArgmax: gv[argmax], activeGpu: aliveL,
           shared, createdMs: created, gpuMs, restMax };
});

await browser.close();
srv.close();

const f2 = (x) => +x.toFixed(6);
console.log(`flyvis export: ${out.N} nodes, ${out.E} edges; ${out.steps} steps`);
console.log(`shared parameter packs on the device: ${out.shared.packs} (${(out.shared.bytes / 1e6).toFixed(1)} MB) for ${out.shared.refs} eyes`);
console.log(`max |GPU - reference| ${f2(out.maxAbs)}  (node ${out.argmax}: ref ${f2(out.refAtArgmax)} vs gpu ${f2(out.gpuAtArgmax)})`);
console.log(`mean |diff| ${f2(out.meanAbs)}, max relative ${f2(out.maxRel)}, ${out.activeGpu} nodes above zero`);
console.log(`second eye still at rest: max |v - bias| = ${f2(out.restMax)}`);
console.log(`create ${out.createdMs.toFixed(0)} ms, ${out.steps} steps ${out.gpuMs.toFixed(0)} ms`);

let bad = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) bad++; };
check(out.shared.packs === 1 && out.shared.refs === 2, 'two eyes share one parameter pack on one device');
check(out.maxAbs < 1e-3, 'GPU matches the reference within the fixed-point step');
check(out.meanAbs < 1e-4, 'mean disagreement is far below the per-node signal');
check(out.activeGpu > 100, 'the GPU model is actually active (not a field of zeros)');
check(out.restMax === 0, 'per-eye state is private');
if (errors.length) { console.log('\nbrowser errors:'); for (const e of errors.slice(0, 5)) console.log('  ' + e); bad++; }
console.log(bad ? `\n${bad} check(s) failed` : '\nall flyvis GPU checks passed');
process.exit(bad ? 1 : 0);
