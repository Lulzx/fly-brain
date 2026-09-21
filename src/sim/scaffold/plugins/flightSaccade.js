// Scaffold plugin: flight saccades and collision avoidance.
//
// In flight the fly fires spontaneous body saccades, and commits to a strong turn toward open space
// when a wall or block lies ahead (flies turn away from the side of visual expansion; Tammero &
// Dickinson 2002). ctx.ahead gives clearance at the lookahead point straight ahead and 40 degrees
// to each side — computed in FlyAgent.state. The saccade decision is a rule standing in for the
// visual steering circuitry.
//
// Registered on the Intrinsic host (flightUpdate branch). Off: no saccades are drawn in flight, so
// the fly steers only by the brain's own turn command and flies into walls it can see.
export function create() {
  return {
    id: 'flightSaccade',
    title: 'Flight saccades and ahead-clearance avoidance',
    claim: 'Without it, a flying fly makes no spontaneous turns and no collision-avoidance saccades.',
    files: ['src/sim/intrinsic.js'],
    defaultOn: true,
    paramSource: 'INTRINSIC',
    paramKeys: ['flightSaccadeRate', 'flightSaccadeMs', 'avoidAhead'],
    setup() {},
    step() {},
    /** avoidance + spontaneous saccade draws; preserves the original rand() draw order */
    update(host, ctx, t, dtMs) {
      const P = this.P, a = ctx.ahead;
      host.sinceSacc += dtMs;
      if (a && a.center < P.avoidAhead && (!host.sacc || !host.sacc.strong)) {
        // commit to one direction until the way ahead is clear, or the fly dithers in front of the wall
        const dir = t - host.lastAvoid < 400 ? host.avoidDir : Math.abs(a.left - a.right) < 0.05 ? host.lastDir : a.left > a.right ? 1 : -1;
        host.sacc = { t: 0, dur: 150 + 100 * host.rand(), dir, strong: true }; host.lastDir = host.avoidDir = dir; host.sinceSacc = 0;
      }
      if (host.sacc?.strong && a && a.center < P.avoidAhead) host.lastAvoid = t;
      if (!host.sacc && host.sinceSacc > 200 && host.rand() < P.flightSaccadeRate / 1000 * dtMs) {
        const dir = host.rand() < 0.6 ? -host.lastDir : host.lastDir; host.lastDir = dir;
        host.sacc = { t: 0, dur: P.flightSaccadeMs[0] + (P.flightSaccadeMs[1] - P.flightSaccadeMs[0]) * host.rand(), dir }; host.sinceSacc = 0;
      }
    },
    readout(host) { return { saccading: !!host.sacc }; },
  };
}
