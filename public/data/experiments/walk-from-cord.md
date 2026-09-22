# walk-from-cord

**Question:** Which cord mechanism carries the leg rhythm the motor neurons produce when they drive the legs directly, and does the real wiring carry it where a weight-shuffled wiring does not?

**Operators:** cord.premotorInhibition, cord.commissural, reflex.footfallCancel

**Split rule:** `cadence < 0.5 * baseline.cadence && legsStepping < baseline.legsStepping`

Ensemble: 8 members over wiring, inhGain, edges.commissural (seed 8)

## Pre-registered observables

| observable | site | measure | value |
|---|---|---|---|
| cadence | arena | gait.cadence | 1.053 |
| legsStepping | arena | gait.legsStepping | 3 |
| duty | arena | gait.duty | 0.243 |
| contraPhase | arena | gait.contraPhase | 0.22 |
| tripod | arena | gait.tripod | 0.037 |
| upright | arena | gait.upright | 0.883 |
| bodyHeightRel | arena | gait.bodyHeightRel | 1.043 |
| speed | arena | gait.speed | 0.224 |
| loadRhythm | arena | gait.loadRhythm | 0.167 |
| cpgCadence | arena | gait.cadence {"assay":"walk_cpg"} | 6.842 |
| cpgContra | arena | gait.contraPhase {"assay":"walk_cpg"} | 0.498 |

## Ranked perturbations

| experiment | separation |
|---|---|
| obs:upright | 0.679 |
| obs:bodyHeightRel | 0.679 |
| obs:legsStepping | 0.607 |
| obs:duty | 0.607 |
| obs:contraPhase | 0.607 |
| obs:speed | 0.571 |
| obs:cadence | 0.536 |
| obs:tripod | 0.536 |
| obs:cpgCadence | 0.536 |
| no_reafference | 0.429 |
| obs:loadRhythm | 0.429 |
| no_commissural | 0.25 |
| no_13A | 0 |
| no_13B | 0 |
| no_19B | 0 |
| obs:cpgContra | 0 |

## Members

| member | params | baseline | kills |
|---|---|---|---|
| 0 | {"wiring":"real","inhGain":0.577,"edges.commissural":1} | cadence=1.053 legsStepping=5 duty=0.236 contraPhase=0.653 tripod=0.037 upright=0.029 bodyHeightRel=0.8 speed=0.565 loadRhythm=0.171 cpgCadence=8.158 cpgContra=0.496 | - |
| 1 | {"wiring":"real","inhGain":0.577,"edges.commissural":3} | cadence=3.421 legsStepping=3 duty=0.078 contraPhase=— tripod=-0.039 upright=0.002 bodyHeightRel=0.458 speed=0.114 loadRhythm=0.066 cpgCadence=8.684 cpgContra=0.486 | no_reafference |
| 2 | {"wiring":"real","inhGain":1,"edges.commissural":1} | cadence=1.579 legsStepping=6 duty=0.839 contraPhase=0.01 tripod=-0.183 upright=0.983 bodyHeightRel=0.652 speed=0.073 loadRhythm=0.202 cpgCadence=6.842 cpgContra=0.503 | no_commissural |
| 3 | {"wiring":"real","inhGain":1,"edges.commissural":3} | cadence=0.789 legsStepping=3 duty=0.061 contraPhase=0.297 tripod=0.377 upright=0.012 bodyHeightRel=0.73 speed=0.187 loadRhythm=0.374 cpgCadence=6.842 cpgContra=0.499 | - |
| 4 | {"wiring":"weightShuffle","inhGain":0.577,"edges.commissural":1} | cadence=2.105 legsStepping=3 duty=0.549 contraPhase=0.175 tripod=0.318 upright=0.883 bodyHeightRel=1.043 speed=0.227 loadRhythm=0.153 cpgCadence=3.684 cpgContra=0.463 | no_reafference |
| 5 | {"wiring":"weightShuffle","inhGain":0.577,"edges.commissural":3} | cadence=0.526 legsStepping=1 duty=0.141 contraPhase=0 tripod=0.008 upright=1 bodyHeightRel=1.983 speed=0.566 loadRhythm=0.167 cpgCadence=3.947 cpgContra=0.483 | - |
| 6 | {"wiring":"weightShuffle","inhGain":1,"edges.commissural":1} | cadence=1.053 legsStepping=3 duty=0.854 contraPhase=0.826 tripod=0.267 upright=0.285 bodyHeightRel=1.049 speed=0.013 loadRhythm=0.073 cpgCadence=5.526 cpgContra=0.498 | - |
| 7 | {"wiring":"weightShuffle","inhGain":1,"edges.commissural":3} | cadence=0.789 legsStepping=2 duty=0.243 contraPhase=0.22 tripod=-0.03 upright=0.988 bodyHeightRel=2.621 speed=0.224 loadRhythm=0.166 cpgCadence=3.947 cpgContra=0.509 | - |

