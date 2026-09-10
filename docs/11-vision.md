# 11. Vision

Files: `src/sim/vision.js`, `src/flyvis.js`, `scripts/prep_flyvis_map.py`.

## Model
flyvis (Lappalainen et al. 2024, MIT), model `flow/0000/000`: 45,669 nodes across 65 cell types on a
721-column hex lattice per eye, 1.5 M synapses, trained on optic flow.
Dynamics: v += dt ÷ max(τ, dt) × (−v + bias + Σ w·relu(v_pre) + input), with 20 ms steps.

Exported to `public/vision/flyvis.bin` and validated against PyTorch to 2 × 10⁻⁶.

## Lattice orientation
Fixed from the trained direction selectivity. T4a prefers leftward image motion and is biologically
front-to-back, so image-right is anterior. T4c prefers upward image motion, so image-up is dorsal.

## Mapping model nodes to connectome neurons
1. Photoreceptor directions come from the [body map](09-bodymap.md).
2. Directions propagate through same-side connections among columnar types for 8 passes, reaching
   67,083 neurons.
3. Each type is rescaled to the eye's field, then matched to the flyvis node of the same type in its column.

About 62,000 neurons are mapped. The propagated columns correlate with the dataset's own hex coordinates
at |r| up to 0.87. About 410 of 721 model columns are used, because the real eye is not a regular hexagon.

## Runtime
- Each eye casts 721 rays from the head with MuJoCo's `mj_multiRay`.
- Luminance comes from surface albedo: checkered floor, striped wall, dark obstacles and flies.
- flyvis steps at 50 Hz after settling on the scene.
- Mapped neurons fire at gain × (activity − resting activity under uniform grey). Using the deviation from
  rest avoids tonic flooding of the brain.
- Mapped neurons are masked from recurrent input so the optic lobe is not computed twice.
- Photoreceptors fire from the luminance of their nearest column, with 300 ms light adaptation.

## Gain
Gain 150 is the default. At 250 looming escape became reliable but walking produced frequent false escapes.
