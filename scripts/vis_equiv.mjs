// Is the differentiable chain the same model as the one that ships?
//
// src/visdiff.js reimplements two things that already exist and run elsewhere: the optic-lobe step
// (fv_step, in the wasm kernel) and the coupling from optic-lobe activity to CNS drive rate
// (driveFromEyes in scripts/calib_eval.mjs, update() in src/sim/vision.js). A gradient is only worth
// having if it is the gradient of the shipped model, so this compares the two implementations on the
// real loom stimulus at full scale: 45,669 optic-lobe nodes per eye, 1,513,231 edges, the real
// anatomical column map, the real 62,157-pair coupling.
//
//   node scripts/vis_equiv.mjs [opticLobeSteps]
//
// What is compared is the optic-lobe trajectory node by node and the drive rate pair by pair. The
// arithmetic is meant to be bit-identical -- same Float32 accumulators, same traversal order -- so the
// bar is exact equality, not a tolerance. Anything else means the adjoint differentiates a model the
// simulator does not run.
import fs from 'node:fs';
import { parseFlyVis, FlyVis, flyvisBytes } from '../src/flyvis.js';
import { FlyVisDiff } from '../src/flyvisdiff.js';
import { COUPLING } from '../src/visdiff.js';

const STEPS = +(process.argv[2] || 35);
const FVB = fs.readFileSync('public/vision/flyvis.bin');
const FVM = parseFlyVis(FVB.buffer.slice(FVB.byteOffset, FVB.byteOffset + FVB.byteLength),
  JSON.parse(fs.readFileSync('public/vision/flyvis.json')),
  JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json')));
const FVMAP = JSON.parse(fs.readFileSync('public/vision/flyvis_map.json'));
const COLDIRS = ['L', 'R'].map(sd => FVMAP.eyes[sd].dirs);
console.log(`flyvis: ${FVM.N} nodes, ${FVM.E} edges per eye | ${STEPS} optic-lobe steps (${STEPS * 20} ms)`);

// the loom of scripts/calib_eval.mjs: a dark disc expanding at az 40, el 10
function lumLoom(eye, t) {
  const c = [Math.cos(0.17) * Math.cos(0.7), Math.cos(0.17) * Math.sin(0.7), Math.sin(0.17)];
  const rad = (5 + 70 * Math.max(0, Math.min(1, t / 0.4)) ** 2) * Math.PI / 180;
  return Float32Array.from(COLDIRS[eye], d =>
    Math.acos(Math.min(1, d[0] * c[0] + d[1] * c[1] + d[2] * c[2])) < rad ? 0.05 : 0.5);
}

// ---- the shipped path: the wasm kernel ------------------------------------------------------------
const PAGES = Math.ceil((flyvisBytes(FVM.N, FVM.E) * 2 + FVM.N * 4 * 8 + (8 << 20)) / 65536);
const MEM = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES, shared: true });
const INST = (await WebAssembly.instantiate(fs.readFileSync('public/lif.wasm'), { env: { memory: MEM } })).instance;
const e0 = new FlyVis(INST, MEM, 0, FVM);
const e1 = new FlyVis(INST, MEM, (e0.end + 4095) & ~4095, { ...FVM, shared: e0.sharedParts, bias: e0.bias });
const wasmEyes = [e0, e1];

// ---- the differentiable path ----------------------------------------------------------------------
const d0 = new FlyVisDiff(FVM);
const d1 = new FlyVisDiff(FVM, d0.sharedParts);
const jsEyes = [d0, d1];

// settle both the same way src/sim/vision.js does, then compare the settled states
const grey = new Float32Array(721).fill(0.5);
for (const e of wasmEyes) { e.reset(); e.setInput(grey); for (let k = 0; k < 150; k++) e.step(); }
for (const e of jsEyes) e.settle(grey, 150);
const cmp = (a, b) => { let bad = 0, worst = 0, wi = -1;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]);
    if (a[i] !== b[i]) bad++; if (d > worst) { worst = d; wi = i; } }
  return { bad, worst, wi }; };
{ const c = cmp(wasmEyes[0].v, jsEyes[0].v);
  console.log(`after settling (150 steps on grey): ${c.bad} of ${FVM.N} nodes differ, worst ${c.worst.toExponential(3)}`); }

// ---- the loom, step by step ----------------------------------------------------------------------
const vRestW = wasmEyes[0].v.slice(), vRestJ = jsEyes[0].v.slice();
let worstV = 0, badV = 0, worstR = 0, badR = 0, totR = 0;
const PAIRS = ['L', 'R'].map(sd => ({ n: Int32Array.from(FVMAP.eyes[sd].pairs, q => q[0]),
  node: Int32Array.from(FVMAP.eyes[sd].pairs, q => q[1]) }));
const rate = (a, gain = COUPLING.gain) => (a > COUPLING.dead ? Math.min(COUPLING.cap, gain * a) : 0);
for (let t = 0; t < STEPS; t++) {
  const tt = t * 0.02;
  for (let s = 0; s < 2; s++) {
    wasmEyes[s].setInput(lumLoom(s, tt)); wasmEyes[s].step();
    jsEyes[s].setInput(lumLoom(s, tt)); jsEyes[s].step();
    const c = cmp(wasmEyes[s].v, jsEyes[s].v);
    badV += c.bad; if (c.worst > worstV) worstV = c.worst;
    // and the quantity the CNS actually sees
    const P = PAIRS[s];
    for (let k = 0; k < P.n.length; k++) {
      const rw = rate(wasmEyes[s].v[P.node[k]] - vRestW[P.node[k]]);
      const rj = rate(jsEyes[s].v[P.node[k]] - vRestJ[P.node[k]]);
      totR++; if (rw !== rj) badR++;
      const d = Math.abs(rw - rj); if (d > worstR) worstR = d;
    }
  }
}
const nV = STEPS * 2 * FVM.N;
console.log(`optic-lobe trajectory: ${badV} of ${nV} node-steps differ (${(100 * badV / nV).toFixed(4)}%),`
  + ` worst ${worstV.toExponential(3)}`);
console.log(`drive rate:            ${badR} of ${totR} pair-steps differ (${(100 * badR / totR).toFixed(4)}%),`
  + ` worst ${worstR.toExponential(3)} Hz`);

const exact = badV === 0 && badR === 0;
console.log(`\n${exact ? 'PASS: bit-identical to the shipped kernel'
  : `FAIL: the differentiable chain is not the shipped model (${badV} node-steps, ${badR} pair-steps)`}`);
process.exit(exact ? 0 : 1);
