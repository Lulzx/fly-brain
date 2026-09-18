// Differentiable whole-CNS LIF: the same dynamics as src/lif.js, with an adjoint.
//
// The calibrated model (docs/07-calibration.md) is fitted by cross-entropy search over nine global
// parameters. That works because nine is small. It cannot reach the parameters a connectome-constrained
// model actually has -- a gain per neuron, a time constant per cell type -- because a
// population search does not scale to 10^5 dimensions. Gradients do, which is how the optic-lobe
// model this project depends on was fitted (Lappalainen et al. 2024). This module supplies them for
// the rest of the nervous system.
//
// Spikes are not differentiable, so the backward pass substitutes a surrogate derivative for the
// threshold (Zenke & Ganguli 2018): the forward pass spikes exactly as src/lif.js does, and only the
// gradient pretends the threshold is soft. The surrogate is the fast-sigmoid derivative
// 1 / (1 + |u - thr| / beta)^2, scaled by 1/beta.
//
// What is differentiable, and what is not, is a property of the model rather than of this code:
//
//   differentiable   wSyn, sizeAlpha, inhGain, eInh, vThresh, kcThreshold, laminaBias, adaptInc,
//                    depU, and a per-neuron log-gain on outgoing weights (N parameters)
//   not              minSyn (a discrete gate on the graph), tRef and delay (integer step counts),
//                    and the two fixed per-neuron arrays below
//
// Two of the nine fitted global parameters therefore have no gradient, which is worth stating plainly:
// a differentiable whole-brain simulator is differentiable in most of its parameters, not all of them.
//
// `outScale` and `thrOffset` are the structure the shipped model has and this one used to be missing.
// scripts/calib_eval.mjs does not hand a bare connectome to the kernel: makeBrain applies a per-cell-type
// gain on outgoing synapses (`typeGains`), per-class physiology, the removal of octopaminergic fast
// synapses, and a static octopamine tone that shifts thresholds (`Neuromod`). Without them this module
// reached 59% of the shipped model's MN9 rate on the assay both were meant to be running, so its
// gradients were the gradients of a different model. `outScale` carries the type gain and `thrOffset`
// the class physiology and the octopamine tone; `preSign` carries the sign removal, as it always could.
// src/diffsetup.js builds all three from the same functions makeBrain calls, so the two cannot drift.
// They are inputs rather than parameters: correct, because the calibration does not fit them either.
//
// The exogenous drive used to be on that second list. It is not any more: `driveIdx` names a set of
// neurons whose drive rate is an input rather than a constant, and `backward` returns the gradient
// with respect to that rate at every drive epoch. That is the hook the optic lobe hangs on
// (src/visdiff.js): flyvis produces the drive, so a gradient on the drive is a gradient that crosses
// from one model into the other, and a visual assay can be fitted end to end.
//
// The drive is a Poisson sample, so its gradient needs the same kind of justification the spike
// threshold does, and it is the same justification. The smooth model the surrogate stands in for is
// `driveSoft: true`, where a driven neuron spikes with graded amplitude
//
//     s = sd + (1 - sd) * st,        sd = drive * dt/1000,   st = the threshold's own amplitude
//
// -- it fires because it was driven, or, failing that, because it crossed threshold. That model is
// genuinely differentiable in `drive` (ds/dsd = 1 - st) and is what scripts/vis_grad_check.mjs checks
// the adjoint against. The sampling forward has the same expected spike count and is left
// bit-identical to src/lif.js; against it the adjoint drops the cross term, using ds/dsd = 1 - s at a
// step that integrated and 1 at a step the drive fired. Both dropped pieces are O(sd), and sd is
// bounded by 0.1 at the 200 Hz cap the coupling applies, so the surrogate is within ~10% of the
// smooth model's gradient by construction.
//
// Memory. Reverse-mode needs the forward trajectory. Storing every state at every step is 3 MB per
// step at this size, so the forward pass checkpoints every CHECKPOINT steps and the backward pass
// recomputes one segment at a time. Each segment is replayed exactly once, so the total work is twice
// the forward pass whatever CHECKPOINT is; the constant only trades segment memory against the number
// of snapshot copies. A small segment therefore costs nothing and keeps the working set in cache.
//
// The backward pass allocates nothing per step. It used to build seven fresh arrays per step of every
// segment, which at whole-CNS size is 300 MB of garbage per segment and was the dominant cost of the
// adjoint -- more than the arithmetic, and more than the graph traversal. Per-step state now comes
// from a single arena that is allocated once and reused across segments, and `u` is recomputed from
// the membrane potential and conductances rather than stored, which is a sixth of the arena back.
import { EXC_SIGN } from './lif.js';

