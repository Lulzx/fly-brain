# 9. Neuron-to-body map

File: `public/data/bodymap.json`, built by `scripts/prep_bodymap.py`.

## Motor neurons
439 motor neurons in 170 muscle groups, mapped by their annotated muscle:

| Annotated type | Joint | Direction |
|---|---|---|
| Tr extensor, Sternotrochanter, Tergotr. | femur | depression |
| Tr flexor, Acc. tr flexor | femur | levation |
| Ti extensor | tibia | extension |
| Ti flexor, Acc. ti flexor | tibia | flexion |
| Tergopleural/Pleural promotor | coxa | promotion |
| Pleural remotor/abductor | coxa, coxa_abduct | remotion, abduction |
| Sternal adductor | coxa_abduct | adduction |
| Sternal anterior / posterior rotator | coxa_twist | ± rotation |
| Fe reductor | femur_twist | reduction |
| Ta levator / depressor | tarsus | ± |
| ltm, ltm1-tibia, ltm2-femur | tarsus2 and claw adhesion | grip |
| MN9 | rostrum | extension |
| MN11D, MN11V, MN12D | haustellum | extension |
| MN6 to MN8 | labella | spreading |
| MN1 to MN5 | rostrum | retraction |

Wing power, steering, and pharyngeal pump neurons are grouped separately. Abdominal, neck, and haltere
motor neurons are unmapped because v1.0 does not annotate their muscles.

**How much output that strands, measured.** `scripts/motor_bound.mjs` censuses every motor neuron during
20 s of foraging and asks which of their spikes can reach an actuator. 350 of the model's 815 motor
neurons have no route to one, and they fire at 21.4 Hz against 21.9 Hz for the ones the body can read:
**42.4% of all motor-neuron spikes are emitted into nothing.** That is the bound
[M5](20-roadmap.md) asks for, and it is a property of this release's annotation rather than of the
model — every behavioural number in this repository is produced by a motor system missing that fraction
of its output. `public/data/motor_bound.json` carries the per-subclass breakdown.

## Sensory neurons
7,745 neurons in 151 channels, by modality, receptor, nerve, and side.

| Channel | Types |
|---|---|
| Labellar taste | LB3b and LB3c sugar, LB1a to LB1d bitter, LB3a water, LB3d high salt |
| Leg taste | LgLG3, LgLG4, LgAG2 sugar; LgAG1 bitter; LgLG1, LgLG2, LgLG5 to LgLG8 pheromone |
| Taste pegs | dorsal tpGRN sugar, claw tpGRN |
| Olfaction | 53 ORN types by glomerulus and antenna |
| Leg mechanosensation | tactile bristles, chordotonal organs, hair plates, campaniform sensilla per leg |
| Other | wing and notum bristles, halteres, Johnston's organ, thermo- and hygrosensory neurons |

Taste identities follow the 2026 gustatory connectome paper.

## Photoreceptors
4,107 photoreceptors. Each viewing direction is the outward normal of a sphere fitted to its eye's lamina
entry points, rescaled to the fly's field of view: azimuth −10° to 165°, elevation −60° to 70°.
Dorsal rim R7d and R8d land near +48° elevation on both eyes, confirming orientation.
