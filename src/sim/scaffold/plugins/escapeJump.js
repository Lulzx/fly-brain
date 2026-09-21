// Scaffold plugin: escape detection and the TTM jump program.
//
// Two detectors decide to jump: a burst of giant-fibre spikes (gfSpikes within gfWindow ms — the
// spikes themselves arrive through the gfGap electrical synapse) and a sharp rise of the looming-
// sensitive takeoff DNs above their own slow baseline (a loom, not self-motion noise). Either one —
// or a voluntary takeoff request — runs a fixed motor program: symmetric pre-jump posture, then a
// 20 ms TTM push that extends the middle legs (scripts/jump_test2.py). The program and the
// detectors are rules standing in for the TTMn/descending circuitry.
//
// Registered on the Motor host, inside apply() where the monolith ran this block. Off: nothing
// jumps — no escape response and no voluntary takeoff, which is the honest consequence: the whole
// jump channel is scaffold machinery.
export const JUMP = { pre: 30, push: 20, f2: 0.7, t2: 0.5, f3: 0.4, f1: 0.5, fly: 80 };   // scripts/jump_test3.py: 24/24 upright from fast turning gaits
const LEGS = ['T1', 'T2', 'T3'], SIDES = ['left', 'right'];

export function create() {
  return {
    id: 'escapeJump',
    title: 'GF/loom escape detection + TTM jump program',
    claim: 'Without it, giant-fibre bursts and looming takeoff DNs fire but the fly never jumps.',
    files: ['src/sim/motor.js'],
    defaultOn: true,
    paramSource: 'READOUT',
    paramKeys: ['takeoffThreshold', 'takeoffRatio', 'takeoffTauSlow', 'takeoffInit', 'startupMs', 'gfSpikes', 'gfWindow'],
    params: { jumpPre: JUMP.pre, jumpPush: JUMP.push, f2: JUMP.f2, t2: JUMP.t2, f3: JUMP.f3, f1: JUMP.f1, fly: JUMP.fly },
    setup() {},
    step(motor, tMs, dtMs, extra) {
      const R = this.P, J = JUMP;
      // escape: a single GF spike drives TTMn 1:1 (electrical synapse) -> jump; or the looming-
      // sensitive takeoff DNs rise sharply above their own recent baseline (a loom, not the
      // fluctuations of self-motion)
      motor.tNow = tMs; motor.gfTimes = (motor.gfTimes || []).filter(t => tMs - t < R.gfWindow); motor.gfSpike = motor.gfTimes.length >= R.gfSpikes;
      const to = motor.cmd.takeoff; motor.toSlow = motor.toSlow === undefined ? R.takeoffInit : motor.toSlow + dtMs / R.takeoffTauSlow * (to - motor.toSlow);
      const loomTakeoff = to > R.takeoffThreshold && to > R.takeoffRatio * motor.toSlow;
      // an inverted fly cannot jump; nor does one whose antennae are on the object filling its view
      // (a wall it walked into looms on the eye, but touch says it is not an approaching predator)
      const canJump = (extra.up ?? 1) > 0.5 && !motor.righting && !(motor.recoverUntil > tMs) && !motor.flying && (!extra.touching || (extra.voluntary && !extra.contact));
      if ((motor.gfSpike || loomTakeoff || extra.voluntary) && canJump && motor.jumpT < 0 && tMs > R.startupMs) { motor.jumpT = tMs; motor.launchT = -1; motor.jumpCause = motor.gfSpike ? 'GF burst' : loomTakeoff ? `takeoff DNs ${to.toFixed(0)}Hz (baseline ${motor.toSlow.toFixed(0)})` : 'voluntary'; if (globalThis.LOG_JUMPS) console.log(`jump at ${tMs} ms: ${motor.jumpCause}, up ${(extra.up ?? 1).toFixed(2)}`); }
      if (motor.jumpT >= 0) {
        // jump program (tested in scripts/jump_test.py): TTM drives both middle legs to full
        // extension for 20 ms, hind femora half-extended, all tarsi released; ~2.5 mm hop that
        // lands upright
        const dtj = tMs - motor.jumpT - J.pre;   // 30 ms symmetric pre-jump posture (long-mode takeoff), then TTM push
        const all = ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus', 'tarsus2'];
        motor.jumping = dtj < J.push + J.fly + 190;
        if (motor.jumping) for (const leg of LEGS) for (const sd of SIDES) {
          for (const j of all) motor.setCtrl(`${j}_${leg}_${sd}`, 0);              // symmetric posture
          if (dtj >= J.push && motor.launchT < 0) motor.launchT = tMs;             // push done: airborne, the wings take over
          if (dtj >= 0 && dtj < J.push) {                                          // TTM push
            if (leg === 'T2') { motor.setCtrl(`femur_T2_${sd}`, J.f2 * motor.range[`femur_T2_${sd}`][1]); motor.setCtrl(`tibia_T2_${sd}`, J.t2 * motor.range[`tibia_T2_${sd}`][1]); }
            if (leg === 'T3') motor.setCtrl(`femur_T3_${sd}`, J.f3 * motor.range[`femur_T3_${sd}`][1]);
            if (leg === 'T1') motor.setCtrl(`femur_T1_${sd}`, J.f1 * motor.range[`femur_T1_${sd}`][1]);
          }
          motor.setCtrl(`adhere_claw_${leg}_${sd}`, dtj < 0 ? 0.8 : dtj < J.push + J.fly ? 0 : 0.8);
        }
        if (dtj > 1000) { motor.jumpT = -1; motor.jumping = false; }   // refractory period
      }
    },
    readout(motor) { return { jumping: !!motor.jumping, gfSpike: !!motor.gfSpike }; },
  };
}
