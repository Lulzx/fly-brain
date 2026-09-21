// Scaffold plugin: the stepping pattern generator (central pattern generator stand-in).
//
// The connectome's descending neurons decide *whether* and *how fast* to walk; this plugin turns
// that command into coordinated leg motion. Each leg joint follows a two-harmonic trajectory
// `off + a1 cos(φ + p1) + a2 cos(2φ + p2)`, the six legs are hard-coupled into a tripod, and the
// parameters were optimised by CMA-ES against FlySuite kinematics (docs/13-gait.md). It is the
// single largest piece of supplied machinery in the animal: with it off, 'descending' mode writes
// nothing to the leg actuators and the fly freezes, which is the known limitation the premotor
// fitter (doc 36) exists to remove.
//
// Registered on the Motor host: step(ctx) is called from Motor.apply at the point the monolith
// used to run this block, after the descending command is computed.
export const PHASE = { T1_left: 0, T2_right: 0, T3_left: 0, T1_right: Math.PI, T2_left: Math.PI, T3_right: Math.PI };
const PIVOT = { turn: 0.25, amp: 0.55, inner: -0.7 };   // turning on the spot
const LEGS = ['T1', 'T2', 'T3'], SIDES = ['left', 'right'];

export function create() {
  return {
    id: 'cpg',
    title: 'Tripod stepping generator (FlySuite-fitted)',
    claim: 'Without it, a walking command produces no coordinated stepping: the animal falls or freezes.',
    files: ['src/sim/motor.js'],
    defaultOn: true,
    params: { pivotTurn: PIVOT.turn, pivotAmp: PIVOT.amp, pivotInner: PIVOT.inner },
    setup() {},
    step(motor, dtMs) {
      const g = motor.gait, set = (n, v) => motor.setCtrl(n, v);
      const v = motor.cmd.v;
      // a standing fly with a strong steering command turns on the spot: the inner legs step backwards
      const pivot = Math.abs(v) < 0.1 && Math.abs(motor.cmd.turn) > PIVOT.turn;
      const amp = pivot ? PIVOT.amp : Math.min(1, Math.abs(v) * 1.5), freq = g.freq * (0.5 + 0.5 * Math.min(1, pivot ? PIVOT.amp : Math.abs(v)));
      motor.stepAmp = amp > 0.05 ? Math.min(1, amp * 2) : 0; motor.pivot = pivot;
      if (amp > 0.05) motor.phase += (pivot ? 1 : Math.sign(v)) * 2 * Math.PI * freq * dtMs / 1000;
      for (const leg of LEGS) for (const sd of SIDES) {
        const key = `${leg}_${sd}`, phi = motor.phase + PHASE[key];
        const inner = (motor.cmd.turn > 0) === (sd === 'left');
        const steer = pivot ? (inner ? PIVOT.inner : 1) : 1 + motor.cmd.turn * (sd === 'left' ? -1 : 1);   // turn>0 (left DNs) -> shorter left strides -> turn left
        for (const j of g.joints) {
          const [off, a1, p1, a2, p2] = g.params[leg][j];
          let q = a1 * Math.cos(phi + p1) + a2 * Math.cos(2 * phi + p2);
          if (j === 'coxa') q *= steer;
          set(`${j}_${key}`, amp * (off + q));
        }
        const stance = ((phi + g.adhPhase) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) < 2 * Math.PI * g.duty;
        set(`adhere_claw_${key}`, amp > 0.05 ? (stance ? 1 : 0) : 0.8);
      }
    },
    readout(motor) { return { stepAmp: motor.stepAmp || 0 }; },
  };
}
