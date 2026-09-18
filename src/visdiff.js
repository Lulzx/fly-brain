// The optic lobe and the central nervous system as one differentiable model.
//
// The two halves of this project's brain are fitted by different methods and were, until this module,
// joined by a one-way wall. flyvis (Lappalainen et al. 2024) is a rate network trained by gradient
// descent; the CNS is a spiking network calibrated by population search (docs/07-calibration.md). They
// meet in src/sim/vision.js, where each optic-lobe node drives the male-CNS neuron of the same type in
// the same column -- as an exogenous Poisson rate, which is where the gradient stopped. Doc 33's
// closing limitation was exactly this: "visual assays cannot be fitted end-to-end through both without
// joining the two models."
//
// This is that join. The chain is
//
//     luminance per hex column
//       -> flyvis, 45,669 nodes per eye, dt = 20 ms          (src/flyvisdiff.js)
//       -> rate = clamp(gain * (v[node] - vRest[node]))      (the coupling, below)
//       -> drive on 62,157 CNS neurons, dt = 0.5 ms          (src/lifdiff.js, driveIdx)
//       -> spikes, and a loss on any CNS neuron
//
// and the adjoint runs the whole way back, so a loss on a descending neuron produces a gradient on the
// CNS parameters, on the coupling gain, on the optic lobe's weights, and -- if asked -- on the
// luminance itself.
//
// Three things about the coupling are worth stating before any result, because they bound what the
// joined gradient can say:
//
//   1. The coupling is a rectifier with a cap: nodes at or below rest, and nodes saturated at the
//      200 Hz ceiling, pass no gradient at all. `stats()` reports what fraction of the 62,157 pairs
//      are in the live band, and it is the first number to look at when a visual fit will not move.
//   2. `vRest` is the optic lobe's resting activity under a uniform grey field, measured by settling
//      the model for 150 steps. It is a function of the flyvis parameters, so if those are being
//      fitted it is stale by the amount they moved. It is re-measured at every `settle()` and its own
//      gradient path is not taken -- which is correct when the optic lobe is frozen (the default) and
//      an approximation when it is not.
//   3. The optic lobe runs 40x slower than the CNS, so one drive value covers 40 LIF steps and the
//      drive gradient is summed over them. That is exact, not an approximation: the drive really is
//      held constant across the epoch, in this module and in src/sim/vision.js alike.
//   4. The optic-lobe state at the start of the taped window is treated as a constant. It is not one:
//      it is the result of settling the model on a static field for 150 steps, so it depends on every
//      optic-lobe parameter. The gradient therefore accounts for what a parameter did during the assay
//      and not for what it did to the scene the assay started from -- the same window limit doc 33
//      already records for the LIF half, and the reason `settle()` snapshots the state it leaves
//      behind (`eyeV0`) so a run is reproducible and a finite-difference check has something exact to
//      compare against.
import { LIFDiff, DIFF_PARAMS } from './lifdiff.js';
import { FlyVisDiff } from './flyvisdiff.js';

export { DIFF_PARAMS };

/** The coupling's own parameters, as shipped in src/sim/vision.js and scripts/calib_eval.mjs. */
export const COUPLING = { gain: 250, dead: 0.02, cap: 200 };

