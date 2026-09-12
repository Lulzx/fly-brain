// Flight: takeoff, stabilised free flight and landing for the flybody fly.
// The wings beat the real FlySuite stroke (218 Hz) through their real hinge joints, and the aerodynamic
// force on each wing is computed every millisecond by a blade-element quasi-steady model (Dickinson et al.
// 1999, Science 284:1954): the wing's velocity at its effective radius, the instantaneous angle of attack,
// and empirical CL(alpha)/CD(alpha) give the lift and drag applied to the wing body. Lift, thrust and drag
// are therefore emergent — the fly accelerates by pitching the stroke plane, slows by pitching up, and
// hovers only while the wings beat. The velocity loop commands a force demand: its vertical part scales the
// stroke amplitude (lift ~ amp^2), its horizontal part tilts the body so the mean lift vector points the
// right way. Roll is produced by the real mechanism — differential wingbeat amplitude (the steering-muscle
// asymmetry); pitch and yaw torques remain a lumped haltere-reflex stand-in (documented in the docs).
// A loss of tarsal contact starts the wings (the tarsal reflex); leg contact at touchdown stops them.
import { clearance } from './senses.js';

// wing yaw, roll, pitch joint angles (rad) over one stroke cycle: 50 samples of body/flysuite/wing_pattern_fmech.npy
export const WING_CYCLE = [[-0.835, -0.102, 0.809], [-0.825, -0.113, 1.126], [-0.799, -0.112, 1.459], [-0.754, -0.095, 1.766], [-0.688, -0.061, 2.000], [-0.602, -0.013, 2.129], [-0.496, 0.042, 2.144], [-0.371, 0.092, 2.068], [-0.231, 0.131, 1.949], [-0.081, 0.151, 1.831], [0.074, 0.152, 1.743], [0.230, 0.135, 1.691], [0.383, 0.104, 1.667], [0.531, 0.066, 1.658], [0.671, 0.025, 1.657], [0.804, -0.016, 1.659], [0.928, -0.056, 1.656], [1.043, -0.092, 1.643], [1.145, -0.127, 1.615], [1.234, -0.161, 1.567], [1.307, -0.193, 1.494], [1.361, -0.225, 1.389], [1.397, -0.255, 1.243], [1.412, -0.282, 1.051], [1.407, -0.303, 0.815], [1.382, -0.316, 0.542], [1.339, -0.319, 0.248], [1.279, -0.311, -0.042], [1.204, -0.292, -0.294], [1.115, -0.265, -0.471], [1.015, -0.234, -0.553], [0.906, -0.202, -0.551], [0.791, -0.171, -0.502], [0.669, -0.141, -0.446], [0.544, -0.113, -0.406], [0.416, -0.087, -0.386], [0.286, -0.062, -0.377], [0.155, -0.040, -0.368], [0.026, -0.019, -0.353], [-0.100, -0.002, -0.329], [-0.221, 0.011, -0.296], [-0.333, 0.020, -0.253], [-0.435, 0.023, -0.204], [-0.526, 0.021, -0.150], [-0.606, 0.013, -0.095], [-0.674, 0.001, -0.034], [-0.730, -0.016, 0.042], [-0.775, -0.036, 0.146], [-0.808, -0.059, 0.298], [-0.828, -0.081, 0.507]];
export const FLIGHT = {
  wingHz: 218,                   // Drosophila wingbeat frequency
  speed: 9, speedJitter: 0.3,    // cm/s cruising speed; free flight reaches 30-100 cm/s, but not in a 5 cm arena
  alt: [0.35, 0.75],             // cm, cruising height range
  duration: [1.5, 0.6],          // lognormal flight time: median s, log-sd
  climbMs: 250,
  yawGain: 14, yawMax: 12,       // rad/s per unit steering command, and the limit (saccades reach ~500 deg/s)
  kv: 14, kz: 5, kp: 400000, kd: 2000, kr: 20000,   // velocity loop (1/s), height (1/s), attitude P (1/s^2) and D (1/s), yaw rate (1/s)
  pitch: 0.35, maxBank: 0.6,     // cruise body pitch nose-up (rad, ~20 deg as in slow forward flight); bank limit in turns
  fmax: 2.2,                     // peak aerodynamic force / body weight
  maxSpeed: 40,                  // cm/s, see the numerical guard in update()
  wallMargin: 0.45, wallPush: 25,   // centring near walls: cm, 1/s
  landSpeed: 2, sink: 4, touchdownMs: 80,   // cm/s, cm/s, ms of weight transfer to the legs
  ampMin: 0.25, ampMax: 1.8, rollGain: 5e-7, pitchTrim: 0.2,
};
const G = 981;   // cm/s^2
// blade-element quasi-steady aerodynamics (Dickinson et al. 1999). Translational lift/drag only; the
// rotational circulation and added-mass terms that matter within ~10 ms of stroke reversal are omitted.
const AERO = {
  rho: 0.00128,                       // air density, g/cm^3 (option density in the physics XML)
  area: Math.PI * 0.0551 * 0.114,     // wing planform area, cm^2 (the wing-fluid ellipsoid's chord x span)
  rEff: 0.6,                          // effective blade radius as a fraction of span (2nd moment of area)
  cl: a => 0.225 + 1.58 * Math.sin(2.13 * a - 7.2),      // alpha in degrees
  cd: a => 1.92 - 1.55 * Math.cos(2.04 * a - 9.82),
  unsteady: 1.6,                      // lumped stand-in for the omitted rotational-circulation and added-mass
                                      // terms, which carry ~30-40% of Drosophila lift (Dickinson 1999)
};
const WING_RANGE = [[-1.45, 1.45], [-0.98, 1.45], [-1.25, 2.9]];   // yaw, roll, pitch joint limits (rad)
const WING_MEAN = [0, 0, 0]; for (const s of WING_CYCLE) for (let a = 0; a < 3; a++) WING_MEAN[a] += s[a] / WING_CYCLE.length;
const WING_SPREAD = 12;   // cycle sample used as the spread wing posture in the physics
const LEG_JOINTS = ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2'];
// flight posture: legs drawn up under the body (fractions of each joint's range toward its upper (+) or lower (-) limit)
export const FLIGHT_LEGS = { T1: { femur: -0.5, tibia: 0.6 }, T2: { femur: -0.5, tibia: 0.6 }, T3: { femur: -0.4, tibia: 0.6 } };

