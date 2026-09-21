// Scaffold plugin: female rejection of a courting male.
//
// An unreceptive female with a male inside her rejection range turns away and runs (decamps), and
// kicks with a hind leg when he is at close range behind or beside her (Connolly & Cook 1973;
// Bussell et al. 2014 for the receptivity decision this stands in for). Receptivity is a parameter,
// not a circuit state: the release is a male CNS, so the female's own pC1/pCd rejection circuitry
// is not in the graph (docs/26-courtship.md).
//
// Registered on the Intrinsic host. Off: a courted female ignores the male entirely — no decamp,
// no kick — while her own locomotion is unaffected.
export function create() {
  return {
    id: 'femaleRejection',
    title: 'Female rejection: decamp run and hind-leg kick',
    claim: 'Without it, a courted female behaves exactly as if no male were present.',
    files: ['src/sim/intrinsic.js', 'src/sim/motor.js'],
    defaultOn: true,
    paramSource: 'INTRINSIC',
    paramKeys: ['rejectRange', 'rejectMs', 'rejectDrive', 'rejectTurn', 'rejectRefractory', 'kickRange', 'kickMs', 'kickRefractory', 'receptivity'],
    setup() {},
    step() {},
    /** enter/expire rejection bouts and the kick timer; preserves the original rand() draw order */
    update(host, su, t, dtMs) {
      const P = this.P;
      if (su && !host.avoid && host.state !== 'feed' && host.rand() >= P.receptivity) {
        if (!host.rejecting && su.dist < P.rejectRange && t - (host.lastReject || -1e9) > P.rejectRefractory) {
          host.rejecting = { t: 0, dur: P.rejectMs[0] + (P.rejectMs[1] - P.rejectMs[0]) * host.rand(),
                             dir: su.bearing > 0 ? -1 : 1 };
          host.sacc = null; host.state = 'reject'; host.rejections = (host.rejections || 0) + 1;
        }
        if (su.dist < P.kickRange && t - (host.lastKick || -1e9) > P.kickRefractory) {
          host.kick = { t: 0, side: su.bearing > 0 ? 'left' : 'right' }; host.lastKick = t; host.kicks = (host.kicks || 0) + 1;
        }
      }
      if (host.rejecting && (host.rejecting.t += dtMs) > host.rejecting.dur) {
        host.rejecting = null; host.lastReject = t;
        if (host.state === 'reject') { host.state = 'walk'; host.left = 500 + 700 * host.rand(); }
      }
      if (host.kick && (host.kick.t += dtMs) > P.kickMs) host.kick = null;
    },
    /** decamping: turn away from his side and run; the turn is on for the first third of the bout so
     *  the run that follows points away from him rather than across him */
    bias(host, B) {
      const P = this.P, r = host.rejecting, turning = r.t < r.dur / 3;
      B.turnL = turning && r.dir > 0 ? P.rejectTurn : 0; B.turnR = turning && r.dir < 0 ? P.rejectTurn : 0;
      B.fwd = P.rejectDrive; B.groom = 0;
    },
    readout(host) { return { rejecting: !!host.rejecting, kicks: host.kicks || 0 }; },
  };
}