export class VisualChain {
  /**
   * @param data    CNS graph, as LIFDiff takes it
   * @param fvModel parsed flyvis model (parseFlyVis)
   * @param fvMap   flyvis_map.json: eyes.{L,R}.{pairs, dirs}
   * @param opts    CNS parameters, plus { gain, dead, cap, fvDt, cnsDt } and anything LIFDiff accepts
   */
  constructor(data, fvModel, fvMap, opts = {}) {
    this.c = { ...COUPLING, ...opts };
    this.sides = ['L', 'R'];
    this.eyes = [new FlyVisDiff(fvModel)];
    this.eyes.push(new FlyVisDiff(fvModel, this.eyes[0].sharedParts));
    this.fvN = this.eyes[0].N; this.fvE = this.eyes[0].E; this.nCol = this.eyes[0].nCol;
    // pairs, per eye: which CNS neuron each optic-lobe node drives
    this.pairs = this.sides.map(sd => ({
      neuron: Int32Array.from(fvMap.eyes[sd].pairs, q => q[0]),
      node: Int32Array.from(fvMap.eyes[sd].pairs, q => q[1]),
    }));
    // The coupled CNS neurons, in one list, which is the drive index LIFDiff differentiates. The two
    // eyes drive disjoint sets (left lobe, right lobe), so a neuron has exactly one slot; the
    // assertion is cheap and this is the assumption the per-slot gradient depends on.
    const all = [];
    for (const P of this.pairs) for (const i of P.neuron) all.push(i);
    const seen = new Set(all);
    if (seen.size !== all.length) throw new Error('a CNS neuron is driven by both eyes: the drive slots would collide');
    this.driveIdx = Int32Array.from(all);
    const slot = new Int32Array(data.N).fill(-1);
    for (let k = 0; k < this.driveIdx.length; k++) slot[this.driveIdx[k]] = k;
    this.pairSlot = this.pairs.map(P => Int32Array.from(P.neuron, i => slot[i]));

    // A coupled neuron is driven from outside, so its incoming CNS synapses carry nothing -- exactly
    // what makeBrain in scripts/calib_eval.mjs does when it marks every pair's neuron sensory before
    // writing the graph. Setting it here rather than trusting the caller is not tidiness: passing the
    // superclass-derived mask instead marks none of the 62,157 (they are ol_intrinsic and
    // visual_projection, not sensory), the optic-lobe neurons then integrate CNS input on top of their
    // flyvis drive, and the giant fibre stops responding to a loom altogether -- DNp01 went to 0
    // spikes against the benchmark's 2.
    const sensoryMask = new Uint8Array(data.N);
    if (opts.sensoryMask) sensoryMask.set(opts.sensoryMask);
    for (const i of this.driveIdx) sensoryMask[i] = 1;
    this.sensoryMask = sensoryMask;

    const cnsDt = opts.dt ?? 0.5, fvDt = opts.fvDt ?? this.eyes[0].dt * 1000;
    this.epoch = Math.max(1, Math.round(fvDt / cnsDt));          // 40 LIF steps per optic-lobe step
    this.net = new LIFDiff(data, { ...opts, sensoryMask, driveIdx: this.driveIdx, driveEpoch: this.epoch });
    this.nD = this.driveIdx.length;
    this.vRest = null;
  }

  /** Optic-lobe resting activity under a uniform grey field. Both eyes settle identically, so one
   *  vector serves both -- the same shortcut src/sim/vision.js and scripts/calib_eval.mjs take. */
  settle(level = 0.5, steps = 150) {
    const grey = new Float32Array(this.nCol).fill(level);
    for (const e of this.eyes) e.settle(grey, steps);
    this.vRest = this.eyes[0].v.slice();
    this.eyeV0 = this.eyes.map(e => e.v.slice());
    return this.vRest;
  }

  /** rate in Hz from an optic-lobe deviation from rest, and whether the gradient survives it */
  _rate(a) { const { gain, dead, cap } = this.c; if (a <= dead) return 0; return Math.min(cap, gain * a); }

