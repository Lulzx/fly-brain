# 20. Roadmap

In recommended order.

1. **Pathway-specific fitting.** Fit a few synaptic scale factors along the escape chain (LC4, LPLC2,
   giant fibre, DNp02, DNp04) and the feeding chain (GRNs, GNG232, DNge080, MN9) against looming and
   feeding data, as flyvis did for the optic lobe — the loom chain is now the clearest weak link
   ([Neuromodulation](25-neuromodulation.md) for the OA-gain negative result).
2. ~~Antennal lobe gain control~~ — done: divisive ORN normalisation for GABA_B presynaptic inhibition
   ([Senses](10-senses.md)).
3. ~~Aerodynamic flight~~ — done: blade-element forces on the real 218 Hz stroke ([Flight](24-flight.md)).
   Next level: wing power and steering MNs driving the stroke, or a trained stabiliser.
4. **Wall climbing.** Train or fit a vertical-surface gait so legs can grip walls.
5. **Neuromodulation and state.** AKH/insulin/octopamine are in, the brain is refitted with them on, and
   locomotion drives optic-lobe OA release ([Neuromodulation](25-neuromodulation.md)). Next: dopamine
   gating of feeding, and bout structure from the circuits rather than rules.
6. **Speed.** WebGPU brain kernel is in with a WASM fallback ([WebGPU](27-webgpu.md)); next: sharing the
   device across flies and moving flyvis up too.
7. ~~Social behaviour~~ — done: LC10 visual detection + cVA pheromone → pIP10/DNp13 pursuit and wing
   display through the male fru/dsx circuitry ([Courtship](26-courtship.md)). Next: a female that flees or
   rejects, and real song pulses.
8. ~~Substitution ladder~~ — done: `scripts/ablation_ladder.mjs` drops one level of description at a
   time and re-scores the benchmark, and `scripts/ablation_refit.mjs` refits each ablation so that
   sensitivity can be told apart from necessity ([Ablation ladder](31-ablation-ladder.md)). Next: the
   same two arms against the embodied assays rather than the physiological ones, since posture,
   stepping and bout structure are where [Limitations](19-limitations.md) says the model already
   depends on supplied machinery.
9. **Individual identifiability.** Fit the same connectome separately against two recorded individuals and
   test whether a held-out assay separates the two models in the direction that matches the two animals.
   A negative result would be the more informative one — see the textbook chapter *What Emulating an
   Individual Would Require* (`docs/textbook/16-upload.md`).

10. **Per-connection uncertainty in the fit.** `scripts/synapse_confidence.py` estimates reconstruction
    error from bilateral replicates and emits empirical-Bayes weights
    ([Per-connection uncertainty](32-synapse-uncertainty.md)). They are available to the benchmark as
    an ablation rung; the next step is a fit that weights each connection by its precision instead of
    substituting a point estimate, and a calibration set that reaches the optic lobe, where the
    one-cell-per-side trick does not apply.
11. **Gradient fitting at scale.** `src/lifdiff.js` differentiates the whole CNS and
    `scripts/grad_fit.mjs` fits 165,122 per-neuron gains with it
    ([Differentiable brain](33-differentiable-brain.md)). Next: fit against recorded activity rather
    than literature summary statistics, which is the measurement the identifiability question in
    item 9 needs, and move the backward pass to the WebGPU kernel.
