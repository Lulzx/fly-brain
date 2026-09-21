// Motor output: connectome activity -> actuator commands.
// Two modes:
//  'descending' (default): the brain's real descending neurons set locomotor drive (forward/backward) and
//     steering; a stepping pattern generator (optimised tripod gait) executes it. Proboscis, antennae and the
//     giant-fibre jump are driven directly by their motor neurons.
//  'connectome': every mapped leg muscle is driven by its own motor neurons through the VNC connectome.
import { Song } from './song.js';
import { createScaffoldSet, bindScaffoldParams } from './scaffold/index.js';

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
  // Flight command (roadmap M1). scripts/dn_flight.mjs drives all 480 descending types in turn and
  // ranks them by their effect on the wing power pool: DNa08 first, DNg02_a second, both putting ~80%
  // of the change on the wings rather than the legs. DNg02 is independently the population Namiki et
  // al. 2018 assign to wing-amplitude control in flight. Flight initiation and maintenance read this
  // rather than the lognormal duration draw in src/sim/flight.js -- which is the whole point, because
  // that draw is why nothing ever told the wing motor neurons the animal was airborne.
  flight: { DNa08: 1, DNg02_a: 1, DNg02_b: 1, DNg02_c: 1, DNg02_e: 1, DNg02_g: 1 },
};
export const READOUT = { takeoffThreshold: 70, takeoffRatio: 3, takeoffTauSlow: 3000, takeoffInit: 20, startupMs: 1500, gfSpikes: 4, gfWindow: 50, fwdThreshold: 4, fwdScale: 12, turnScale: 25, turnAdaptTau: 4000, backMax: 0.35, groomScale: 40, turnTau: 150, flightTurnTau: 50, muscleHalf: 17,
  // `flightTau` filters the flight-command readout below. There is deliberately no threshold here:
  // scripts/wing_mn.mjs measures that population at 2.35 Hz on the ground and 1.98 Hz in flight, so a
  // threshold on it would be a threshold on noise. See roadmap M1 for why the readout is computed and
  // reported anyway.
  flightTau: 200,
  courtPBase: 5, courtPScale: 4, courtDNBase: 12, courtDNScale: 8 };   // courtship readout: baseline-subtracted, normalised
// fwd: walking needs weighted DN drive above threshold (Hz); speed = 1 - exp(-excess / fwdScale).
//
// Muscles: activation = 1 - exp(-ln2 * (rate/f50)^n). With n = 1 and f50 = muscleHalf this is the single
// saturating exponential the model used for every muscle in the animal; MUSCLE_FF below gives each
// muscle class its own f50 and n, which is roadmap item M4.
//
// The classes and their numbers, with what each is taken from. These are estimates from the insect
// muscle literature rather than Drosophila measurements of these particular muscles -- there is no
// per-muscle force-frequency dataset for this animal -- and the point of M4 is to find out what the
// single constant was costing, which is a question the ladder answers whatever the numbers are. What
// the classes encode is the ordering, which is not in doubt: asynchronous flight power muscles are
// set by calcium level rather than by spike rate and saturate lowest; the tergotrochanteral jump
// muscle is a fast twitch fibre that reaches full force in one or two spikes; synchronous wing
// steering muscles fire about one spike a wingbeat and grade over a narrow range; slow postural leg
// muscles summate and need tens of Hz to fuse.
export const MUSCLE_FF = {
  legFast:  { f50: 25, n: 1 },  // fast leg units: the main extensor/flexor pools, graded over tens of Hz
  legSlow:  { f50: 60, n: 1 },  // accessory (slow) units: tonic, fuse late, hold posture (Hooper et al. 2007)
  ltm:      { f50: 12, n: 1 },  // long tendon muscle and claw adhesion: a grip, near-maximal once recruited
  feed:     { f50: 17, n: 1 },  // proboscis: the model's original constant, kept because nothing better is sourced
  other:    { f50: 17, n: 1 },  // anything unclassified: unchanged from the single-constant model
  // Defined and currently unreached, because the wing muscles are not driven by their motor neurons in
  // this model at all -- that is roadmap item M1, and these are the numbers it would need.
  flight:   { f50: 5, n: 1 },   // asynchronous DLM/DVM: stretch-activated, rate sets Ca level not force per cycle (Gordon & Dickinson 2006)
  steer:    { f50: 20, n: 1 },  // synchronous steering muscles, ~1 spike per 218 Hz wingbeat (Lindsay et al. 2017)
  jump:     { f50: 8, n: 2 },   // tergotrochanteral: fast twitch, near-maximal on one spike; the jump runs a program instead
};
/** which force-frequency class a bodymap muscle group belongs to, from its annotated name */
export function muscleClass(name) {
  if (/^ltm/.test(name)) return 'ltm';
  if (/^Acc\./.test(name)) return 'legSlow';
  if (/T[123]\b/.test(name)) return 'legFast';
  if (/^MN\d|rostrum|haustellum|labell|labrum/i.test(name)) return 'feed';
  return 'other';
}
const ffAct = (rate, c) => 1 - Math.exp(-Math.LN2 * Math.pow(Math.max(0, rate) / c.f50, c.n));
const LEGS = ['T1', 'T2', 'T3'], SIDES = ['left', 'right'];
// The jump program (JUMP), the righting reflex (RIGHT), the pivot constants and the leg phases moved to
// the scaffold plugins that own them: src/sim/scaffold/plugins/{escapeJump,rightingReflex,cpg}.js.

