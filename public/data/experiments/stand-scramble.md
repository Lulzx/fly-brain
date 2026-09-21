# stand-scramble

**Question:** Which scaffolds does standing need — and does scrambling the premotor graph destroy what the CPG supplies?

**Operators:** vnc.posture, cpg.pattern

**Split rule:** `standUpright < 0.5 * baseline.standUpright`

Ensemble: 9 members over scaffold.cpg.pivotAmp, scaffold.steeringAdapt.turnAdaptTau (seed 2)

## Pre-registered observables

| observable | site | measure | value |
|---|---|---|---|
| standUpright | arena | standUpright | — |
| walk | arena | walkDist | — |

## Ranked perturbations

| experiment | separation |
|---|---|
| cpg_off | 0 |
| righting_off | 0 |
| steering_off | 0 |
| obs:standUpright | 0 |
| obs:walk | 0 |

Skipped (no backend yet): premotor_scramble

## Members

| member | params | baseline | kills |
|---|---|---|---|
| 0 | {"scaffold.cpg.pivotAmp":0.05,"scaffold.steeringAdapt.turnAdaptTau":0.3} | standUpright=1 walk=13.168 | - |
| 1 | {"scaffold.cpg.pivotAmp":0.05,"scaffold.steeringAdapt.turnAdaptTau":1} | standUpright=1 walk=13.299 | - |
| 2 | {"scaffold.cpg.pivotAmp":0.05,"scaffold.steeringAdapt.turnAdaptTau":3} | standUpright=1 walk=13.974 | - |
| 3 | {"scaffold.cpg.pivotAmp":0.1,"scaffold.steeringAdapt.turnAdaptTau":0.3} | standUpright=1 walk=13.168 | - |
| 4 | {"scaffold.cpg.pivotAmp":0.1,"scaffold.steeringAdapt.turnAdaptTau":1} | standUpright=1 walk=13.299 | - |
| 5 | {"scaffold.cpg.pivotAmp":0.1,"scaffold.steeringAdapt.turnAdaptTau":3} | standUpright=1 walk=13.974 | - |
| 6 | {"scaffold.cpg.pivotAmp":0.2,"scaffold.steeringAdapt.turnAdaptTau":0.3} | standUpright=1 walk=13.168 | - |
| 7 | {"scaffold.cpg.pivotAmp":0.2,"scaffold.steeringAdapt.turnAdaptTau":1} | standUpright=1 walk=13.299 | - |
| 8 | {"scaffold.cpg.pivotAmp":0.2,"scaffold.steeringAdapt.turnAdaptTau":3} | standUpright=1 walk=13.974 | - |
