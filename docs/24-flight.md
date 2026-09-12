# 24. Flight

File: `src/sim/flight.js`. Driven from `FlyAgent.step`; decisions come from `src/sim/intrinsic.js`.

## Approach
Blade-element quasi-steady aerodynamics on the real stroke. Every physics substep (~0.1 ms) the wing
joints are set to the FlySuite 218 Hz stroke cycle, `mj_kinematics` is run, and each wing's blade point is
finite-differenced for its true velocity (MuJoCo's `cvel`/`mj_objectVelocity` do not report prescribed-joint
speeds). The Dickinson (1999) lift/drag fits act on the blade velocity and wing orientation; an empirical
unsteady factor of 1.6 lumps in the rotational-circulation and added-mass terms the quasi-steady terms omit
(they carry roughly a third of real fly lift).

Two approximations keep it stable in the browser:

- **The stroke is virtual.** Writing wing joint angles directly destabilises the body (the solver reacts
  to the teleports), and the wing actuators (gain 1–3, armature-dominated joints) cannot servo 218 Hz.
  Applying the aero force to the 8 µg wing bodies flings them instead. So the force is evaluated on a
  kinematic copy of the stroke and applied to the thorax with a reduced hinge-based moment arm — the
  rigid-body-equivalent load, minus the wings' 0.8% mass deflection. The physical wings stay parked; the
  renderer still draws the real stroke (at 218 Hz the cycle is shown as faint copies).
- **The mean force points ~55° forward** of the body vertical for this stroke, so the hover solution is a
  steep nose-up pitch, as in a real fly's inclined-stroke-plane hover.

## Safeguards
The blade forces made several numerical traps necessary:

- The distal span sign is fixed from the mesh once (per-pose sign tests made the blade point teleport,
  which the finite-difference read as million-cm/s gusts); chord and normal signs resolve against the
  current body axes per pose.
- Blade velocity is capped by rescaling the velocity vector itself (600 cm/s), not just its magnitude —
  capping only the magnitude left the drag direction term enormous.
- The free body's linear and angular velocities are clamped before every MuJoCo step; the contact solver
  otherwise catapults a fast fly on floor penetration.
- Flight ends on floor or leg contact (touchdown), and per-substep forces are written, not accumulated —
  `xfrc_applied` persists between steps.

Stability is best-effort: with these guards the fly takes off, climbs, cruises near the arena scale speed
(9 cm/s) and lands, but attitude recovery after large kicks is not guaranteed — real flapping flight is
open-loop unstable and this is a lumped controller, not a trained one.

## Sequence
1. **Takeoff.** An escape jump (giant fibre or takeoff DNs) or a voluntary takeoff runs the jump program.
   Once the push-off is done, the wings take over (the tarsal reflex). An escape banks away from the
   looming object for 300 ms and flies 40% faster.
2. **Climb** for 250 ms to a cruising height of 3.5 to 7.5 mm.
3. **Cruise** for a lognormal flight time, median 1.5 s, at about 9 cm/s. Free flight reaches 30 to
   100 cm/s, but not in a 5 cm arena.
4. **Land.** Descend at 4 cm/s with legs extended and claws ready. Landing is deferred while over a block.
5. **Touchdown.** Leg contact starts an 80 ms transfer of weight to the legs, then walking resumes after a
   300 ms stance.

## Control
| Quantity | Controlled by |
|---|---|
| Yaw rate | The brain's steering readout × 14 rad/s, limit 12 rad/s. Saccades arrive through the steering DNs |
| Roll and pitch | A haltere-like reflex holding 20° nose-up and banking into turns |
| Speed and height | The flight motor, as a fly holds them from optic flow |
| Walls and blocks | Collision-avoidance saccades, plus a push away from surfaces closer than 4.5 mm |

Torques use the whole fly's composite inertia about its centre of mass. The applied force is corrected
for its offset from that centre.

Steering is smoothed with a 50 ms time constant in flight, against 150 ms when walking.

## Decisions
The intrinsic module chooses when to fly (see [Endogenous behaviour](23-behaviour.md)).
- **Takeoff:** 10% of bout ends, more when hungry, and 10% of head-on wall contacts. The arena button
  "Activate takeoff DNs" excites DNp02 and DNp04 of the selected fly, as optogenetic activation would.
- **Steering in flight:** spontaneous saccades, and avoidance saccades when the path 9 mm ahead comes
  within 4 mm of a wall or block. The saccade turns toward the side with more room and holds that
  direction until the path is clear.

## Safeguards
- No takeoff while the body or antennae press against something. Takeoffs pressed into a wall made the
  contact solver fling the fly over it.
- Speed is capped at 40 cm/s.

## Test
`node scripts/flight_test.mjs [turn] [ms]` flies a brainless fly with fixed steering and prints its
attitude. `node scripts/diag_walk.mjs 12 open out.jsonl '{"takeoffAt":2500}'` requests a takeoff every
2.5 s in the full embodied fly.
