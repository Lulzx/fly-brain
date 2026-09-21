// Scaffold plugin: contact and heat avoidance.
//
// Head-on contact (both antennae within 150 ms, or the body rearing against a surface) triggers
// stop-back-off-pivot; a one-sided graze turns away while walking; noxious heat at the aristae
// turns away from the warmer side and runs. These are rules standing in for the mechanosensory
// and thermosensory escape circuits the connectome does not close: the afferents fire, but nothing
// in the graph converts them into a directed avoidance bout.
//
// Registered on the Intrinsic host. Off: contact and heat produce sensory spikes but no avoidance
// response, so the fly walks into walls and stays on hot patches.
export function create() {
  return {
    id: 'avoidance',
    title: 'Contact/heat avoidance (back-off, graze turn, heat escape)',
    claim: 'Without it, head-on contact, wall grazes and noxious heat drive no avoidance behaviour.',
    files: ['src/sim/intrinsic.js'],
    defaultOn: true,
    paramSource: 'INTRINSIC',
    paramKeys: ['avoidMs', 'backDrive', 'grazeTurnMs', 'grazeRefractory', 'pTakeoffWall', 'heatRefractory'],
    setup() {},
    step() {},
    /** contact and heat triggers -> this.avoid / this.sacc; preserves the original rand() draw order */
    trigger(host, ctx, t) {
      const P = this.P;
      const headOn = ctx.rearing || (t - host.touchL < 150 && t - host.touchR < 150);
      const graze = ctx.touch.left !== ctx.touch.right;
      const courting = host.state === 'court';
      if (!courting && !host.avoid && headOn) {
        host.avoid = { t: 0, dir: host.touchL > host.touchR ? -1 : host.touchR > host.touchL ? 1 : (host.rand() < 0.5 ? 1 : -1), turn: 500 + 400 * host.rand(), why: ctx.rearing ? 'rear' : 'both' };
        host.sacc = null;
        host.avoid.fly = host.rand() < P.pTakeoffWall;   // or leave the wall by air, once turned away from it
      } else if (!courting && !host.avoid && graze && t - host.lastGraze > P.grazeRefractory) {
        const dir = ctx.touch.left ? -1 : 1;   // +1 = turn left
        host.sacc = { t: 0, dur: P.grazeTurnMs[0] + (P.grazeTurnMs[1] - P.grazeTurnMs[0]) * host.rand(), dir }; host.lastDir = dir; host.sinceSacc = 0; host.lastGraze = t;
      }
      // noxious heat at the aristae: turn away from the warmer side and run (flies turn back at a hot
      // edge). Deep inside a hot patch both sides read the same saturated heat, so turning has no
      // direction to go: run straight out instead of turning on the spot
      const hot = Math.max(ctx.heat.left, ctx.heat.right); host.hot = hot;
      if (hot > 0.08 && !host.avoid && t - host.lastHeat > P.heatRefractory) {
        const even = Math.abs(ctx.heat.left - ctx.heat.right) < 0.02, dir = even ? host.lastDir : ctx.heat.left > ctx.heat.right ? -1 : 1;
        if (!(even && hot > 0.9)) { host.sacc = { t: 0, dur: 300 + 300 * host.rand(), dir }; host.lastDir = dir; host.sinceSacc = 0; }
        host.lastHeat = t; host.state = 'walk'; host.left = Math.max(host.left, 1500);
      }
    },
    /** an avoidance bout in progress: back off, then pivot away, then walk on (or take off) */
    progress(host, t, dtMs) {
      const P = this.P, a = host.avoid; a.t += dtMs;
      if (a.t > P.avoidMs && !host.sacc) host.sacc = { t: 0, dur: a.turn, dir: a.dir };   // pivot away
      if (a.t > P.avoidMs + a.turn) { if (a.fly) host.takeoffUntil = t + 80; host.avoid = null; host.lastDir = a.dir; host.sinceSacc = 0; host.state = 'walk'; host.left = Math.max(host.left, 1000); }
    },
    /** backward-walk drive while backing off */
    backDrive(host) { return host.avoid && host.avoid.t < this.P.avoidMs ? this.P.backDrive : 0; },
    readout(host) { return { avoiding: !!host.avoid, hot: host.hot }; },
  };
}
