// Scaffold plugin: the head-grooming leg pattern.
//
// When the bout scheduler puts the fly in the 'groom' state, the grooming DNs (DNg07/08/12) fire
// through the connectome — but the actual leg movement is a fixed pattern: front legs lift and
// sweep over the head/eyes in antiphase at ~7 Hz. Supplied kinematics, like the stepping
// generator's.
//
// Registered on the Motor host, inside apply(). Off: `cmd.grooming` still reads the DNs but no leg
// moves, so the fly reports "grooming" while standing still — which is exactly the distinction the
// ledger exists to record.
export function create() {
  return {
    id: 'groomPattern',
    title: 'Head-grooming front-leg sweep (7 Hz antiphase)',
    claim: 'Without it, grooming DNs fire but the front legs never sweep the head.',
    files: ['src/sim/motor.js'],
    defaultOn: true,
    params: { freq: 7 },
    setup() {},
    step(motor, dtMs) {
      if (!motor.cmd.grooming || motor.mode === 'connectome') return;
      motor.groomPhase = (motor.groomPhase || 0) + 2 * Math.PI * this.params.freq * dtMs / 1000;
      for (const sd of ['left', 'right']) { const ph = motor.groomPhase + (sd === 'left' ? 0 : Math.PI);
        motor.setCtrl(`coxa_T1_${sd}`, 1.1 + 0.25 * Math.sin(ph)); motor.setCtrl(`femur_T1_${sd}`, -0.1); motor.setCtrl(`tibia_T1_${sd}`, -0.9 + 0.35 * Math.sin(ph + 0.8));
        motor.setCtrl(`coxa_twist_T1_${sd}`, 0.3 * Math.sin(ph)); motor.setCtrl(`tarsus_T1_${sd}`, 0.4); motor.setCtrl(`adhere_claw_T1_${sd}`, 0); }
    },
    readout(motor) { return { groomPhase: motor.groomPhase || 0 }; },
  };
}
