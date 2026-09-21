// The learned self-motion cancel (spec S3.3): a forward model that predicts the reafferent
// component of the loom pathway's drive from the animal's own commands and body, and subtracts it.
//
//   u_t = [fwd, back, turnL, turnR, groom]    filtered DN readouts (the 40 ms rate filter in
//                                             Motor.readBrain is the spec's 40 ms window)
//   p_t = lowpass(leg joint velocities, 20 ms)
//   hat_s = W_u u_t + W_p p_t + b             predicted reafferent drive per target neuron
//   s_cancelled = s_raw - hat_s               written as a negative `bias` on the target neurons
//
// The targets are the loom pathway's readout set -- LC4, LPLC2, DNp02, DNp04, DNp01 (giant fibre).
// They are not flyvis-coupled (the optic-lobe model stops at the columnar types), so s_raw is
// their membrane drive in the LIF -- the spec's second reading -- and the subtract lands on lif.c's
// additive `bias` term, which enters the membrane bracket exactly where synaptic drive does.
//
// The weights are fitted by scripts/reafference_fit.mjs on self-motion traces collected by
// scripts/loom_protocol.mjs, and shipped as public/data/reafference.json. W_u and W_p are dense
// and tiny: (5 + nProprio) x nTargets, not a second optic lobe.

/** The model's input features, shared by the runtime (dtMs = 1 in the step loop) and the
 *  trace recorder in loom_protocol.mjs, so the fit sees exactly the signal the model does.
 *  `filt` is persistent per-animal state: { jointNames: string[], p: Float64Array }. */
export function cancelFeatures(fly, st, dtMs, filt) {
  const M = fly.motor, cmd = M.cmd;
  const u = [cmd.drive || 0, cmd.back || 0, M.wmean(M.dn.turnL), M.wmean(M.dn.turnR), cmd.groom || 0];
  const kp = Math.min(1, dtMs / 20), jn = filt.jointNames, p = filt.p;
  for (let j = 0; j < jn.length; j++) p[j] += kp * ((st.jointVel?.[jn[j]] || 0) - p[j]);
  return { u, p };
}

export class SelfMotionCancel {
  /** model: { targets: int[], jointNames: string[], Wu: f64[5*T], Wp: f64[nP*T], b: f64[T] }
   *  Wu/Wp/b are in bias units (the mV-scale bracket term of lif.c); the fitter converts its
   *  Hz-space regression by the measured rate->bias sensitivity rho. */
  constructor(model) {
    this.m = model;
    this.targets = Int32Array.from(model.targets);
    this.T = this.targets.length;
    this.Wu = Float64Array.from(model.Wu); this.Wp = Float64Array.from(model.Wp);
    this.b = Float64Array.from(model.b);
    this.filt = { jointNames: model.jointNames, p: new Float64Array(model.jointNames.length) };
    this.hat = new Float64Array(this.T);
  }
  /** one step of the forward model; writes brain.bias[targets] = -hat_s. dtMs is the host step. */
  apply(fly, st, dtMs = 1) {
    const { u, p } = cancelFeatures(fly, st, dtMs, this.filt);
    const { T, Wu, Wp, b, hat, targets } = this, nP = p.length;
    for (let t = 0; t < T; t++) {
      let h = b[t];
      for (let f = 0; f < 5; f++) h += Wu[f * T + t] * u[f];
      for (let j = 0; j < nP; j++) h += Wp[j * T + t] * p[j];
      hat[t] = h;
    }
    // reafference is a positive drive being removed: a negative prediction must not inject one
    const bias = fly.brain.bias;
    for (let t = 0; t < T; t++) bias[targets[t]] = -Math.max(0, hat[t]);
  }
  /** the model's current prediction, for diagnostics and the fitter's bookkeeping */
  prediction() { return Float64Array.from(this.hat); }
}
