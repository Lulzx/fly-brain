# 14. Reflexes

## Escape jump
Triggered by a giant-fibre burst or a sharp rise in the takeoff neurons, see [Motor](12-motor.md).

| Phase | Duration | Action |
|---|---|---|
| Pre-posture | 30 ms | All legs to a symmetric stance, claws gripping |
| Push | 20 ms | Middle femurs 70% and tibias 50% extension, hind femurs 40%, front femurs 50%, claws released |
| Airborne | 80 ms | Symmetric posture, claws released |
| Landing | 190 ms | Symmetric posture, claws gripping |

Refractory period: 1 s. Landed upright in 24 of 24 trials from full-speed walking and hard turns, hopping
at least 1 mm (`scripts/jump_test3.py`). Without the pre-posture, jumps from mid-stride flipped the fly.

After the push, the wings take over and the fly flies ([Flight](24-flight.md)). The airborne and landing
phases above now apply only if flight does not start. See [Motor](12-motor.md) for escape gating.

## Righting
A nerve-cord-level reflex, not a brain decision. It starts after 150 ms inverted and runs until upright:
- the left wing swings forward and down to push on the floor at 4 Hz,
- the legs flail in tripod antiphase,
- afterwards the fly holds a standing posture for 300 ms.

Leg-only programs never righted the fly; the legs cannot reach the floor from its back.
The chosen program rights and stays upright in 4 of 6 tested inverted starts (`scripts/righting_test.py`).
