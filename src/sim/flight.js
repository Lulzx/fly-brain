// Flight: takeoff, stabilised free flight and landing for the flybody fly.
// The physics file has no aerodynamic model for the wings, and flapping flight in flybody needed a trained
// controller, so flight here is quasi-steady: the wings beat with real kinematics (FlySuite wing-beat cycle,
// 218 Hz), and the net aerodynamic force and torque of each stroke cycle are applied to the body. The
// commands come from the fly: the brain's steering DNs set the yaw rate (collision-avoidance and spontaneous
// saccades are delivered through them), and a haltere-like reflex holds roll and pitch, banking into turns
// (halteres are gyroscopes that feed the wing steering muscles directly; Dickinson 1999). Speed and height
// are held by the flight motor as a fly holds them from ventral optic flow. A loss of tarsal contact starts
// the wings (the tarsal reflex); leg contact at touchdown stops them.
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
  kv: 14, kz: 5, kp: 2500, kd: 90, kr: 60,   // velocity loop (1/s), height (1/s), attitude P (1/s^2) and D (1/s), yaw rate (1/s)
  pitch: 0.35, maxBank: 0.6,     // cruise body pitch nose-up (rad, ~20 deg as in slow forward flight); bank limit in turns
  fmax: 2.2,                     // peak aerodynamic force / body weight
  maxSpeed: 40,                  // cm/s, see the numerical guard in update()
  wallMargin: 0.45, wallPush: 25,   // centring near walls: cm, 1/s
  landSpeed: 2, sink: 4, touchdownMs: 80,   // cm/s, cm/s, ms of weight transfer to the legs
};
const G = 981;   // cm/s^2
const WING_SPREAD = 12;   // cycle sample used as the spread wing posture in the physics
const LEG_JOINTS = ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2'];
// flight posture: legs drawn up under the body (fractions of each joint's range toward its upper (+) or lower (-) limit)
export const FLIGHT_LEGS = { T1: { femur: -0.5, tibia: 0.6 }, T2: { femur: -0.5, tibia: 0.6 }, T3: { femur: -0.4, tibia: 0.6 } };

