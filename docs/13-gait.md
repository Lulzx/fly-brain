# 13. Gait

## Pattern generator
Each leg joint follows off + a1·cos(φ + p1) + a2·cos(2φ + p2), shared by left and right legs of a pair.
A tripod couples left-front, right-middle, and left-hind, with the other three in antiphase.
Claws adhere during stance. Commands scale it:
- speed sets amplitude and frequency, from half to full,
- turning scales coxa stride per side,
- negative speed reverses the phase.

Parameters live in `public/body/gait.json`.

## History
| Version | Method | Result |
|---|---|---|
| First | CMA-ES for forward distance | Rejected: hopped, 7 cm/s, airborne 24% of the time |
| Constrained | At least 3 feet down, bounce and body-contact penalties, 3 cm/s cap | 2.9 to 3.4 cm/s, stable, heading drift |
| Multi-condition | Forward, both turns, slow, backward together | Straight walking and backward walking fixed |
| Real-fly anchored, current | Start from FlySuite data, penalise drift from it | 12° RMS from real flies, stable |

## Real-fly data
`scripts/gait_from_data.py` reads 100 FlySuite walking trajectories. Legs are phased from the coxa angle
with a Hilbert transform, joint angles are averaged over phase, and two harmonics are fitted.
Real flies stepped at a median 9.5 Hz and 1.7 cm/s, in a clean tripod.

## Current performance

| Condition | Result over 1.5 s |
|---|---|
| Forward | 4.0 cm, heading drift +4° |
| Turn left / right | about +360° / −340° |
| Slow | 1.5 cm, stable |
| Backward | 2.4 cm back, stable |
| Brain-like fluctuating commands | 0 flips in 40 runs of 6 s |

## Scripts
`gait_opt.py`, `gait_opt2.py`, `gait_from_data.py`, `gait_check.py`, `gait_compare.py`, `gait_stress.py`,
`gait_export.py`.