const CHECKPOINT = 16;
// The soft drive's spike amplitude is capped just below 1 so that the threshold amplitude stays
// recoverable in the backward pass (st = (s - sd) / (1 - sd)). The coupling caps the drive at 200 Hz,
// which is sd = 0.1 at dt = 0.5 ms, so this bound is three orders of magnitude out of reach.
const DRIVE_MAX = 0.999;

/** Parameters the adjoint produces gradients for, in the order used by grad vectors. */
export const DIFF_PARAMS = ['wSyn', 'sizeAlpha', 'inhGain', 'eInh', 'vThresh', 'kcThreshold', 'laminaBias', 'adaptInc', 'depU'];

export class LIFDiff {
  /**
   * @param data   {N, indptr, indices, weights, nt}
   * @param opts   model parameters; `sizeLog` is log(s_i) per neuron, the quantity sizeAlpha scales
   *               (inScale = min(boostCap, exp(-sizeAlpha * sizeLog))), `thrMask` marks the neurons
   *               kcThreshold applies to and `biasMask` the ones laminaBias applies to.
   */
  constructor(data, opts = {}) {
    const p = this.p = {
      dt: 0.5, vRest: -52, vThresh: -45, vReset: -52, tauM: 20, tauSyn: 5, tRef: 2.2, delay: 1.8,
      wSyn: 0.3, adaptInc: 0, adaptTau: 100, depU: 0, depTau: 200, minSyn: 1,
      coba: true, eExc: 0, eInh: -70, inhGain: 1, sizeAlpha: 0, maxSizeScale: 20, boostCap: 1,
      kcThreshold: 0, laminaBias: 0, surrogateBeta: 2.0,
      // soft: replace the hard threshold in the FORWARD pass too, so the model is genuinely smooth
      // and the adjoint can be checked against finite differences. The gradient code is identical
      // either way; only the spike amplitude changes from {0,1} to a logistic in (0,1).
      soft: false,
      // driveSoft: the same move for the exogenous drive -- replace the Poisson sample with its
      // expectation as a graded spike amplitude, which makes the drive a differentiable input.
      driveSoft: false, ...opts,
    };
    this.N = data.N; this.indptr = data.indptr; this.indices = data.indices;
    this.counts = data.weights;                                  // raw synapse counts, never mutated
    this.sign = opts.preSign ? Float32Array.from(opts.preSign)
      : Float32Array.from({ length: data.N }, (_, i) => EXC_SIGN[data.nt[i]]);
    this.sizeLog = opts.sizeLog || new Float32Array(data.N);      // log of relative neuron volume
    this.thrMask = opts.thrMask || new Uint8Array(data.N);
    this.biasMask = opts.biasMask || new Uint8Array(data.N);
    this.sensory = opts.sensoryMask || new Uint8Array(data.N);
    this.logGain = opts.logGain || new Float32Array(data.N);      // per-neuron parameter, zero = off
    // Fixed per-neuron structure from src/diffsetup.js. One is a multiplier on everything a neuron
    // sends, the other an additive millivolt offset on its threshold; both default to inert.
    this.outScale = opts.outScale ? Float32Array.from(opts.outScale) : null;
    this.thrOffset = opts.thrOffset ? Float32Array.from(opts.thrOffset) : new Float32Array(data.N);
    this.nslots = Math.max(1, Math.round(p.delay / p.dt)) + 1;
    this.drive = new Float32Array(data.N);
    // Neurons whose drive is an input to be differentiated, and how many steps a drive value is held
    // for. The optic lobe runs at 50 Hz against the LIF's 2 kHz, so one drive value covers 40 steps
    // and the drive gradient is accumulated per epoch rather than per step -- at 62,157 coupled
    // neurons that is 8.7 MB for a 700 ms assay instead of 348 MB.
    this.driveIdx = opts.driveIdx ? Int32Array.from(opts.driveIdx) : null;
    this.driveEpoch = Math.max(1, opts.driveEpoch || 1);
    if (this.driveIdx) {
      this.driveSlot = new Int32Array(data.N).fill(-1);
      for (let k = 0; k < this.driveIdx.length; k++) this.driveSlot[this.driveIdx[k]] = k;
    }
    this._alloc();
  }

  _alloc() {
    const N = this.N;
    this.v = new Float32Array(N); this.gE = new Float32Array(N); this.gI = new Float32Array(N);
    this.adapt = new Float32Array(N); this.res = new Float32Array(N); this.refr = new Float32Array(N);
    this.spikeCount = new Float32Array(N);
    this.inScale = new Float32Array(N);
    this.ring = Array.from({ length: this.nslots }, () => ({ idx: new Int32Array(0), amp: new Float32Array(0) }));
  }