## Perturbed reads

### no_13A

| member | cadence | legsStepping | duty | contraPhase | tripod | upright | bodyHeightRel | speed | loadRhythm | cpgCadence | cpgContra | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.789 | 3 | 0.103 | 0.997 | 0.117 | 0.036 | 0.557 | 0.286 | 0.262 | 8.684 | 0.488 |  |
| 1 | 3.421 | 4 | 0.193 | 0.32 | 0.036 | 0 | 0.301 | 0.029 | 0.098 | 4.474 | 0.506 |  |
| 2 | 7.105 | 3 | 0.273 | 0.127 | 0.106 | 0.01 | 0.54 | 0.349 | 0.086 | 6.842 | 0.499 |  |
| 3 | 5 | 2 | 0.467 | — | 0.314 | 0.002 | 0.494 | 0.27 | 0.03 | 6.579 | 0.497 |  |
| 4 | 1.316 | 5 | 0.365 | 0.846 | -0.096 | 0.377 | 0.655 | 0.402 | 0.177 | 3.947 | 0.484 |  |
| 5 | 0.789 | 5 | 0.329 | 0.049 | -0.127 | 0.871 | 1.845 | 0.521 | 0.258 | 3.684 | 0.476 |  |
| 6 | 6.316 | 2 | 0.624 | 0.4 | 0.356 | 0 | 0.701 | 0.131 | 0.053 | 5.789 | 0.507 |  |
| 7 | 4.474 | 4 | 0.679 | 0.895 | -0.135 | 0.898 | 0.921 | 0.027 | 0.125 | 5.263 | 0.513 |  |

### no_13B

| member | cadence | legsStepping | duty | contraPhase | tripod | upright | bodyHeightRel | speed | loadRhythm | cpgCadence | cpgContra | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1.579 | 6 | 0.499 | 0.999 | -0.017 | 0.088 | 0.638 | 0.314 | 0.106 | 8.421 | 0.486 |  |
| 1 | 2.895 | 6 | 0.259 | 0.062 | -0.021 | 0 | 0.34 | 0.047 | 0.132 | 8.684 | 0.48 |  |
| 2 | 1.316 | 5 | 0.781 | 0.2 | -0.045 | 0.93 | 0.656 | 0.35 | 0.252 | 6.053 | 0.509 |  |
| 3 | 1.053 | 2 | 0.432 | — | — | 0 | 0.623 | 0.13 | 0.073 | 6.316 | 0.493 |  |
| 4 | 5 | 2 | 0.925 | — | — | 0 | 0.746 | 0.262 | 0 | 4.211 | 0.466 |  |
| 5 | 3.421 | 3 | 0.338 | — | -0.068 | 0.002 | 0.551 | 0.393 | 0.1 | 3.684 | 0.478 |  |
| 6 | 1.842 | 1 | 0.811 | — | 0.611 | 0.353 | 1.031 | 0.015 | 0 | 6.053 | 0.49 |  |
| 7 | 0.526 | 0 | 0.147 | 0.861 | — | 1 | 3.369 | 0.471 | 0.145 | 5.263 | 0.484 |  |

### no_19B

