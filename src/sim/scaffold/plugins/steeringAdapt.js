// Scaffold plugin: slow steering adaptation (the 4 s leak).
//
// The model's steering DNs are not balanced: the right DNa02 and P9 get more tonic excitation than
// the left (docs/19-limitations.md), so a standing fly would yaw forever. This plugin keeps a slow
// exponential of the filtered turn command and subtracts it, which cancels the standing asymmetry
// while keeping transient asymmetries (saccades, plumes, objects). It is a rule standing in for
// whatever circuit actually balances the steering channel.
//
// Registered on the Motor host. Off: `turnBase` stays at zero and the raw left/right imbalance
// reaches the gait.
export function create() {
  return {
    id: 'steeringAdapt',
    title: 'Steering-command adaptation leak',
    claim: 'Without it, the steering DNs\' standing left/right imbalance becomes a permanent turn.',
    files: ['src/sim/motor.js'],
    defaultOn: true,
    paramSource: 'READOUT',
    paramKeys: ['turnAdaptTau'],
    setup() {},
    step(motor, dtMs) {
      const tau = this.P ? this.P.turnAdaptTau : 4000;
      motor.turnBase = (motor.turnBase || 0) + dtMs / tau * (motor.turnF - (motor.turnBase || 0));
    },
    readout(motor) { return { turnBase: motor.turnBase || 0 }; },
  };
}
