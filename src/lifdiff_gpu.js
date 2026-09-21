// WebGPU adjoint for src/lifdiff.js -- the S4.7 port.
//
// What is on the GPU and what is not: the forward pass and the checkpoint-segment replay stay on
// the CPU (LIFDiff.forward / _replay). What moves to the device is the backward sweep itself --
// the eleven N-element adjoint vectors (lv, lgE, lgI, lad, lres, the nslots-deep ls ring,
// gLogGain, gDrive, and five per-neuron scalar accumulators) plus the edge traversal each step's
// arrival list drives. That is the part the spec names -- "the backward scatter over 10.5 M edges
// and the eleven 165,122-vectors" -- and the part whose cost profile (two streaming passes over N
// plus one fan-out walk per arrival) is exactly the shape a GPU wants.
//
// The split is honest about what it buys: CPU backward costs replay + sweep ~ 2.3x forward; this
// path costs forward + replay (CPU, unchanged) + a device sweep. The tape and arena come from the
// same CPU replay either way, so the GPU returns the gradient of the identical trajectory --
// scripts/grad_check_gpu.mjs compares the two directly rather than going back through finite
// differences.
//
// Per 16-step checkpoint segment, one compute pass holds 2*L ordered dispatches (dispatches in a
// pass are sequential):
//
//   kNeuron   one thread per neuron: reverses the post-step decays, dispatches on mode
//             (refractory / driven / integrated / soft-driven), applies the surrogate
//             derivative, deposits scalar-parameter terms in per-neuron accumulators.
//   kArrival  one thread per arriving spike: walks the presynaptic fan-out, gathers lgE/lgI
//             into lRaw (Kahan-compensated), scatters gInScale through an CAS-emulated f32
//             atomic accumulator (WGSL has no floating-point atomics), and writes per-arrival
//             {dWSyn, dDepU, dInhGain} records the host reduces in f64.
//
// No atomics are needed anywhere else: within one step's arrival list each presynaptic index
// appears once (a neuron spikes at most once per step), so the gLogGain, lres and ls-ring writes
// are single-writer. Scalar gradients that would need a global accumulator instead ride out as
// per-arrival or per-neuron arrays and are summed in f64 on the CPU -- strictly more accurate
// than fixed-point atomics, and the reduction is over megabytes rather than the edge set.
//
// Bindings pack the way src/lifgpu.js does (eight storage buffers per stage): one u32 read-only
// block, two f32 read-only blocks (statics and per-segment tape), one f32 read-write block for
// all adjoint state and accumulators, one atomic<u32> block for gInScale, and two uniforms --
// static params and per-step params at a dynamic offset.
import { DIFF_PARAMS } from './lifdiff.js';

const CHECKPOINT = 16;                    // must equal lifdiff.js
const DRIVE_MAX = 0.999;

