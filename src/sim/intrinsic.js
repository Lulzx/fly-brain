// Endogenous activity: the part of behaviour that comes from inside the fly rather than from its senses.
// The connectome model has no neuromodulation and no intrinsic dynamics, so left alone it only reacts: it
// either never starts walking or, once walking, never stops. Real flies in a featureless arena alternate
// walking bouts, pauses and grooming with heavy-tailed durations, and turn in brief saccades whose timing
// is neither random nor stimulus-locked (Maye et al. 2007, PLoS ONE 2:e443; Brembs 2011, Proc R Soc B
// 278:930 on spontaneous variability as the biological basis of "free will"; Geurten et al. 2014 on
// saccadic walking). This module stands in for those unmodelled central inputs (octopaminergic arousal,
// action selection): it delivers slowly varying excitatory synaptic input to identified descending neurons.
// It is a conductance, not a current, because the embodied brain holds these DNs in a high-conductance
// state (inhibition ~3x the leak) where an injected current is shunted.
// The connectome still integrates this drive with sensory input, so inhibition (sugar stop, bitter,
// contact) can still veto it, and every command leaves the brain through the usual DN readout.
//
// Every mechanism below is a scaffold plugin (src/sim/scaffold/): this file owns the shared state and the
// parameter table; the decisions — bout scheduling, feeding, avoidance, courtship, rejection, flight
// saccades and the arousal signal itself — are plugin calls, so each can be switched off for a ladder
// rung and counted in the ledger. The plugins run in exactly the order the monolith did and draw from
// this.rand() at the same points, so a default-on set is behaviourally identical.
import { DN_ROLES } from './motor.js';
import { createScaffoldSet, bindScaffoldParams } from './scaffold/index.js';
const TYPES = { fwd: ['DNg100', 'DNg97'], turn: ['DNa02', 'DNa01'], groom: ['DNg07', 'DNg08', 'DNg12'], back: ['MDN'], brake: Object.keys(DN_ROLES.forward), takeoff: Object.keys(DN_ROLES.takeoff) };
export const INTRINSIC = {
  walkBout: [2.2, 0.9],     // lognormal bout durations: median s, log-sd
  stopBout: [1.4, 0.9],
  groomBout: [2.5, 0.4], pGroom: 0.2,   // chance a pause is spent grooming
  // excitatory conductance added per ms (steady-state gE ~5.5x this; units of the LIF kernel)
  fwdDrive: 12, fwdJitter: 0.25, fwdTau: 800,   // forward DNs while walking; slow OU speed variation (fraction)
  saccadeRate: 0.7, standSaccadeRate: 0.3, saccadeMs: [120, 260], turnDrive: 10,   // spontaneous body saccades
  groomDrive: 10,
  stopBrake: 6, feedBrake: 16, feedDrive: 10,   // inhibitory conductance on all forward DNs: flies stop actively, firmly on food
  avoidMs: 350, backDrive: 14,   // head-on contact: back off this long, then turn away
  grazeTurnMs: [120, 260], grazeRefractory: 400,   // one-sided contact: turn away without stopping
  heatRefractory: 700,
  feedBout: [6, 0.5], satiety: 0.9, searchMs: 12000, searchTurns: 3,   // feeding stop, then local search
  pTakeoff: 0.1, pTakeoffWall: 0.1, takeoffDrive: 20,   // chance a bout ends in a voluntary takeoff (more when hungry), via DNp02/DNp04
  flightSaccadeRate: 1.0, flightSaccadeMs: [80, 160], avoidAhead: 0.4, avoidDrive: 18,   // flight: avoid when the path 9 mm ahead (FlyAgent.state) comes within 4 mm of a surface
  // courtship: the connectome's pIP10 + DNp13 rate (ctx.court.level, see motor.js) tells the male a fly is
  // near; he chases it by steering on its bearing and sings with the wing on its side (Ewing & Bennet-Clark 1968)
  courtEnter: 0.4, courtExit: 0.2, courtRange: 1.8, courtLostMs: 1500, courtSing: 0.45, courtDrive: 9, courtTurn: 12,
  // rejection, for a female target. An unreceptive female decamps — turns away and runs — and kicks
  // with a hind leg when he is at close range behind or beside her (Connolly & Cook 1973; Bussell et
  // al. 2014 for the receptivity decision this stands in for). Receptivity is a parameter here rather
  // than a state of a circuit, because the female's own nervous system is not in this dataset.
  rejectRange: 0.55, rejectMs: [400, 900], rejectDrive: 16, rejectTurn: 14, rejectRefractory: 600,
  kickRange: 0.3, kickMs: 90, kickRefractory: 500, receptivity: 0,
};
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Intrinsic {
  constructor(typeOf, sideOf, seed = 1, feeding = [], scaffoldCfg) {
    const pick = (types, s) => { const o = []; for (let i = 0; i < typeOf.length; i++) if (types.includes(typeOf[i]) && (s === undefined || sideOf[i] === s)) o.push(i); return o; };
    this.ix = { feed: [...new Set([...pick(['MN9']), ...feeding])], takeoff: pick(TYPES.takeoff), brake: pick(TYPES.brake), fwd: pick(TYPES.fwd), turnL: pick(TYPES.turn, 1), turnR: pick(TYPES.turn, 2), groom: pick(TYPES.groom), back: pick(TYPES.back) };
    this.rand = mulberry(seed * 7919 + 17);
    this.state = 'stop'; this.left = 300 + 700 * this.rand();   // settle briefly before the first decision
    this.fwdNoise = 0; this.sacc = null; this.sinceSacc = 0; this.avoid = null; this.t = 0; this.touchL = this.touchR = this.lastGraze = this.lastHeat = this.leftFood = this.lastAvoid = this.lastSugar = -1e9; this.avoidDir = 1; this.searchUntil = 0; this.hot = 0; this.approach = false; this.lastDir = this.rand() < 0.5 ? 1 : -1;
    this.bias = { fwd: 0, turnL: 0, turnR: 0, groom: 0, back: 0, takeoff: 0, feed: 0 }; this.takeoffUntil = -1;
    // FlyAgent overwrites this with the scaffold set shared by the whole animal; a standalone Intrinsic
    // gets the all-on default. INTRINSIC is bound into the plugins that take their parameters from it.
    this.scaffolds = createScaffoldSet(scaffoldCfg);
    bindScaffoldParams(this.scaffolds, 'INTRINSIC', INTRINSIC);
  }
  gauss() { let u = 0; while (!u) u = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand()); }
  lognormal([median, sd]) { return 1000 * median * Math.exp(sd * this.gauss()); }
  /** one ms. ctx: { energy 0..1, touch/heat: {left, right} per antenna, rearing: body pitched up against something } */
  update(dtMs, brain, ctx) {
    // hunger gates feeding. Starved flies also walk more (Yang et al. 2015): the behavioural arousal
    // is the oaArousalRule plugin's signal (ctx.arousal from the OA neurons, else the energy deficit);
    // with it off the neutral 0.5 below means starvation changes nothing about locomotion
    const P = INTRINSIC, hunger = Math.max(0, Math.min(1, (0.7 - ctx.energy) / 0.6));
    const arousal = this.scaffolds.oaArousalRule ? this.scaffolds.oaArousalRule.level(ctx, hunger) : 0.5;
    // obstacle at the front. Head-on (both antennae within 150 ms, or the body rearing up against it): stop,
    // back off, pivot away, walk on. One antenna grazing: turn away while walking, which is how flies come to
    // follow walls.
    const t = this.t += dtMs;
    if (ctx.flying) return this.flightUpdate(t, dtMs, brain, ctx);
    if (this.state === 'fly') { this.state = 'stop'; this.left = 500 + 1000 * this.rand(); this.sacc = null; }   // landed
    if (ctx.touch.left) this.touchL = t; if (ctx.touch.right) this.touchR = t;
    // courtship gating: the pheromone-driven courtship readout (pIP10, DNp13) must be high, another fly must
    // be in range, and no avoidance in progress. While courting, contact with the other fly is not an obstacle.
    const court = ctx.court;
    this.scaffolds.courtship?.gate(this, court, dtMs);
    // rejection: a female with a male inside her rejection range turns away and runs, and kicks if he
    // is closer still (femaleRejection plugin)
    this.scaffolds.femaleRejection?.update(this, ctx.suitor, t, dtMs);
    // contact and heat avoidance (avoidance plugin)
    this.scaffolds.avoidance?.trigger(this, ctx, t);
    // food: a hungry fly that tastes sugar with its legs or labellum stops there to feed; once it leaves (sated,
    // or the bout ends), it searches locally with frequent turns, looping back to the spot (Dethier 1957,
    // Kim & Dickinson 2017) — the feedingStop plugin
    this.scaffolds.feedingStop?.update(this, ctx, t, dtMs, hunger);
    const searching = t < this.searchUntil && this.state !== 'feed';
    if (this.avoid) this.scaffolds.avoidance?.progress(this, t, dtMs);
    else if (this.rejecting) {
      // decamping is a bout of its own: no spontaneous saccades and no scheduler transition while it runs
      this.sinceSacc = 0;
    } else if (this.state === 'court' && court) {
      // chasing: no spontaneous saccades or bout transitions; steering is set from the target's bearing below
      this.scaffolds.courtship?.chase(this, court);
    } else {
      this.scaffolds.boutScheduler?.step(this, dtMs, arousal, searching);
    }
    if (this.sacc && (this.sacc.t += dtMs) > this.sacc.dur) this.sacc = null;
    this.fwdNoise += dtMs / P.fwdTau * (-this.fwdNoise) + Math.sqrt(2 * dtMs / P.fwdTau) * this.gauss();
    const walking = this.state === 'walk' && !this.avoid;
    const B = this.bias;
    B.fwd = walking ? P.fwdDrive * (this.approach ? 0.7 : Math.max(0.3, 1 + P.fwdJitter * this.fwdNoise + 0.25 * arousal + 0.6 * this.hot)) : 0;
    B.back = this.scaffolds.avoidance ? this.scaffolds.avoidance.backDrive(this) : 0;
    B.groom = this.state === 'groom' && !this.avoid ? P.groomDrive : 0;
    B.turnL = this.sacc && this.sacc.dir > 0 ? P.turnDrive : 0; B.turnR = this.sacc && this.sacc.dir < 0 ? P.turnDrive : 0;
    if (this.state === 'court' && court) this.scaffolds.courtship?.bias(this, court, B);
    if (this.rejecting) this.scaffolds.femaleRejection?.bias(this, B);
    B.takeoff = t < this.takeoffUntil ? P.takeoffDrive : 0;
    // hunger gates the proboscis extension reflex: a hungry fly tasting sugar extends and pumps (MN9, pump MNs)
    B.feed = this.state === 'feed' && this.scaffolds.feedingStop ? this.scaffolds.feedingStop.feedDrive(hunger) : 0;
    for (const k in B) if (B[k] > 0) brain.pulse(this.ix[k], B[k] * dtMs);
    const brake = this.state === 'feed' ? (this.scaffolds.feedingStop ? this.scaffolds.feedingStop.brake() : 0)
      : this.state === 'stop' || this.state === 'groom' ? (this.scaffolds.boutScheduler ? this.scaffolds.boutScheduler.brake() : 0) : 0;
    if (brake) for (const i of this.ix.brake) brain.addG(i, 0, -brake * dtMs);
  }
  /** in flight: spontaneous saccades, and collision-avoidance saccades toward open space when a wall or block
   *  lies ahead (flies turn away from the side of visual expansion; Tammero & Dickinson 2002). ctx.ahead gives
   *  clearance (cm) at the lookahead point straight ahead and 40 degrees to each side. */
  flightUpdate(t, dtMs, brain, ctx) {
    const P = INTRINSIC;
    if (this.state !== 'fly') { this.state = 'fly'; this.sacc = null; this.avoid = null; this.lastDir = this.rand() < 0.5 ? 1 : -1; }
    this.scaffolds.flightSaccade?.update(this, ctx, t, dtMs);
    if (this.sacc && (this.sacc.t += dtMs) > this.sacc.dur) this.sacc = null;
    const drive = this.sacc ? (this.sacc.strong ? P.avoidDrive : P.turnDrive) : 0;
    if (drive) brain.pulse(this.sacc.dir > 0 ? this.ix.turnL : this.ix.turnR, drive * dtMs);
  }
  label() { return this.avoid ? 'avoiding' : this.state === 'walk' && this.t < this.searchUntil ? 'search' : this.state; }
}