export class Flight {
  constructor({ mj, model, data, thorax, jointAdr, act, range, rand = Math.random }) {
    this.mj = mj; this.M = model; this.d = data; this.th = thorax; this.act = act; this.range = range; this.rand = rand;
    this.mass = model.body_subtreemass[thorax];
    this.bodies = []; for (let b = 1; b < model.nbody; b++) { let p = b; while (p > 0 && p !== thorax) p = model.body_parentid[p]; if (p === thorax) this.bodies.push(b); }
    // wing joint qpos addresses — the stroke is applied kinematically (see substep), the actuators cannot
    // swing the real 218 Hz cycle against the joint armature
    this.wing = ['left', 'right'].map(sd => ['yaw', 'roll', 'pitch'].map(ax => jointAdr[`wing_${ax}_${sd}`]));
    this.wingBody = ['left', 'right'].map(sd => model.body(`wing_${sd}`).id);
    this.wingGeom = ['left', 'right'].map(sd => model.geom(`wing_${sd}_fluid`).id);
    // which way each wing-geom axis points (distal span, dorsal normal, leading edge) is a fixed property of
    // the mesh — resolve the signs once; testing them every step lets a tumbled pose flip a sign and the
    // blade point teleports, which explodes the force calculation
    this.wingSign = [0, 1].map(s => {
      const g = this.wingGeom[s], gm = data.geom_xmat, gp = data.geom_xpos, gb = g * 9, go = g * 3;
      const th = [data.xpos[thorax * 3], data.xpos[thorax * 3 + 1], data.xpos[thorax * 3 + 2]];
      const sp = [gm[gb + 2], gm[gb + 5], gm[gb + 8]];
      const dP = (gp[go] + sp[0] - th[0]) ** 2 + (gp[go + 1] + sp[1] - th[1]) ** 2 + (gp[go + 2] + sp[2] - th[2]) ** 2;
      const dM = (gp[go] - sp[0] - th[0]) ** 2 + (gp[go + 1] - sp[1] - th[1]) ** 2 + (gp[go + 2] - sp[2] - th[2]) ** 2;
      return { sp: dP >= dM ? 1 : -1 };
    });
    this.active = false; this.phase = null; this.wingPhase = 0; this.liftUnit = null;
  }
  /** blade-element point on wing s: wing-fluid geom centre + rEff * semi-span along the distal span axis */
  bladePoint(s) {
    const d = this.d, g = this.wingGeom[s], gm = d.geom_xmat, gp = d.geom_xpos, gb = g * 9, go = g * 3;
    const ss = this.wingSign[s].sp, sp = [gm[gb + 2] * ss, gm[gb + 5] * ss, gm[gb + 8] * ss];
    return { bp: [gp[go] + sp[0] * AERO.rEff * 0.114, gp[go + 1] + sp[1] * AERO.rEff * 0.114, gp[go + 2] + sp[2] * AERO.rEff * 0.114], sp };
  }
  /** aerodynamic force on wing s (0 left, 1 right) for blade-point velocity vb (cm/s, inertial frame) and
   *  ambient wind [wx, wy] cm/s. Blade-element quasi-steady (Dickinson 1999): relative air velocity at the
   *  effective radius, alpha in the chord-normal plane, empirical CL/CD. Returns dynes, world frame. */
  aeroForce(s, wind, vb) {
    const d = this.d, g = this.wingGeom[s], gm = d.geom_xmat, gb = g * 9;
    let n = [gm[gb], gm[gb + 3], gm[gb + 6]], c = [gm[gb + 1], gm[gb + 4], gm[gb + 7]];
    const { sp } = this.bladePoint(s);
    // quasi-steady convention: the chord frame follows whichever face is up relative to the body at this
    // instant (lift is directed toward the surface meeting the flow) — fixed material signs instead
    // mis-measure alpha once the wing pitches past 90 deg
    const R = this.R();
    const bx = [R[0], R[3], R[6]], bz = [R[2], R[5], R[8]];
    if (n[0] * bz[0] + n[1] * bz[1] + n[2] * bz[2] < 0) { n = n.map(x => -x); c = c.map(x => -x); }
    if (c[0] * bx[0] + c[1] * bx[1] + c[2] * bx[2] < 0) c = c.map(x => -x);
    const vr = [(wind ? wind[0] : 0) - vb[0], (wind ? wind[1] : 0) - vb[1], -vb[2]];
    const vs = vr[0] * sp[0] + vr[1] * sp[1] + vr[2] * sp[2];
    let pl = [vr[0] - vs * sp[0], vr[1] - vs * sp[1], vr[2] - vs * sp[2]];
    let V = Math.hypot(pl[0], pl[1], pl[2]);
    if (V < 1) return [0, 0, 0];
    if (V > 600) { pl = pl.map(p => p * 600 / V); V = 600; }   // cap: beyond this a transient is unphysical
    const alpha = Math.atan2(pl[0] * n[0] + pl[1] * n[1] + pl[2] * n[2], pl[0] * c[0] + pl[1] * c[1] + pl[2] * c[2]) * 180 / Math.PI;
    const q = 0.5 * AERO.rho * V * V * AERO.area;
    const L = q * AERO.cl(alpha) * AERO.unsteady, D = q * AERO.cd(alpha);
    // drag opposes the in-plane flow; lift is perpendicular to it, toward the dorsal normal for CL > 0
    const ld = [sp[1] * pl[2] - sp[2] * pl[1], sp[2] * pl[0] - sp[0] * pl[2], sp[0] * pl[1] - sp[1] * pl[0]];
    const ln = Math.hypot(ld[0], ld[1], ld[2]) || 1, sgn = (ld[0] * n[0] + ld[1] * n[1] + ld[2] * n[2]) * Math.sign(AERO.cl(alpha)) >= 0 ? 1 : -1;
    return [L * sgn * ld[0] / ln - D * pl[0] / V, L * sgn * ld[1] / ln - D * pl[1] / V, L * sgn * ld[2] / ln - D * pl[2] / V];
  }
  /** mean cycle-averaged total lift of both wings at amplitude 1 with a still body: the lift scale used to
   *  map the vertical force demand to a wingbeat amplitude. Measured once on the standing fly by stepping
   *  the real joints through one cycle and finite-differencing the blade points. */
  calibrateLift() {
    const d = this.d, M = this.M, mj = this.mj;
    const q0 = d.qpos.slice(0);
    const prev = [null, null]; let L = 0; const dt = 1 / (WING_CYCLE.length * FLIGHT.wingHz);
    for (let k = 0; k <= WING_CYCLE.length; k++) {
      const kk = k % WING_CYCLE.length;
      for (let s = 0; s < 2; s++) for (let a = 0; a < 3; a++) d.qpos[this.wing[s][a]] = WING_CYCLE[kk][a];
      mj.mj_kinematics(M, d);
      for (let s = 0; s < 2; s++) {
        const { bp } = this.bladePoint(s);
        if (prev[s]) { const vb = bp.map((x, i) => (x - prev[s][i]) / dt); L += this.aeroForce(s, null, vb)[2]; }
        prev[s] = bp;
      }
    }
    d.qpos.set(q0); mj.mj_kinematics(M, d);
    this.liftUnit = Math.max(1e-3, L / WING_CYCLE.length);   // dynes at amplitude 1
  }
  gauss() { let u = 0; while (!u) u = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand()); }
  start(tMs, { cause = 'takeoff', awayFrom = null } = {}) {
    const F = FLIGHT;
    this.active = true; this.phase = 'climb'; this.t0 = tMs; this.cause = cause; this.bladePrev = [null, null];
    this.dur = 1000 * F.duration[0] * Math.exp(F.duration[1] * this.gauss());
    this.alt = F.alt[0] + (F.alt[1] - F.alt[0]) * this.rand();
    this.speed = F.speed * Math.max(0.4, 1 + F.speedJitter * this.gauss());
    this.escape = null;
    if (awayFrom) {   // escape: bank away from the looming object for the first moments of flight
      const R = this.R(), yaw = Math.atan2(R[3], R[0]), p = this.com();
      const bearing = Math.atan2(awayFrom[1] - p[1], awayFrom[0] - p[0]) - yaw;
      this.escape = { dir: Math.sin(bearing) > 0 ? -1 : 1, until: tMs + 300 }; this.speed *= 1.4;
    }
  }
  R() { const b = this.th * 9; return this.d.xmat.slice(b, b + 9); }
  com() { const b = this.th * 3, c = this.d.subtree_com; return [c[b], c[b + 1], c[b + 2]]; }
  /** composite inertia tensor of the whole fly about its centre of mass, world frame (row-major 3x3) */
  inertia(com) {
    const M = this.M, d = this.d, I = new Float64Array(9);
    for (const b of this.bodies) {
      const m = M.body_mass[b], R = d.ximat.subarray(b * 9, b * 9 + 9), J = [M.body_inertia[b * 3], M.body_inertia[b * 3 + 1], M.body_inertia[b * 3 + 2]];
      const r = [d.xipos[b * 3] - com[0], d.xipos[b * 3 + 1] - com[1], d.xipos[b * 3 + 2] - com[2]], r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        let s = 0; for (let k = 0; k < 3; k++) s += R[i * 3 + k] * J[k] * R[j * 3 + k];
        I[i * 3 + j] += s + m * ((i === j ? r2 : 0) - r[i] * r[j]);
      }
    }
    return I;
  }
  /** one ms of flight. ctx: { turn: brain steering command, env, others, legTouch: any claw on a surface } */
  update(tMs, dtMs, ctx) {
    if (!this.active) return;
    if (this.liftUnit === null) this.calibrateLift();
    const F = FLIGHT, d = this.d, m = this.mass, th = this.th, dt = dtMs / 1000, mj = this.mj, M = this.M;
    const R = this.R(), com = this.com(), v = [d.qvel[0], d.qvel[1], d.qvel[2]], w = [d.qvel[3], d.qvel[4], d.qvel[5]];   // free joint: world linear, body angular velocity
    const yaw = Math.atan2(R[3], R[0]), pitch = Math.asin(Math.max(-1, Math.min(1, R[6]))), roll = Math.atan2(R[7], R[8]);
    const age = tMs - this.t0;
    // numerical guard: a takeoff pressed into a wall can make the contact solver fling the body; no fly does that
    const sp = Math.hypot(v[0], v[1], v[2]); if (sp > F.maxSpeed) { const k = F.maxSpeed / sp; for (let i = 0; i < 3; i++) { d.qvel[i] *= k; v[i] *= k; } }
    const wr = Math.hypot(w[0], w[1], w[2]); if (wr > 3000) { const k = 3000 / wr; for (let i = 3; i < 6; i++) { d.qvel[i] *= k; w[i - 3] *= k; } }   // contact kicks can fling the free body; a fly never spins at 3000 rad/s
    // --- phases: climb, cruise, land (descend onto the legs), touchdown (weight onto the legs) ---
    if (this.phase === 'climb' && age > F.climbMs) this.phase = 'cruise';
    if (this.phase === 'cruise' && age > this.dur && !this.overObstacle(com, ctx.env)) this.phase = 'land';
    if ((this.phase === 'land' || (this.phase === 'cruise' && com[2] < 0.2)) && (ctx.legTouch || com[2] < 0.15)) { this.phase = 'touchdown'; this.tTouch = tMs; }
    if (this.phase === 'touchdown' && tMs - this.tTouch > F.touchdownMs) return this.end();
    const landing = this.phase === 'land' || this.phase === 'touchdown';
    // --- desired motion ---
    let r = F.yawGain * (ctx.turn || 0);
    if (this.escape && tMs < this.escape.until) r += this.escape.dir * 10;
    r = Math.max(-F.yawMax, Math.min(F.yawMax, r));
    const spd = landing ? F.landSpeed : this.speed * Math.min(1, age / F.climbMs + 0.3);
    const vt = [spd * Math.cos(yaw), spd * Math.sin(yaw), 0];
    // centring: a wall or obstacle closer than the margin pushes the flight path away from it
    const c0 = clearance(com, ctx.env, ctx.others, com[2]);
    if (c0 < F.wallMargin) {
      const e = 0.01, gx = (clearance([com[0] + e, com[1]], ctx.env, ctx.others, com[2]) - c0) / e, gy = (clearance([com[0], com[1] + e], ctx.env, ctx.others, com[2]) - c0) / e, gn = Math.hypot(gx, gy) || 1;
      const k = F.wallPush * (F.wallMargin - c0); vt[0] += k * gx / gn; vt[1] += k * gy / gn;
    }
    vt[2] = landing ? -F.sink : Math.max(-F.sink, Math.min(3, F.kz * (this.alt - com[2])));
    // --- force demand: vertical part sets the stroke amplitude (lift ~ amp^2), forward part tilts the body ---
    const fz = m * (G + F.kv * (vt[2] - v[2]));
    const fx = m * F.kv * (vt[0] - v[0]), fy = m * F.kv * (vt[1] - v[1]);
    const fFwd = fx * Math.cos(yaw) + fy * Math.sin(yaw);
    let amp = Math.sqrt(Math.max(0.1 * m * G, fz) / this.liftUnit);
    amp = Math.max(F.ampMin, Math.min(F.ampMax, amp));
    // --- attitude: banking into turns; pitch tilts the lift vector for thrust (nose down to accelerate) ---
    const bank = Math.max(-F.maxBank, Math.min(F.maxBank, -Math.atan(spd * r / G)));
    // the stroke's mean force tilts ~55 deg forward of the body frame (measured on the blade-element
    // model), so the body must pitch steeply nose-up to put lift under weight — Drosophila really do
    // hover at ~50 deg. The bound needs room for that
    const pitchT = landing ? 0.05 : Math.max(-0.5, Math.min(1.2, F.pitchTrim - Math.atan2(fFwd, Math.max(fz, 0.2 * m * G)) + 0.9));
    const alpha = [F.kp * (bank - roll) - F.kd * w[0], -F.kp * (pitchT - pitch) - F.kd * w[1], F.kr * (r - w[2])];   // body frame (y rotation: nose down)
    // --- wingbeat control state for the substeps: amplitude from the force demand, roll from differential
    // amplitude (the steering-muscle asymmetry), fading out through touchdown ---
    const dAmp = Math.max(-0.35, Math.min(0.35, F.rollGain * alpha[0]));
    this.ampS = [amp * (1 + dAmp), amp * (1 - dAmp)];
    this.fade = this.phase === 'touchdown' ? Math.max(0, 1 - (tMs - this.tTouch) / F.touchdownMs) : 1;
    this.wind = ctx.env.wind;
    // attitude torque: the lumped haltere->steering-muscle moment (roll is assisted, not replaced, by the
    // differential amplitude above — it adds a real roll moment but is too weak alone to recover a tumble)
    const Iw = this.inertia(com);
    const aw = [0, 1, 2].map(i => R[i * 3] * alpha[0] + R[i * 3 + 1] * alpha[1] + R[i * 3 + 2] * alpha[2]);
    const tau = [0, 1, 2].map(i => Iw[i * 3] * aw[0] + Iw[i * 3 + 1] * aw[1] + Iw[i * 3 + 2] * aw[2]);
    this.tauAtt = tau.map(t => t * this.fade);   // combined with the aero moment each substep
    // --- legs: tucked in flight, extended to land ---
    const set = (name, val) => { const i = this.act[name]; if (i === undefined) return; const [lo, hi] = this.range[name]; d.ctrl[i] = Math.min(hi, Math.max(lo, val)); };
    for (const leg of ['T1', 'T2', 'T3']) for (const sd of ['left', 'right']) {
      for (const j of LEG_JOINTS) { const fr = landing ? 0 : (FLIGHT_LEGS[leg][j] || 0), [lo, hi] = this.range[`${j}_${leg}_${sd}`] || [0, 0]; set(`${j}_${leg}_${sd}`, fr >= 0 ? fr * hi : -fr * lo); }
      set(`adhere_claw_${leg}_${sd}`, landing ? 0.8 : 0);
    }
    return this.phase;
  }
  /** one physics substep (~0.1 ms = ~8 deg of stroke): advance the wings through the real FlySuite stroke
   *  and apply the instantaneous aerodynamic force they produce. Called before every mj_step while flying,
   *  so the air sees the full 218 Hz beat and the oscillating lift cannot alias into the attitude loop.
   *  The stroke is evaluated kinematically (wing qpos -> kinematics -> blade point -> restore): the wing
   *  actuators cannot swing the real stroke against the joint armature, and teleporting qpos under the
   *  constraint solver pumps energy into the free body. The wing's own dynamics are negligible anyway
   *  (wing mass is 0.8% of the fly); the force it would transmit through the hinge is applied to the
   *  thorax at the blade point, which is the same rigid-body load. */
  substep(dtMs) {
    const F = FLIGHT, d = this.d, M = this.M, mj = this.mj;
    this.wingPhase = (this.wingPhase + F.wingHz * dtMs / 1000) % 1;
    const ph = this.wingPhase * WING_CYCLE.length, i0 = Math.floor(ph) % WING_CYCLE.length, i1 = (i0 + 1) % WING_CYCLE.length, u = ph - Math.floor(ph);
    const q = [0, 1, 2].map(a => WING_CYCLE[i0][a] + (WING_CYCLE[i1][a] - WING_CYCLE[i0][a]) * u);
    const saved = [0, 1].map(s => [0, 1, 2].map(a => d.qpos[this.wing[s][a]]));
    for (let s = 0; s < 2; s++) for (let a = 0; a < 3; a++) {
      const qq = a === 2 ? q[a] : WING_MEAN[a] + this.ampS[s] * (q[a] - WING_MEAN[a]);
      const [lo, hi] = WING_RANGE[a];
      d.qpos[this.wing[s][a]] = Math.max(lo, Math.min(hi, qq));
    }
    mj.mj_kinematics(M, d);
    // clamp the free body before every step: the leg launch and floor-contact kicks can push qvel to
    // physically absurd values (10+ m/s), and one ballistic substep penetrates the floor and catapults
    for (let i = 0; i < 3; i++) d.qvel[i] = Math.max(-F.maxSpeed, Math.min(F.maxSpeed, d.qvel[i]));
    for (let i = 3; i < 6; i++) d.qvel[i] = Math.max(-3000, Math.min(3000, d.qvel[i]));
    const x = d.xfrc_applied, dt = dtMs / 1000, com = this.com(), o = this.th * 6;
    const tauA = this.tauAtt || [0, 0, 0];
    x[o] = 0; x[o + 1] = 0; x[o + 2] = 0; x[o + 3] = tauA[0]; x[o + 4] = tauA[1]; x[o + 5] = tauA[2];
    for (let s = 0; s < 2; s++) {
      const { bp } = this.bladePoint(s);
      const vb = this.bladePrev[s] ? bp.map((p, i) => (p - this.bladePrev[s][i]) / dt) : [0, 0, 0];
      this.bladePrev[s] = bp;
      const Fw = this.aeroForce(s, this.wind, vb).map(f => f * this.fade);
      // the load transmits to the thorax through the wing hinge: equivalent force at the COM plus the
      // moment about it. The moment arm is taken at the hinge, not the blade point — the beat-scale
      // moment from our quasi-steady conventions is unreliable and injects a large oscillating torque
      // the attitude loop cannot follow; the wing hinge keeps a smaller real coupling
      const wb = this.wingBody[s] * 3;
      const r = [d.xpos[wb] - com[0], d.xpos[wb + 1] - com[1], d.xpos[wb + 2] - com[2]];
      x[o] += Fw[0]; x[o + 1] += Fw[1]; x[o + 2] += Fw[2];
      x[o + 3] += r[1] * Fw[2] - r[2] * Fw[1]; x[o + 4] += r[2] * Fw[0] - r[0] * Fw[2]; x[o + 5] += r[0] * Fw[1] - r[1] * Fw[0];
    }
    for (let s = 0; s < 2; s++) for (let a = 0; a < 3; a++) d.qpos[this.wing[s][a]] = saved[s][a];   // restore parked wings
  }
  /** wing poses relative to the thorax at n phases of the stroke cycle, for drawing the beating wings:
   *  { left: [[px, py, pz, qw, qx, qy, qz], ...], right: [...] } */
  wingPoses(mj, n = 8) {
    const M = this.M, d = this.d, saved = d.qpos.slice(0), out = { left: [], right: [] }, th = this.th;
    const wb = ['left', 'right'].map(sd => M.body(`wing_${sd}`).id);
    for (let k = 0; k < n; k++) {
      const q = WING_CYCLE[Math.floor(k * WING_CYCLE.length / n)];
      for (let s = 0; s < 2; s++) for (let a = 0; a < 3; a++) d.qpos[this.wing[s][a]] = q[a];
      mj.mj_kinematics(M, d);
      const R = d.xmat.slice(th * 9, th * 9 + 9), pt = [d.xpos[th * 3], d.xpos[th * 3 + 1], d.xpos[th * 3 + 2]], qt = d.xquat.slice(th * 4, th * 4 + 4);
      wb.forEach((b, s) => {
        const dp = [0, 1, 2].map(i => d.xpos[b * 3 + i] - pt[i]), pr = [0, 1, 2].map(j => R[j] * dp[0] + R[3 + j] * dp[1] + R[6 + j] * dp[2]);
        const qw = d.xquat.slice(b * 4, b * 4 + 4), qi = [qt[0], -qt[1], -qt[2], -qt[3]];
        out[s ? 'right' : 'left'].push([...pr, ...qmul(qi, qw)].map(x => +x.toFixed(5)));
      });
    }
    d.qpos.set(saved); mj.mj_kinematics(M, d);
    return out;
  }
  overObstacle(p, env) { return env.obstacles.some(o => o.type === 'box' ? Math.abs(p[0] - o.x) < o.sx + 0.15 && Math.abs(p[1] - o.y) < o.sy + 0.15 : Math.hypot(p[0] - o.x, p[1] - o.y) < o.r + 0.15); }
  end() {
    const x = this.d.xfrc_applied; for (const b of [this.th, ...this.wingBody]) for (let k = 0; k < 6; k++) x[b * 6 + k] = 0;
    this.active = false; this.phase = null; return 'landed';
  }
  label() { return { climb: 'taking off', cruise: 'flying', land: 'landing', touchdown: 'landing' }[this.phase] || null; }
}
function qmul(a, b) { return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]]; }
