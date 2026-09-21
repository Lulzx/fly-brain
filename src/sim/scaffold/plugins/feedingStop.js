// Scaffold plugin: the feeding stop and local search.
//
// A hungry fly that tastes sugar with its legs or labellum stops there to feed; once it leaves
// (sated, or the bout ends) it searches locally with frequent turns, looping back to the spot
// (Dethier 1957, Kim & Dickinson 2017). The sugar receptors and the proboscis motor neurons are in
// the graph; the decision to stop on food and the search pattern are not, so they live here.
//
// Registered on the Intrinsic host. Off: `approach` stays false, the feed state is never entered,
// food gives no stop and no post-feed search; sugar still drives taste neurons.
export function create() {
  return {
    id: 'feedingStop',
    title: 'Feeding stop on food + local search afterwards',
    claim: 'Without it, a hungry fly tasting sugar walks straight over the patch and never loops back.',
    files: ['src/sim/intrinsic.js'],
    defaultOn: true,
    paramSource: 'INTRINSIC',
    paramKeys: ['feedBout', 'satiety', 'searchMs', 'feedDrive', 'feedBrake'],
    setup() {},
    step() {},
    /** food bookkeeping: approach flag, feed bout entry/exit, post-feed local search window */
    update(host, ctx, t, dtMs, hunger) {
      const P = this.P;
      host.approach = ctx.sugar > 0.1 && ctx.energy < P.satiety && !ctx.mouthOnFood && host.state !== 'feed';   // sugar underfoot: step onto it
      if (ctx.sugar > 0.1 && ctx.mouthOnFood && ctx.energy < P.satiety && !host.avoid && host.state !== 'feed' && t - host.leftFood > 3000) {
        host.state = 'feed'; host.left = host.lognormal(P.feedBout) * (0.5 + 2 * hunger); host.sacc = null;
      }
      if (ctx.sugar > 0.1) host.lastSugar = t;
      if (host.state === 'feed' && (t - host.lastSugar > 400 || !ctx.mouthOnFood || ctx.energy >= P.satiety)) host.left = 0;   // off the food (feet lift and land, so allow gaps), or sated
      if (host.state === 'feed' && host.left - dtMs <= 0) { host.leftFood = t; host.searchUntil = t + P.searchMs; }
    },
    /** hunger-gated proboscis drive during a feed bout (MN9, pump MNs) */
    feedDrive(hunger) { return this.P.feedDrive * (0.4 + hunger); },
    /** the stronger brake that pins the fly on food */
    brake() { return this.P.feedBrake; },
    readout(host) { return { feeding: host.state === 'feed', approach: host.approach }; },
  };
}
