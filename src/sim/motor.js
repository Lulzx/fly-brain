// Motor output: connectome activity -> actuator commands.
// Two modes:
//  'descending' (default): the brain's real descending neurons set locomotor drive (forward/backward) and
//     steering; a stepping pattern generator (optimised tripod gait) executes it. Proboscis, antennae and the
//     giant-fibre jump are driven directly by their motor neurons.
//  'connectome': every mapped leg muscle is driven by its own motor neurons through the VNC connectome.
export const DN_ROLES = {
  // Locomotion phenotypes of DN activation: Cande et al. 2018 (eLife 7:e34275), Bidaye et al. 2014/2020,
  // Sapkal et al. 2024 (BDN2, oDN1), Rayshubskiy et al. 2020 (DNa02 steering), von Reyn 2014 (GF).
  // walking command neurons carry the drive; the others are visually driven all the time and only modulate it
  forward: { DNg100: 1, DNg97: 1, DNp09: 1, DNa05: 0.2, DNa07: 0.2, DNp26: 0.2, DNg25: 0.2, DNa01: 0.1, DNa02: 0.1 },
  backward: { MDN: 1 },
  turn: { DNa02: 1.0, DNa01: 0.6, DNp09: 0.5 },   // ipsilateral steering
  groom: { DNg07: 1, DNg08: 1, DNg12: 1 },         // head grooming with the front legs
  escape: { DNp01: 1 },                            // giant fibre
  takeoff: { DNp02: 1, DNp04: 1 },                 // looming-sensitive non-GF escape DNs (von Reyn 2014, Namiki 2018)
  courtP: { pIP10: 1 },                            // P1->VNC courtship interneuron (fru+; Deutsch et al. 2020)
  courtDN: { DNp13: 1 },                           // courtship pursuit descending neuron
};
export const READOUT = { takeoffThreshold: 70, takeoffRatio: 3, takeoffTauSlow: 3000, takeoffInit: 20, startupMs: 1500, gfSpikes: 4, gfWindow: 50, fwdThreshold: 4, fwdScale: 12, turnScale: 25, turnAdaptTau: 4000, backMax: 0.35, groomScale: 40, turnTau: 150, flightTurnTau: 50, muscleHalf: 17,
  courtPBase: 5, courtPScale: 4, courtDNBase: 12, courtDNScale: 8 };   // courtship readout: baseline-subtracted, normalised
// fwd: walking needs weighted DN drive above threshold (Hz); speed = 1 - exp(-excess / fwdScale).
// muscles: activation = 1 - exp(-rate * ln2 / muscleHalf), i.e. half-maximal at ~17 Hz (insect force-frequency curves saturate early)
const LEGS = ['T1', 'T2', 'T3'], SIDES = ['left', 'right'];
// jump program selected by scripts/jump_test2.py: lands upright from any walking phase, >=1.1 mm hop
const JUMP = { pre: 30, push: 20, f2: 0.7, t2: 0.5, f3: 0.4, f1: 0.5, fly: 80 };   // scripts/jump_test3.py: 24/24 upright from fast turning gaits
// righting reflex (VNC-level; scripts/righting_test.py): inverted > 150 ms -> left wing pushes on the substrate
// while the legs flail in tripod antiphase; rights the fly from all tested inverted starts within ~0.1 s
const RIGHT = { f: 6, aL: 1.0, aR: 0.3, tib: 0.5, abd: 0.5, wy: 1.0, wr: -1.0, wp: -1.0, wf: 4 };
const PIVOT = { turn: 0.25, amp: 0.55, inner: -0.7 };   // turning on the spot
const PHASE = { T1_left: 0, T2_right: 0, T3_left: 0, T1_right: Math.PI, T2_left: Math.PI, T3_right: Math.PI };

