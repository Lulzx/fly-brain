# 20. Roadmap

Each item says what to build and what would count as success. Where the item is an experiment rather
than an engineering task, it also says what a negative result would mean — an item with no stated
failure mode is engineering, and an item with one is science, where the negative result is often the
more valuable outcome.

The ordering inside each part is by dependency, not by ambition. Part A is reachable from what is
already in the repository. Part B needs data this project does not have but that exists. Part C needs
data nobody has yet, and is stated precisely so that the cost of getting it is visible.

---

## A. Reachable now

### A1. The substitution ladder against behaviour
[Doc 31](31-ablation-ladder.md) runs both arms — sensitivity and refit — against the 17-assay
*physiological* benchmark. The substitutions that [Chapter 16](textbook/16-upload.md) treats as most
informative are behavioural, and they cannot break there, because posture, stepping and bout structure
are supplied by machinery outside the graph ([Limitations](19-limitations.md)).

Build the same two arms over `scripts/behavior_report.mjs` and `scripts/diag_walk.mjs`: five
scenarios, four seeds, scored on flips, deaths, distance to food, feeding latency, bout-length
distribution and escape rate. An embodied evaluation takes ~40 s against 3.3 s for a physiological
one, so a 20-rung by 12-seed sweep is about three hours rather than three minutes, and the refit arm
needs either a cheaper surrogate objective or a reduced rung set.

**Success:** a table with the same shape as doc 31, for behaviour.
**The interesting negative:** if the embodied assays prove *less* sensitive than the physiological
ones, the supplied gait and scheduling machinery is masking the brain's contribution. The model would
be robust for the wrong reason, and the ladder would be measuring the scaffolding rather than the
nervous system.

### A2. Close the supplied-machinery gaps, one at a time
Four behaviours are produced by code rather than read out of the graph. Each is separable work with
the same test: does the behaviour survive when its rule is deleted?

- **Stepping from the nerve cord.** The full-connectome motor mode does not hold posture
  ([Gait](13-gait.md)). Fit the leg premotor circuits against the FlySuite walking data using the
  adjoint from [doc 33](33-differentiable-brain.md), rather than fitting a generator to trajectories.
- **Bout structure from the circuits.** Walk, pause and saccade timing comes from a scheduler whose
  statistics are taken from Maye et al. 2007 and Geurten et al. 2014 ([Behaviour](23-behaviour.md)).
  The candidate substrate is the descending network of Braun et al. 2024.
- **The giant-fibre gap junction.** Added by hand, because the packed chemical graph carries no
  electrical edges. The male CNS release ships no gap-junction table; the IR in
  [doc 29](29-connectome-compiler.md) already carries a second symmetric graph for the worm, so the
  slot exists as soon as a table does.
- **Dopamine gating of feeding** (Marella et al. 2012) — the one major modulator not yet in
  [Neuromodulation](25-neuromodulation.md).

### A3. Pathway-specific fitting, by gradient
The long-standing version of this item proposed fitting a handful of synaptic scale factors along the
escape chain (LC4, LPLC2, giant fibre, DNp02, DNp04) and the feeding chain (GRNs, GNG232, DNge080,
MN9). [Doc 33](33-differentiable-brain.md) makes the scale factors unnecessary: fit a gain on every
neuron in the chain and let the gradient decide where the correction belongs.

The loom chain is the clearest weak link in the model — `loomGF` is 0 in the calibrated fit, so escape
currently rides on DNp02 and DNp04 rather than on the giant fibre, and
[Neuromodulation](25-neuromodulation.md) records that an octopamine gain change did not fix it.

**Success:** giant-fibre escape at a rate matching von Reyn et al. 2014, without the false-alarm term
regressing.

### A4. Uncertainty inside the objective, not beside it
[Doc 32](32-synapse-uncertainty.md) produces a reliability and an empirical-Bayes weight for every
connection, and the benchmark then consumes the weight as a point estimate — throwing away the
uncertainty it just measured. Two steps:

- Weight each connection's contribution to the loss by its precision, so a fit is free to move a
  3-synapse connection and constrained on a 100-synapse one. This matters because doc 31 finds graded
  weight to be the most load-bearing quantity in the model, and doc 32 finds it to be the one the
  reconstruction measures worst.