const WGSL = /* wgsl */`
struct Static {
  N: u32, nslots: u32, ep: u32, nDrive: u32, epochs: u32, hasDrive: u32, hasPer: u32, soft: u32,
  driveSoft: u32, hasBeta: u32, hasOutScale: u32, hasEdgeGain: u32,
  dt: f32, dE: f32, dA: f32, kRec: f32, kM: f32, dtS: f32, cE: f32, cI: f32,
  vRest: f32, vReset: f32, vThresh: f32, eExc: f32, eInh: f32, kcThr: f32, laminB: f32,
  adaptInc: f32, depU: f32, wSyn: f32, inhGain: f32, betaS: f32, aClip: f32, driveMax: f32,
  uIndices: u32, uGatePk: u32, uModePk: u32, uThrPk: u32, uBiasPk: u32, uDSlot: u32, uArrPre: u32,
  fCounts: u32, fEdgeGain: u32, fInScale: u32, fSign: u32, fLogGain: u32, fOutScale: u32,
  fThrOff: u32, fSizeLog: u32, fDriveFix: u32, fBeta: u32, fArrAmp: u32,
  sVPre: u32, sGE: u32, sGI: u32, sAd: u32, sSp: u32, sResAt: u32,
  sDLdS: u32, sDPer: u32, sDTape: u32,
  rLv: u32, rLgE: u32, rLgI: u32, rLad: u32, rLres: u32, rRing: u32,
  rGLogGain: u32, rGDrive: u32, rAccA: u32, rAccV: u32, rAccK: u32, rAccL: u32, rAccEI: u32,
  rPerArr: u32,
};
struct Step {
  t: u32, r: u32, scored: u32, truncClear: u32,
  dOff: u32, arrG: u32, nArr: u32, resO: u32, emitOk: u32,
  pad: array<u32, 55>,
};
@group(0) @binding(0) var<uniform> P: Static;
@group(0) @binding(1) var<uniform> S: Step;
@group(0) @binding(2) var<storage, read> U: array<u32>;
@group(0) @binding(3) var<storage, read> F: array<f32>;
@group(0) @binding(4) var<storage, read> SG: array<f32>;
@group(0) @binding(5) var<storage, read_write> A: array<f32>;
@group(0) @binding(6) var<storage, read_write> AI: array<atomic<u32>>;

fn pkU8(base: u32, i: u32) -> u32 { return (U[base + (i >> 2u)] >> ((i & 3u) << 3u)) & 255u; }
fn clipv(x: f32) -> f32 {
  if (P.aClip > 0.0) { return clamp(x, -P.aClip, P.aClip); }
  return x;
}
// f32 atomic add -- WGSL has no floating atomics, so CAS on the bitcast word. Contention is the
// number of arrivals sharing a postsynaptic target in one step, small against the fan-out walk.
fn atomicAddF(ptr: ptr<storage, atomic<u32>, read_write>, delta: f32) {
  var old = atomicLoad(ptr);
  loop {
    let res = atomicCompareExchangeWeak(ptr, old, bitcast<u32>(bitcast<f32>(old) + delta));
    if (res.exchanged) { break; }
    old = res.old_value;
  }
}

// ---------------------------------------------------------------- neuron pass
// Reverses one step of integrate-and-spike: post-step decays first, then the mode dispatch, then
// the carried-adjoint clip. Scalar-parameter terms go to per-neuron accumulators; the drive
// adjoint lands in gDrive, whose slots are unique per neuron.
@compute @workgroup_size(256)
fn kNeuron(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.N) { return; }
  let N = P.N;
  if (S.truncClear != 0u) {
    A[P.rLv + i] = 0.0; A[P.rLgE + i] = 0.0; A[P.rLgI + i] = 0.0;
    A[P.rLad + i] = 0.0; A[P.rLres + i] = 0.0;
    for (var s = 0u; s < P.nslots; s++) { A[P.rRing + s * N + i] = 0.0; }
  }
  let off = S.r * N;
  let md = pkU8(P.uModePk, off + i);
  let lsI = P.rRing + (S.t % P.nslots) * N + i;
  let ls = A[lsI];
  let lpA = A[P.rLad + i];
  var lvO = A[P.rLv + i];
  var lgEO = A[P.rLgE + i] * P.dE;
  var lgIO = A[P.rLgI + i] * P.dE;
  var ladO = lpA * P.dA;
  var lresO = A[P.rLres + i] * (1.0 - P.kRec);
  var zeroLs = false;
  if (md == 1u) {                                   // refractory: v clamped to vReset
    lvO = 0.0;
  } else if (md == 2u) {                            // exogenously driven spike
    var dl = 0.0;
    if (S.scored != 0u) {
      if (P.hasPer != 0u) { dl = SG[P.sDPer + (S.t / P.ep) * N + i]; } else { dl = SG[P.sDLdS + i]; }
    }
    let lspike2 = ls + dl;
    A[P.rAccA + i] += ladO;
    if (P.hasDrive != 0u) {
      let ds = bitcast<i32>(U[P.uDSlot + i]);
      if (ds >= 0) { A[P.rGDrive + S.dOff + u32(ds)] += (ladO * P.adaptInc + lspike2) * P.dtS; }
    }
    lvO = 0.0; zeroLs = true;
  } else {                                          // integrated (0) or soft-driven (3)
    let vv = SG[P.sVPre + off + i];
    let gEv = SG[P.sGE + off + i];
    let gIv = SG[P.sGI + off + i];
    let bias = select(0.0, P.laminB, pkU8(P.uBiasPk, i) != 0u);
    let u = vv + (P.vRest - vv + gEv * (P.eExc - vv) * P.cE + gIv * (vv - P.eInh) * P.cI + bias) * P.kM;
    let thr = P.vThresh + SG[P.sAd + off + i] + select(0.0, P.kcThr, pkU8(P.uThrPk, i) != 0u) + F[P.fThrOff + i];
    let d = u - thr;
    let s = SG[P.sSp + off + i];
    var sd = 0.0; var st = s;
    var dsx = -1;
    if (P.hasDrive != 0u) { dsx = bitcast<i32>(U[P.uDSlot + i]); }
    if (md == 3u) {
      var rate = F[P.fDriveFix + i];
      if (dsx >= 0) { rate = SG[P.sDTape + S.dOff + u32(dsx)]; }
      sd = min(P.driveMax, rate * P.dtS); st = (s - sd) / (1.0 - sd);
    }
    let beta = select(P.betaS, F[P.fBeta + i], P.hasBeta != 0u);
    var sg: f32;
    if (P.soft != 0u) { sg = st * (1.0 - st) / beta; }
    else { let q = 1.0 + abs(d) / beta; sg = 1.0 / (beta * q * q); }
    var dl = 0.0;
    if (S.scored != 0u) {
      if (P.hasPer != 0u) { dl = SG[P.sDPer + (S.t / P.ep) * N + i]; } else { dl = SG[P.sDLdS + i]; }
    }
    let lspike = ls + dl;
    let lvNew = lvO;
    let lsTot = (P.vReset - u) * lvNew + lpA * P.adaptInc + lspike;
    let lt = lsTot * (1.0 - sd) * sg;
    let lu = lvNew * (1.0 - s) + lt;
    let lthr = -lt;
    if (dsx >= 0) { A[P.rGDrive + S.dOff + u32(dsx)] += lsTot * (1.0 - st) * P.dtS; }
    A[P.rAccA + i] += lpA * s;
    A[P.rAccV + i] += lthr;
    if (pkU8(P.uThrPk, i) != 0u) { A[P.rAccK + i] += lthr; }
    ladO = ladO + lthr * P.dA;
    lvO = lu * (1.0 + P.kM * (-1.0 - gEv * P.cE + gIv * P.cI));
    lgEO = lgEO + lu * P.kM * (P.eExc - vv) * P.cE;
    lgIO = lgIO + lu * P.kM * (vv - P.eInh) * P.cI;
    if (bias != 0.0) { A[P.rAccL + i] += lu * P.kM; }
    A[P.rAccEI + i] += lu * P.kM * gIv * P.cI * (-1.0 + (vv - P.eInh) * P.cI);
    zeroLs = true;
  }
  A[P.rLv + i] = clipv(lvO);
  A[P.rLgE + i] = clipv(lgEO);
  A[P.rLgI + i] = clipv(lgIO);
  A[P.rLad + i] = clipv(ladO);
  A[P.rLres + i] = clipv(lresO);
  if (zeroLs) { A[lsI] = 0.0; }
}

// ---------------------------------------------------------------- arrival pass
// Reverses the synaptic delivery of step t: one thread per arrival walks the presynaptic fan-out.
// lRaw is the adjoint of the delivered amount, summed over out-edges with Kahan compensation.
// gInScale is a genuine scatter -> atomic fixed point; everything indexed by pre is
// single-writer within the step, because a neuron emits at most one spike per step.
@compute @workgroup_size(256)
fn kArrival(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= S.nArr) { return; }
  let gi = S.arrG + k;                                 // tape-wide arrival index
  let pre = U[P.uArrPre + gi];
  let out3 = P.rPerArr + 3u * gi;
  let sgn = F[P.fSign + pre];
  if (sgn == 0.0) {
    A[out3] = 0.0; A[out3 + 1u] = 0.0; A[out3 + 2u] = 0.0;
    return;
  }
  let amp = F[P.fArrAmp + gi];
  let resAtv = SG[P.sResAt + S.resO + k];
  let os = select(1.0, F[P.fOutScale + pre], P.hasOutScale != 0u);
  let gain = exp(F[P.fLogGain + pre]) * os;
  let base = sgn * P.wSyn * gain * resAtv;
  let eff = base * amp;
  let a = U[pre]; let b = U[pre + 1u];
  var lRaw = 0.0; var lC = 0.0;                        // Kahan: lC carries the lost low bits
  var dInh = 0.0;
  if (eff > 0.0) {
    for (var j = a; j < b; j++) {
      if (pkU8(P.uGatePk, j) == 0u) { continue; }
      let q = U[P.uIndices + j];
      let eg = select(1.0, F[P.fEdgeGain + j], P.hasEdgeGain != 0u);
      let cw = F[P.fCounts + j] * eg;
      let lq = A[P.rLgE + q];
      let term = lq * cw * F[P.fInScale + q];
      let y = term - lC; let tt = lRaw + y; lC = (tt - lRaw) - y; lRaw = tt;
      atomicAddF(&AI[q], lq * cw * eff);
    }
  } else {
    for (var j = a; j < b; j++) {
      if (pkU8(P.uGatePk, j) == 0u) { continue; }
      let q = U[P.uIndices + j];
      let eg = select(1.0, F[P.fEdgeGain + j], P.hasEdgeGain != 0u);
      let cw = F[P.fCounts + j] * eg;
      let lq = A[P.rLgI + q];
      let term = lq * cw * F[P.fInScale + q];
      let y = term * P.inhGain - lC; let tt = lRaw + y; lC = (tt - lRaw) - y; lRaw = tt;
      atomicAddF(&AI[q], lq * cw * P.inhGain * eff);
      dInh += term * eff;
    }
  }
  A[out3] = lRaw * sgn * gain * resAtv * amp;          // d wSyn
  A[out3 + 1u] = -A[P.rLres + pre] * resAtv;           // d depU (lresAfter = post-decay value)
  A[out3 + 2u] = dInh;                                 // d inhGain
  A[P.rGLogGain + pre] += lRaw * eff;
  if (S.emitOk != 0u) {
    let emit = S.t - (P.nslots - 1u);
    A[P.rRing + (emit % P.nslots) * P.N + pre] = clipv(lRaw * base);
  }
  A[P.rLres + pre] = clipv(A[P.rLres + pre] * (1.0 - P.depU) + lRaw * sgn * P.wSyn * gain * amp);
}
`;

