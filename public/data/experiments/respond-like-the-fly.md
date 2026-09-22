# respond-like-the-fly

**Question:** Which ensemble members respond to the real perturbation experiments the way the animal did, and does the real wiring match rows the weight-shuffled wiring does not?

**Operators:** readout.descending, cord.premotorInhibition, cmd.MDN, cmd.BDN2

**Split rule:** `speed < 0.5 * baseline.speed`

Ensemble: 4 members over wiring, inhGain (seed 9)

## Pre-registered observables

| observable | site | measure | value |
|---|---|---|---|
| forward | arena | gait.forward {"assay":"walk_cpg"} | 4.024 |
| speed | arena | gait.speed {"assay":"walk_cpg"} | 0.426 |
| cadence | arena | gait.cadence {"assay":"walk_cpg"} | 5.263 |
| backFrac | arena | gait.backFrac {"assay":"walk_cpg"} | 0.19 |
| upright | arena | gait.upright {"assay":"walk_cpg"} | 1 |
| displacement | arena | gait.displacement {"assay":"walk_cpg"} | 1.618 |
| driveHz | arena | driveHz {"assay":"walk_cpg"} | 0 |
| restSpeed | arena | gait.speed {"assay":"rest_cpg"} | 0.178 |
| restUpright | arena | gait.upright {"assay":"rest_cpg"} | 1 |
| restDisplacement | arena | gait.displacement {"assay":"rest_cpg"} | 0.676 |
| restDriveHz | arena | driveHz {"assay":"rest_cpg"} | 0 |

## Response operator

How many ensemble members respond to each real experiment the way the animal did. `measured` and `qualitative` rows are animal data; `prediction` rows are sibling-model predictions with no animal anchor and count for nothing; `pending` rows have no source yet.

| row | status | experiment | animal | match | mismatch | undefined |
|---|---|---|---|---|---|---|
| mdn_backward | qualitative | Activate the moonwalker descending neurons (MDN) in a walking fly | backward walking: the fly reverses for the duration of activation | 2 | 2 | 0 |
| dng100_dose | qualitative | Drive the BDN2 / DNg100 descending pair at increasing rates | walking speed and step frequency both increase with drive, with a threshold below which the fly does not walk | 0 | 4 | 0 |
| b13_slowdown | measured | Optogenetic activation of 13B premotor interneurons (13Balpha driver, 720 ms pulse) during walking | forward speed falls during the pulse: about 0.65 cm/s slowdown against about 0.1 cm/s in the no-driver control, a 40-80% reduction | 2 | 2 | 0 |
| decapitated_stands | measured | Decapitation: the brain removed, the nerve cord and legs intact | decapitated flies keep standing posture and do not locomote: 0 of 90 moved 1 mm or more in 2 min | 4 | 0 | 0 |
| no_command_stands | qualitative | Brain intact, no walking command delivered | an undisturbed fly spends most of its time not walking; the descending command is required for sustained walking | 1 | 3 | 0 |
| dng93_stop | prediction | Drive the DNg93 descending pair (the largest direct descending projection onto leg motor neurons, GABA-predicted) during a walking command | no animal measurement. Sibling-model prediction: walking does not start, the fly stays upright with the motor pool at a tenth of its walking rate | 0 | 4 | 0 |
| dnge036_walks | prediction | Drive the DNge036 pair with no other walking command | no animal measurement. Sibling-model prediction: walking starts within 0.2 s at command-class speed | 0 | 4 | 0 |

Animal rows matched by every member: 1 of 5. Members matching every animal row: 0 of 4.

## Ranked perturbations