- Extend the calibration set to the optic lobe. The one-cell-per-side trick covers 6.4% of the CNS and
  excludes every columnar type by construction, so the optic lobe currently inherits a noise model
  fitted elsewhere. Columnar types have a different replicate available: the columns themselves, which
  repeat across the retinotopic array.

### A5. Make the adjoint affordable
The backward pass in `src/lifdiff.js` is dense over neurons and sparse only over spikes, and costs
~6 s per gradient at 200 ms of simulated time. Three compounding wins: the event-driven wake list the
forward WASM kernel already has, the WebGPU kernel ([doc 27](27-webgpu.md)) for the adjoint, and
longer truncation windows once it is cheap enough.

The truncation limit is the one with scientific consequences. At 25 steps the gradient cannot see the
100–200 ms adaptation and neuromodulation timescales at all, which means those parameters are
currently unfittable by gradient — and doc 31 shows the benchmark is sensitive to both.

### A6. A second individual, through the IR
[Doc 29](29-connectome-compiler.md) runs on the fly and the worm. FlyWire (139,255 neurons, adult
female) is the obvious third dataset, and it is more than a count: it is a *different individual of
the same species*, which makes it the only cross-individual comparison available anywhere in this
project.

**Success:** run the generic analyses on both and report which measured structures are conserved
between two individual flies and which are not.
**Why it matters:** this is the cheapest available bound on how much of a connectome is individual
rather than species-typical, which [Chapter 16](textbook/16-upload.md) argues is the load-bearing
question. It is confounded by sex, preparation and reconstruction pipeline — and it is still worth
having, because every one of those confounds pushes toward *over*-estimating individual variation, so
any structure that survives them is a safe finding.

---

## B. Needs data that exists

### B1. Fit against recorded activity, not literature summaries
Every number the calibration is scored against is a summary statistic from published work: a firing
rate, a sparseness fraction, a rhythm index. The nine-parameter fit reaches a composite of 0.746
against them, and [Chapter 16](textbook/16-upload.md) argues that this procedure can only ever produce
a species-typical animal.

Pan-neuronal calcium imaging in behaving flies makes a different objective possible: predict held-out
activity, per neuron, per time point. That is the objective flyvis was trained on for the optic lobe,
and the reason it predicts single-neuron responses ([Vision](11-vision.md)).

**Success:** held-out correlation above chance on neurons not used in fitting, reported per cell type.
**The interesting negative:** a model that fits the recording well and predicts held-out neurons at
chance would mean the 165,122 gains are absorbing the recording rather than learning the circuit. That
is the overfitting failure mode the identifiability experiment in C1 would then inherit, so it is
worth finding here, where it is cheap.

### B2. Register recordings to connectome neurons
B1 has a prerequisite that is a substantial project in itself. Calcium imaging gives a voxel; the
connectome gives a skeleton. Matching them at the level of cell types is tractable now. Matching them
at the level of individual cells is the hard version — and it is the one C1 needs, because a
cell-type-level registration can only ever identify a species-typical model.

### B3. The ladder in a second species
The IR runs on *C. elegans* ([doc 29](29-connectome-compiler.md)), which has a complete connectome, a
body model, and a century of behavioural data. Running both ladder arms there answers whether the
abstraction-level findings in [doc 31](31-ablation-ladder.md) are facts about nervous systems or facts
about this fly model.

Axonal delay turning out to be the least compensable mechanism in a 302-neuron animal with a 1 mm body
would be a strong result. Its absence would be equally informative, and would localise doc 31's
finding to circuits of this size and speed.

---

## C. The long program

These are the items the textbook argues are decisive. They are stated with their costs visible rather
than as aspirations.

### C1. Individual identifiability
Fit the same connectome separately against recordings from two individuals, then test whether a
held-out behavioural assay separates the two resulting models in the direction that matches the two
animals. Per [Chapter 15](textbook/15-synthesis.md), the assay and the observable must be fixed before
the comparison, or the result is a consistency check rather than a test.

This is the experiment the rest of the roadmap exists to make possible. It needs the gradient (A5),
the activity objective (B1), per-cell registration (B2), and two animals recorded densely enough and
long enough that the functional record carries individual-specific information.