  /**
   * Run the chain. `lum(eye, tSec)` returns luminance per hex column for that eye at that time; it is
   * called once per optic-lobe step, which is what the arena does too.
   *
   * @returns { tape, fvTapes, aAt } -- aAt holds the coupling's input (v - vRest) per epoch per pair,
   *          which is what the backward pass needs to know which pairs were in the live band.
   */
  forward(steps, { seed = 1, lum, record = true, t0 = 0 } = {}) {
    if (!this.vRest) this.settle();
    // Start from the settled state every time, so a run is a function of its stimulus and parameters
    // and not of whatever the last run left behind.
    if (this.eyeV0) for (let s = 0; s < 2; s++) this.eyes[s].v.set(this.eyeV0[s]);
    const epochs = Math.ceil(steps / this.epoch);
    const fvDt = this.eyes[0].dt;
    const aAt = record ? new Float32Array(epochs * this.nD) : null;
    if (record) for (const e of this.eyes) e.startTape(epochs);
    const vRest = this.vRest;

    const onEpoch = (e) => {
      const t = t0 + e * fvDt;
      for (let s = 0; s < 2; s++) {
        const eye = this.eyes[s];
        eye.setInput(lum(s, t));
        if (record) eye.stepTaped(); else eye.step();
        const P = this.pairs[s], sl = this.pairSlot[s], v = eye.v, off = e * this.nD;
        for (let k = 0; k < P.neuron.length; k++) {
          const a = v[P.node[k]] - vRest[P.node[k]];
          this.net.setDriveOne(P.neuron[k], this._rate(a));
          if (record) aAt[off + sl[k]] = a;
        }
      }
    };
    const tape = this.net.forward(steps, { seed, record, onEpoch });
    this.aAt = aAt; this.epochs = epochs;
    return { tape, aAt, epochs };
  }

  /**
   * Gradient of a loss on CNS spike counts, back through the CNS, the coupling and both eyes.
   *
   * @param tape      from forward()
   * @param dLdSpike  Float32Array(cns N)
   * @param opts      { truncate, lum: true to also return dLoss/d(luminance) }
   * @returns { params, logGain, gain, fv: {weight, bias, kdt}, lum?, live }
   */
  backward(tape, dLdSpike, { truncate = 0, lum = false } = {}) {
    const cns = this.net.backward(tape, dLdSpike, { truncate });
    const gDrive = cns.drive;
    const { gain, dead, cap } = this.c;
    const aAt = this.aAt, epochs = this.epochs, nD = this.nD, N = this.fvN;
    // adjoint of each eye's node activity, per optic-lobe step
    const dLdV = [new Float32Array(epochs * N), new Float32Array(epochs * N)];
    let gGain = 0, live = 0, dcount = 0;
    for (let e = 0; e < epochs; e++) {
      const off = e * nD, vo = e * N;
      for (let s = 0; s < 2; s++) {
        const P = this.pairs[s], sl = this.pairSlot[s];
        for (let k = 0; k < P.neuron.length; k++) {
          const a = aAt[off + sl[k]];
          dcount++;
          // rate = clamp(gain * a): below the deadband and above the cap the derivative is zero, and
          // that is a real property of the coupling rather than a numerical convenience.
          if (a <= dead || gain * a >= cap) continue;
          live++;
          const dR = gDrive[off + sl[k]];
          if (dR === 0) continue;
          gGain += dR * a;
          dLdV[s][vo + P.node[k]] += dR * gain;
        }
      }
    }
    // both eyes share every optic-lobe parameter, so both accumulate into one gradient
    const g = { weight: new Float32Array(this.fvE), bias: new Float32Array(N), kdt: new Float32Array(N) };
    const gLum = lum ? [new Float32Array(epochs * this.nCol), new Float32Array(epochs * this.nCol)] : [null, null];
    for (let s = 0; s < 2; s++) this.eyes[s].backward(dLdV[s], g, gLum[s]);
    return { params: cns.params, logGain: cns.logGain, gain: gGain, fv: g,
      lum: lum ? gLum : undefined, live: dcount ? live / dcount : 0, clamped: cns.clamped };
  }

  /** What fraction of the coupling is in the band where a gradient exists, and how hard it is driven.
   *  A visual fit that will not move is usually this number, not the adjoint. */
  stats() {
    const { gain, dead, cap } = this.c;
    const aAt = this.aAt, epochs = this.epochs, nD = this.nD;
    let below = 0, live = 0, sat = 0, sum = 0;
    for (let q = 0; q < epochs * nD; q++) {
      const a = aAt[q];
      if (a <= dead) below++; else if (gain * a >= cap) sat++; else live++;
      sum += this._rate(a);
    }
    const tot = epochs * nD;
    return { pairs: nD, epochs, belowDeadband: below / tot, live: live / tot, saturated: sat / tot,
      meanRate: sum / tot };
  }
}
