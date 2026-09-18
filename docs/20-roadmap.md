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

### A3. Pathway-specific fitting, by gradient — the goal was met, and not by a gradient
The long-standing version of this item proposed fitting a handful of synaptic scale factors along the
escape chain (LC4, LPLC2, giant fibre, DNp02, DNp04) and the feeding chain (GRNs, GNG232, DNge080,
MN9). [Doc 33](33-differentiable-brain.md) makes the scale factors unnecessary: fit a gain on every
neuron in the chain and let the gradient decide where the correction belongs.

The premise was that `loomGF` is 0 — escape riding on DNp02 and DNp04 rather than on the giant fibre,
and [Neuromodulation](25-neuromodulation.md) recording that an octopamine gain change did not fix it.
That premise was false, and in the way most likely to be mistaken for a modelling failure: the
benchmark was measuring a number that could not move. Photoreceptors are histaminergic, so driving them
inhibits L1–L5 rather than exciting them, and the lamina relay is silent at every stage — but the
photoreceptor-driven block wrote its `loomGF` over the flyvis-driven measurement above it, so 60% of
the loom term's weight was reading a structurally-zero quantity and the fit was being told that zero was
correct. [Doc 31](31-ablation-ladder.md) was already carrying the symptom without recognising it:
`no_delay` broke the loom term hardest of any ablation, which is not what a dead term looks like.

Repairing the benchmark and refitting the nine globals puts `loomGF` at 1.0–2.0 spikes per neuron
against von Reyn et al. 2014's 1–3, with `flowGF` at 0 in all twelve seeds — the stated success
criterion, reached by the population search rather than by the per-neuron gradient this item proposed.
The per-neuron gradient is still the right tool for the feeding chain and for anything the nine globals
cannot reach, but it is now a method in search of a target rather than a fix for a known break, and it
belongs with [B1](20-roadmap.md) and [C1](20-roadmap.md) where there is an objective with enough
dimensions to need it.

**What the repair did not fix** is the subject of A7 below.

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