**The negative result is the valuable one.** If a held-out assay cannot separate the two models, then
the parameters recoverable this way are dominated by species-typical structure, and individuation
requires either a different measurement or a level of description the current representation cannot
express. That is a real answer to a question the upload literature generally assumes away, and it is
reachable at fly scale for a small fraction of what the same question costs at any larger one.

### C2. Design the validation before there is anything to validate
What test would convince a skeptic that a model is *that* animal and not a plausible stranger? This is
a harder design problem than it looks, and the honest time to solve it is before anyone holds a
candidate model, because a test designed afterwards can always be tuned until it passes.

Concretely: specify the assay, the observable, the number of animals, the held-out split, and the
effect size that would count — and commit them to the repository before C1 runs.
[Hypothesis lab](30-hypothesis-lab.md) already ranks experiments by how well they discriminate between
model ensembles; the missing piece is pointing it at individuals rather than at mechanisms.

### C3. A scan-to-model compiler with uncertainty end to end
[Doc 29](29-connectome-compiler.md) starts at a published table, and [doc 32](32-synapse-uncertainty.md)
estimates uncertainty after the fact. The full version starts at raw electron micrographs —
segmentation, synapse detection, proofreading — and carries a confidence per synapse forward into the
fit, so the model knows what to trust for reasons the pipeline can state rather than reasons a
modeller inferred from symmetry.

Proofreading is the part that does not scale. FlyWire took roughly a decade of consortium effort for
139,255 neurons. The mouse, at ~71 million neurons, is the scale at which human proofreading stops
being affordable and the pipeline has to be trusted without a human in the loop — which makes
automated proofreading, and a calibrated confidence attached to its output, the load-bearing problem
rather than the imaging.

**Why it belongs here even though it is out of reach in this repository:** the estimate in doc 32 is a
lower bound derived from bilateral symmetry, and it exists only because the pipeline discarded its own
confidence upstream. A pipeline that kept it would make that entire document unnecessary. That is an
argument for building the pipeline, not for improving the workaround.

---

## Done

- ~~**Antennal lobe gain control**~~ — divisive ORN normalisation for GABA_B presynaptic inhibition
  ([Senses](10-senses.md)).
- ~~**Aerodynamic flight**~~ — blade-element forces on the real 218 Hz stroke ([Flight](24-flight.md)).
  Next level: wing power and steering motor neurons driving the stroke, or a trained stabiliser.
- ~~**Social behaviour**~~ — LC10 visual detection and cVA pheromone driving pIP10/DNp13 pursuit and
  wing display through the male *fru*/*dsx* circuitry ([Courtship](26-courtship.md)). Next: a female
  that flees or rejects, and real song pulses.
- ~~**Neuromodulation**~~ — AKH, insulin and octopamine are in, the brain is refitted with them on, and
  locomotion drives optic-lobe octopamine release ([Neuromodulation](25-neuromodulation.md)). Dopamine
  gating of feeding remains, as A2.
- ~~**Speed**~~ — WebGPU brain kernel with a WASM fallback ([WebGPU](27-webgpu.md)). Next: sharing the
  device across flies, and moving flyvis onto it too.
- ~~**Substitution ladder**~~ — both arms, sensitivity and refit
  ([Ablation ladder](31-ablation-ladder.md)). The embodied version is A1.
- ~~**Per-connection uncertainty**~~ — estimated from bilateral replicates
  ([doc 32](32-synapse-uncertainty.md)). Putting it inside the objective is A4.
- ~~**Differentiable whole-brain model**~~ — `src/lifdiff.js` and a verified adjoint
  ([doc 33](33-differentiable-brain.md)). Making it affordable is A5; using it on recordings is B1.

## Open, not yet scheduled

- **Wall climbing.** Train or fit a vertical-surface gait so the legs can grip walls.
- **A female fly.** The male CNS connectome is the only whole-CNS release, so courtship currently plays
  against a target that cannot respond.
- **Learning.** Nothing in the model changes with experience. The mushroom body is wired for it
  ([textbook chapter 11](textbook/11-mushroom-body.md)), and the dopaminergic compartments that would
  gate plasticity are in the graph but static. This is the largest single capability the model lacks,
  and it is also the one that would most complicate every fitting procedure above, since a plastic
  model's parameters are no longer constants to be fitted.
