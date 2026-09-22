# Cord ensemble, circuit site

64 members over 6 binary axes, 6 perturbations, 1000 steps of the cord at 0.5 ms, read as a gait from the six leg motor pools with no body.

## Verdict

No member reaches the coherence a synthetic tripod produces (0.5); the ensemble's best is 0.404. 2 members cross the 0.3 floor, which is inside the ensemble's own spread.

## Every condition, ensemble median

| condition | median pool rate | median periodicity |
|---|---|---|
| `baseline` | 632.5 Hz | 0.232 |
| `ablate_13A` | 720 Hz | 0.24 |
| `ablate_13B` | 740 Hz | 0.222 |
| `ablate_19B` | 680 Hz | 0.216 |
| `no_commissural` | 1102.5 Hz | 0.168 |
| `no_command` | 372.5 Hz | 0.234 |

## Baseline, ensemble median

| bestStrength | bestF | cadence | duty | contraPhase | contraR | tripod | legsStepping | rateRhythm | meanHz | modDepth | poolsModulated |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.232 | 8.5 | 10 | 0.185 | 0.579 | 0.369 | 0.004 | 3 | 0.071 | 632.5 | 1500 | 6 |

## Perturbations, ranked by how far they split the ensemble

| perturbation | split fraction | members whose class changes |
|---|---|---|
| `no_command` | 0.905 | 0.953 |
| `ablate_13A` | 0.804 | 0.594 |
| `ablate_19B` | 0.745 | 0.609 |
| `baseline` | 0.711 | 0 |
| `ablate_13B` | 0.69 | 0.516 |
| `no_commissural` | 0.504 | 0.781 |

## Live rhythms

2 of 64 members. A rhythm counts when the frequency sweep finds a periodicity of at least 0.3 in three or more pools, at a rate inside 5–16 Hz.

| member | axes | periodicity | at | pools | tripod | killed by | command row |
|---|---|---|---|---|---|---|---|
| 9 | commissural x3, 19B gain x2 | 0.306 | 8.25 Hz | 2 | 0.086 | ablate_13B, no_commissural, no_command | passes |
| 49 | commissural x3, tonic 4 mV, proprio delay 20 ms | 0.307 | 7.25 Hz | 3 | -0.17 | ablate_13A, ablate_13B, ablate_19B, no_commissural, no_command | passes |

## What the pools do at baseline