### A5. Make the adjoint affordable — partly done, and the measurement changed the item
The three wins this item proposed have now been measured
([doc 33](33-differentiable-brain.md#truncation-was-not-necessary-and-was-the-largest-source-of-error-in-the-fit)),
and two of them do not survive:

- **Longer truncation windows — done, and it was never a cost problem.** The premise that the adjoint
  diverges without truncation is false: at 20,000 neurons and 1.6 M connections over 150 ms the adjoint
  stays finite and matches central finite differences to better than 1e-2, while a 25-step window is
  wrong by up to 76% (and once by a factor of 13 with the wrong sign). Truncation was pure bias, and it
  costs nothing to remove — the backward pass is 1,389 ms with the full window against 1,416 ms with a
  25-step one. The default is now no truncation, in `src/lifdiff.js` and in `scripts/grad_fit.mjs`.
  This was the scientifically consequential half of the item and it is closed.
- **The event-driven wake list is worth much less than it looks.** The surrogate derivative is evaluated
  at every neuron, spiking or not, so the adjoint's sparsity is set by how far back the loss reaches
  rather than by how active the network is. Measured on the whole CNS, the adjoint state is nonzero at
  3.5% of neurons per step with a 25-step window and 13.3% with the full window — bounded at ~7× the
  neuron loops, and nothing at all on the CSR traversal, which is not neuron-indexed.
- **WebGPU for the adjoint** ([doc 27](27-webgpu.md)) is what is left, and it is still the right target:
  the remaining cost is one pass over eleven 165,122-element arrays per step plus a scatter over 10.5 M
  edges, both of which are exactly the shape a GPU wants.

**What success would now look like:** the WebGPU adjoint, at which point a gradient over 165,122
parameters costs less than one benchmark evaluation rather than two.

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

### A7. One scored term was arithmetically pinned, and two were reading the baseline — repaired, and the repair has a failure mode
Starting from the [ladder](31-ablation-ladder.md)'s list of terms that never leave zero. In all twelve
seeds at the fitted point and in every rung, `kcSpecific`, `pnSpecific` and `quietMN9` are exactly zero.
(`quietMN9` is a separate and probably genuine failure — the proboscis motor neuron sits at 31 Hz with
no tastant present — and is not part of this item.)

**The first cause is a bug in the benchmark, not in the model.** `kcSpecific` compares the Kenyon cells
active under DM1 with those active under VA2, and the two runs were made in a single expression:

```js
const a = sim(cfg, [...base, [DM1, 80]], 400), b = sim(cfg, [...base, [VA2, 80]], 400);
```

Every `LIFWasm` is laid out at the same base of the one shared `WebAssembly.Memory`, so
`a.net.spikeCount` and `b.net.spikeCount` are two views of the same `Uint32Array`. Reading counts off
both compares a run with itself. The two Kenyon-cell sets were therefore identical in every evaluation
this project has ever run, and `kcJaccard` came out as 1.000 to three decimals — which is what gave it
away, since a genuine Jaccard between two different odour responses landing on exactly 1.000 every time
is not a result, it is a signature.

**The second cause is the same class as A3.** Both terms thresholded a **raw** spike count at more than
one spike in 400 ms — 2.5 Hz — and the 6 Hz baseline drive the benchmark puts on every ORN already
carries most of the antennal lobe past that before any odour arrives:

| | raw | odour-evoked |
|---|---|---|
| `Jaccard(DM1, VA2)` over Kenyon cells | 0.790 | **0.212** |
| Kenyon cells responding to DM1 | 5.7% | 2.5% |
| antennal-lobe PNs responding to DM1 | 72.0% | **41.4%** |

So even with the aliasing repaired, the terms were scoring whether two nearly identical baseline sets
are nearly identical.

Scoring baseline-subtracted counts instead — the ordinary definition of an odour-evoked response, with
the three runs forced to share a seed so the subtraction measures the odour and not the Poisson draw —
leaves all three quantities inside their ranges at the *unrefitted* parameters:

| | before | after |
|---|---|---|
| `kcJaccard` | 1.000 (pinned) | 0.212 |
| `pnFrac` | 0.724 | 0.414 |
| `kcFrac` | 0.057 | 0.025 |
| `kcSpecific` | 0.000 | 0.646 |
| `pnSpecific` | 0.000 | 0.272 |
| `kcSparse` | 0.822 | 0.430 |

Only `quietMN9` is still pinned at zero. Three of the seventeen terms were measuring nothing, and the
composite the rest of this repository quotes — 0.754 — was a composite of the fourteen that worked.
Re-scored on the repaired objective the same parameters give 0.755, so the repair is not itself a gain;
it is a change in what is being counted.

The model's odour coding was specific all along, and the wiring says so independently: DM1 projects
directly to 28 of 686 projection neurons (4.1%), VA2 to 19 (2.8%), and the two target sets overlap at
Jaccard 0.15. The DM1-innervated neurons fire at 5.45 Hz against 1.03 Hz for everything else.

**Refitting against the repaired objective** settles the first of the two open questions and sharpens
the second. Twenty generations of twenty-four, same search as every other fit here: the winner selects
at 0.838 on one seed and re-scores at **0.786 ± 0.006** across twelve. Against the previous fit's
0.754 ± 0.005 that is **+0.026 ± 0.008 paired over the same twelve seeds** — about two thirds of the
0.04 of weight the two repaired terms carry, with `kcSpecific` landing at 0.46 and `pnSpecific` at
0.50. The terms were not unreachable; the old fit had simply never been shown a gradient that pointed
at them. `kcSparse`'s 8% target is reachable too — the refit reaches a 12.2% mean evoked Kenyon-cell
fraction — so the target was not the problem either.

**What the refit did instead is the real finding.** It bought the specificity partly by making the
population busier: baseline Kenyon-cell activity went from 5.1% of cells above one spike to 22.8%, and
the baseline-activity term fell from 0.459 to 0.393. The two repaired terms count per-neuron threshold
crossings in `max(0, odour − baseline)`, and at a high baseline most such crossings are Poisson
turnover rather than response. The arithmetic makes it unambiguous: DM1 lifts the raw Kenyon-cell
fraction by 1.7 points, 22.79% to 24.47%, while the evoked measure calls 12.2% of the population
responsive — seven times the whole net change. A response measure cannot exceed the population change
it is measuring by that factor, so the honest reading is that the repaired term is *satisfiable by an
active baseline*, and the fit found the loose joint rather than the odour code. The Jaccard between
the DM1 and VA2 Kenyon-cell sets agrees: it is a set comparison rather than a rate, and it rose with
the baseline, from 0.212 to 0.323, which is what two independently-thresholded sets do when more of
both populations is crossing threshold for reasons that have nothing to do with the odour.

So the composite improved, the dead terms are alive, and the repaired measure has a failure mode that
was not visible until something was fitted against it. That is the same lesson as the original bug at
one remove: an objective term that cannot be moved hides one kind of error, and a term that can be
moved by the wrong thing hides another. Fixing it means either bounding the evoked count by the raw
increase — a neuron cannot respond more than the population rate rose — or scoring specificity on the
signed population change rather than on per-neuron crossings. It is worth doing before B1, because the
same construction would otherwise be inherited by the per-neuron activity objective that item proposes.

**The second open question is unchanged.** `quietMN9` — the proboscis motor neuron runs at 26.6 Hz with
no tastant, against a target of 10 — is still the only term at exactly zero in every seed. Note that it
is also the one term in the objective that punishes a busy baseline, and it is the one the fit cannot
satisfy; the two facts are probably related, and separating them is the same piece of work.

**Why it was worth doing before B1:** the objective is the thing every fit in this repository is
measured against. Nothing downstream of it means what it says until the terms in it can move.

### A7 continued — the repair was measured, and the measurement moved the loophole twice

The paragraph above ends by naming the failure mode and proposing two fixes. Both were built, and
building them turned up a third problem that neither the original bug nor the first repair could see.

**The response criterion was not a criterion.** `ev > 1` is the same threshold at 0.5 Hz and at 50 Hz,
so at the 6 Hz baseline drive it is a test of Poisson turnover rather than of response. Measured at the
fitted point: **23% of Kenyon cells and 72% of ALPNs clear it with no odour applied**, and two
independently seeded *baseline* runs agree at Jaccard 0.925. Under it DM1 was credited with 18.4% of
Kenyon cells and 60.5% of ALPNs while the raw population fraction rose by **2.1 and 0.6 points** — an
overshoot of eightfold, and inflatable, because raising the baseline raises the count without raising
the bound. That is the mechanism by which the first refit collected 0.786.

The replacement counts a neuron as responding when its evoked increase exceeds **three Poisson sigmas
of its own baseline**, plus a cap at the population's total evoked count over the same number of
sigmas — the correct form of the "cannot respond more than the population changed" bound, since a
cell crossing the threshold and another falling back cancel in a fraction and not in a total. The bar
now scales with the baseline, and **the null collapses to zero**: at the fitted point 1.3% of Kenyon
cells and 0.27% of ALPNs respond to DM1, against no Kenyon cells and 0.17% of ALPNs for a second
baseline run. The smaller numbers are the supported ones — DM1 drives 28 of 686 ALPNs (4.1%) directly
in the wiring — and both layers come out *sparser* than their targets, which is the opposite of what
the fixed threshold reported.

**Which is where the loophole turned out to have moved rather than closed.** Sparseness was still
scored as the fraction of cells crossing the bar, and that fraction can be bought by making the layer
more excitable. A refit against the repaired objective did exactly that: baseline Kenyon-cell activity
rose from 23% of cells to **62%**, the crossing fraction doubled (0.015 to 0.030) — and the response it
bought is *broader and weaker*, so a scale-invariant measure of the same thing went the other way,
from 0.163 to 0.364. The effective number of responding cells, `(Σe)²/Σe²`, is invariant to the
amplitude of the odour response, so no gain change can move it; only concentrating the response can.
Scoring that instead — target 0.08, the imaging literature's sparseness for a food odour — closes the
route, and the same parameters that gamed the fraction measure score 0.24 on it.

**The repaired objective is more sensitive, not merely different.** It moves the composite for the
unchanged fitted parameters from 0.786 to **0.794 ± 0.005** across twelve seeds, and the
[substitution ladder](31-ablation-ladder.md) run under it keeps the same ordering while every
substantial rung costs more: `w_binary` −0.407 to −0.459, `w_shuffle` −0.344 to −0.392,
`no_size_scaling` −0.269 to −0.327, `cuba` −0.245 to −0.325. The assays that were pinned now register:
`pnSpecific` breaks under five rungs where it was previously incapable of moving, and `dm1PN` under
three. `quietMN9` is still the only term at exactly zero in every seed — 26.6 Hz with no tastant
against a target of 10 — and remains the open half of this item.

**Refitting against it does not improve the model, and the reason is the selection rule.** Twenty
generations of twenty-four, seeded from the current fit, select a point scoring 0.808 on the single
seed the search optimises and **0.785 ± 0.009 across twelve, against 0.796 ± 0.006 for the parameters
it started from — paired −0.012 ± 0.010**. The search is not at fault; selecting on one seed is. This
is the same arithmetic that makes the current fit's `_score` of 0.780 sit below its honest 0.794, and
it is now visible directly because the search stopped discarding its own starting point: candidate 0
was a perturbation rather than the incumbent at generation 0, so a search could finish *below* the
point it was seeded from, which the first of these runs did. That is fixed in `scripts/calib_search.mjs`
(`scripts/behavior_refit.mjs` already had it right), and it is worth stating plainly that a
one-seed-selected winner in this repository is not evidence of a better model.

**What this leaves open.** Sparseness, specificity and baseline activity are three quantities that a
single KC threshold trades against each other, and the objective now prices all three rather than two.
Whether the balance it lands on is right is a question the literature targets can only partly answer:
the 8% sparseness figure is a summary statistic of the same kind [B1](20-roadmap.md) exists to
replace. The finding to carry forward is that each repair made the terms movable and each time
something was fitted against them, a further loosened joint appeared — first aliasing, then a
threshold, then sparseness-by-excitability — which is the argument for B1 in miniature.

---

## B. Needs data that exists

### B1. Fit against recorded activity, not literature summaries
Every number the calibration is scored against is a summary statistic from published work: a firing
rate, a sparseness fraction, a rhythm index. The nine-parameter fit reaches a composite of 0.794
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

### ~~C2. Design the validation before there is anything to validate~~
Committed: [doc 34](34-individual-validation.md) fixes the assay, the six observables, the number of
animals, the split, the statistic, the threshold, the controls and the outcome table, and
`scripts/identify_test.mjs` implements the statistic and can be exercised on simulated data now. What
it adds beyond the original statement of the item is the part that turned out to be the design problem:
the test has three inputs — observable reliability, readout sensitivity and fit error — of which only
the first is measurable before the models exist, and the second fails *silently*, producing the null
result no matter how good everything else is. The pre-registration therefore bounds what a negative
result can mean, which is the only thing that makes a negative worth having.

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
