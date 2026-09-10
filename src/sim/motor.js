// Motor output: connectome activity -> actuator commands.
// Two modes:
//  'descending' (default): the brain's real descending neurons set locomotor drive (forward/backward) and
//     steering; a stepping pattern generator (optimised tripod gait) executes it. Proboscis, antennae and the
//     giant-fibre jump are driven directly by their motor neurons.
//  'connectome': every mapped leg muscle is driven by its own motor neurons through the VNC connectome.
export const DN_ROLES = {
  // Locomotion phenotypes of DN activation: Cande et al. 2018 (eLife 7:e34275), Bidaye et al. 2014/2020,
  // Sapkal et al. 2024 (BDN2, oDN1), Rayshubskiy et al. 2020 (DNa02 steering), von Reyn 2014 (GF).
  forward: { DNg100: 1, DNg97: 1, DNp09: 1, DNa05: 0.7, DNa07: 0.7, DNp26: 0.7, DNg25: 0.7, DNa01: 0.4, DNa02: 0.4 },
  backward: { MDN: 1 },
  turn: { DNa02: 1.0, DNa01: 0.6, DNp09: 0.5 },   // ipsilateral steering
  groom: { DNg07: 1, DNg08: 1, DNg12: 1 },         // head grooming with the front legs
  escape: { DNp01: 1 },                            // giant fibre
  takeoff: { DNp02: 1, DNp04: 1 },                 // looming-sensitive non-GF escape DNs (von Reyn 2014, Namiki 2018)
};
export const READOUT = { takeoffThreshold: 50, fwdThreshold: 2.5, fwdScale: 10, turnScale: 12, groomScale: 40, turnTau: 150, muscleHalf: 17 };
// fwd: walking needs weighted DN drive above threshold (Hz); command saturates fwdScale Hz above it.
// muscles: activation = 1 - exp(-rate * ln2 / muscleHalf), i.e. half-maximal at ~17 Hz (insect force-frequency curves saturate early)
const LEGS = ['T1', 'T2', 'T3'], SIDES = ['left', 'right'];
// jump program selected by scripts/jump_test2.py: lands upright from any walking phase, >=1.1 mm hop
const JUMP = { push: 20, f2: 1.0, t2: 1.0, f3: 0.4, f1: 0.5, fly: 80 };
const PHASE = { T1_left: 0, T2_right: 0, T3_left: 0, T1_right: Math.PI, T2_left: Math.PI, T3_right: Math.PI };