  /** inScale and the effective per-edge weight depend on sizeAlpha, inhGain and minSyn. */
  _prepare() {
    const p = this.p, N = this.N;
    for (let i = 0; i < N; i++) {
      const s = Math.exp(-p.sizeAlpha * this.sizeLog[i]);
      this.inScale[i] = Math.min(p.boostCap, Math.max(1 / p.maxSizeScale, s));
    }
    // gate: a connection under minSyn, or one landing on a neuron driven from outside, carries nothing
    if (!this.gate || this.gateMin !== p.minSyn) {
      this.gate = new Uint8Array(this.counts.length); this.gateMin = p.minSyn;
      for (let j = 0; j < this.counts.length; j++) {
        this.gate[j] = (this.counts[j] >= p.minSyn && !this.sensory[this.indices[j]]) ? 1 : 0;
      }
    }
  }

  reset() {
    const p = this.p;
    this.v.fill(p.vRest); this.gE.fill(0); this.gI.fill(0);
    this.adapt.fill(0); this.res.fill(1); this.refr.fill(0); this.spikeCount.fill(0);
    this.ring = Array.from({ length: this.nslots }, () => ({ idx: new Int32Array(0), amp: new Float32Array(0) }));
    this.head = 0; this.t = 0;
    this._prepare();
  }

  setDrive(ix, rate) { for (const i of ix) this.drive[i] = rate; }
  setDriveOne(i, rate) { this.drive[i] = rate; }

  /** random number source; deterministic so the forward pass can be replayed exactly */
  _rand() { let s = this._seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this._seed = s >>> 0; return (s >>> 0) / 4294967296; }

  // ------------------------------------------------------------------ forward
  /**
   * Run `steps` steps, recording what the adjoint needs.
   * Returns { spikes, tape } where tape holds checkpoints and the per-step spike lists.
   */
  forward(steps, { seed = 1, record = true, onEpoch = null } = {}) {
    const p = this.p, N = this.N;
    this._seed = (seed * 2654435761) >>> 0 || 1;
    this.reset();
    const dE = Math.exp(-p.dt / p.tauSyn), dA = Math.exp(-p.dt / p.adaptTau), kRec = p.dt / p.depTau;
    const kM = p.dt / p.tauM, dtS = p.dt / 1000;
    const cE = 1 / (p.eExc - p.vRest), cI = 1 / (p.vRest - p.eInh);
    const { v, gE, gI, adapt, res, refr, spikeCount, indptr, indices, counts, gate, inScale, sign, logGain, drive } = this;
    const driveSoft = p.driveSoft, dIdx = this.driveIdx, ep = this.driveEpoch;
    const outScale = this.outScale, thrOffset = this.thrOffset;

    const tape = record ? { spikes: [], arrivals: [], checkpoints: new Map(), steps, seed } : null;
    if (record) tape.checkpoints.set(0, this._snapshot());
    // The drive is taped so the backward pass's segment replay is exact without re-running whatever
    // produced it. Only the coupled neurons are stored, and only once per epoch.
    if (record && dIdx) {
      tape.epochs = Math.ceil(steps / ep); tape.nDrive = dIdx.length; tape.epoch = ep;
      tape.driveAt = new Float32Array(tape.epochs * dIdx.length);
    }

    for (let t = 0; t < steps; t++) {
      if (t % ep === 0) {
        if (onEpoch) onEpoch(t / ep, t);                      // may call setDrive/setDriveOne
        if (record && dIdx) { const off = (t / ep) * dIdx.length;
          for (let k = 0; k < dIdx.length; k++) tape.driveAt[off + k] = drive[dIdx[k]]; }
      }
      const arriving = this.ring[this.head];
      if (record) tape.arrivals.push({ idx: arriving.idx.slice(), amp: arriving.amp.slice() });
      // --- deliver arriving spikes
      for (let k = 0; k < arriving.idx.length; k++) {
        const pre = arriving.idx[k], sg = sign[pre], amp = arriving.amp[k];
        if (sg === 0) continue;
        const eff = sg * p.wSyn * (outScale ? outScale[pre] : 1) * Math.exp(logGain[pre]) * res[pre] * amp;
        res[pre] -= p.depU * res[pre];
        const a = indptr[pre], b = indptr[pre + 1];
        if (eff > 0) { for (let j = a; j < b; j++) if (gate[j]) gE[indices[j]] += counts[j] * inScale[indices[j]] * eff; }
        else { const ig = p.inhGain; for (let j = a; j < b; j++) if (gate[j]) gI[indices[j]] += counts[j] * inScale[indices[j]] * ig * eff; }
      }

      // --- integrate and spike
      const fIdx = [], fAmp = [];
      for (let i = 0; i < N; i++) {
        let vi = v[i], s = 0;
        if (refr[i] > 0) { refr[i] -= p.dt; vi = p.vReset; }
        else if (!driveSoft && drive[i] > 0 && this._rand() < drive[i] * dtS) {
          vi = p.vReset; refr[i] = p.tRef; s = 1;
        } else {
          vi += (p.vRest - vi + gE[i] * (p.eExc - vi) * cE + gI[i] * (vi - p.eInh) * cI
            + (this.biasMask[i] ? p.laminaBias : 0)) * kM;
          const thr = p.vThresh + adapt[i] + (this.thrMask[i] ? p.kcThreshold : 0) + thrOffset[i];
          s = p.soft ? 1 / (1 + Math.exp(-(vi - thr) / p.surrogateBeta)) : (vi >= thr ? 1 : 0);
          // the drive as an expectation rather than a sample: fires because driven, or else because
          // it crossed threshold. Same expected count as the Poisson branch above, and smooth.
          if (driveSoft && drive[i] > 0) { const sd = Math.min(DRIVE_MAX, drive[i] * dtS); s = sd + (1 - sd) * s; }
          if (s > 0) { vi = s * p.vReset + (1 - s) * vi; if (!p.soft) refr[i] = p.tRef; }
        }
        if (s > (p.soft ? 1e-4 : 0.5)) { fIdx.push(i); fAmp.push(s); }
        spikeCount[i] += s;
        adapt[i] += s * p.adaptInc;
        v[i] = vi; gE[i] *= dE; gI[i] *= dE; adapt[i] *= dA; res[i] += (1 - res[i]) * kRec;
      }
      const fired = { idx: Int32Array.from(fIdx), amp: Float32Array.from(fAmp) };
      if (record) tape.spikes.push(fired);
      const slot = (this.head + this.nslots - 1) % this.nslots;
      this.ring[slot] = fired; this.head = (this.head + 1) % this.nslots;
      this.t += p.dt;
      if (record && (t + 1) % CHECKPOINT === 0) tape.checkpoints.set(t + 1, this._snapshot());
    }
    return tape;
  }

