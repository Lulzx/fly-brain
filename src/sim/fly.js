// FlyAgent: one connectome brain in one physically simulated body, living in an arena.
// Closed loop every 1 ms of simulated time:
//   physics state -> Senses (+ CompoundEye every 10 ms) -> sensory neuron drive -> brain (2 x 0.5 ms LIF steps)
//   -> Motor (descending commands / motor neurons) -> actuators -> physics (10 x 0.1 ms MuJoCo steps)
import { buildWorldXML } from './world.js';
import { Senses, CompoundEye, clearance, heatAt } from './senses.js';
import { Intrinsic } from './intrinsic.js';
import { Neuromod } from './neuromod.js';
import { Flight } from './flight.js';
import { FlyVisionFV } from './vision.js';
import { Motor } from './motor.js';
import { createBrain } from '../brainmodel.js';

const Rt9 = (xm, b) => [xm[b * 9], xm[b * 9 + 3], xm[b * 9 + 6]];   // body x axis (heading) in world frame

export class FlyAgent {
  constructor({ mj, flyXML, env, data, size, sign, bodymap, gait, id = 0, pos = [0, 0], yaw = 0, nProxies = 0, mode = 'descending', brainOpts = {}, vision = true, brain = null, flyvis = null, intrinsic = true, seed = 0, neuromod = null, sex = 'm' }) {
    this.id = id; this.mj = mj; this.env = env; this.data = data; this.vision = vision; this.sex = sex;
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
    // hunger as hormones and octopamine (neuromod: { calib: neuromod.json, block }); needs brainOpts.neuromod, which
    // also removes the OA neurons' fast synapses from the graph
    this.neuromod = brainOpts.neuromod ? new Neuromod(data, this.brain, { calib: neuromod?.calib, block: neuromod?.block, params: neuromod?.params, minSyn: brainOpts.minSyn ?? 5 }) : null;
    const typeOf = data.meta.types, sideOf = data.side;
    this.senses = new Senses(bodymap, mj, M); this.senses.bindTypes(typeOf, sideOf);
    // LC10 small-object visual projection neurons: the eye-to-courtship channel. A nearby fly is detected
    // visually (LC10 responds to small moving objects; LC10a -> pC1/pIP10, Ribeiro et al. 2018), which is
    // how a male starts courting before the cVA pheromone plume reaches him
    this.lc10 = { left: [], right: [] };
    for (let i = 0; i < typeOf.length; i++) if (/^LC10[ad]$/.test(typeOf[i])) this.lc10[sideOf[i] === 2 ? 'right' : 'left'].push(i);
    // vision: flyvis optic-lobe model driving the male-CNS optic lobe (if provided), else the simple photoreceptor eye
    this.fv = vision && flyvis ? new FlyVisionFV(mj, M, this.mjd, bodymap, flyvis.map, flyvis.eyes, this.bid.head, this.bid.thorax, flyvis.gain ?? 150) : null;
    this.eye = vision && !this.fv ? new CompoundEye(mj, M, this.mjd, bodymap, this.bid.head, this.bid.thorax) : null;
    this.motor = new Motor(mj, M, this.mjd, bodymap, typeOf, sideOf, gait, mode);
    this.intrinsic = intrinsic ? new Intrinsic(typeOf, sideOf, id + 1 + (seed || 0), bodymap.feeding) : null;
    this.flight = new Flight({ mj, model: M, data: this.mjd, thorax: this.bid.thorax, jointAdr: this.jointAdr, act: this.motor.act, range: this.motor.range, rand: this.intrinsic?.rand });
    this.flights = 0;
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
    st.pitchUp = d.xmat[B.thorax * 9 + 6];   // sine of nose-up pitch (body x axis z component)
    st.proboscisOut = this.motor.proboscisOut(); st.stepping = this.motor.stepAmp || 0;
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
    // obstacle ahead: antenna tips (~0.2 mm in front of the antenna bases) or a front claw reach a wall, block
    // or fly. Both reach the brain as touch; antennal contact is what makes the fly turn away (st.antTouch)
    const fx = Rt9(d.xmat, B.thorax);
    st.frontTouch = {}; st.antTouch = {};
    for (const sd of ['left', 'right']) { const a = st.antenna[sd], tip = [a[0] + 0.02 * fx[0], a[1] + 0.02 * fx[1]];
      st.antTouch[sd] = clearance(tip, this.env, this.others, a[2]) < 0.003;
      st.frontTouch[sd] = st.antTouch[sd] || clearance(st.claw[`T1_${sd}`], this.env, this.others) < 0; }
    // a static surface just ahead (~1.7 mm): its looming matches the fly's own translation
    const hp = P(B.head); st.nearAhead = clearance([hp[0] + 0.12 * fx[0], hp[1] + 0.12 * fx[1]], this.env, this.others, hp[2]) < 0.05;
    if (this.flight.active) {   // flight: clearance at the lookahead point ahead and 40 degrees to each side
      const L = 0.9, yaw = Math.atan2(fx[1], fx[0]), at = a => clearance([st.pos[0] + L * Math.cos(yaw + a), st.pos[1] + L * Math.sin(yaw + a)], this.env, this.others, st.pos[2]);
      st.ahead = { center: at(0), left: at(0.7), right: at(-0.7) };
    }
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
    const rates = this.senses.update(st, this.env, 1); this._sugar = st.sugar;
    if (this.eye && (this.t % 10 === 0)) { this._eyeRates = new Map(); const er = this._eyeRates; this.eye.update({ set: (ix, hz) => { for (const i of ix) er.set(i, hz); } }, this.env, 10, this.albedo); }
    if (this.fv && (this.t % 20 === 0)) { this._eyeRates = new Map(); const er = this._eyeRates; this.fv.update((ix, hz) => { for (const i of ix) er.set(i, hz); }, this.env, this.albedo, 20); }
    if (this._eyeRates) for (const [i, hz] of this._eyeRates) rates.set(i, hz);
    // apply sensory drive (clear neurons no longer driven)
    const B = this.brain; for (const i of this.driven) B.setDriveOne(i, 0);
    if (this.neuromod) this.neuromod.update(1, this.energy, this.flight.active ? 1 : this.motor.stepAmp || 0);
    // courtship context for a male: the nearest other fly's range and bearing in his head frame, plus the
    // connectome's own courtship-circuit readout (pIP10, DNp13) from the previous step
    let court = null;
    if (this.sex !== 'f' && st.otherFlies.length) {
      const fx = Rt9(d.xmat, this.bid.thorax), yaw = Math.atan2(fx[1], fx[0]);
      for (const o of st.otherFlies) {
        const dd = Math.hypot(o.x - st.pos[0], o.y - st.pos[1]);
        if (!court || dd < court.dist) { const a = Math.atan2(o.y - st.pos[1], o.x - st.pos[0]) - yaw; court = { dist: dd, bearing: Math.atan2(Math.sin(a), Math.cos(a)) }; }
      }
      if (court) court.level = this.motor.cmd.court || 0;
      // LC10 drive: a nearby fly subtends a small moving object on the eye. Salience ~ angular size,
      // gated to the frontal-lateral field; the ipsilateral LC10 population carries it to pIP10
      for (const o of st.otherFlies) {
        const a = Math.atan2(o.y - st.pos[1], o.x - st.pos[0]) - Math.atan2(fx[1], fx[0]);
        const bearing = Math.atan2(Math.sin(a), Math.cos(a));
        const dd = Math.hypot(o.x - st.pos[0], o.y - st.pos[1]);
        const angular = Math.atan2(0.13, dd);              // fly ~1.3 mm radius
        if (Math.abs(bearing) < 2.2 && dd < 3 && angular > 0.04) {
          const hz = Math.min(140, 200 * angular);         // saturating small-object response
          const pool = this.lc10[bearing > 0 ? 'left' : 'right'];
          for (let k = 0; k < pool.length; k += 4) if ((rates.get(pool[k]) || 0) < hz) rates.set(pool[k], hz);   // ~1/4 of the column: the object covers part of the visual field
        }
      }
    }
    if (this.intrinsic) this.intrinsic.update(1, B, { energy: this.energy, arousal: this.neuromod?.arousal, touch: st.antTouch, rearing: st.pitchUp > 0.45 && this.motor.jumpT < 0 && !this.motor.righting,
      heat: { left: heatAt(st.antenna.left, this.env), right: heatAt(st.antenna.right, this.env) }, sugar: this._sugar || 0, flying: this.flight.active, ahead: st.ahead, court,
      mouthOnFood: this.env.food.some(f => f.amount > 0 && Math.hypot(st.labellum[0] - f.x, st.labellum[1] - f.y) < f.r - 0.02) });
    const nd = new Int32Array(rates.size); let k = 0; for (const [i, hz] of rates) { B.setDriveOne(i, hz); nd[k++] = i; } this.driven = nd;
    // GF -> TTMn electrical synapse (not in the chemical connectome): GF spikes depolarise TTMn directly
    const before = this.brain.spikeCount[this.motor.dn.escape[0]] + this.brain.spikeCount[this.motor.dn.escape[1]];
    this.brain.step(); this.brain.step();
    const after = this.brain.spikeCount[this.motor.dn.escape[0]] + this.brain.spikeCount[this.motor.dn.escape[1]];
    if (after > before) this.brain.pulse(this.motor.ttmn, 20);
    this.motor.readBrain(this.brain.spikeCount, 1);
    // escape gating: a static surface the fly is walking up to, touching, or backing away from looms on the eye,
    // its own pivots sweep the scene across the eye, and grooming legs pass over it. Touch, optic flow that matches
    // its own translation, and efference copies of its movements (Kim et al. 2015) tell the brain none is a predator.
    if (st.frontTouch.left || st.frontTouch.right || st.nearAhead || st.bodyContact.left || st.bodyContact.right || this.intrinsic?.avoid || this.cmd?.grooming) this.lastTouch = this.t;
    if (this.motor.pivot) this.lastPivot = this.t;
    const gated = this.t - (this.lastTouch ?? -1e9) < 500 || this.t - (this.lastPivot ?? -1e9) < 300;
    this.motor.flying = this.flight.active;
    this.cmd = this.motor.apply(this.t, 1, { up: this.mjd.xmat[this.bid.thorax * 9 + 8], touching: gated, voluntary: this.intrinsic && this.t < this.intrinsic.takeoffUntil,
      court: this.intrinsic?.state === 'court' ? { sing: !!this.intrinsic.courtSing, side: this.intrinsic.courtSide } : null,
      contact: st.bodyContact.left || st.bodyContact.right || st.antTouch.left || st.antTouch.right });   // no takeoff while pressed against something
    // takeoff: once the jump has pushed off, the wings start (tarsal reflex); an escape banks away from the threat
    if (this.motor.launchT === this.t && !this.flight.active) {
      const th = this.env.threat; this.flight.start(this.t, { cause: this.motor.jumpCause, awayFrom: th ? [th.x, th.y] : null }); this.flights++;
    }
    if (this.flight.active) {
      const legTouch = Object.values(st.touch).some(x => x > 0);
      if (this.flight.update(this.t, 1, { turn: this.cmd.turn, env: this.env, others: this.others, legTouch }) === 'landed') this.motor.recoverUntil = this.t + 300;
      this.cmd.flying = this.flight.active; this.cmd.flight = this.flight.label();
    }
    const dtSub = 1000 * M.opt.timestep;
    for (let s = 0; s < this.physPerMs; s++) { if (this.flight.active) this.flight.substep(dtSub); mj.mj_step(M, d); }
    this.t += 1;
    this.physiology(st);
  }
  physiology(st) {
    const dt = 0.001;
    if (this._lastPos) this.dist += Math.hypot(st.pos[0] - this._lastPos[0], st.pos[1] - this._lastPos[1]); this._lastPos = st.pos;
    const jumping = this.motor.jumping; if (jumping && !this._wasJumping) this.jumps++; this._wasJumping = jumping;
    const walking = Math.abs(this.cmd.v);
    this.energy -= dt * (1 / 240 + walking / 180 + (this.flight.active ? 1 / 40 : 0));   // compressed timescale: ~4 min to starve at rest; flight is costly
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
    if (this.flight.active) return this.flight.label();
    if (m.jumping) return m.jumpCause === 'voluntary' ? 'taking off' : 'escape jump';
    if (this.intrinsic?.state === 'court') return c.singing ? 'singing (courtship)' : 'courting';
    if (c.grooming) return 'grooming';
    if (st && st.proboscisOut && st.labellumZ < 0.065 && this.env.food.some(f => f.amount > 0 && Math.hypot(st.labellum[0] - f.x, st.labellum[1] - f.y) < f.r)) return 'feeding';
    const pe = st && st.proboscisOut ? ' (proboscis out)' : '';
    if (c.v < -0.05) return 'walking backward' + pe;
    if (c.v > 0.05) return (Math.abs(c.turn) > 0.3 ? (c.turn > 0 ? 'turning left' : 'turning right') : 'walking') + pe;
    return pe ? 'proboscis extended' : 'standing';
  }
  pose() { const d = this.mjd; return { xpos: d.xpos.slice(0), xquat: d.xquat.slice(0) }; }
}