| member | cadence | legsStepping | duty | contraPhase | tripod | upright | bodyHeightRel | speed | loadRhythm | cpgCadence | cpgContra | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2.895 | 6 | 0.464 | 0.189 | 0.052 | 0.149 | 0.596 | 0.332 | 0.106 | 4.211 | 0.493 |  |
| 1 | 1.579 | 6 | 0.178 | 0.127 | -0.006 | 0.099 | 0.713 | 0.072 | 0.143 | 8.158 | 0.489 |  |
| 2 | 1.316 | 5 | 0.496 | 0.524 | 0.248 | 1 | 1.147 | 0.039 | 0.176 | 6.316 | 0.502 |  |
| 3 | 4.211 | 3 | 0.643 | 0.28 | -0.244 | 0.346 | 0.643 | 0.018 | 0.104 | 6.579 | 0.499 |  |
| 4 | 2.105 | 2 | 0.655 | — | — | 0.008 | 0.727 | 0.286 | 0.062 | 3.947 | 0.48 |  |
| 5 | 0.526 | 0 | 0.071 | 0.977 | -0.027 | 1 | 1.971 | 0.543 | 0.295 | 3.684 | 0.48 |  |
| 6 | 1.842 | 3 | 0.679 | 0.373 | 0.287 | 0.471 | 1.042 | 0.343 | 0.162 | 7.105 | 0.489 |  |
| 7 | 1.579 | 4 | 0.462 | 0.928 | 0.013 | 1 | 1.086 | 0.486 | 0.259 | 7.632 | 0.481 |  |

### no_commissural

| member | cadence | legsStepping | duty | contraPhase | tripod | upright | bodyHeightRel | speed | loadRhythm | cpgCadence | cpgContra | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 3.158 | 5 | 0.84 | 0.996 | -0.12 | 0.524 | 0.568 | 0.006 | 0.082 | 5 | 0.489 |  |
| 1 | 3.158 | 5 | 0.84 | 0.996 | -0.12 | 0.524 | 0.568 | 0.006 | 0.082 | 5 | 0.489 |  |
| 2 | 0.526 | 2 | 0.337 | 0.497 | 0.035 | 0.995 | 0.695 | 0.026 | 0.294 | 6.053 | 0.5 | yes |
| 3 | 0.526 | 2 | 0.337 | 0.497 | 0.035 | 0.995 | 0.695 | 0.026 | 0.294 | 6.053 | 0.5 |  |
| 4 | 1.053 | 4 | 0.499 | 0.094 | 0.076 | 0.978 | 1.162 | 0.234 | 0.261 | 3.684 | 0.448 |  |
| 5 | 1.053 | 4 | 0.499 | 0.094 | 0.076 | 0.978 | 1.162 | 0.234 | 0.261 | 3.684 | 0.448 |  |
| 6 | 1.053 | 3 | 0.556 | — | 0.181 | 0.654 | 1.012 | 0.176 | 0.028 | 5.263 | 0.514 |  |
| 7 | 1.053 | 3 | 0.556 | — | 0.181 | 0.654 | 1.012 | 0.176 | 0.028 | 5.263 | 0.514 |  |

### no_reafference

| member | cadence | legsStepping | duty | contraPhase | tripod | upright | bodyHeightRel | speed | loadRhythm | cpgCadence | cpgContra | kills |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1.316 | 5 | 0.196 | 0.116 | -0.141 | 0.137 | 0.752 | 0.184 | 0.156 | 7.368 | 0.48 |  |
| 1 | 0.789 | 1 | 0.017 | — | — | 0.002 | 0.705 | 0.162 | 0 | 8.421 | 0.502 | yes |
| 2 | 0.789 | 2 | 0.669 | 0.669 | — | 1 | 0.598 | 0.045 | 0.107 | 6.053 | 0.5 |  |
| 3 | 4.737 | 4 | 0.299 | 0.11 | -0.052 | 0.1 | 0.669 | 0.066 | 0.139 | 8.158 | 0.5 |  |
| 4 | 0.789 | 1 | 0.19 | — | — | 0.025 | 1.27 | 0.707 | 0 | 4.211 | 0.471 | yes |
| 5 | 0.526 | 1 | 0.395 | 0 | 0 | 1 | 2.022 | 0.564 | 0.263 | 3.947 | 0.482 |  |
| 6 | 0.526 | 1 | 0.529 | 0 | -0.14 | 0.256 | 1.055 | 0.019 | 0.05 | 6.053 | 0.486 |  |
| 7 | 2.368 | 5 | 0.404 | — | — | 0.289 | 0.713 | 0.431 | 0.072 | 5.526 | 0.528 |  |