  /** Per-step scratch for the backward pass, sized for one checkpoint segment and reused thereafter.
   *  Step r of a segment lives at [r*N, (r+1)*N) of each array; `resAt` is a pool addressed by
   *  `resOff[r]`, because the number of spikes arriving at a step varies. */
  _arena(L, resTotal) {
    let a = this._ar;
    if (!a || a.L < L || a.resCap < resTotal) {
      const N = this.N, cap = Math.max(L, a?.L || 0), resCap = Math.max(1, resTotal, a?.resCap || 0);
      a = this._ar = { L: cap, resCap,
        vPre: new Float32Array(cap * N), gE: new Float32Array(cap * N),
        gI: new Float32Array(cap * N), adapt: new Float32Array(cap * N),
        sp: new Float32Array(cap * N), mode: new Uint8Array(cap * N),
        resAt: new Float32Array(resCap), resOff: new Int32Array(cap + 1) };
    }
    a.resOff[0] = 0;
    return a;
  }

  _snapshot() {
    return { v: this.v.slice(), gE: this.gE.slice(), gI: this.gI.slice(), adapt: this.adapt.slice(),
      res: this.res.slice(), refr: this.refr.slice(), ring: this.ring.map(a => ({ idx: a.idx.slice(), amp: a.amp.slice() })), head: this.head,
      seed: this._seed };
  }

  _restore(c) {
    this.v.set(c.v); this.gE.set(c.gE); this.gI.set(c.gI); this.adapt.set(c.adapt);
    this.res.set(c.res); this.refr.set(c.refr);
    this.ring = c.ring.map(a => ({ idx: a.idx.slice(), amp: a.amp.slice() })); this.head = c.head; this._seed = c.seed;
  }

