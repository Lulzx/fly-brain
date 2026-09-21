# 24. Flight

Files: `src/sim/flight.js`, `src/sim/fly.js`, `src/sim/motor.js`, `src/sim/fly.worker.js`.

## Model

Flight uses a **cycle-averaged aerodynamic motor** driving an articulated MuJoCo body. The actual
FlySuite 218 Hz wing cycle is sampled once to calibrate mean force magnitude at unit amplitude.
A velocity/height controller chooses amplitude and the direction of the mean force, capped at 2.2
body weights. A separate haltere-like attitude controller provides roll, pitch and yaw moments using
the fly's composite inertia. MuJoCo integrates all translation, rotation, leg motion and contacts.

This is an engineered control approximation. The commanded stroke-plane direction and attitude torque
are not derived from individual steering muscles or a resolved unsteady flow solver. The renderer
samples the real wing cycle into two instanced membrane fans; those samples do not reproduce the
controller's amplitude or stroke-plane adjustments exactly. No body trajectory is prescribed.

The calibration uses degree-valued empirical lift/drag fits, converted to radians before JavaScript
trigonometric functions. Drag follows air velocity relative to the wing. See the discussion of these
fits in [Walker and Taylor, 2021](https://doi.org/10.1098/rsif.2021.0103).

The net force acts at the whole fly's center of mass. Its moment is translated to the thorax body's
inertial center of mass before writing MuJoCo's `xfrc_applied`; these centers are different. See
[MuJoCo's force application guidance](https://github.com/google-deepmind/mujoco/discussions/641).
Yaw commands about world vertical are converted into body angular-velocity components before the
attitude feedback is evaluated.

## Sequence

1. **Request / jump.** The intrinsic bout controller or escape pathway can request a jump. The arena's
   takeoff button also queues an explicit request. It remains pending across the 1.5-second simulation
   startup gate, pauses and temporary contact gating. The UI shows when Run is needed. It clears when
   a flight actually starts. This routes through the existing intrinsic drive and voluntary motor gate;
   it is not proof of experimentally validated optogenetic behavior.
2. **Climb.** After the leg push-off, wing support starts and the legs tuck. The climb phase lasts 250 ms
   of simulation time, targeting a height sampled from 0.35–0.75 cm.
3. **Cruise.** The median sampled duration is 1.5 seconds, with lognormal variability. Target airspeed is
   around 9 cm/s, with variability. Wind offsets ground velocity; near-wall/obstacle clearance adds an
   avoidance demand. Steering comes from the simulated brain's motor readout. The body is held roughly
   20 degrees nose-up and banks into turns.
4. **Land.** Landing is deferred above obstacles. Forward speed and descent taper near the floor;
   yaw commands stop, the body levels and legs extend. This avoids pitching into the ground at cruising
   attitude and speed.
5. **Touchdown.** Foot contact or the low-height fallback initiates an 80 ms transfer of weight to the
   legs. Attitude support continues during that transfer. Wing force then stops; a 300 ms stance allows
   walking to resume. The renderer restores the parked wing geometry.

## The wing motor neurons are in the dataset, and they carry nothing useful

The roadmap's next step for flight was to drive the stroke from the wing motor neurons rather than
from the engineered controller. Those motor neurons are annotated in this release — both sets, which
is more than the leg map gets:

| pool | types | cells |
|---|---|---|
| power | `DLMn a,b`, `DLMn c-f`, `DVMn 1a-c`, `DVMn 2a,b`, `DVMn 3a,b` | 24 (12 per side) |
| basalar | `b1 MN`, `b2 MN`, `b3 MN` | 6 |
| first axillary | `i1 MN`, `i2 MN`, `hi1 MN`, `hi2 MN` | 10 |
| third axillary | `iii1 MN`, `iii3 MN`, `hiii2 MN` | 6 |
| hg group | `hg1 MN` … `hg4 MN` | 8 |
| pitch / tergopleural | `ps1 MN`, `tp1 MN`, `tp2 MN`, `tpn MN`, `hDVM MN` | 10 |

`scripts/wing_mn.mjs` flies the fly headless and records what each pool does, per side, through
takeoff, cruise and turns (`public/data/wing_mn.json`). Eight seconds, one takeoff at 1.5 s, 217 flying
samples and 183 on the ground:

| pool | ground (Hz) | flight (Hz) | r(L−R asymmetry, commanded turn) |
|---|---|---|---|
| power | 101.7 | 107.3 | 0.02 |
| basalar | 47.6 | 43.8 | 0.07 |
| first axillary | 69.5 | 78.1 | 0.07 |
| third axillary | 33.4 | 42.2 | 0.09 |
| hg | 51.6 | 45.0 | 0.14 |
| pitch | 61.5 | 71.4 | −0.09 |

(the six-second run this table first reported gave the same picture: power 101.7 → 109.2 and
|r| ≤ 0.08 in every pool)

**Two things are wrong with these numbers, and together they close the item.** The pools barely notice
that the fly has taken off — the power motor neurons, which in the animal are silent on the ground and
drive the asynchronous muscle only in flight, change by 5% — and their left-right asymmetry, which is
the entire mechanism by which steering muscles steer, is uncorrelated with the turn the brain is
commanding (|r| ≤ 0.14 in every pool, against the 0.5 the roadmap asks for). A stroke driven from these pools would be a constant, almost
symmetric command that does not know whether the animal is flying.

**The cause is upstream and is the same one as the walking gap.** Flight in this model is initiated and
maintained by the endogenous module, not by the connectome ([Behaviour](23-behaviour.md)), so no
descending signal ever tells the wing motor pools that flight has begun; they run on whatever tonic
drive the graph gives them. This is the flight version of [Limitations](19-limitations.md)'s
observation about the nerve cord: the motor neurons are wired, and nothing is driving them in a way
that carries the behaviour. Until a descending flight command exists in the model, "drive the stroke
from the motor neurons" would replace a working controller with an unsteerable one.

**What this makes the item.** Not "wire the MNs to the wings" but "give the wing system something to
listen to" — a descending flight command read from the graph, scored on the pools' flight-versus-ground
contrast and on asymmetry-versus-turn correlation, both of which `wing_mn.mjs` now measures. Those two
numbers are the success criterion, and they are near zero today.

### The search for that command has now been run, and it failed for a reason worth having

`scripts/dn_flight.mjs` drives each of the 480 descending types in turn and ranks them by what reaches
the wing pools. DNa08 comes first and DNg02_a second, both putting about 80% of their effect on the
wings rather than the legs — and DNg02 is independently the population Namiki et al. 2018 assign to
wing-amplitude control, which the screen was not told. The graph connects a plausible command.

In the embodied model that command is silent: the 27 cells fire at **2.35 Hz on the ground and 1.98 Hz
in flight**, while the power pool sits at 101.7 and 107.3 Hz. Decomposing the drive onto the power pool
says why — **90.4% of it is VNC intrinsic interneurons** (IN19B043, IN19B067 and IN19B040, at 45–122 Hz)
and only 8.6% is descending, from all 63 descending cells that touch the pool put together. The wing
motor neurons are not waiting for a command; they are being held near 100 Hz by the nerve cord itself.

The readout is built anyway and reported as `cmd.flightDrive` and `cmd.flightAsym`
(`src/sim/motor.js`), and nothing is gated on it, because a threshold on a 2 Hz signal that falls at
takeoff is a threshold on noise. See [M1](20-roadmap.md) for the full table and for what it does to the
ordering of the roadmap.

## Why the prior flight failed

The old controller repeatedly evaluated a virtual stroke inside each physics step while the solver's
wing joints stayed parked. Its instantaneous moments, overly aggressive attitude feedback and
incorrect force-application center produced violent tumbling in the flight diagnostic. The empirical
coefficient formulas also passed degree-valued angles to radian trigonometric functions, and drag had
its sign reversed. Fixing those two formulas alone did not give stable takeoff-to-landing behavior.
The former 80 ms UI request could additionally expire during startup, making a click do nothing.

The replacement applies the calibrated cycle mean and removes five extra kinematics traversals per
simulated millisecond. It retains the existing 40 cm/s emergency speed guard; normal regression cases
stay below 8 cm/s and do not depend on that guard. Recovery from arbitrary collisions or extreme gusts
is not established by these tests.

## Verification

```sh
node scripts/check_flight.mjs
node scripts/flight_test.mjs 0.25 3500
node scripts/diag_walk.mjs 6 open /tmp/fly-flight-full.jsonl '{"takeoffAt":2000,"vision":false}'
npm run build
npm run preview -- --port 5176
node scripts/check_arena_flight.mjs --url=http://localhost:5176
node scripts/check_arena_flight.mjs --url=http://localhost:5176 --gpu=0
```

`check_flight.mjs` exercises real MuJoCo motion with fixed steering: straight flight, both turn
directions, wind and a zero-lift ablation. It asserts bounded height and speed, opposite turns,
upright landing, phase transitions and actual foot contact. The ablation falls rather than hovering.
This isolates the motor; it is not a neural-behavior validation.

`check_arena_flight.mjs` clicks the actual button before startup, checks the queued/paused state,
runs the full brain/vision/physics worker, observes flight and wing visibility, and waits for landing.
The six-second WASM embodiment trace with vision disabled separately recorded two takeoffs and one
complete upright landing, followed by another cruise. See [arena performance](arena-performance.md)
for browser measurements and their scope.
