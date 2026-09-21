// Scaffold plugin: the righting reflex.
//
// An inverted fly (up < -0.3 for more than 150 ms) rights itself: the left wing pushes on the
// substrate while the legs flail in tripod antiphase, then it settles in a standing posture
// (scripts/righting_test.py: rights from all tested inverted starts within ~0.1 s). A fixed motor
// program standing in for the VNC righting circuitry.
//
// Registered on the Motor host. Off: an inverted fly stays inverted — the legs do not flail and
// the wing does not push, so `cmd.righting` is never asserted.
export const RIGHT = { f: 6, aL: 1.0, aR: 0.3, tib: 0.5, abd: 0.5, wy: 1.0, wr: -1.0, wp: -1.0, wf: 4 };
const LEGS = ['T1', 'T2', 'T3'], SIDES = ['left', 'right'];

export function create() {
  return {
    id: 'rightingReflex',
    title: 'Righting reflex (inverted -> wing push + leg flail)',
    claim: 'Without it, an upside-down fly never rights itself.',
    files: ['src/sim/motor.js'],
    defaultOn: true,
    params: { invertMs: 150, recoverMs: 300, ...RIGHT },
    setup() {},
    step(motor, tMs, dtMs, extra) {
      const P = RIGHT, R = motor.range;
      const up = extra.up ?? 1;
      motor.invertedMs = up < -0.3 && !motor.flying ? (motor.invertedMs || 0) + dtMs : 0;
      if (motor.invertedMs > this.params.invertMs || (motor.righting && up < 0.8)) {
        motor.righting = true; const t = tMs / 1000;
        for (const leg of LEGS) for (const sd of SIDES) {
          const amp = sd === 'left' ? P.aL : P.aR, lph = 2 * Math.PI * P.f * t + (['T1_left', 'T2_right', 'T3_left'].includes(`${leg}_${sd}`) ? 0 : Math.PI);
          motor.setCtrl(`coxa_${leg}_${sd}`, amp * Math.sin(lph) * R[`coxa_${leg}_${sd}`][1]);
          motor.setCtrl(`femur_${leg}_${sd}`, amp * (0.5 + 0.5 * Math.sin(lph)) * R[`femur_${leg}_${sd}`][1]);
          motor.setCtrl(`tibia_${leg}_${sd}`, P.tib * R[`tibia_${leg}_${sd}`][1]);
          motor.setCtrl(`coxa_abduct_${leg}_${sd}`, R[`coxa_abduct_${leg}_${sd}`][0] * P.abd * (sd === 'left' ? 1 : 0.2));
          motor.setCtrl(`adhere_claw_${leg}_${sd}`, Math.sin(lph) > 0 ? 1 : 0);
        }
        const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * P.wf * t);
        motor.setCtrl('wing_yaw_left', P.wy * w); motor.setCtrl('wing_roll_left', P.wr * w); motor.setCtrl('wing_pitch_left', P.wp * w);
        motor.cmd.righting = true;
      } else if (motor.righting) { motor.righting = false; motor.recoverUntil = tMs + this.params.recoverMs; for (const ax of ['yaw', 'roll', 'pitch']) motor.setCtrl(`wing_${ax}_left`, 0); }
      if (!motor.righting && motor.recoverUntil > tMs) for (const leg of LEGS) for (const sd of SIDES) {   // settle in a standing posture after righting
        for (const j of ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2']) motor.setCtrl(`${j}_${leg}_${sd}`, 0);
        motor.setCtrl(`adhere_claw_${leg}_${sd}`, 0.8); }
    },
    readout(motor) { return { righting: !!motor.righting, invertedMs: motor.invertedMs || 0 }; },
  };
}