/**
 * GPU backward sweep for LIFDiff. init() uploads the graph, params, tape arrivals and loss
 * weights once; backward() replays each checkpoint segment on the CPU (filling the arena exactly
 * as LIFDiff.backward does), uploads it, and runs the two kernels per step on the device. Returns
 * the same gradient object LIFDiff.backward returns.
 */
export class LIFAdjointGPU {
  constructor(device) {
    this.device = device;
    const mod = device.createShaderModule({ code: WGSL });
    this.bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    this.pNeuron = device.createComputePipeline({ layout, compute: { module: mod, entryPoint: 'kNeuron' } });
    this.pArrival = device.createComputePipeline({ layout, compute: { module: mod, entryPoint: 'kArrival' } });
  }

  /** Upload graph, params, loss weights and the tape's arrival lists. */
  init(net, tape, opts = {}) {
    const p = net.p, N = net.N, E = net.counts.length, dev = this.device;
    const L = CHECKPOINT;
    this.net = net; this.tape = tape; this.opts = opts;
    const nslots = this.nslots = net.nslots;
    const nD = tape.nDrive || 0, epochs = tape.epochs || 0;
    const dPer = opts.dLdSpikePerEpoch || null;

    // tape-wide arrival offsets: arrivals for step t start at gArrOff[t]
    const gArrOff = this.gArrOff = new Uint32Array(tape.steps + 1);
    for (let t = 0; t < tape.steps; t++) gArrOff[t + 1] = gArrOff[t] + tape.arrivals[t].idx.length;
    const arrTot = this.arrTot = gArrOff[tape.steps];
    // largest single-segment arrival count, for the resAt block
    let segCap = 1;
    for (let s = 0; s < tape.steps; s += L) segCap = Math.max(segCap, gArrOff[Math.min(tape.steps, s + L)] - gArrOff[s]);
    this.segArrCap = segCap;

    // ---- u32 read-only block
    const uOff = {};
    let uw = 0;
    const uput = (name, words) => { uOff[name] = uw; uw += words; };
    uput('indptr', N + 1); uput('indices', E); uput('gatePk', Math.ceil(E / 4));
    uput('modePk', Math.ceil(L * N / 4));
    uput('thrPk', Math.ceil(N / 4)); uput('biasPk', Math.ceil(N / 4)); uput('dSlot', N);
    uput('arrPre', arrTot);
    const U = new Uint32Array(uw);
    U.set(net.indptr, uOff.indptr);
    U.set(net.indices, uOff.indices);
    new Uint8Array(U.buffer, uOff.gatePk * 4, E).set(net.gate);
    new Uint8Array(U.buffer, uOff.thrPk * 4, N).set(net.thrMask);
    new Uint8Array(U.buffer, uOff.biasPk * 4, N).set(net.biasMask);
    if (net.driveSlot) U.set(new Uint32Array(net.driveSlot.buffer, net.driveSlot.byteOffset, N), uOff.dSlot);
    else new Int32Array(U.buffer, uOff.dSlot * 4, N).fill(-1);
    for (let t = 0; t < tape.steps; t++) U.set(tape.arrivals[t].idx, uOff.arrPre + gArrOff[t]);

    // ---- f32 read-only static block
    const fOff = {};
    let fw = 0;
    const fput = (name, len) => { fOff[name] = fw; fw += len; };
    fput('counts', E); fput('edgeGain', net.edgeGain ? E : 1); fput('inScale', N); fput('sign', N);
    fput('logGain', N); fput('outScale', net.outScale ? N : 1); fput('thrOff', N);
    fput('sizeLog', N); fput('driveFix', N); fput('beta', typeof p.surrogateBeta === 'number' ? 1 : N);
    fput('arrAmp', arrTot);
    const F = new Float32Array(fw);
    F.set(Float32Array.from(net.counts), fOff.counts);
    if (net.edgeGain) F.set(net.edgeGain, fOff.edgeGain);
    F.set(net.inScale, fOff.inScale); F.set(net.sign, fOff.sign); F.set(net.logGain, fOff.logGain);
    if (net.outScale) F.set(net.outScale, fOff.outScale);
    F.set(net.thrOffset, fOff.thrOff); F.set(net.sizeLog, fOff.sizeLog); F.set(net.drive, fOff.driveFix);
    const betaArr = typeof p.surrogateBeta === 'number' ? null : p.surrogateBeta;
    if (betaArr) F.set(betaArr, fOff.beta);
    for (let t = 0; t < tape.steps; t++) F.set(tape.arrivals[t].amp, fOff.arrAmp + gArrOff[t]);

    // ---- f32 read-only per-segment block (rewritten each segment)
    const sOff = {};
    let sw = 0;
    const sput = (name, len) => { sOff[name] = sw; sw += len; };
    sput('vPre', L * N); sput('gE', L * N); sput('gI', L * N); sput('sA', L * N); sput('sp', L * N);
    sput('resAt', segCap);
    sput('dLdS', N); sput('dPer', dPer ? epochs * N : 1); sput('dTape', Math.max(1, nD * Math.max(1, epochs)));
    const SG = new Float32Array(sw);
    SG.set(opts.dLdSpike, sOff.dLdS);
    if (dPer) SG.set(dPer, sOff.dPer);
    if (nD) SG.set(tape.driveAt, sOff.dTape);

    // ---- f32 read-write block: adjoint state + accumulators + per-arrival output
    const rOff = {};
    let rw = 0;
    const rput = (name, len) => { rOff[name] = rw; rw += len; };
    rput('lv', N); rput('lgE', N); rput('lgI', N); rput('lad', N); rput('lres', N);
    rput('ring', nslots * N);
    rput('gLogGain', N); rput('gDrive', Math.max(1, nD * Math.max(1, epochs)));
    rput('accA', N); rput('accV', N); rput('accK', N); rput('accL', N); rput('accEI', N);
    rput('perArr', 3 * Math.max(1, arrTot));
    this.uOff = uOff; this.fOff = fOff; this.sOff = sOff; this.rOff = rOff;

    // ---- uniforms
    const dE = Math.exp(-p.dt / p.tauSyn), dA = Math.exp(-p.dt / p.adaptTau), kRec = p.dt / p.depTau;
    const kM = p.dt / p.tauM, dtS = p.dt / 1000;
    const cE = 1 / (p.eExc - p.vRest), cI = 1 / (p.vRest - p.eInh);
    const st = new ArrayBuffer(384);
    const su = new Uint32Array(st), sf = new Float32Array(st);
    [N, nslots, net.driveEpoch, nD, epochs, net.driveSlot ? 1 : 0, dPer ? 1 : 0,
      p.soft ? 1 : 0, p.driveSoft ? 1 : 0, betaArr ? 1 : 0, net.outScale ? 1 : 0,
      net.edgeGain ? 1 : 0].forEach((v, i) => su[i] = v);
    [p.dt, dE, dA, kRec, kM, dtS, cE, cI, p.vRest, p.vReset, p.vThresh, p.eExc, p.eInh,
      p.kcThreshold, p.laminaBias, p.adaptInc, p.depU, p.wSyn, p.inhGain,
      betaArr ? 0 : p.surrogateBeta, p.adjClip || 0, DRIVE_MAX].forEach((v, i) => sf[12 + i] = v);
    [uOff.indices, uOff.gatePk, uOff.modePk, uOff.thrPk, uOff.biasPk, uOff.dSlot,
      uOff.arrPre].forEach((v, i) => su[34 + i] = v);
    [fOff.counts, fOff.edgeGain, fOff.inScale, fOff.sign, fOff.logGain, fOff.outScale,
      fOff.thrOff, fOff.sizeLog, fOff.driveFix, fOff.beta, fOff.arrAmp].forEach((v, i) => su[41 + i] = v);
    [sOff.vPre, sOff.gE, sOff.gI, sOff.sA, sOff.sp, sOff.resAt,
      sOff.dLdS, sOff.dPer, sOff.dTape].forEach((v, i) => su[52 + i] = v);
    [rOff.lv, rOff.lgE, rOff.lgI, rOff.lad, rOff.lres, rOff.ring, rOff.gLogGain,
      rOff.gDrive, rOff.accA, rOff.accV, rOff.accK, rOff.accL, rOff.accEI,
      rOff.perArr].forEach((v, i) => su[61 + i] = v);

    const usageRO = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const usageRW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.bStatic = dev.createBuffer({ size: st.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bStep = dev.createBuffer({ size: 256 * L, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bU = dev.createBuffer({ size: U.byteLength, usage: usageRO });
    this.bF = dev.createBuffer({ size: F.byteLength, usage: usageRO });
    this.bSG = dev.createBuffer({ size: SG.byteLength, usage: usageRO });
    this.bA = dev.createBuffer({ size: rw * 4, usage: usageRW });
    this.bAI = dev.createBuffer({ size: N * 4, usage: usageRW });
    dev.queue.writeBuffer(this.bStatic, 0, st);
    dev.queue.writeBuffer(this.bU, 0, U);
    dev.queue.writeBuffer(this.bF, 0, F);
    dev.queue.writeBuffer(this.bSG, 0, SG);
    dev.queue.writeBuffer(this.bA, 0, new Float32Array(rw));
    dev.queue.writeBuffer(this.bAI, 0, new Int32Array(N));
    this.bg = dev.createBindGroup({ layout: this.bgl, entries: [
      { binding: 0, resource: { buffer: this.bStatic } },
      { binding: 1, resource: { buffer: this.bStep, size: 256 } },
      { binding: 2, resource: { buffer: this.bU } },
      { binding: 3, resource: { buffer: this.bF } },
      { binding: 4, resource: { buffer: this.bSG } },
      { binding: 5, resource: { buffer: this.bA } },
      { binding: 6, resource: { buffer: this.bAI } },
    ] });
    this.modeStage = new Uint8Array(L * N);
    this.stepBuf = new ArrayBuffer(256 * L);
    return this;
  }

  /**
   * Run the backward sweep. Returns { params, logGain, drive, truncate, clamped, timing } --
   * the same shape as LIFDiff.backward() plus a millisecond breakdown.
   */
  async backward() {
    const { net, tape, opts, device: dev, nslots, gArrOff } = this;
    const N = net.N, L = CHECKPOINT, steps = tape.steps, p = net.p;
    const truncate = opts.truncate || 0, lossFrom = opts.lossFrom || 0;
    const ep = net.driveEpoch, nD = tape.nDrive || 0;
    const timing = { replayMs: 0, uploadMs: 0, encodeMs: 0, waitMs: 0, readbackMs: 0 };
    const bounds = [];
    for (let s = 0; s < steps; s += L) bounds.push([s, Math.min(steps, s + L)]);

    net.tape = tape;
    for (let b = bounds.length - 1; b >= 0; b--) {
      const [from, to] = bounds[b];
      const tr = performance.now();
      const A = net._replay(from, to);
      timing.replayMs += performance.now() - tr;
      const segLen = to - from;
      // stage the segment: mode bytes + arena f32 slices + per-step params
      this.modeStage.set(A.mode.subarray(0, segLen * N));
      const tu = performance.now();
      dev.queue.writeBuffer(this.bU, this.uOff.modePk * 4,
        this.modeStage.buffer, 0, Math.ceil(segLen * N / 4) * 4);
      const sg = this.sOff;
      dev.queue.writeBuffer(this.bSG, sg.vPre * 4, A.vPre.buffer, 0, segLen * N * 4);
      dev.queue.writeBuffer(this.bSG, sg.gE * 4, A.gE.buffer, 0, segLen * N * 4);
      dev.queue.writeBuffer(this.bSG, sg.gI * 4, A.gI.buffer, 0, segLen * N * 4);
      dev.queue.writeBuffer(this.bSG, sg.sA * 4, A.adapt.buffer, 0, segLen * N * 4);
      dev.queue.writeBuffer(this.bSG, sg.sp * 4, A.sp.buffer, 0, segLen * N * 4);
      const nRes = A.resOff[segLen];
      dev.queue.writeBuffer(this.bSG, sg.resAt * 4, A.resAt.buffer, 0, nRes * 4);
      const stepRec = new DataView(this.stepBuf);
      for (let r = 0; r < segLen; r++) {
        const t = from + r, dw = r * 256;
        stepRec.setUint32(dw + 0, t, true);
        stepRec.setUint32(dw + 4, r, true);
        stepRec.setUint32(dw + 8, t >= lossFrom ? 1 : 0, true);
        stepRec.setUint32(dw + 12, truncate > 0 && (t + 1) % truncate === 0 ? 1 : 0, true);
        stepRec.setUint32(dw + 16, nD ? ((t / ep) | 0) * nD : 0, true);
        stepRec.setUint32(dw + 20, gArrOff[t], true);
        stepRec.setUint32(dw + 24, tape.arrivals[t].idx.length, true);
        stepRec.setUint32(dw + 28, A.resOff[r], true);
        stepRec.setUint32(dw + 32, t - (nslots - 1) >= 0 ? 1 : 0, true);
      }
      dev.queue.writeBuffer(this.bStep, 0, this.stepBuf);
      timing.uploadMs += performance.now() - tu;

      const tg = performance.now();
      const enc = dev.createCommandEncoder();
      const cp = enc.beginComputePass();
      for (let r = segLen - 1; r >= 0; r--) {
        cp.setPipeline(this.pNeuron);
        cp.setBindGroup(0, this.bg, [r * 256]);
        cp.dispatchWorkgroups(Math.ceil(N / 256));
        const nArr = stepRec.getUint32(r * 256 + 24, true);
        if (nArr) {
          cp.setPipeline(this.pArrival);
          cp.setBindGroup(0, this.bg, [r * 256]);
          cp.dispatchWorkgroups(Math.ceil(nArr / 256));
        }
      }
      cp.end();
      dev.queue.submit([enc.finish()]);
      timing.encodeMs += performance.now() - tg;
    }
    const tw0 = performance.now();
    await dev.queue.onSubmittedWorkDone();
    timing.waitMs = performance.now() - tw0;
    const tw = performance.now();

    // ---- readback and f64 reduction on the host
    const r = this.rOff;
    const rb = async (buf, off, len, Arr) => {
      const out = dev.createBuffer({ size: len * Arr.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = dev.createCommandEncoder();
      enc.copyBufferToBuffer(buf, off * 4, out, 0, len * Arr.BYTES_PER_ELEMENT);
      dev.queue.submit([enc.finish()]);
      await out.mapAsync(GPUMapMode.READ);
      const res = new Arr(out.getMappedRange().slice(0)); out.unmap(); out.destroy();
      return res;
    };
    const nDrive = Math.max(1, nD * Math.max(1, tape.epochs || 0));
    const [gLogGain, gDrive, accA, accV, accK, accL, accEI, perArr, gInI] = await Promise.all([
      rb(this.bA, r.gLogGain, N, Float32Array), rb(this.bA, r.gDrive, nDrive, Float32Array),
      rb(this.bA, r.accA, N, Float32Array), rb(this.bA, r.accV, N, Float32Array),
      rb(this.bA, r.accK, N, Float32Array), rb(this.bA, r.accL, N, Float32Array),
      rb(this.bA, r.accEI, N, Float32Array), rb(this.bA, r.perArr, 3 * this.arrTot, Float32Array),
      rb(this.bAI, 0, N, Int32Array),
    ]);
    timing.readbackMs = performance.now() - tw;
    const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
    const g = Object.fromEntries(DIFF_PARAMS.map(k => [k, 0]));
    g.adaptInc = sum(accA); g.vThresh = sum(accV); g.kcThreshold = sum(accK);
    g.laminaBias = sum(accL); g.eInh = sum(accEI);
    for (let k = 0; k < this.arrTot; k++) {
      g.wSyn += perArr[3 * k]; g.depU += perArr[3 * k + 1]; g.inhGain += perArr[3 * k + 2];
    }
    const gInScale = new Float32Array(gInI.buffer);       // the i32 words carry bitcast f32 sums
    const { sizeLog } = net;
    for (let i = 0; i < N; i++) {
      const raw = Math.exp(-p.sizeAlpha * sizeLog[i]);
      if (raw < p.boostCap && raw > 1 / p.maxSizeScale) g.sizeAlpha += gInScale[i] * (-sizeLog[i]) * raw;
    }
    const clamped = { params: 0, logGain: 0, drive: 0 };
    for (const k of DIFF_PARAMS) if (!Number.isFinite(g[k])) { g[k] = 0; clamped.params++; }
    for (let i = 0; i < N; i++) if (!Number.isFinite(gLogGain[i])) { gLogGain[i] = 0; clamped.logGain++; }
    if (nD) for (let k = 0; k < gDrive.length; k++) if (!Number.isFinite(gDrive[k])) { gDrive[k] = 0; clamped.drive++; }
    return { params: g, logGain: gLogGain, drive: nD ? gDrive : null, truncate, clamped, timing };
  }
}
