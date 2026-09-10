// FlyAgent: one connectome brain in one physically simulated body, living in an arena.
// Closed loop every 1 ms of simulated time:
//   physics state -> Senses (+ CompoundEye every 10 ms) -> sensory neuron drive -> brain (2 x 0.5 ms LIF steps)
//   -> Motor (descending commands / motor neurons) -> actuators -> physics (10 x 0.1 ms MuJoCo steps)
import { buildWorldXML } from './world.js';
import { Senses, CompoundEye } from './senses.js';
import { FlyVisionFV } from './vision.js';
import { Motor } from './motor.js';
import { createBrain } from '../brainmodel.js';

export class FlyAgent {
  constructor({ mj, flyXML, env, data, size, sign, bodymap, gait, id = 0, pos = [0, 0], yaw = 0, nProxies = 0, mode = 'descending', brainOpts = {}, vision = true, brain = null, flyvis = null }) {
    this.id = id; this.mj = mj; this.env = env; this.data = data; this.vision = vision;
    this.model = mj.MjModel.from_xml_string(buildWorldXML(flyXML, env, { flyPos: [pos[0], pos[1], 0.132], flyYaw: yaw, nProxies }));
    this.mjd = new mj.MjData(this.model);
    this.physPerMs = Math.round(0.001 / this.model.opt.timestep);
    mj.mj_forward(this.model, this.mjd);
    const M = this.model, name2body = n => M.body(n).id;
    this.bid = { thorax: name2body('thorax'), head: name2body('head'), labrum: name2body('labrum_left'), antL: name2body('antenna_left'), antR: name2body('antenna_right') };
    this.claw = {}; for (const l of ['T1', 'T2', 'T3']) for (const s of ['left', 'right']) this.claw[`${l}_${s}`] = name2body(`claw_${l}_${s}`);
    this.sensorAdr = {}; for (let i = 0; i < M.nsensor; i++) this.sensorAdr[M.sensor(i).name] = M.sensor_adr[i];
    this.jointAdr = {}; for (let j = 0; j < M.njnt; j++) this.jointAdr[M.jnt(j).name] = M.jnt_qposadr[j];
    // geoms: albedo for vision; which bodies count as "self body" for bristle contact
    this.geomKind = []; for (let g = 0; g < M.ngeom; g++) { const n = M.geom(g).name; this.geomKind.push(n === 'floor' ? 'floor' : n.startsWith('wall') ? 'wall' : n.startsWith('food') ? 'food' : n.startsWith('bitter') ? 'bitter' : n.startsWith('hazard') ? 'hazard' : n.startsWith('obst') ? 'obst' : n.startsWith('proxy') ? 'fly' : n.startsWith('threat') ? 'threat' : 'self'); }
    this.floorGeom = M.geom('floor').id;
    this.threatMocap = M.body_mocapid[M.body('threat').id];
    // brain
    this.brain = brain || createBrain(data, size, brainOpts, sign);   // wasm brain can be injected (shared connectome memory)
    const typeOf = data.meta.types, sideOf = data.side;
    this.senses = new Senses(bodymap, mj, M); this.senses.bindTypes(typeOf, sideOf);
    // vision: flyvis optic-lobe model driving the male-CNS optic lobe (if provided), else the simple photoreceptor eye
    this.fv = vision && flyvis ? new FlyVisionFV(mj, M, this.mjd, bodymap, flyvis.map, flyvis.eyes, this.bid.head, this.bid.thorax, flyvis.gain ?? 150) : null;
    this.eye = vision && !this.fv ? new CompoundEye(mj, M, this.mjd, bodymap, this.bid.head, this.bid.thorax) : null;
    this.motor = new Motor(mj, M, this.mjd, bodymap, typeOf, sideOf, gait, mode);
    this.driven = new Int32Array(0);
    // physiology
    this.energy = 0.6; this.health = 1; this.alive = true; this.eaten = 0; this.t = 0; this.foodEaten = env.food.map(() => 0); this.dist = 0; this.jumps = 0; this._lastPos = null; this._wasJumping = false;
    this.others = [];   // [{x,y,yaw}] of other flies (set by the host)
    this.log = [];
  }
  state() {
    const d = this.mjd, xp = d.xpos, B = this.bid;
    const P = b => [xp[3 * b], xp[3 * b + 1], xp[3 * b + 2]];
    const sd = this.mjd.sensordata, sa = this.sensorAdr;
    const st = { pos: P(B.thorax), labellum: P(B.labrum), antenna: { left: P(B.antL), right: P(B.antR) }, claw: {}, touch: {}, load: {}, joint: {},
      gyro: [sd[sa.gyro], sd[sa.gyro + 1], sd[sa.gyro + 2]], vel: [sd[sa.velocimeter], sd[sa.velocimeter + 1], sd[sa.velocimeter + 2]],
      bodyContact: { left: false, right: false }, otherFlies: this.others, sugarGain: 0.6 + 0.9 * (1 - this.energy), bitterGain: 0.6 + 0.8 * this.energy };
    st.labellumZ = st.labellum[2];
    st.proboscisOut = this.motor.proboscisOut();
    for (const [k, b] of Object.entries(this.claw)) { st.claw[k] = P(b); st.touch[k] = sd[sa[`touch_claw_${k}`]]; const f = sa[`force_tarsus_${k}`]; st.load[k] = Math.hypot(sd[f], sd[f + 1], sd[f + 2]); }
    for (const [n, a] of Object.entries(this.jointAdr)) if (/^(tibia|coxa)_T/.test(n)) st.joint[n] = d.qpos[a];
    // body contacts with anything other than the floor (walls, obstacles, other flies) -> bristles by side (every 10 ms)
    if (this.t % 10 === 0) {
      const Rt = d.xmat.slice(B.thorax * 9, B.thorax * 9 + 9); const bc = { left: false, right: false };
      const cv = d.contact; const n = Math.min(d.ncon, cv.size());
      for (let c = 0; c < n; c++) { const con = cv.get(c); const k1 = this.geomKind[con.geom1], k2 = this.geomKind[con.geom2];
        if ((k1 === 'self') !== (k2 === 'self') && k1 !== 'floor' && k2 !== 'floor') {
          const p = con.pos; const rel = [p[0] - st.pos[0], p[1] - st.pos[1], p[2] - st.pos[2]]; const lat = Rt[1] * rel[0] + Rt[4] * rel[1] + Rt[7] * rel[2];
          bc[lat > 0 ? 'left' : 'right'] = true; }
        con.delete(); }
      cv.delete(); this._bodyContact = bc;
    }
    st.bodyContact = this._bodyContact || st.bodyContact;
    return st;
  }
  albedo = (g, x, y) => {
    const k = this.geomKind[g];
    if (k === 'threat') return 0.03;
    if (k === 'floor') return 0.35 + 0.25 * (((Math.floor(x / 0.4) + Math.floor(y / 0.4)) & 1) ? 1 : 0);   // checker floor
    if (k === 'wall') { const a = Math.atan2(y, x); return 0.15 + 0.6 * ((Math.floor(a / (Math.PI / 12)) & 1) ? 1 : 0); }  // striped wall
    if (k === 'food') return 0.9; if (k === 'bitter') return 0.5; if (k === 'hazard') return 0.6; if (k === 'obst') return 0.12; if (k === 'fly') return 0.08;
    return 0.3;
  };
  /** advance 1 ms of simulated time */
  step() {
    if (!this.alive) return;
    const mj = this.mj, M = this.model, d = this.mjd;
    const th = this.env.threat, tm = this.threatMocap * 3;
    if (th) { d.mocap_pos[tm] = th.x; d.mocap_pos[tm + 1] = th.y; d.mocap_pos[tm + 2] = th.z; } else if (d.mocap_pos[tm + 2] > -10) d.mocap_pos[tm + 2] = -20;
    const st = this.state();
    const rates = this.senses.update(st, this.env, 1);
    if (this.eye && (this.t % 10 === 0)) { this._eyeRates = new Map(); const er = this._eyeRates; this.eye.update({ set: (ix, hz) => { for (const i of ix) er.set(i, hz); } }, this.env, 10, this.albedo); }
    if (this.fv && (this.t % 20 === 0)) { this._eyeRates = new Map(); const er = this._eyeRates; this.fv.update((ix, hz) => { for (const i of ix) er.set(i, hz); }, this.env, this.albedo, 20); }
    if (this._eyeRates) for (const [i, hz] of this._eyeRates) rates.set(i, hz);
    // apply sensory drive (clear neurons no longer driven)
    const B = this.brain; for (const i of this.driven) B.drive[i] = 0;
    const nd = new Int32Array(rates.size); let k = 0; for (const [i, hz] of rates) { B.setDriveOne(i, hz); nd[k++] = i; } this.driven = nd;
    // GF -> TTMn electrical synapse (not in the chemical connectome): GF spikes depolarise TTMn directly
    const before = this.brain.spikeCount[this.motor.dn.escape[0]] + this.brain.spikeCount[this.motor.dn.escape[1]];
    this.brain.step(); this.brain.step();
    const after = this.brain.spikeCount[this.motor.dn.escape[0]] + this.brain.spikeCount[this.motor.dn.escape[1]];
    if (after > before) this.brain.pulse(this.motor.ttmn, 20);
    this.motor.readBrain(this.brain.spikeCount, 1);
    this.cmd = this.motor.apply(this.t, 1, { up: this.mjd.xmat[this.bid.thorax * 9 + 8] });
    for (let s = 0; s < this.physPerMs; s++) mj.mj_step(M, d);
    this.t += 1;
    this.physiology(st);
  }
  physiology(st) {
    const dt = 0.001;
    if (this._lastPos) this.dist += Math.hypot(st.pos[0] - this._lastPos[0], st.pos[1] - this._lastPos[1]); this._lastPos = st.pos;
    const jumping = this.motor.jumpT >= 0; if (jumping && !this._wasJumping) this.jumps++; this._wasJumping = jumping;
    const walking = Math.abs(this.cmd.v);
    this.energy -= dt * (1 / 240 + walking / 180);                 // compressed timescale: ~4 min to starve at rest
    // ingestion: labellum on food + proboscis extended + pharyngeal pump motor neurons active
    if (st.labellumZ < 0.065 && st.proboscisOut) for (const f of this.env.food) {
      if (f.amount > 0 && Math.hypot(st.labellum[0] - f.x, st.labellum[1] - f.y) < f.r) {
        const intake = dt * 0.15 * f.sugar * (0.3 + 0.7 * this.motor.feeding());
        f.amount -= intake; this.energy += intake; this.eaten += intake; this.foodEaten[this.env.food.indexOf(f)] += intake; }
    }
    if (st.heat > 0.5) this.health -= dt * 0.5 * st.heat;
    if (this.energy <= 0) { this.energy = 0; this.health -= dt * 0.2; }
    this.energy = Math.min(1, this.energy);
    if (this.health <= 0 && this.alive) { this.alive = false; this.health = 0; }
  }
  behavior(st) {
    const c = this.cmd || {}; const m = this.motor;
    if (!this.alive) return 'dead';
    if (c.righting) return 'righting';
    if (m.jumpT >= 0) return 'escape jump';
    if (c.grooming) return 'grooming';
    if (st && st.proboscisOut && st.labellumZ < 0.065 && this.env.food.some(f => f.amount > 0 && Math.hypot(st.labellum[0] - f.x, st.labellum[1] - f.y) < f.r)) return 'feeding';
    if (st && st.proboscisOut) return 'proboscis extended';
    if (c.v < -0.05) return 'walking backward';
    if (c.v > 0.05) return Math.abs(c.turn) > 0.3 ? (c.turn > 0 ? 'turning left' : 'turning right') : 'walking';
    return 'standing';
  }
  pose() { const d = this.mjd; return { xpos: d.xpos.slice(0), xquat: d.xquat.slice(0) }; }
}
