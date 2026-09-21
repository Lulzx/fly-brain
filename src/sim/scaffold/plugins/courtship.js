// Scaffold plugin: male courtship pursuit.
//
// The connectome's courtship readout (pIP10 + DNp13 rates, computed in motor.js) reports a female
// nearby; the decisions to start courting, to keep station at singing distance, to steer onto her
// bearing, and to give up when she is lost are rules standing in for the pC1/vpoDN decision
// circuitry (docs/26-courtship.md; Ewing & Bennet-Clark 1968 for the chase-and-sing structure).
//
// Registered on the Intrinsic host. Off: `courting` is never set, the 'court' state never entered,
// so no chasing, no station-keeping and no song trigger.
export function create() {
  return {
    id: 'courtship',
    title: 'Male courtship pursuit and song trigger',
    claim: 'Without it, the pheromone/LC10 pathway still drives courtship DNs but the male never chases or sings.',
    files: ['src/sim/intrinsic.js', 'src/sim/motor.js', 'src/sim/song.js'],
    defaultOn: true,
    paramSource: 'INTRINSIC',
    paramKeys: ['courtEnter', 'courtExit', 'courtRange', 'courtLostMs', 'courtSing', 'courtDrive', 'courtTurn'],
    setup() {},
    step() {},
    /** enter/exit bookkeeping for the court state; preserves the original rand() draw order */
    gate(host, court, dtMs) {
      const P = this.P;
      if (!host.courting && court && court.level > P.courtEnter && court.dist < P.courtRange && !host.avoid && host.state !== 'feed') { host.courting = { lost: 0 }; host.sacc = null; host.state = 'court'; }
      if (host.courting) {
        if (!court || court.level < P.courtExit || court.dist > P.courtRange * 1.5 || host.avoid) {
          if ((host.courting.lost += dtMs) > P.courtLostMs) { host.courting = null; host.courtSing = false; if (host.state === 'court') { host.state = 'stop'; host.left = 400 + 600 * host.rand(); } }
        } else host.courting.lost = 0;
      }
    },
    /** station-keeping while courting: sing when close and roughly facing her */
    chase(host, court) {
      const P = this.P, b = court.bearing;
      host.courtSing = court.dist < P.courtSing && Math.abs(b) < 0.9;
      host.courtSide = b > 0 ? 'left' : 'right';
      host.sinceSacc = 0;
    },
    /** chase steering: turn onto her bearing, close to singing distance, then keep station.
     *  Males keep walking while singing (Ewing & Bennet-Clark 1968). */
    bias(host, court, B) {
      const P = this.P, b = court.bearing;
      B.turnL = b > 0.04 ? P.courtTurn * Math.min(1, b) : 0; B.turnR = b < -0.04 ? P.courtTurn * Math.min(1, -b) : 0;
      B.fwd = court.dist > 0.6 ? P.courtDrive : court.dist > 0.4 ? P.courtDrive * 0.4 : P.courtDrive * 0.15;
    },
    readout(host) { return { courting: !!host.courting, singing: !!host.courtSing }; },
  };
}