| member | axes | mean Hz | best periodicity | at | class |
|---|---|---|---|---|---|
| 0 | none | 577.5 | 0.205 | 4.75 Hz | noise/mid/some |
| 1 | commissural x3 | 1190.0 | 0.329 | 3.00 Hz | weak/saturated/some |
| 2 | 13A gain x2 | 772.5 | 0.184 | 5.75 Hz | noise/mid/some |
| 3 | commissural x3, 13A gain x2 | 747.5 | 0.404 | 3.00 Hz | weak/mid/none |
| 4 | 13B gain x2 | 427.5 | 0.167 | 8.50 Hz | noise/mid/some |
| 5 | commissural x3, 13B gain x2 | 967.5 | 0.270 | 4.25 Hz | noise/saturated/none |
| 6 | 13A gain x2, 13B gain x2 | 757.5 | 0.180 | 13.25 Hz | noise/mid/some |
| 7 | commissural x3, 13A gain x2, 13B gain x2 | 425.0 | 0.253 | 10.50 Hz | noise/mid/none |
| 8 | 19B gain x2 | 587.5 | 0.198 | 13.00 Hz | noise/mid/none |
| 9 | commissural x3, 19B gain x2 | 732.5 | 0.306 | 8.25 Hz | weak/mid/none |
| 10 | 13A gain x2, 19B gain x2 | 760.0 | 0.201 | 11.25 Hz | noise/mid/some |
| 11 | commissural x3, 13A gain x2, 19B gain x2 | 380.0 | 0.228 | 6.75 Hz | noise/low/none |
| 12 | 13B gain x2, 19B gain x2 | 592.5 | 0.247 | 8.50 Hz | noise/mid/some |
| 13 | commissural x3, 13B gain x2, 19B gain x2 | 897.5 | 0.297 | 2.00 Hz | noise/mid/none |
| 14 | 13A gain x2, 13B gain x2, 19B gain x2 | 790.0 | 0.249 | 10.00 Hz | noise/mid/some |
| 15 | commissural x3, 13A gain x2, 13B gain x2, 19B gain x2 | 342.5 | 0.238 | 8.25 Hz | noise/low/some |
| 16 | tonic 4 mV | 562.5 | 0.229 | 10.75 Hz | noise/mid/none |
| 17 | commissural x3, tonic 4 mV | 1095.0 | 0.221 | 5.25 Hz | noise/saturated/some |
| 18 | 13A gain x2, tonic 4 mV | 860.0 | 0.233 | 4.75 Hz | noise/mid/some |
| 19 | commissural x3, 13A gain x2, tonic 4 mV | 670.0 | 0.262 | 4.25 Hz | noise/mid/some |
| 20 | 13B gain x2, tonic 4 mV | 425.0 | 0.237 | 4.50 Hz | noise/mid/none |
| 21 | commissural x3, 13B gain x2, tonic 4 mV | 1120.0 | 0.213 | 10.00 Hz | noise/saturated/some |
| 22 | 13A gain x2, 13B gain x2, tonic 4 mV | 582.5 | 0.193 | 4.25 Hz | noise/mid/none |
| 23 | commissural x3, 13A gain x2, 13B gain x2, tonic 4 mV | 785.0 | 0.211 | 7.25 Hz | noise/mid/some |
| 24 | 19B gain x2, tonic 4 mV | 560.0 | 0.227 | 14.00 Hz | noise/mid/some |
| 25 | commissural x3, 19B gain x2, tonic 4 mV | 992.5 | 0.221 | 10.75 Hz | noise/saturated/all |
| 26 | 13A gain x2, 19B gain x2, tonic 4 mV | 687.5 | 0.212 | 15.50 Hz | noise/mid/some |
| 27 | commissural x3, 13A gain x2, 19B gain x2, tonic 4 mV | 532.5 | 0.269 | 4.25 Hz | noise/mid/some |
| 28 | 13B gain x2, 19B gain x2, tonic 4 mV | 640.0 | 0.231 | 16.25 Hz | noise/mid/some |
| 29 | commissural x3, 13B gain x2, 19B gain x2, tonic 4 mV | 1227.5 | 0.324 | 4.25 Hz | weak/saturated/some |
| 30 | 13A gain x2, 13B gain x2, 19B gain x2, tonic 4 mV | 580.0 | 0.204 | 2.75 Hz | noise/mid/some |
| 31 | commissural x3, 13A gain x2, 13B gain x2, 19B gain x2, tonic 4 mV | 740.0 | 0.301 | 2.75 Hz | weak/mid/some |
| 32 | proprio delay 20 ms | 560.0 | 0.178 | 14.75 Hz | noise/mid/some |
| 33 | commissural x3, proprio delay 20 ms | 975.0 | 0.243 | 10.00 Hz | noise/saturated/some |
| 34 | 13A gain x2, proprio delay 20 ms | 787.5 | 0.161 | 13.25 Hz | noise/mid/some |
| 35 | commissural x3, 13A gain x2, proprio delay 20 ms | 340.0 | 0.272 | 8.75 Hz | noise/low/some |
| 36 | 13B gain x2, proprio delay 20 ms | 537.5 | 0.146 | 10.00 Hz | noise/mid/none |
| 37 | commissural x3, 13B gain x2, proprio delay 20 ms | 522.5 | 0.254 | 4.00 Hz | noise/mid/some |
| 38 | 13A gain x2, 13B gain x2, proprio delay 20 ms | 805.0 | 0.206 | 4.50 Hz | noise/mid/some |
| 39 | commissural x3, 13A gain x2, 13B gain x2, proprio delay 20 ms | 702.5 | 0.253 | 9.50 Hz | noise/mid/some |
| 40 | 19B gain x2, proprio delay 20 ms | 605.0 | 0.247 | 11.25 Hz | noise/mid/none |
| 41 | commissural x3, 19B gain x2, proprio delay 20 ms | 522.5 | 0.261 | 8.50 Hz | noise/mid/none |
| 42 | 13A gain x2, 19B gain x2, proprio delay 20 ms | 732.5 | 0.202 | 12.75 Hz | noise/mid/some |
| 43 | commissural x3, 13A gain x2, 19B gain x2, proprio delay 20 ms | 337.5 | 0.256 | 8.75 Hz | noise/low/none |
| 44 | 13B gain x2, 19B gain x2, proprio delay 20 ms | 560.0 | 0.230 | 9.00 Hz | noise/mid/some |
| 45 | commissural x3, 13B gain x2, 19B gain x2, proprio delay 20 ms | 452.5 | 0.277 | 11.50 Hz | noise/mid/none |
| 46 | 13A gain x2, 13B gain x2, 19B gain x2, proprio delay 20 ms | 805.0 | 0.183 | 6.75 Hz | noise/mid/some |
| 47 | commissural x3, 13A gain x2, 13B gain x2, 19B gain x2, proprio delay 20 ms | 382.5 | 0.243 | 19.00 Hz | noise/low/none |
| 48 | tonic 4 mV, proprio delay 20 ms | 525.0 | 0.207 | 11.25 Hz | noise/mid/some |
| 49 | commissural x3, tonic 4 mV, proprio delay 20 ms | 1345.0 | 0.307 | 7.25 Hz | weak/saturated/some |
| 50 | 13A gain x2, tonic 4 mV, proprio delay 20 ms | 862.5 | 0.155 | 11.50 Hz | noise/mid/some |
| 51 | commissural x3, 13A gain x2, tonic 4 mV, proprio delay 20 ms | 627.5 | 0.242 | 13.25 Hz | noise/mid/some |
| 52 | 13B gain x2, tonic 4 mV, proprio delay 20 ms | 475.0 | 0.219 | 4.25 Hz | noise/mid/some |
| 53 | commissural x3, 13B gain x2, tonic 4 mV, proprio delay 20 ms | 1182.5 | 0.232 | 10.00 Hz | noise/saturated/none |
| 54 | 13A gain x2, 13B gain x2, tonic 4 mV, proprio delay 20 ms | 592.5 | 0.147 | 4.75 Hz | noise/mid/none |
| 55 | commissural x3, 13A gain x2, 13B gain x2, tonic 4 mV, proprio delay 20 ms | 675.0 | 0.191 | 15.00 Hz | noise/mid/some |
| 56 | 19B gain x2, tonic 4 mV, proprio delay 20 ms | 605.0 | 0.230 | 14.75 Hz | noise/mid/some |
| 57 | commissural x3, 19B gain x2, tonic 4 mV, proprio delay 20 ms | 1112.5 | 0.251 | 15.75 Hz | noise/saturated/some |
| 58 | 13A gain x2, 19B gain x2, tonic 4 mV, proprio delay 20 ms | 632.5 | 0.227 | 3.75 Hz | noise/mid/some |
| 59 | commissural x3, 13A gain x2, 19B gain x2, tonic 4 mV, proprio delay 20 ms | 610.0 | 0.253 | 7.25 Hz | noise/mid/some |
| 60 | 13B gain x2, 19B gain x2, tonic 4 mV, proprio delay 20 ms | 512.5 | 0.221 | 11.25 Hz | noise/mid/some |
| 61 | commissural x3, 13B gain x2, 19B gain x2, tonic 4 mV, proprio delay 20 ms | 1372.5 | 0.250 | 8.00 Hz | noise/saturated/some |
| 62 | 13A gain x2, 13B gain x2, 19B gain x2, tonic 4 mV, proprio delay 20 ms | 580.0 | 0.248 | 6.50 Hz | noise/mid/none |
| 63 | commissural x3, 13A gain x2, 13B gain x2, 19B gain x2, tonic 4 mV, proprio delay 20 ms | 577.5 | 0.399 | 2.25 Hz | weak/mid/none |