| experiment | separation |
|---|---|
| cmd_silenced | 0.667 |
| obs:restDisplacement | 0.667 |
| resp:mdn_backward | 0.667 |
| resp:b13_slowdown | 0.667 |
| b13_on | 0.5 |
| obs:forward | 0.5 |
| obs:cadence | 0.5 |
| obs:backFrac | 0.5 |
| obs:restSpeed | 0.5 |
| resp:no_command_stands | 0.5 |
| mdn_on | 0 |
| dng100_40 | 0 |
| dng100_80 | 0 |
| dng100_160 | 0 |
| headless | 0 |
| dng93_on | 0 |
| dnge036_on | 0 |
| obs:speed | 0 |
| obs:upright | 0 |
| obs:displacement | 0 |
| obs:driveHz | 0 |
| obs:restUpright | 0 |
| obs:restDriveHz | 0 |
| resp:dng100_dose | 0 |
| resp:decapitated_stands | 0 |
| resp:dng93_stop | 0 |
| resp:dnge036_walks | 0 |

## Members

| member | params | baseline | kills |
|---|---|---|---|
| 0 | {"wiring":"real","inhGain":0.577} | forward=3.342 speed=0.497 cadence=5 backFrac=0.19 upright=1 displacement=1.89 driveHz=0 restSpeed=0.115 restUpright=1 restDisplacement=0.437 restDriveHz=0 | b13_on,headless,cmd_silenced |
| 1 | {"wiring":"real","inhGain":1} | forward=-0.408 speed=0.405 cadence=6.053 backFrac=0.946 upright=1 displacement=1.54 driveHz=0 restSpeed=0.178 restUpright=1 restDisplacement=0.676 restDriveHz=0 | headless,cmd_silenced |
| 2 | {"wiring":"weightShuffle","inhGain":0.577} | forward=4.553 speed=0.426 cadence=3.684 backFrac=0.091 upright=1 displacement=1.618 driveHz=0 restSpeed=0.502 restUpright=1 restDisplacement=1.907 restDriveHz=0 | headless |
| 3 | {"wiring":"weightShuffle","inhGain":1} | forward=4.024 speed=0.381 cadence=5.263 backFrac=0.153 upright=1 displacement=1.448 driveHz=0 restSpeed=0.076 restUpright=1 restDisplacement=0.288 restDriveHz=0 | headless |

## Response reads

| member | mdn_backward | dng100_dose | b13_slowdown | decapitated_stands | no_command_stands | dng93_stop | dnge036_walks |
|---|---|---|---|---|---|---|---|
| 0 | match: value -0.657, expected sign -1 with |v| >= 0.02 | mismatch: series 0.376 -> 0.602 -> 0.479, expected non-decreasing with span >= 0.05; series 8.158 -> 7.895 -> 4.474, expected non-decreasing with span >= 1 | match: ratio 0.206, expected in [0.2, 0.6] | match: value 0.001, expected <= 0.1; |delta| 0.000 against tolerance 0.150 | match: value 0.049, expected <= 0.05 | mismatch: delta -0.130 (base 0.497), expected sign -1 with |delta| >= 0.249 | mismatch: delta -0.024 (base 0.115), expected sign 1 with |delta| >= 0.115 |
| 1 | match: value -0.739, expected sign -1 with |v| >= 0.02 | mismatch: series 0.427 -> 0.454 -> 0.482, expected non-decreasing with span >= 0.05; series 6.053 -> 6.053 -> 5.526, expected non-decreasing with span >= 1 | mismatch: ratio 1.467, expected in [0.2, 0.6] | match: value 0.001, expected <= 0.1; |delta| 0.000 against tolerance 0.150 | mismatch: value 0.079, expected <= 0.05 | mismatch: delta -0.008 (base 0.405), expected sign -1 with |delta| >= 0.203 | mismatch: delta -0.005 (base 0.178), expected sign 1 with |delta| >= 0.178 |
| 2 | mismatch: value 3.182, expected sign -1 with |v| >= 0.02 | mismatch: series 0.410 -> 0.531 -> 0.517, expected non-decreasing with span >= 0.05; series 3.947 -> 3.684 -> 3.947, expected non-decreasing with span >= 1 | mismatch: ratio 1.266, expected in [0.2, 0.6] | match: value 0.001, expected <= 0.1; |delta| 0.000 against tolerance 0.150 | mismatch: value 0.407, expected <= 0.05 | mismatch: delta -0.031 (base 0.426), expected sign -1 with |delta| >= 0.213 | mismatch: delta -0.148 (base 0.502), expected sign 1 with |delta| >= 0.502 |
| 3 | mismatch: value 3.765, expected sign -1 with |v| >= 0.02 | mismatch: series 0.508 -> 0.500 -> 0.610, expected non-decreasing with span >= 0.05; series 5.263 -> 5.263 -> 5.789, expected non-decreasing with span >= 1 | match: ratio 0.521, expected in [0.2, 0.6] | match: value 0.001, expected <= 0.1; |delta| 0.000 against tolerance 0.150 | mismatch: value 0.597, expected <= 0.05 | mismatch: delta 0.364 (base 0.381), expected sign -1 with |delta| >= 0.191 | mismatch: delta -0.030 (base 0.076), expected sign 1 with |delta| >= 0.076 |