  /**
   * Replay one segment from a checkpoint, saving into the arena the per-step pre-spike quantities the
   * adjoint needs: the membrane potential before the reset, and the conductances and adapt/res that
   * fed it. Restoring a snapshot rewinds `this`'s live state; the arena is the record of the segment.
   */
  _replay(from, to) {
    const p = this.p, N = this.N;
    this._restore(this.tape.checkpoints.get(from));
    const dE = Math.exp(-p.dt / p.tauSyn), dA = Math.exp(-p.dt / p.adaptTau), kRec = p.dt / p.depTau;
    const kM = p.dt / p.tauM, dtS = p.dt / 1000;
    const cE = 1 / (p.eExc - p.vRest), cI = 1 / (p.vRest - p.eInh);
    const { v, gE, gI, adapt, res, refr, indptr, indices, counts, gate, inScale, sign, logGain, drive } = this;
    const driveSoft = p.driveSoft, dIdx = this.driveIdx, ep = this.driveEpoch, dTape = this.tape.driveAt;
    const outScale = this.outScale, thrOffset = this.thrOffset;
    let resTotal = 0; for (let t = from; t < to; t++) resTotal += this.tape.arrivals[t].idx.length;
    const A = this._arena(to - from, resTotal);
    const { vPre, sp, mode, resAt } = A, sG = A.gE, sI = A.gI, sA = A.adapt;
    for (let t = from; t < to; t++) {
      const r = t - from, off = r * N;
      // The drive the forward pass used at this step, read back rather than recomputed. A segment
      // boundary need not land on an epoch boundary -- CHECKPOINT is 16 and an epoch is 40 steps --
      // so the first step of every segment reloads too, or it would inherit a stale drive.
      if (dTape && (t === from || t % ep === 0)) { const d0 = ((t / ep) | 0) * dIdx.length;
        for (let k = 0; k < dIdx.length; k++) drive[dIdx[k]] = dTape[d0 + k]; }
      const arriving = this.tape.arrivals[t];
      const ro = A.resOff[r], rn = A.resOff[r + 1] = ro + arriving.idx.length;
      for (let k = 0; k < arriving.idx.length; k++) {
        const pre = arriving.idx[k], sg = sign[pre], amp = arriving.amp[k];
        if (sg === 0) continue;
        resAt[ro + k] = res[pre];
        const eff = sg * p.wSyn * (outScale ? outScale[pre] : 1) * Math.exp(logGain[pre]) * res[pre] * amp;
        res[pre] -= p.depU * res[pre];
        const a = indptr[pre], b = indptr[pre + 1];
        if (eff > 0) { for (let j = a; j < b; j++) if (gate[j]) gE[indices[j]] += counts[j] * inScale[indices[j]] * eff; }
        else { const ig = p.inhGain; for (let j = a; j < b; j++) if (gate[j]) gI[indices[j]] += counts[j] * inScale[indices[j]] * ig * eff; }
      }
      for (let i = 0; i < N; i++) {
        let vi = v[i], sv = 0, md = 0;       // md: 0 integrated, 1 refractory, 2 exogenous spike
        vPre[off + i] = vi; sG[off + i] = gE[i]; sI[off + i] = gI[i]; sA[off + i] = adapt[i];
        if (refr[i] > 0) { refr[i] -= p.dt; vi = p.vReset; md = 1; }
        else if (!driveSoft && drive[i] > 0 && this._rand() < drive[i] * dtS) { vi = p.vReset; refr[i] = p.tRef; sv = 1; md = 2; }
        else {
          vi += (p.vRest - vi + gE[i] * (p.eExc - vi) * cE + gI[i] * (vi - p.eInh) * cI
            + (this.biasMask[i] ? p.laminaBias : 0)) * kM;
          const thr = p.vThresh + adapt[i] + (this.thrMask[i] ? p.kcThreshold : 0) + thrOffset[i];
          sv = p.soft ? 1 / (1 + Math.exp(-(vi - thr) / p.surrogateBeta)) : (vi >= thr ? 1 : 0);
          if (driveSoft && drive[i] > 0) { const sd = Math.min(DRIVE_MAX, drive[i] * dtS); sv = sd + (1 - sd) * sv; md = 3; }
          if (sv > 0) { vi = sv * p.vReset + (1 - sv) * vi; if (!p.soft) refr[i] = p.tRef; }
        }
        mode[off + i] = md; sp[off + i] = sv;
        adapt[i] += sv * p.adaptInc;
        v[i] = vi; gE[i] *= dE; gI[i] *= dE; adapt[i] *= dA; res[i] += (1 - res[i]) * kRec;
      }
      const slot = (this.head + this.nslots - 1) % this.nslots;
      const f = this.tape.spikes[t];
      this.ring[slot] = { idx: f.idx.slice(), amp: f.amp.slice() }; this.head = (this.head + 1) % this.nslots;
    }
    return A;
  }

