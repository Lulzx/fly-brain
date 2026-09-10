# 24. Flight

File: `src/sim/flight.js`. Driven from `FlyAgent.step`; decisions come from `src/sim/intrinsic.js`.

## Approach
flybody's physics file has no aerodynamic model for the wings, and flapping flight in flybody needs a
trained controller. Flight here is quasi-steady:
- The net aerodynamic force and torque of each stroke cycle are applied to the thorax.
- In the physics the wings are held spread.
- The renderer draws the real stroke. At 218 Hz a wing sweeps its stroke every 4.6 ms, so it is shown as
  faint copies across the FlySuite wing-beat cycle.

Driving the stroke kinematically in the physics was tried and dropped. It gives the wing joints about
1,000 rad/s velocities that hit joint limits, and the resulting reaction torques rolled the fly over.

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