export class Motor {
  constructor(mj, model, data, bodymap, typeOf, sideOf, gait, mode = 'descending') {
    this.model = model; this.data = data; this.mode = mode; this.gait = gait;
    this.act = {}; for (let i = 0; i < model.nu; i++) this.act[model.actuator(i).name] = i;
    this.range = {}; const cr = model.actuator_ctrlrange; for (let i = 0; i < model.nu; i++) this.range[model.actuator(i).name] = [cr[2 * i], cr[2 * i + 1]];
    const byType = (t, s) => { const o = []; for (let i = 0; i < typeOf.length; i++) if (typeOf[i] === t && (s === undefined || sideOf[i] === s)) o.push(i); return o; };
    const pop = (roles, s) => Object.entries(roles).flatMap(([t, w]) => byType(t, s).map(i => [i, w]));
    this.dn = { forward: pop(DN_ROLES.forward), backward: pop(DN_ROLES.backward), escape: pop(DN_ROLES.escape).map(x => x[0]), takeoff: pop(DN_ROLES.takeoff), groom: pop(DN_ROLES.groom),
      turnL: pop(DN_ROLES.turn, 1), turnR: pop(DN_ROLES.turn, 2) };
    this.muscles = bodymap.muscles; this.ttmn = bodymap.jump;
    this.rate = new Float32Array(typeOf.length);    // low-pass filtered firing rate per neuron (Hz), only for used neurons
    this.used = new Set([...this.dn.forward.map(x => x[0]), ...this.dn.backward.map(x => x[0]), ...this.dn.escape, ...this.dn.takeoff.map(x => x[0]), ...this.dn.groom.map(x => x[0]), ...this.dn.turnL.map(x => x[0]), ...this.dn.turnR.map(x => x[0]), ...bodymap.jump, ...bodymap.feeding]);
    for (const m of this.muscles) for (const i of m.idx) this.used.add(i);
    this.used = Int32Array.from(this.used);
    this.lastCount = new Uint32Array(typeOf.length);
    this.phase = 0; this.cmd = { v: 0, turn: 0, drive: 0, back: 0, escape: 0 }; this.jumpT = -1;
    this.feedingIdx = bodymap.feeding;
  }
  /** update filtered rates from brain spike counts; dtMs since last call */
  readBrain(spikeCount, dtMs, tau = 40) {
    const k = dtMs / tau, inv = 1000 / dtMs;
    this.gfSpike = false; for (const i of this.dn.escape) if (spikeCount[i] !== this.lastCount[i]) this.gfSpike = true;
    for (const i of this.used) { const n = spikeCount[i] - this.lastCount[i]; this.lastCount[i] = spikeCount[i]; this.rate[i] += k * (n * inv - this.rate[i]); }
  }
  mean(ix) { let s = 0; for (const i of ix) s += this.rate[i]; return ix.length ? s / ix.length : 0; }
  wmean(pairs) { let s = 0, w = 0; for (const [i, wt] of pairs) { s += this.rate[i] * wt; w += wt; } return w ? s / w : 0; }
  /** compute and write actuator controls */
  apply(tMs, dtMs, extra = {}) {
    const d = this.data, ctrl = d.ctrl, A = this.act, R = this.range;
    const set = (name, v) => { const i = A[name]; if (i === undefined) return; const [lo, hi] = R[name]; ctrl[i] = Math.min(hi, Math.max(lo, v)); };
    // --- muscles driven directly by motor neurons (activation = rate / 100 Hz, saturating) ---
    const actv = {};
    const kHalf = Math.LN2 / READOUT.muscleHalf;
    for (const m of this.muscles) { const a = 1 - Math.exp(-this.mean(m.idx) * kHalf); (actv[m.actuator] ||= []).push([m.dir, a]); }
    const muscleCtrl = (name, rest = 0) => { const [lo, hi] = R[name]; let v = rest; for (const [dir, a] of actv[name] || []) v += dir > 0 ? a * (hi - rest) : -a * (rest - lo); return v; };
    for (const name of ['rostrum', 'haustellum', 'labrum_left', 'labrum_right', 'antenna_left', 'antenna_right']) if (A[name] !== undefined) set(name, muscleCtrl(name));
    // --- locomotion ---
    const fwd = this.wmean(this.dn.forward), back = this.wmean(this.dn.backward), groom = this.wmean(this.dn.groom);
    const turn = this.wmean(this.dn.turnL) - this.wmean(this.dn.turnR);
    const R0 = READOUT;
    const grooming = groom / R0.groomScale > 0.5 && groom > 1.5 * fwd;
    const net = fwd - 2 * back;
    const v = grooming ? 0 : (net > R0.fwdThreshold ? Math.min(1, (net - R0.fwdThreshold) / R0.fwdScale) : back > R0.fwdThreshold ? -Math.min(1, (back - R0.fwdThreshold) / R0.fwdScale) : 0);
    this.turnF = (this.turnF || 0) + dtMs / R0.turnTau * (turn - (this.turnF || 0));
    this.cmd = { v, turn: Math.max(-0.6, Math.min(0.6, this.turnF / R0.turnScale)), drive: fwd, back, groom, grooming, escape: this.mean(this.dn.escape), takeoff: this.wmean(this.dn.takeoff) };
    if (this.mode === 'connectome') {
      for (const leg of LEGS) for (const sd of SIDES) {
        for (const j of ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2']) set(`${j}_${leg}_${sd}`, muscleCtrl(`${j}_${leg}_${sd}`));
        set(`adhere_claw_${leg}_${sd}`, 0.6 + 0.4 * Math.min(1, (actv[`adhere_claw_${leg}_${sd}`] || []).reduce((a, [, x]) => a + x, 0)));
      }
    } else {
      const g = this.gait, amp = Math.min(1, Math.abs(v) * 1.5), freq = g.freq * (0.5 + 0.5 * Math.min(1, Math.abs(v)));
      if (amp > 0.05) this.phase += Math.sign(v) * 2 * Math.PI * freq * dtMs / 1000;
      for (const leg of LEGS) for (const sd of SIDES) {
        const key = `${leg}_${sd}`, phi = this.phase + PHASE[key];
        const steer = 1 + this.cmd.turn * (sd === 'left' ? -1 : 1);   // turn>0 (left DNs) -> shorter left strides -> turn left
        for (const j of g.joints) {
          const [off, a1, p1, a2, p2] = g.params[leg][j];
          let q = a1 * Math.cos(phi + p1) + a2 * Math.cos(2 * phi + p2);
          if (j === 'coxa') q *= steer;
          set(`${j}_${key}`, amp * (off + q));
        }
        const stance = ((phi + g.adhPhase) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) < 2 * Math.PI * g.duty;
        set(`adhere_claw_${key}`, amp > 0.05 ? (stance ? 1 : 0) : 0.8);
      }
    }
    // --- head grooming (DNg07/08/12): front legs lift and sweep over the head/eyes in antiphase (~7 Hz) ---
    if (this.cmd.grooming && this.mode !== 'connectome') {
      this.groomPhase = (this.groomPhase || 0) + 2 * Math.PI * 7 * dtMs / 1000;
      for (const sd of SIDES) { const ph = this.groomPhase + (sd === 'left' ? 0 : Math.PI);
        set(`coxa_T1_${sd}`, 1.1 + 0.25 * Math.sin(ph)); set(`femur_T1_${sd}`, -0.1); set(`tibia_T1_${sd}`, -0.9 + 0.35 * Math.sin(ph + 0.8));
        set(`coxa_twist_T1_${sd}`, 0.3 * Math.sin(ph)); set(`tarsus_T1_${sd}`, 0.4); set(`adhere_claw_T1_${sd}`, 0); }
    }
    // --- giant fibre escape: GF spikes -> TTM (electrical synapse) -> middle legs extend explosively ---
    const gf = this.cmd.escape, ttm = this.mean(this.ttmn);
    // escape: giant-fibre spikes (fast jump) or strong activity of looming-sensitive takeoff DNs (slower escape)
    // a single GF spike drives TTMn 1:1 through the GF-TTMn electrical synapse -> jump
    if ((this.gfSpike || this.cmd.takeoff > READOUT.takeoffThreshold) && this.jumpT < 0 && tMs > 200) this.jumpT = tMs;
    if (this.jumpT >= 0) {
      // jump program (tested in scripts/jump_test.py): TTM drives both middle legs to full extension for 20 ms,
      // hind femora half-extended, all tarsi released; ~2.5 mm hop that lands upright
      const dtj = tMs - this.jumpT, J = JUMP;
      const all = ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2'];
      if (dtj < J.push + J.fly + 190) for (const leg of LEGS) for (const sd of SIDES) {
        for (const j of all) set(`${j}_${leg}_${sd}`, 0);                      // symmetric posture
        if (dtj < J.push) {                                                     // TTM push
          if (leg === 'T2') { set(`femur_T2_${sd}`, J.f2 * R[`femur_T2_${sd}`][1]); set(`tibia_T2_${sd}`, J.t2 * R[`tibia_T2_${sd}`][1]); }
          if (leg === 'T3') set(`femur_T3_${sd}`, J.f3 * R[`femur_T3_${sd}`][1]);
          if (leg === 'T1') set(`femur_T1_${sd}`, J.f1 * R[`femur_T1_${sd}`][1]);
        }
        set(`adhere_claw_${leg}_${sd}`, dtj < J.push + J.fly ? 0 : 0.8);
      }
      if (dtj > 1000) this.jumpT = -1;   // refractory period
    }
    return this.cmd;
  }
  feeding() { return 1 - Math.exp(-this.mean(this.feedingIdx) * Math.LN2 / READOUT.muscleHalf); }
  proboscisOut() { const r = this.data.ctrl[this.act.rostrum]; return r < -0.4; }
}
