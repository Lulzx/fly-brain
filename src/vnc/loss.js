// The premotor fit's loss plumbing (spec S2.6).
//
// The differentiable loss lives on muscle commands, not joint torques: the subgraph's leg motor
// neurons produce epoch spike rates; the same saturating force-frequency curves and per-actuator
// aggregation that src/sim/motor.js uses in 'connectome' mode turn those rates into actuator ctrl;
// the recorded fit data supplies the ctrl that real walking needed. Fitting logGain against ctrl
// error is fitting the premotor map the graph must implement -- MN identities stay read-only.
//
//   rate_mn = spikes_mn / epochSecs                       (the twin's per-epoch counts)
//   a_m     = ffAct(mean rate over muscle m's MNs)        (motor.js MUSCLE_FF + muscleClass)
//   ctrl_a  = sum over muscles on a: dir>0 ? a*hi : a*lo  (muscleCtrl with rest=0; adhere_claw
//             carries the CPG's 0.6 + 0.4*min(1, sum a) grip law instead)
//   L       = mean over epochs, actuators of (ctrl - ctrl*)^2 + lambdaBudget * ||logGain||_1
//
// Everything below is pure function of the per-epoch MN counts -- the twin's backward gets the
// per-epoch spike weights via dLdSpikePerEpoch.
import { MUSCLE_FF, muscleClass } from '../sim/motor.js';

const LN2 = Math.LN2;
const ff = (rate, c) => 1 - Math.exp(-LN2 * Math.pow(Math.max(0, rate) / c.f50, c.n));
const dff = (rate, a, c) => {                    // da/drate, used by the ctrl->rate gradient
  const x = Math.max(0, rate) / c.f50;
  return rate <= 0 ? (c.n === 1 ? LN2 / c.f50 : 0) : (1 - a) * LN2 * c.n / c.f50 * Math.pow(x, c.n - 1);
};

/** Build the actuator-level readout over subgraph MNs.
 *  sub: extracted subgraph; ranges: {actuator: [lo, hi]} from the MuJoCo model's ctrlrange.
 *  Returns { actuators: [name], units: [{act, dir, f50, n, mn: [subIdx]}] } — `units` is the
 *  muscle-level structure; each muscle contributes ff(mean MN rate) to its actuator. */
export function buildReadout(sub, ranges) {
  const actuators = [...new Set(sub.mn.map(m => m.actuator))].sort();
  const actOf = new Map(actuators.map((n, k) => [n, k]));
  const byMuscle = new Map();                     // muscle name -> its MN sub-indices
  for (const m of sub.mn) {
    if (!byMuscle.has(m.muscle)) byMuscle.set(m.muscle, { actuator: m.actuator, dir: m.dir, mn: [] });
    byMuscle.get(m.muscle).mn.push(m.sub);
  }
  const units = [];
  for (const [name, m] of byMuscle) {
    const cls = muscleClass(name), ff = MUSCLE_FF[cls];
    units.push({ name, act: actOf.get(m.actuator), dir: m.dir, f50: ff.f50, n: ff.n, mn: [...new Set(m.mn)] });
  }
  return { actuators, units };
}

/** Per-epoch predicted ctrl and the spike weights for the twin's backward pass.
 *  mnCounts: Float32Array(nEp * N) — per-epoch spike counts on subgraph nodes (only MNs read).
 *  target:   Float32Array(nEp * nAct) — recorded ctrl.
 *  rateTarget (optional): Float32Array(nEp * nMn) — recorded MN rates; mnSub maps row j to a node.
 *  Returns { loss, lossCtrl, lossRate, dLdSpikePerEpoch (nEp*N), predCtrl }. */
export function ctrlLoss(sub, readout, ranges, mnCounts, target, nEp, epochSecs,
    { scoreFromEpoch = 0, lambdaRate = 0, rateTarget = null, mnSub = null } = {}) {
  const N = sub.N, nAct = readout.actuators.length;
  const pred = new Float32Array(nEp * nAct);
  const dW = new Float32Array(nEp * N);           // dL/d(count of neuron i in epoch e)
  let loss = 0, lossRate = 0, nScored = 0, nRate = 0;
  const aCache = new Float64Array(readout.units.length), rCache = new Float64Array(readout.units.length);
  for (let e = 0; e < nEp; e++) {
    const off = e * N, cOff = e * nAct, score = e >= scoreFromEpoch;
    // muscle activations from this epoch's MN rates
    for (let u = 0; u < readout.units.length; u++) {
      const un = readout.units[u];
      let r = 0; for (const i of un.mn) r += mnCounts[off + i];
      r = r / un.mn.length / epochSecs;
      rCache[u] = r; aCache[u] = ff(r, un);
    }
    // aggregate to ctrl exactly as muscleCtrl does (rest = 0), then the loss and its gradient
    for (let a = 0; a < nAct; a++) {
      const name = readout.actuators[a];
      const [lo, hi] = ranges[name] || [0, 1];
      let c = 0;
      if (/^adhere_claw/.test(name)) {
        let s = 0; for (let u = 0; u < readout.units.length; u++) if (readout.units[u].act === a) s += aCache[u];
        c = 0.6 + 0.4 * Math.min(1, s);
      } else {
        for (let u = 0; u < readout.units.length; u++) { const un = readout.units[u]; if (un.act !== a) continue;
          c += un.dir > 0 ? aCache[u] * hi : aCache[u] * lo; }   // dir<0 contributes a*lo (<0): pulls to lo
      }
      pred[cOff + a] = c;
      if (!score) continue;
      const err = c - target[cOff + a];
      loss += err * err; nScored++;
      const dLdc = 2 * err / (nAct * Math.max(1, nEp - scoreFromEpoch));
      // back to muscle activations, then to MN counts
      let adhereSum = 0;
      if (/^adhere_claw/.test(name)) { for (let u = 0; u < readout.units.length; u++) if (readout.units[u].act === a) adhereSum += aCache[u]; }
      for (let u = 0; u < readout.units.length; u++) {
        const un = readout.units[u]; if (un.act !== a) continue;
        const dcda = /^adhere_claw/.test(name) ? (adhereSum < 1 ? 0.4 : 0) : (un.dir > 0 ? hi : lo);
        const dadr = dff(rCache[u], aCache[u], un);
        const w = dLdc * dcda * dadr / un.mn.length / epochSecs;
        for (const i of un.mn) dW[off + i] += w;
      }
    }
    // MN-rate term: dense supervision that lifts silent MNs toward the recorded regime
    if (rateTarget && score) {
      const nMn = mnSub.length;
      for (let j = 0; j < nMn; j++) {
        const i = mnSub[j];
        const r = mnCounts[off + i] / epochSecs, rt = rateTarget[e * nMn + j];
        const err = r - rt;
        lossRate += err * err; nRate++;
        dW[off + i] += lambdaRate * 2 * err / (nMn * Math.max(1, nEp - scoreFromEpoch)) / epochSecs;
      }
    }
  }
  return { loss: loss / Math.max(1, nScored), lossCtrl: loss / Math.max(1, nScored),
    lossRate: lossRate / Math.max(1, nRate), dLdSpikePerEpoch: dW, predCtrl: pred };
}

/** L1 budget subgradient for logGain (spec S2.6's L_budget). */
export function budgetGrad(logGain, lambda, out) {
  for (let i = 0; i < logGain.length; i++) out[i] = lambda * Math.sign(logGain[i]);
  return out;
}