export class Motor {
  constructor(mj, model, data, bodymap, typeOf, sideOf, gait, mode = 'descending') {
    this.model = model; this.data = data; this.mode = mode; this.gait = gait;
    this.act = {}; for (let i = 0; i < model.nu; i++) this.act[model.actuator(i).name] = i;
    this.range = {}; const cr = model.actuator_ctrlrange; for (let i = 0; i < model.nu; i++) this.range[model.actuator(i).name] = [cr[2 * i], cr[2 * i + 1]];
    const byType = (t, s) => { const o = []; for (let i = 0; i < typeOf.length; i++) if (typeOf[i] === t && (s === undefined || sideOf[i] === s)) o.push(i); return o; };
    const pop = (roles, s) => Object.entries(roles).flatMap(([t, w]) => byType(t, s).map(i => [i, w]));
    this.dn = { forward: pop(DN_ROLES.forward), backward: pop(DN_ROLES.backward), escape: pop(DN_ROLES.escape).map(x => x[0]), takeoff: pop(DN_ROLES.takeoff), groom: pop(DN_ROLES.groom),
      turnL: pop(DN_ROLES.turn, 1), turnR: pop(DN_ROLES.turn, 2), courtP: pop(DN_ROLES.courtP), courtDN: pop(DN_ROLES.courtDN) };
    this.muscles = bodymap.muscles; this.ttmn = bodymap.jump;
    this.rate = new Float32Array(typeOf.length);    // low-pass filtered firing rate per neuron (Hz), only for used neurons
    this.used = new Set([...this.dn.forward.map(x => x[0]), ...this.dn.backward.map(x => x[0]), ...this.dn.escape, ...this.dn.takeoff.map(x => x[0]), ...this.dn.groom.map(x => x[0]), ...this.dn.turnL.map(x => x[0]), ...this.dn.turnR.map(x => x[0]), ...this.dn.courtP.map(x => x[0]), ...this.dn.courtDN.map(x => x[0]), ...bodymap.jump, ...bodymap.feeding]);
    for (const m of this.muscles) for (const i of m.idx) this.used.add(i);
    this.used = Int32Array.from(this.used);
    this.lastCount = new Uint32Array(typeOf.length);
    this.phase = 0; this.cmd = { v: 0, turn: 0, drive: 0, back: 0, escape: 0 }; this.jumpT = -1;
    this.feedingIdx = bodymap.feeding;
  }
  /** update filtered rates from brain spike counts; dtMs since last call */
  readBrain(spikeCount, dtMs, tau = 40) {
    const k = dtMs / tau, inv = 1000 / dtMs;
    this.gfTimes = this.gfTimes || []; for (const i of this.dn.escape) if (spikeCount[i] !== this.lastCount[i]) this.gfTimes.push(this.tNow || 0);
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
    // backward walking (MDN) is slow in real flies, ~1 cm/s, a third of top forward speed
    const sat = x => 1 - Math.exp(-x / R0.fwdScale);   // speed saturates smoothly with DN drive
    const v = grooming ? 0 : (net > R0.fwdThreshold ? sat(net - R0.fwdThreshold) : back > R0.fwdThreshold ? -R0.backMax * sat(back - R0.fwdThreshold) : 0);
    this.turnF = (this.turnF || 0) + dtMs / (this.flying ? R0.flightTurnTau : R0.turnTau) * (turn - (this.turnF || 0));   // flight steering is faster
    // slow adaptation removes standing left/right imbalances of the steering DNs (the model's DNa02 and P9
    // pairs receive unequal tonic input), keeping transient asymmetries: saccades, plumes, objects
    this.turnBase = (this.turnBase || 0) + dtMs / R0.turnAdaptTau * (this.turnF - (this.turnBase || 0));
    // courtship circuit readout: pIP10 and DNp13 sit downstream of the pheromone pathways (2 hops from the
    // cVA and tarsal pheromone receptors); both roughly double their rate near another fly
    const court = Math.max(0, Math.min(1, 0.5 * Math.max(0, this.wmean(this.dn.courtP) - R0.courtPBase) / R0.courtPScale + 0.5 * Math.max(0, this.wmean(this.dn.courtDN) - R0.courtDNBase) / R0.courtDNScale));
    this.cmd = { v, turn: Math.max(-0.6, Math.min(0.6, (this.turnF - this.turnBase) / R0.turnScale)), drive: fwd, back, groom, grooming, escape: this.mean(this.dn.escape), takeoff: this.wmean(this.dn.takeoff), court };
    if (this.mode === 'connectome') {
      for (const leg of LEGS) for (const sd of SIDES) {
        for (const j of ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2']) set(`${j}_${leg}_${sd}`, muscleCtrl(`${j}_${leg}_${sd}`));
        set(`adhere_claw_${leg}_${sd}`, 0.6 + 0.4 * Math.min(1, (actv[`adhere_claw_${leg}_${sd}`] || []).reduce((a, [, x]) => a + x, 0)));
      }
    } else {
      // a standing fly with a strong steering command turns on the spot: the inner legs step backwards
      const pivot = Math.abs(v) < 0.1 && Math.abs(this.cmd.turn) > PIVOT.turn;
      const g = this.gait, amp = pivot ? PIVOT.amp : Math.min(1, Math.abs(v) * 1.5), freq = g.freq * (0.5 + 0.5 * Math.min(1, pivot ? PIVOT.amp : Math.abs(v)));
      this.stepAmp = amp > 0.05 ? Math.min(1, amp * 2) : 0; this.pivot = pivot;
      if (amp > 0.05) this.phase += (pivot ? 1 : Math.sign(v)) * 2 * Math.PI * freq * dtMs / 1000;
      for (const leg of LEGS) for (const sd of SIDES) {
        const key = `${leg}_${sd}`, phi = this.phase + PHASE[key];
        const inner = (this.cmd.turn > 0) === (sd === 'left');
        const steer = pivot ? (inner ? PIVOT.inner : 1) : 1 + this.cmd.turn * (sd === 'left' ? -1 : 1);   // turn>0 (left DNs) -> shorter left strides -> turn left
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
    // --- courtship song: one wing (on the side facing the other fly) extended and vibrating ---
    if (extra.court?.sing && !this.jumping && !this.flying && !this.righting) {
      const sd = extra.court.side === 'right' ? 'right' : 'left';
      const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * 30 * tMs / 1000);   // song pulses rendered as a visible flutter
      set(`wing_yaw_${sd}`, 1.35); set(`wing_roll_${sd}`, 0.5); set(`wing_pitch_${sd}`, -0.5 - 0.4 * w);
      this.cmd.singing = true;
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
    // escape: a single GF spike drives TTMn 1:1 (electrical synapse) -> jump; or the looming-sensitive takeoff DNs
    // rise sharply above their own recent baseline (a loom, not the fluctuations of self-motion)
    this.tNow = tMs; this.gfTimes = (this.gfTimes || []).filter(t => tMs - t < READOUT.gfWindow); this.gfSpike = this.gfTimes.length >= READOUT.gfSpikes;
    const to = this.cmd.takeoff; this.toSlow = this.toSlow === undefined ? READOUT.takeoffInit : this.toSlow + dtMs / READOUT.takeoffTauSlow * (to - this.toSlow);
    const loomTakeoff = to > READOUT.takeoffThreshold && to > READOUT.takeoffRatio * this.toSlow;
    // an inverted fly cannot jump; nor does one whose antennae are on the object filling its view (a wall it
    // walked into looms on the eye, but touch says it is not an approaching predator)
    const canJump = (extra.up ?? 1) > 0.5 && !this.righting && !(this.recoverUntil > tMs) && !this.flying && (!extra.touching || (extra.voluntary && !extra.contact));
    if ((this.gfSpike || loomTakeoff || extra.voluntary) && canJump && this.jumpT < 0 && tMs > READOUT.startupMs) { this.jumpT = tMs; this.launchT = -1; this.jumpCause = this.gfSpike ? 'GF burst' : loomTakeoff ? `takeoff DNs ${to.toFixed(0)}Hz (baseline ${this.toSlow.toFixed(0)})` : 'voluntary'; if (globalThis.LOG_JUMPS) console.log(`jump at ${tMs} ms: ${this.jumpCause}, up ${(extra.up ?? 1).toFixed(2)}`); }
    if (this.jumpT >= 0) {
      // jump program (tested in scripts/jump_test.py): TTM drives both middle legs to full extension for 20 ms,
      // hind femora half-extended, all tarsi released; ~2.5 mm hop that lands upright
      const J = JUMP, dtj = tMs - this.jumpT - J.pre;   // 30 ms symmetric pre-jump posture (long-mode takeoff), then TTM push
      const all = ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2'];
      this.jumping = dtj < J.push + J.fly + 190;
      if (this.jumping) for (const leg of LEGS) for (const sd of SIDES) {
        for (const j of all) set(`${j}_${leg}_${sd}`, 0);                      // symmetric posture
        if (dtj >= J.push && this.launchT < 0) this.launchT = tMs;              // push done: airborne, the wings take over
        if (dtj >= 0 && dtj < J.push) {                                         // TTM push
          if (leg === 'T2') { set(`femur_T2_${sd}`, J.f2 * R[`femur_T2_${sd}`][1]); set(`tibia_T2_${sd}`, J.t2 * R[`tibia_T2_${sd}`][1]); }
          if (leg === 'T3') set(`femur_T3_${sd}`, J.f3 * R[`femur_T3_${sd}`][1]);
          if (leg === 'T1') set(`femur_T1_${sd}`, J.f1 * R[`femur_T1_${sd}`][1]);
        }
        set(`adhere_claw_${leg}_${sd}`, dtj < 0 ? 0.8 : dtj < J.push + J.fly ? 0 : 0.8);
      }
      if (dtj > 1000) { this.jumpT = -1; this.jumping = false; }   // refractory period
    }
    // --- righting reflex ---
    const up = extra.up ?? 1;
    this.invertedMs = up < -0.3 && !this.flying ? (this.invertedMs || 0) + dtMs : 0;
    if (this.invertedMs > 150 || (this.righting && up < 0.8)) {
      this.righting = true; const t = tMs / 1000, P = RIGHT;
      for (const leg of LEGS) for (const sd of SIDES) {
        const amp = sd === 'left' ? P.aL : P.aR, lph = 2 * Math.PI * P.f * t + (['T1_left', 'T2_right', 'T3_left'].includes(`${leg}_${sd}`) ? 0 : Math.PI);
        set(`coxa_${leg}_${sd}`, amp * Math.sin(lph) * R[`coxa_${leg}_${sd}`][1]);
        set(`femur_${leg}_${sd}`, amp * (0.5 + 0.5 * Math.sin(lph)) * R[`femur_${leg}_${sd}`][1]);
        set(`tibia_${leg}_${sd}`, P.tib * R[`tibia_${leg}_${sd}`][1]);
        set(`coxa_abduct_${leg}_${sd}`, R[`coxa_abduct_${leg}_${sd}`][0] * P.abd * (sd === 'left' ? 1 : 0.2));
        set(`adhere_claw_${leg}_${sd}`, Math.sin(lph) > 0 ? 1 : 0);
      }
      const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * P.wf * t);
      set('wing_yaw_left', P.wy * w); set('wing_roll_left', P.wr * w); set('wing_pitch_left', P.wp * w);
      this.cmd.righting = true;
    } else if (this.righting) { this.righting = false; this.recoverUntil = tMs + 300; for (const ax of ['yaw', 'roll', 'pitch']) set(`wing_${ax}_left`, 0); }
    if (!this.righting && this.recoverUntil > tMs) for (const leg of LEGS) for (const sd of SIDES) {   // settle in a standing posture after righting
      for (const j of ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2']) set(`${j}_${leg}_${sd}`, 0);
      set(`adhere_claw_${leg}_${sd}`, 0.8); }
    return this.cmd;
  }
  feeding() { return 1 - Math.exp(-this.mean(this.feedingIdx) * Math.LN2 / READOUT.muscleHalf); }
  proboscisOut() { const r = this.data.ctrl[this.act.rostrum]; return r < -0.4; }
}