  // ------------------------------------------------------------------ backward
  /**
   * Reverse-mode gradient of a loss expressed through per-neuron spike counts.
   * @param tape   from forward()
   * @param dLdSpike  Float32Array(N): dLoss / d(spike count of neuron i)
   * @param lossFrom  the first step at which `dLdSpike` applies, default 0. An assay that adapts to a
   *                  grey field for 200 ms and then shows a stimulus scores only the spikes after the
   *                  stimulus onset (scripts/calib_eval.mjs snapshots the counts at that step), and a
   *                  gradient that credited the adaptation period too would be the gradient of a
   *                  different loss than the one being reported.
   * @param truncate  window length for truncated BPTT, in steps; 0 (the default) means no truncation,
   *                  and the adjoint differentiates the whole trajectory. Non-zero clears the adjoint
   *                  state every `truncate` steps, so the gradient only accounts for influences up to
   *                  truncate * dt milliseconds back.
   *
   *                  This parameter used to default to 40, with a comment claiming the adjoint
   *                  overflows Float32 if carried further. It does not: scripts/adjoint_window.mjs
   *                  takes the adjoint over a full 150 ms at 20k neurons and 1.6M connections and
   *                  every parameter stays finite and within 1e-3 of central finite differences, while
   *                  a 25-step window is off by up to 76%. Truncation was never buying stability here;
   *                  it was only introducing bias, into a fit (scripts/grad_fit.mjs, TRUNC=25) that had
   *                  no other source of it. It costs nothing to leave off -- each checkpoint segment is
   *                  replayed exactly once either way -- so the default is now the full window.
   * @returns { params: {name: grad}, logGain: Float32Array(N), drive, truncate }
   *          `drive` is present when `driveIdx` was given: Float32Array(epochs * driveIdx.length),
   *          dLoss / d(drive rate in Hz) for each coupled neuron at each drive epoch. That is the
   *          quantity src/visdiff.js hands to the optic lobe's adjoint.
   */
  backward(tape, dLdSpike, { truncate = 0, lossFrom = 0 } = {}) {
    this.tape = tape;
    const p = this.p, N = this.N, steps = tape.steps;
    const dE = Math.exp(-p.dt / p.tauSyn), dA = Math.exp(-p.dt / p.adaptTau), kRec = p.dt / p.depTau;
    const kM = p.dt / p.tauM, dtS = p.dt / 1000;
    const cE = 1 / (p.eExc - p.vRest), cI = 1 / (p.vRest - p.eInh);
    const { indptr, indices, counts, gate, inScale, sign, logGain, sizeLog } = this;
    const beta = p.surrogateBeta;
    // Everything the inner loops touch, hoisted: the loops run 165,122 times a step for 200 steps, and
    // a property load per neuron per step costs more than the arithmetic it feeds.
    const thrMask = this.thrMask, biasMask = this.biasMask;
    const outScale = this.outScale, thrOffset = this.thrOffset;
    const soft = p.soft, vRest = p.vRest, vReset = p.vReset, vThresh = p.vThresh, eExc = p.eExc,
      eInhP = p.eInh, kcThreshold = p.kcThreshold, laminaBias = p.laminaBias, adaptIncP = p.adaptInc;
    // The nine scalars the loops accumulate are summed in registers and written back once.
    let sAdaptInc = 0, sVThresh = 0, sKc = 0, sLamin = 0, sEInh = 0;

    const lv = new Float32Array(N), lgE = new Float32Array(N), lgI = new Float32Array(N);
    const lad = new Float32Array(N), lres = new Float32Array(N);
    const gInScale = new Float32Array(N), gLogGain = new Float32Array(N);
    const g = Object.fromEntries(DIFF_PARAMS.map(k => [k, 0]));
    // the drive adjoint, accumulated per epoch rather than per step (see the constructor)
    const dSlot = this.driveSlot || null, dTape = tape.driveAt || null, ep = this.driveEpoch;
    // Constant drive on neurons outside driveIdx -- the background ORN rate, say -- is not taped,
    // because it never changes; it is read straight off the live array.
    const driveFix = this.drive;
    const nD = dTape ? tape.nDrive : 0;
    const gDrive = dTape ? new Float32Array(tape.epochs * nD) : null;

    // adjoint of each step's spike vector, held in a ring: a spike at step t is delivered at t+delay
    const lsRing = Array.from({ length: this.nslots }, () => new Float32Array(N));

    const bounds = [];
    for (let s = 0; s < steps; s += CHECKPOINT) bounds.push([s, Math.min(steps, s + CHECKPOINT)]);

    const diag = this.diag || null;
    for (let b = bounds.length - 1; b >= 0; b--) {
      const [from, to] = bounds[b];
      const A = this._replay(from, to);
      const { vPre, sp, mode, resAt } = A, sG = A.gE, sI = A.gI, sA = A.adapt;
      for (let t = to - 1; t >= from; t--) {
        const r = t - from, off = r * N;
        const dOff = dTape ? ((t / ep) | 0) * nD : 0;
        const scored = t >= lossFrom;
        if (diag) { let k = 0; for (let i = 0; i < N; i++) if (lv[i] || lgE[i] || lgI[i] || lad[i] || lres[i]) k++; (diag.counts ||= []).push(k); }
        if (truncate > 0 && (t + 1) % truncate === 0) {      // start of a fresh truncation window
          lv.fill(0); lgE.fill(0); lgI.fill(0); lad.fill(0); lres.fill(0);
          for (const r of lsRing) r.fill(0);
        }
        const ls = lsRing[t % this.nslots];

        // --- reverse the post-step decays, then integrate-and-spike, fused: every neuron is decayed
        // exactly once and read in the same pass, so the adjoint vectors are walked once a step, not
        // twice. Decay still precedes the mode tests, because a refractory or exogenously driven
        // neuron carries its adjoint through even though it skips the integration below.
        for (let i = 0; i < N; i++) {
          const md = mode[off + i];
          const lE = lgE[i] * dE, lI = lgI[i] * dE, lA = lad[i] * dA, lR = lres[i] * (1 - kRec);
          lgE[i] = lE; lgI[i] = lI; lad[i] = lA; lres[i] = lR;
          if (md === 1) { lv[i] = 0; continue; }                 // clamped to vReset while refractory
          if (md === 2) {
            // The drive fired. v is clamped to vReset, so nothing flows back through the membrane;
            // what remains is the adaptation increment the spike applied, and -- because this spike
            // existed only because the drive was as large as it was -- the drive's own gradient.
            // ds/d(sd) is 1 here rather than 1 - st, because the step never integrated and has no st.
            const lspike2 = ls[i] + (scored ? dLdSpike[i] : 0);
            sAdaptInc += lA;
            if (dSlot && dSlot[i] >= 0) gDrive[dOff + dSlot[i]] += (lA * adaptIncP + lspike2) * dtS;
            lv[i] = 0; ls[i] = 0; continue;
          }
          // u is rebuilt from the arena rather than stored: same arithmetic, same order, same bits.
          const vv = vPre[off + i], gEv = sG[off + i], gIv = sI[off + i];
          const bias = biasMask[i] ? laminaBias : 0;
          const u = vv + (vRest - vv + gEv * (eExc - vv) * cE + gIv * (vv - eInhP) * cI + bias) * kM;
          const thr = vThresh + sA[off + i] + (thrMask[i] ? kcThreshold : 0) + thrOffset[i];
          const d = u - thr;
          const s = sp[off + i];
          // With a soft drive the recorded amplitude is the composite s = sd + (1 - sd) * st, and it
          // is the threshold's own st that the surrogate derivative is taken at, so split them back.
          let sd = 0, st = s;
          if (md === 3) {
            const rate = dSlot && dSlot[i] >= 0 ? dTape[dOff + dSlot[i]] : driveFix[i];
            sd = Math.min(DRIVE_MAX, rate * dtS); st = (s - sd) / (1 - sd);
          }
          // exact derivative when the forward pass is smooth; the fast-sigmoid surrogate when it is not
          let sg;
          if (soft) sg = st * (1 - st) / beta;
          else { const t = 1 + Math.abs(d) / beta; sg = 1 / (beta * t * t); }
          const lspike = ls[i] + (scored ? dLdSpike[i] : 0);        // downstream + direct loss term
          // v_new = s * vReset + (1-s) * u ; adapt_new = adapt + s * adaptInc
          const lvNew = lv[i];
          const lsTot = (vReset - u) * lvNew + lA * adaptIncP + lspike;   // adjoint of the emitted s
          const lt = lsTot * (1 - sd) * sg;                        // ... through st, then through d
          const lu = lvNew * (1 - s) + lt;
          const lthr = -lt;
          // and through sd, the drive's expected spike: ds/d(sd) = 1 - st, ds(sd)/d(rate) = dt/1000.
          // With a sampling drive (md === 0) sd is zero in the forward pass and st is s, so this is
          // the surrogate described at the top of the file rather than an exact derivative.
          if (dSlot && dSlot[i] >= 0) gDrive[dOff + dSlot[i]] += lsTot * (1 - st) * dtS;
          sAdaptInc += lA * s;
          sVThresh += lthr;
          if (thrMask[i]) sKc += lthr;
          lad[i] = lA + lthr;                                      // adapt enters through the threshold

          // u = v + (vRest - v + gE (eExc - v) cE + gI (v - eInh) cI + bias) kM
          lv[i] = lu * (1 + kM * (-1 - gEv * cE + gIv * cI));
          lgE[i] = lE + lu * kM * (eExc - vv) * cE;
          lgI[i] = lI + lu * kM * (vv - eInhP) * cI;
          if (bias !== 0) sLamin += lu * kM;
          sEInh += lu * kM * gIv * cI * (-1 + (vv - eInhP) * cI);
          ls[i] = 0;
        }

        // --- reverse the synaptic delivery that happened at the top of this step.
        // Delivery is additive in gE/gI, so the adjoint passes through unchanged; what it produces
        // is the gradient with respect to everything the delivered amount was built from, and the
        // adjoint of the presynaptic spike itself, which belongs to the step that emitted it.
        const arriving = tape.arrivals[t];
        const ro = A.resOff[r];
        const emit = t - (this.nslots - 1);
        const target = emit >= 0 ? lsRing[emit % this.nslots] : null;
        for (let k = 0; k < arriving.idx.length; k++) {
          const pre = arriving.idx[k], sgn = sign[pre], amp = arriving.amp[k];
          if (sgn === 0) continue;
          const resAtv = resAt[ro + k];
          const gain = Math.exp(logGain[pre]) * (outScale ? outScale[pre] : 1);
          const base = sgn * p.wSyn * gain * resAtv;       // delivered amount before the spike amplitude
          const eff = base * amp;
          const a = indptr[pre], b2 = indptr[pre + 1];
          let lRaw = 0;                                   // d(loss) / d(eff), summed over the fan-out
          if (eff > 0) {
            for (let j = a; j < b2; j++) { if (!gate[j]) continue; const q = indices[j], cw = counts[j];
              lRaw += lgE[q] * cw * inScale[q]; gInScale[q] += lgE[q] * cw * eff; }
          } else {
            const ig = p.inhGain;
            for (let j = a; j < b2; j++) { if (!gate[j]) continue; const q = indices[j], cw = counts[j];
              lRaw += lgI[q] * cw * inScale[q] * ig; gInScale[q] += lgI[q] * cw * ig * eff;
              g.inhGain += lgI[q] * cw * inScale[q] * eff; }
          }
          g.wSyn += lRaw * sgn * gain * resAtv * amp;
          gLogGain[pre] += lRaw * eff;                    // d(eff) / d(logGain) = eff
          if (target) target[pre] += lRaw * base;         // d(delivered) / d(the spike amplitude)
          // res[pre] was read here and then depressed: res_after = res * (1 - depU)
          const lresAfter = lres[pre];
          g.depU += -lresAfter * resAtv;
          lres[pre] = lresAfter * (1 - p.depU) + lRaw * sgn * p.wSyn * gain * amp;
        }
      }
    }
    g.adaptInc += sAdaptInc; g.vThresh += sVThresh; g.kcThreshold += sKc;
    g.laminaBias += sLamin; g.eInh += sEInh;
    // sizeAlpha reaches the loss through inScale = min(boostCap, exp(-sizeAlpha * sizeLog))
    for (let i = 0; i < N; i++) {
      const raw = Math.exp(-p.sizeAlpha * sizeLog[i]);
      if (raw < p.boostCap && raw > 1 / p.maxSizeScale) g.sizeAlpha += gInScale[i] * (-sizeLog[i]) * raw;
    }
    // Non-finite gradients are zeroed so a caller cannot poison its parameters with a NaN, but the
    // count is returned rather than swallowed. It is not a rounding detail: over a long window at
    // whole-CNS scale the adjoint can overflow outright, and a zero that came from an overflow looks
    // exactly like a zero that came from a parameter having no influence. Reading the sanitised
    // gradient without this count is how a 1e34 gradient reads as a plausible one.
    const clamped = { params: 0, logGain: 0, drive: 0 };
    for (const k of DIFF_PARAMS) if (!Number.isFinite(g[k])) { g[k] = 0; clamped.params++; }
    for (let i = 0; i < N; i++) if (!Number.isFinite(gLogGain[i])) { gLogGain[i] = 0; clamped.logGain++; }
    if (gDrive) for (let k = 0; k < gDrive.length; k++) if (!Number.isFinite(gDrive[k])) { gDrive[k] = 0; clamped.drive++; }
    return { params: g, logGain: gLogGain, drive: gDrive, truncate, clamped };
  }
}
