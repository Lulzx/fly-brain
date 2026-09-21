# loom-vs-gait

**Question:** Does the escape gate suppress self-motion false alarms without blunting the real loom response?

**Operators:** gate.ruleVeto, s3.selfMotionCancel

**Split rule:** `loomEscape < 0.5 * baseline.loomEscape && walk > 0.5 * baseline.walk`

Ensemble: 9 members over scaffold.escapeGate.touchMs, scaffold.escapeGate.pivotMs (seed 5)

## Pre-registered observables

| observable | site | measure | value |
|---|---|---|---|
| loomEscape | arena | loomEscape | — |
| walk | arena | walkDist | — |
| forageJumps | arena | forageJumps | — |

## Ranked perturbations

| experiment | separation |
|---|---|
| gate_off | 0 |
| reafference_off | 0 |
| jump_off | 0 |
| obs:loomEscape | 0 |
| obs:walk | 0 |
| obs:forageJumps | 0 |

## Members

| member | params | baseline | kills |
|---|---|---|---|
| 0 | {"scaffold.escapeGate.touchMs":200,"scaffold.escapeGate.pivotMs":100} | loomEscape=1 walk=37.406 forageJumps=1 | reafference_off,jump_off |
| 1 | {"scaffold.escapeGate.touchMs":200,"scaffold.escapeGate.pivotMs":300} | loomEscape=1 walk=37.406 forageJumps=1 | reafference_off,jump_off |
| 2 | {"scaffold.escapeGate.touchMs":200,"scaffold.escapeGate.pivotMs":600} | loomEscape=1 walk=37.406 forageJumps=1 | reafference_off,jump_off |
| 3 | {"scaffold.escapeGate.touchMs":500,"scaffold.escapeGate.pivotMs":100} | loomEscape=1 walk=37.406 forageJumps=1 | reafference_off,jump_off |
| 4 | {"scaffold.escapeGate.touchMs":500,"scaffold.escapeGate.pivotMs":300} | loomEscape=1 walk=37.406 forageJumps=1 | reafference_off,jump_off |
| 5 | {"scaffold.escapeGate.touchMs":500,"scaffold.escapeGate.pivotMs":600} | loomEscape=1 walk=37.406 forageJumps=1 | reafference_off,jump_off |
| 6 | {"scaffold.escapeGate.touchMs":1000,"scaffold.escapeGate.pivotMs":100} | loomEscape=1 walk=37.406 forageJumps=1 | reafference_off,jump_off |
| 7 | {"scaffold.escapeGate.touchMs":1000,"scaffold.escapeGate.pivotMs":300} | loomEscape=1 walk=37.406 forageJumps=1 | reafference_off,jump_off |
| 8 | {"scaffold.escapeGate.touchMs":1000,"scaffold.escapeGate.pivotMs":600} | loomEscape=1 walk=37.406 forageJumps=1 | reafference_off,jump_off |