## Perturbed reads

### mdn_on

| member | forward | speed | cadence | backFrac | upright | displacement | driveHz | restSpeed | restUpright | restDisplacement | restDriveHz | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | -0.657 | 0.567 | 5.526 | 0.86 | 0.781 | 2.156 | 95 | 0.457 | 0.778 | 1.738 | 83.875 |  |
| 1 | -0.739 | 0.573 | 6.316 | 0.928 | 0.945 | 2.179 | 124.75 | 0.558 | 0.944 | 2.12 | 123.75 |  |
| 2 | 3.182 | 0.509 | 2.632 | 0.412 | 1 | 1.936 | 123.563 | 0.231 | 1 | 0.879 | 127.5 |  |
| 3 | 3.765 | 0.599 | 2.632 | 0.36 | 1 | 2.275 | 111.75 | 0.514 | 1 | 1.954 | 112.563 |  |

### dng100_40

| member | forward | speed | cadence | backFrac | upright | displacement | driveHz | restSpeed | restUpright | restDisplacement | restDriveHz | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1.052 | 0.376 | 8.158 | 0.313 | 1 | 1.429 | 27.625 | 0.306 | 1 | 1.164 | 9.625 |  |
| 1 | -0.429 | 0.427 | 6.053 | 0.907 | 1 | 1.623 | 9 | 0.221 | 1 | 0.838 | 5.5 |  |
| 2 | 4.563 | 0.41 | 3.947 | 0.082 | 1 | 1.56 | 149.75 | 0.608 | 1 | 2.311 | 132.875 |  |
| 3 | 0.64 | 0.508 | 5.263 | 0.432 | 0.654 | 1.932 | 125 | 0.446 | 0.229 | 1.694 | 112.5 |  |

### dng100_80

| member | forward | speed | cadence | backFrac | upright | displacement | driveHz | restSpeed | restUpright | restDisplacement | restDriveHz | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1.081 | 0.602 | 7.895 | 0.325 | 1 | 2.289 | 45.25 | 0.064 | 1 | 0.243 | 1 |  |
| 1 | -0.464 | 0.454 | 6.053 | 0.906 | 1 | 1.725 | 36.375 | 0.437 | 1 | 1.66 | 3.125 |  |
| 2 | 4.606 | 0.531 | 3.684 | 0.154 | 1 | 2.019 | 175.25 | 0.255 | 1 | 0.969 | 167.375 |  |
| 3 | 0.715 | 0.5 | 5.263 | 0.399 | 0.524 | 1.899 | 160.375 | 0.508 | 0.723 | 1.932 | 155.875 |  |

### dng100_160

| member | forward | speed | cadence | backFrac | upright | displacement | driveHz | restSpeed | restUpright | restDisplacement | restDriveHz | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2.079 | 0.479 | 4.474 | 0.27 | 0.933 | 1.821 | 125.25 | 0.636 | 0.371 | 2.417 | 119.75 |  |
| 1 | 0.521 | 0.482 | 5.526 | 0.49 | 1 | 1.832 | 113.125 | 0.255 | 1 | 0.969 | 70 |  |
| 2 | 4.502 | 0.517 | 3.947 | 0.082 | 1 | 1.964 | 199.375 | 0.515 | 1 | 1.956 | 200 |  |
| 3 | 2.519 | 0.61 | 5.789 | 0.23 | 0.99 | 2.317 | 186.5 | 0.492 | 0.222 | 1.868 | 183.375 |  |

