# 8. Body and physics

## Model
flybody (Vaxenburg et al. 2024, Apache-2.0): 67 bodies, 102 joints, 78 actuators, adhesive tarsal claws,
units of cm, g, and s. Total mass 0.98 mg.

## Preparation
`scripts/prep_body.py` splits the model:
- `fly_physics.xml`: collision shapes only, with the exact compiled masses and inertias written at full
  precision. The default XML writer rounded tiny tarsal inertias to zero, so they are rewritten manually.
- `fly_visual.bin` and `.json`: meshes welded, then decimated to about 69,000 triangles for Three.js.
  MuJoCo stores meshes as triangle soup, which must be welded before decimation.

## World
`src/sim/world.js` builds one MuJoCo world per fly: floor, a 48-segment circular wall, obstacles, food and
patch discs, a looming threat body, and mocap proxies for other flies.

## Contact layers
| Geoms | Touch |
|---|---|
| Claws, labella, and leg segments | Floor only |
| Head, thorax, abdomen, wings | Floor, walls, obstacles, other flies |

Legs previously stepped up vertical walls and flipped the fly backwards. With legs sliding along walls,
the body stops against them and the fly must turn or back away.

## Timestep
0.2 ms without no-slip iterations. This matched flybody's 0.1 ms gait quality in tests and halves cost.
Wall friction stays at 1; low friction let the head slide up walls and flip the fly.

## Joint sign conventions, measured
femur + is trochanter depression; tibia + is extension; coxa + is promotion; coxa_abduct + is adduction;
coxa_twist + is anterior rotation; femur_twist + is reduction; tarsus + is levation.
