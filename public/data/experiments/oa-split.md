# oa-split

**Question:** Which octopamine operator — threshold field, gain field, or typed targets — explains hunger-modulated locomotion?

**Operators:** oa.thrField, oa.gainField, oa.thrTyped

**Split rule:** `starveDist < 0.5 * baseline.starveDist && walk > 0.5 * baseline.walk`

Ensemble: 5 members over oaLevel (seed 5)

## Ranked perturbations

| experiment | separation |
|---|---|

Skipped (no backend yet): oa_silence, oa_gain_half

## Members

| member | params | baseline | kills |
|---|---|---|---|
