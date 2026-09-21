// Scaffold plugin: the locomotor bout scheduler.
//
// Real flies in a featureless arena alternate walking bouts, pauses and grooming with heavy-tailed
// durations, and turn in spontaneous saccades whose timing is neither random nor stimulus-locked
// (Maye et al. 2007; Geurten et al. 2014). The connectome has no action selection, so this plugin
// runs it: a state machine over stop/walk/groom/feed with lognormal bout durations, voluntary
// takeoffs, and a Poisson saccade draw. It also owns the active brake that stops the fly between
// bouts (inhibitory conductance on the forward DNs).
//
// Registered on the Intrinsic host. Off: `left` never counts down and no saccades are drawn, so the
// animal stays in its initial 'stop' state forever — the stimulus-driven channels (avoidance,
// feeding, courtship) can still move it.
export function create() {
  return {
    id: 'boutScheduler',
    title: 'Locomotor bout scheduler (walk/stop/groom + saccades + takeoff draw)',
    claim: 'Without it, the fly never starts a spontaneous walking or grooming bout and never saccades.',
    files: ['src/sim/intrinsic.js'],
    defaultOn: true,
    paramSource: 'INTRINSIC',
    paramKeys: ['walkBout', 'stopBout', 'groomBout', 'pGroom', 'saccadeRate', 'standSaccadeRate', 'saccadeMs', 'searchTurns', 'pTakeoff', 'stopBrake'],
    setup() {},
    /** action selection + spontaneous saccades; preserves the original rand()/gauss() draw order */
    step(host, dtMs, arousal, searching) {
      const P = this.P;
      host.left -= dtMs;
      if (host.left <= 0) {   // action selection at the end of a bout
        if (host.approach && host.state !== 'feed') { host.state = 'walk'; host.left = 600; }
        else if (host.state !== 'feed' && host.state !== 'groom' && host.rand() < P.pTakeoff * (1 + 2 * arousal)) host.takeoffUntil = host.t + 80;   // leave by air
        if (host.state === 'feed') { host.state = 'walk'; host.left = host.lognormal(P.walkBout); }
        else if (host.state === 'walk') { host.state = host.rand() < P.pGroom * (1 - arousal) ? 'groom' : 'stop'; host.left = host.lognormal(host.state === 'groom' ? P.groomBout : P.stopBout) * (1 - 0.6 * arousal); }
        else { host.state = 'walk'; host.left = host.lognormal(P.walkBout) * (1 + 1.5 * arousal); }
      }
      // spontaneous saccades; alternate direction more often than not (flies avoid circling)
      host.sinceSacc += dtMs;
      const rate = (host.state === 'walk' ? P.saccadeRate * (searching ? P.searchTurns : 1) : host.state === 'stop' ? P.standSaccadeRate : 0) / 1000;
      if (!host.sacc && host.sinceSacc > 250 && host.rand() < rate * dtMs) {
        const dir = host.rand() < (searching ? 0.25 : 0.65) ? -host.lastDir : host.lastDir; host.lastDir = dir;   // searching: keep turning one way, looping
        host.sacc = { t: 0, dur: P.saccadeMs[0] + (P.saccadeMs[1] - P.saccadeMs[0]) * host.rand(), dir }; host.sinceSacc = 0;
      }
    },
    /** the active brake on forward DNs while stopped or grooming */
    brake() { return this.P.stopBrake; },
    readout(host) { return { state: host.state, left: host.left }; },
  };
}