export class Flight {
  constructor({ model, data, thorax, jointAdr, act, range, rand = Math.random }) {
    this.M = model; this.d = data; this.th = thorax; this.act = act; this.range = range; this.rand = rand;
    this.mass = model.body_subtreemass[thorax];
    this.bodies = []; for (let b = 1; b < model.nbody; b++) { let p = b; while (p > 0 && p !== thorax) p = model.body_parentid[p]; if (p === thorax) this.bodies.push(b); }
    const dof = {}; for (let j = 0; j < model.njnt; j++) dof[model.jnt(j).name] = model.jnt_dofadr[j];
    this.wing = ['left', 'right'].map(sd => ['yaw', 'roll', 'pitch'].map(ax => [jointAdr[`wing_${ax}_${sd}`], dof[`wing_${ax}_${sd}`]]));
    this.active = false; this.phase = null; this.wingPhase = 0;
  }
  gauss() { let u = 0; while (!u) u = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand()); }
  start(tMs, { cause = 'takeoff', awayFrom = null } = {}) {
    const F = FLIGHT;
    this.active = true; this.phase = 'climb'; this.t0 = tMs; this.cause = cause;
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
    const F = FLIGHT, d = this.d, m = this.mass, th = this.th, dt = dtMs / 1000;
    const R = this.R(), com = this.com(), v = [d.qvel[0], d.qvel[1], d.qvel[2]], w = [d.qvel[3], d.qvel[4], d.qvel[5]];   // free joint: world linear, body angular velocity
    const yaw = Math.atan2(R[3], R[0]), pitch = Math.asin(Math.max(-1, Math.min(1, R[6]))), roll = Math.atan2(R[7], R[8]);
    const age = tMs - this.t0;
    // numerical guard: a takeoff pressed into a wall can make the contact solver fling the body; no fly does that
    const sp = Math.hypot(v[0], v[1], v[2]); if (sp > F.maxSpeed) { const k = F.maxSpeed / sp; for (let i = 0; i < 3; i++) { d.qvel[i] *= k; v[i] *= k; } }
    // --- phases: climb, cruise, land (descend onto the legs), touchdown (weight onto the legs) ---
    if (this.phase === 'climb' && age > F.climbMs) this.phase = 'cruise';
    if (this.phase === 'cruise' && age > this.dur && !this.overObstacle(com, ctx.env)) this.phase = 'land';
    if (this.phase === 'land' && (ctx.legTouch || com[2] < 0.15)) { this.phase = 'touchdown'; this.tTouch = tMs; }
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
    let f = [m * F.kv * (vt[0] - v[0]), m * F.kv * (vt[1] - v[1]), m * (G + F.kv * (vt[2] - v[2]))];
    const fn = Math.hypot(...f), fmax = F.fmax * m * G; if (fn > fmax) f = f.map(x => x * fmax / fn);
    if (this.phase === 'touchdown') { const k = Math.max(0, 1 - (tMs - this.tTouch) / F.touchdownMs); f = f.map(x => x * k); }
    // --- attitude: haltere reflex holds roll/pitch, banks into turns; yaw rate follows the command ---
    const bank = Math.max(-F.maxBank, Math.min(F.maxBank, -Math.atan(spd * r / G)));
    const pitchT = landing ? 0.05 : F.pitch;
    const alpha = [F.kp * (bank - roll) - F.kd * w[0], -F.kp * (pitchT - pitch) - F.kd * w[1], F.kr * (r - w[2])];   // body frame (y rotation: nose down)
    const Iw = this.inertia(com);
    // tau_world = Iw * (R alpha)
    const aw = [0, 1, 2].map(i => R[i * 3] * alpha[0] + R[i * 3 + 1] * alpha[1] + R[i * 3 + 2] * alpha[2]);
    const tau = [0, 1, 2].map(i => Iw[i * 3] * aw[0] + Iw[i * 3 + 1] * aw[1] + Iw[i * 3 + 2] * aw[2]);
    // the force acts at the thorax's centre of mass; remove the torque it makes about the fly's centre of mass
    const ra = [d.xipos[th * 3] - com[0], d.xipos[th * 3 + 1] - com[1], d.xipos[th * 3 + 2] - com[2]];
    const x = d.xfrc_applied, o = th * 6;
    x[o] = f[0]; x[o + 1] = f[1]; x[o + 2] = f[2];
    x[o + 3] = tau[0] - (ra[1] * f[2] - ra[2] * f[1]); x[o + 4] = tau[1] - (ra[2] * f[0] - ra[0] * f[2]); x[o + 5] = tau[2] - (ra[0] * f[1] - ra[1] * f[0]);
    // --- wings: held spread in the physics (the renderer draws the 218 Hz stroke from wingPoses); driving the
    // real stroke kinematically would add ~1000 rad/s joint velocities whose reaction torques the quasi-steady
    // force model already accounts for ---
    this.wingPhase = (this.wingPhase + F.wingHz * dt) % 1;
    const spread = WING_CYCLE[WING_SPREAD];
    for (let s = 0; s < 2; s++) for (let a = 0; a < 3; a++) { const [qa, da] = this.wing[s][a]; d.qpos[qa] = this.phase === 'touchdown' ? d.qpos[qa] : spread[a]; d.qvel[da] = 0; }
    // --- legs: tucked in flight, extended to land ---
    const set = (name, val) => { const i = this.act[name]; if (i === undefined) return; const [lo, hi] = this.range[name]; d.ctrl[i] = Math.min(hi, Math.max(lo, val)); };
    for (const leg of ['T1', 'T2', 'T3']) for (const sd of ['left', 'right']) {
      for (const j of LEG_JOINTS) { const fr = landing ? 0 : (FLIGHT_LEGS[leg][j] || 0), [lo, hi] = this.range[`${j}_${leg}_${sd}`] || [0, 0]; set(`${j}_${leg}_${sd}`, fr >= 0 ? fr * hi : -fr * lo); }
      set(`adhere_claw_${leg}_${sd}`, landing ? 0.8 : 0);
    }
    return this.phase;
  }
  /** wing poses relative to the thorax at n phases of the stroke cycle, for drawing the beating wings:
   *  { left: [[px, py, pz, qw, qx, qy, qz], ...], right: [...] } */
  wingPoses(mj, n = 8) {
    const M = this.M, d = this.d, saved = d.qpos.slice(0), out = { left: [], right: [] }, th = this.th;
    const wb = ['left', 'right'].map(sd => M.body(`wing_${sd}`).id);
    for (let k = 0; k < n; k++) {
      const q = WING_CYCLE[Math.floor(k * WING_CYCLE.length / n)];
      for (let s = 0; s < 2; s++) for (let a = 0; a < 3; a++) d.qpos[this.wing[s][a][0]] = q[a];
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
    const x = this.d.xfrc_applied, o = this.th * 6; for (let k = 0; k < 6; k++) x[o + k] = 0;
    this.active = false; this.phase = null; return 'landed';
  }
  label() { return { climb: 'taking off', cruise: 'flying', land: 'landing', touchdown: 'landing' }[this.phase] || null; }
}
function qmul(a, b) { return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]]; }