export class Motor {
  constructor(mj, model, data, bodymap, typeOf, sideOf, gait, mode = 'descending', opts = {}) {
    this.model = model; this.data = data; this.mode = mode; this.gait = gait;
    // Per-class force-frequency curves are on by default and switchable off, which is what makes them a
    // ladder rung (scripts/rungs.mjs, `muscle_single`) rather than a silent change.
    this.perClassMuscles = opts.perClassMuscles !== false;
    // Non-graph mechanisms live in scaffold plugins (src/sim/scaffold/): the stepping generator
    // (`cpg`), the steering leak (`steeringAdapt`), the grooming sweep (`groomPattern`), the escape
    // detector and jump program (`escapeJump`) and the righting reflex (`rightingReflex`). FlyAgent
    // overwrites this with the set it shares with the other subsystems (and rebinds READOUT); a
    // standalone Motor gets the all-on default.
    this.scaffolds = createScaffoldSet(opts.scaffolds);
    bindScaffoldParams(this.scaffolds, 'READOUT', READOUT);
    this.song = new Song(1);          // courtship song timing (src/sim/song.js)
    this.act = {}; for (let i = 0; i < model.nu; i++) this.act[model.actuator(i).name] = i;
    this.range = {}; const cr = model.actuator_ctrlrange; for (let i = 0; i < model.nu; i++) this.range[model.actuator(i).name] = [cr[2 * i], cr[2 * i + 1]];
    const byType = (t, s) => { const o = []; for (let i = 0; i < typeOf.length; i++) if (typeOf[i] === t && (s === undefined || sideOf[i] === s)) o.push(i); return o; };
    const pop = (roles, s) => Object.entries(roles).flatMap(([t, w]) => byType(t, s).map(i => [i, w]));
    this.dn = { forward: pop(DN_ROLES.forward), backward: pop(DN_ROLES.backward), escape: pop(DN_ROLES.escape).map(x => x[0]), takeoff: pop(DN_ROLES.takeoff), groom: pop(DN_ROLES.groom),
      turnL: pop(DN_ROLES.turn, 1), turnR: pop(DN_ROLES.turn, 2), courtP: pop(DN_ROLES.courtP), courtDN: pop(DN_ROLES.courtDN),
      flight: pop(DN_ROLES.flight), flightL: pop(DN_ROLES.flight, 1), flightR: pop(DN_ROLES.flight, 2) };
    this.muscles = bodymap.muscles; this.ttmn = bodymap.jump; this._ffClass = {};
    this.rate = new Float32Array(typeOf.length);    // low-pass filtered firing rate per neuron (Hz), only for used neurons
    this.used = new Set([...this.dn.flight.map(x => x[0]), ...this.dn.forward.map(x => x[0]), ...this.dn.backward.map(x => x[0]), ...this.dn.escape, ...this.dn.takeoff.map(x => x[0]), ...this.dn.groom.map(x => x[0]), ...this.dn.turnL.map(x => x[0]), ...this.dn.turnR.map(x => x[0]), ...this.dn.courtP.map(x => x[0]), ...this.dn.courtDN.map(x => x[0]), ...bodymap.jump, ...bodymap.feeding]);
    for (const m of this.muscles) for (const i of m.idx) this.used.add(i);
    this.used = Int32Array.from(this.used);
    this.lastCount = new Uint32Array(typeOf.length);
    this.phase = 0; this.cmd = { v: 0, turn: 0, drive: 0, back: 0, escape: 0 }; this.jumpT = -1;
    this.feedingIdx = bodymap.feeding;
  }
  /** update filtered rates from brain spike counts; dtMs since last call */
  readBrain(spikeCount, dtMs, tau = 40) {
    const k = dtMs / tau, inv = 1000 / dtMs;
    this.gfTimes = this.gfTimes || []; if (this.scaffolds.escapeJump) for (const i of this.dn.escape) if (spikeCount[i] !== this.lastCount[i]) this.gfTimes.push(this.tNow || 0);
    for (const i of this.used) { const n = spikeCount[i] - this.lastCount[i]; this.lastCount[i] = spikeCount[i]; this.rate[i] += k * (n * inv - this.rate[i]); }
  }
  mean(ix) { let s = 0; for (const i of ix) s += this.rate[i]; return ix.length ? s / ix.length : 0; }
  wmean(pairs) { let s = 0, w = 0; for (const [i, wt] of pairs) { s += this.rate[i] * wt; w += wt; } return w ? s / w : 0; }
  /** clamped write to one actuator control, for scaffold plugins (the `set` closure of apply()) */
  setCtrl(name, v) { const i = this.act[name]; if (i === undefined) return; const [lo, hi] = this.range[name]; this.data.ctrl[i] = Math.min(hi, Math.max(lo, v)); }
  /** compute and write actuator controls */
  apply(tMs, dtMs, extra = {}) {
    const d = this.data, ctrl = d.ctrl, A = this.act, R = this.range;
    const set = (name, v) => { const i = A[name]; if (i === undefined) return; const [lo, hi] = R[name]; ctrl[i] = Math.min(hi, Math.max(lo, v)); };
    // --- muscles driven directly by motor neurons (activation = rate / 100 Hz, saturating) ---
    const actv = {};
    const kHalf = Math.LN2 / READOUT.muscleHalf;
    // `perClassMuscles` off reproduces the single-constant model exactly, which is what makes the two a
    // ladder rung rather than a change (scripts/rungs.mjs, `muscle_single`).
    const perClass = this.perClassMuscles;
    for (const m of this.muscles) {
      const r = this.mean(m.idx);
      const a = perClass ? ffAct(r, MUSCLE_FF[this._ffClass[m.name] ||= muscleClass(m.name)]) : 1 - Math.exp(-r * kHalf);
      (actv[m.actuator] ||= []).push([m.dir, a]);
    }
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
    // pairs receive unequal tonic input), keeping transient asymmetries: saccades, plumes, objects.
    // The leak is the `steeringAdapt` scaffold plugin; off, turnBase stays 0 and the raw imbalance drives.
    this.scaffolds.steeringAdapt?.step(this, dtMs);
    // courtship circuit readout: pIP10 and DNp13 sit downstream of the pheromone pathways (2 hops from the
    // cVA and tarsal pheromone receptors); both roughly double their rate near another fly
    const court = Math.max(0, Math.min(1, 0.5 * Math.max(0, this.wmean(this.dn.courtP) - R0.courtPBase) / R0.courtPScale + 0.5 * Math.max(0, this.wmean(this.dn.courtDN) - R0.courtDNBase) / R0.courtDNScale));
    // flight command: the DN_ROLES.flight population's rate, low-pass filtered on the same timescale as
    // the other locomotor readouts, and its left-right difference (what a steering readout would see).
    const fl = this.wmean(this.dn.flight);
    this.flightF = (this.flightF || 0) + dtMs / R0.flightTau * (fl - (this.flightF || 0));
    this.cmd = { v, turn: Math.max(-0.6, Math.min(0.6, (this.turnF - (this.turnBase || 0)) / R0.turnScale)), drive: fwd, back, groom, grooming, escape: this.mean(this.dn.escape), takeoff: this.wmean(this.dn.takeoff), court,
      flightDrive: this.flightF, flightAsym: this.wmean(this.dn.flightL) - this.wmean(this.dn.flightR) };
    if (this.mode === 'connectome') {
      for (const leg of LEGS) for (const sd of SIDES) {
        for (const j of ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2']) set(`${j}_${leg}_${sd}`, muscleCtrl(`${j}_${leg}_${sd}`));
        set(`adhere_claw_${leg}_${sd}`, 0.6 + 0.4 * Math.min(1, (actv[`adhere_claw_${leg}_${sd}`] || []).reduce((a, [, x]) => a + x, 0)));
      }
    } else {
      // the stepping generator is the `cpg` scaffold plugin; with it off nothing writes the leg
      // actuators in this mode, which is the known limitation (the fly freezes rather than walks)
      this.scaffolds.cpg?.step(this, dtMs);
    }
    // --- courtship song: one wing (on the side facing the other fly) extended and vibrating ---
    // The envelope comes from src/sim/song.js, which carries the real pulse/sine structure: pulse
    // trains at a 35 ms inter-pulse interval when he is moving or further away, a 160 Hz sine hum
    // when he is slow and close (Coen et al. 2014 for the switch, Arthur et al. 2013 for the IPI).
    {
      const singing = !!extra.court?.sing && !this.jumping && !this.flying && !this.righting;
      const sg = this.song.update(tMs, dtMs, singing
        ? { sing: true, dist: extra.court.dist, speed: extra.court.speed } : null);
      if (sg.mode) {
        const sd = extra.court.side === 'right' ? 'right' : 'left';
        const reach = sg.mode === 'sine' ? 1.1 : 1.35;      // sine song is the smaller display
        set(`wing_yaw_${sd}`, reach); set(`wing_roll_${sd}`, 0.5);
        set(`wing_pitch_${sd}`, -0.5 - 0.4 * sg.amp);
        this.cmd.singing = true; this.cmd.songMode = sg.mode; this.cmd.songPulse = sg.pulse;
      } else { this.cmd.songMode = null; this.cmd.songPulse = false; }
    }
    // --- rejection kick: a hind leg extends sharply toward the male's side (Connolly & Cook 1973) ---
    if (extra.kick && !this.jumping && !this.flying && !this.righting) {
      const sd = extra.kick.side === 'right' ? 'right' : 'left';
      const ph = Math.min(1, extra.kick.t / 45);                       // out fast, back slower
      const ext = ph < 1 ? ph : Math.max(0, 2 - extra.kick.t / 45);
      set(`coxa_T3_${sd}`, -0.5 * ext); set(`femur_T3_${sd}`, 0.8 * ext);
      set(`tibia_T3_${sd}`, 1.2 * ext); set(`adhere_claw_T3_${sd}`, 0);
      this.cmd.kicking = true;
    } else this.cmd.kicking = false;
    // --- head grooming (DNg07/08/12): front legs lift and sweep over the head/eyes in antiphase ---
    // the sweep kinematics are the `groomPattern` scaffold plugin; off, grooming DNs fire but no leg moves
    this.scaffolds.groomPattern?.step(this, dtMs);
    // --- giant fibre escape + takeoff detection and the jump program: the `escapeJump` plugin ---
    // off: GF bursts, loom takeoff DNs and voluntary takeoffs fire but nothing jumps
    this.scaffolds.escapeJump?.step(this, tMs, dtMs, extra);
    // --- righting reflex: the `rightingReflex` plugin ---
    this.scaffolds.rightingReflex?.step(this, tMs, dtMs, extra);
    return this.cmd;
  }
  feeding() { return 1 - Math.exp(-this.mean(this.feedingIdx) * Math.LN2 / READOUT.muscleHalf); }
  proboscisOut() { const r = this.data.ctrl[this.act.rostrum]; return r < -0.4; }
}