### b13_on

| member | forward | speed | cadence | backFrac | upright | displacement | driveHz | restSpeed | restUpright | restDisplacement | restDriveHz | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.833 | 0.103 | 6.579 | 0.221 | 1 | 0.39 | 62.065 | 0.004 | 1 | 0.015 | 62.923 | yes |
| 1 | -0.595 | 0.595 | 6.579 | 0.982 | 1 | 2.259 | 57.477 | 0.168 | 1 | 0.639 | 57.765 |  |
| 2 | 4.571 | 0.539 | 3.684 | 0.134 | 1 | 2.048 | 62.886 | 0.41 | 1 | 1.558 | 63.343 |  |
| 3 | 1.067 | 0.198 | 8.158 | 0.305 | 1 | 0.754 | 60.482 | 0.052 | 1 | 0.198 | 61.263 |  |

### headless

| member | forward | speed | cadence | backFrac | upright | displacement | driveHz | restSpeed | restUpright | restDisplacement | restDriveHz | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 1 | 1 | 0.001 | 0 | 0 | 1 | 0.001 | 0 | yes |
| 1 | 0 | 0 | 0 | 1 | 1 | 0.001 | 0 | 0 | 1 | 0.001 | 0 | yes |
| 2 | 0 | 0 | 0 | 1 | 1 | 0.001 | 0 | 0 | 1 | 0.001 | 0 | yes |
| 3 | 0 | 0 | 0 | 1 | 1 | 0.001 | 0 | 0 | 1 | 0.001 | 0 | yes |

### cmd_silenced

| member | forward | speed | cadence | backFrac | upright | displacement | driveHz | restSpeed | restUpright | restDisplacement | restDriveHz | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.174 | 0.049 | 4.211 | 0.389 | 1 | 0.186 | 0 | 0.18 | 1 | 0.682 | 0 | yes |
| 1 | -0.078 | 0.079 | 5.263 | 0.566 | 1 | 0.299 | 0 | 0.166 | 1 | 0.631 | 0 | yes |
| 2 | 3.692 | 0.407 | 2.368 | 0.384 | 1 | 1.545 | 0 | 0.385 | 1 | 1.465 | 0 |  |
| 3 | 2.073 | 0.597 | 3.947 | 0.258 | 1 | 2.267 | 0 | 0.049 | 1 | 0.185 | 0 |  |

### dng93_on

| member | forward | speed | cadence | backFrac | upright | displacement | driveHz | restSpeed | restUpright | restDisplacement | restDriveHz | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.563 | 0.367 | 6.579 | 0.263 | 1 | 1.396 | 89.375 | 0.046 | 1 | 0.173 | 130.375 |  |
| 1 | -0.399 | 0.398 | 6.053 | 0.921 | 1 | 1.511 | 59.125 | 0.171 | 1 | 0.651 | 136 |  |
| 2 | 4.588 | 0.394 | 3.947 | 0.091 | 1 | 1.499 | 155.375 | 0.46 | 1 | 1.747 | 155.75 |  |
| 3 | 2.035 | 0.746 | 4.211 | 0.317 | 1 | 2.833 | 152.875 | 0.086 | 1 | 0.327 | 153.5 |  |

### dnge036_on

| member | forward | speed | cadence | backFrac | upright | displacement | driveHz | restSpeed | restUpright | restDisplacement | restDriveHz | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.498 | 0.463 | 5.789 | 0.296 | 1 | 1.76 | 116.75 | 0.091 | 1 | 0.347 | 155.375 |  |
| 1 | -0.334 | 0.329 | 6.053 | 0.88 | 1 | 1.251 | 99.375 | 0.173 | 1 | 0.657 | 133.25 |  |
| 2 | 4.539 | 0.5 | 3.421 | 0.09 | 1 | 1.9 | 162.25 | 0.353 | 1 | 1.343 | 161.25 |  |
| 3 | 1.184 | 0.447 | 7.895 | 0.286 | 1 | 1.7 | 157.25 | 0.045 | 1 | 0.172 | 156.25 |  |

