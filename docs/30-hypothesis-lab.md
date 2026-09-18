# The hypothesis lab: ensembles, discriminating experiments, and a PDE benchmark

Doc 29 built the dataset-agnostic IR and analysis layer. This doc adds the layer that answers
the actual scientific question: **which computation does the wiring support, and what would
you measure to find out?** The approach: instantiate an *ensemble* of dynamical models over the
parameters the connectome does not fix, measure the same observables on every member, classify
them into competing mechanistic hypotheses, then rank candidate perturbations by how many model
pairs they separate.

## The machinery (`scripts/lif_ensemble.mjs`)

Generic pieces any circuit lab reuses:

- seeded RNG (mulberry32 — ensemble results are reproducible; `argv[2]` selects the seed)
- `makeBuilder` — constructs a calibrated `LIFNetwork` and scales edge classes by named
  parameters (`{pre: typeOrSet, post: typeOrSet, param}`), plus tonic bias populations
- perturbation helpers (`silence` = clamped threshold), circular-mean observables
- `rankExperiments` — for each candidate experiment, the fraction of ensemble member pairs
  whose outcome class differs; the top-ranked experiment is the most informative measurement

## Lab 1: the heading bump (`scripts/hypothesis_lab.mjs`)

48 members over `{epgRecur, d7Gain, epgTonic, penGain}` — recurrence gain, Delta7 kernel gain,
tonic EPG excitability, PEN push gain. Observables per member: bump persistence after a seeded
bump is released (concentration + FWHM), realised Delta7 kernel, bump rotation under unilateral
PEN drive. Perturbations: Delta7 silence, PEG lesion, EPG excitability sweep, unilateral PEN.

**Result, stable across seeds:**

- **No free-running bump anywhere on the grid.** Every bump-sustaining member requires tonic
  EPG bias — the wiring supports the attractor geometry, but the dynamics needs an excitability
  floor. ~15–25% of the grid (recur ≈ 3–6×, tonic ≈ 3–7 mV) sustains a bump at all.
- **Among bump-sustaining members, three mechanisms produce the same baseline bump** and are
  nominally separated by Delta7 silencing — but see the floor measurement below, which finds the
  silencing effect smaller than the ensemble's own member-to-member spread, so this separation is
  mostly not a measurement:
  - `d7_sculpts` — bump survives silencing; Delta7 sharpens it but isn't required
  - `d7_confines` — silencing releases runaway/uniform firing; Delta7 is what confines the bump
  - `d7_essential` — silencing extinguishes activity (released excitation drives adaptation
    shutdown — flagged as a possible LIF artifact, not a biological claim)
- **Ranked experiments** (consistent top-3, order shuffles across seeds): EPG excitability
  manipulation, PEG lesion, Delta7 silencing. The ranking counts a member changing class for any
  reason, including noise, which is the flaw the floor measurement below exposes. Each maps to a real experiment: depolarize EPGs
  while imaging the ring; kill the PEG copy; silence Delta7 and watch bump width/continuity.

The literature check: real Delta7→EPG is glutamate→GluClα inhibition that suppresses EPGs
*distant* from the bump (the measured antipodal kernel), so `d7_sculpts`/`d7_confines`-style
outcomes are the plausible ones; `d7_essential` is the class real data would rule out — which
is exactly what a discriminating experiment is for.

## The labs are now compiler output (`scripts/ensemble_spec.py` + `scripts/run_ensemble.mjs`)

Both labs were reimplemented as executions of a declarative **ensemble spec**. The spec
generator reads `operators.json` and emits, per detected operator: populations and their
functional roles, the gain axes the wiring does not fix (per-edge-class scalar gains +
tonic biases, each with a `why` note), the perturbation set (each load-bearing population
and edge class ablated), hypothesis classes, and provenance (which evidence items justified
the detection). `run_ensemble.mjs` executes a spec through geometry plugins (`ring`,
`linear`) — hypothesis classification, perturbation ranking, mechanism attribution.

Equivalence check: the ring spec at seed 42 reproduces the hand-written lab's hypothesis
distribution and top-3 experiment set; the phasor spec reproduces the deepened workup and
surfaces arm coupling (`needs_...+pfnv_silenced`: some members' PFNd shift requires PFNv
co-activity). The difference between this and the earlier labs is the compiler claim: a new
operator is now analysed by writing a spec entry, not a new script.

## Lab 2: the PFN→hDeltaB phasor transform (`scripts/phasor_lab.mjs`)

Same machinery, different circuit — the test of whether the framework is generic or secretly
ring-specific. Geometry is linear FB columns (`_C<n>` tags), not the ring; the observable is a
population centroid offset, not bump persistence.

72 members over `{pfndGain, pfnvGain, hdRecur(0–2), hdTonic}`. Drive PFN column C6, measure where the
hDeltaB population responds; structure predicts PFNd −3 / PFNv +2 columns.

**Result:** 13 wired_shift · 55 passthrough · 4 silent. Realised offsets cluster at −1..−2 —
**directionally consistent with the wiring but magnitude-compressed** by dendritic integration.
hDeltaB response amplitude scales sub-linearly with PFN drive (the velocity channel exists but
saturates).

**The deeper workup changed the conclusion.** The connectome contains three candidate dynamical
mechanisms the first pass didn't test: PFNd→PFNd self-recurrence (7970 synapses), hΔB→PFN
feedback (61 edges), and hΔB internal recurrence. Ablating each in every wired_shift member:

- **No member is `wired_only`** — every shifted response requires at least one dynamical
  element (needs_hdb_recur / needs_pfn_recur / needs_hd2pfn_feedback in various combinations).
  The −3-column wiring alone does not produce a shifted response; dynamics always participates.
- **Column sweep is never rigid** — the realised offset varies with driven column, so the
  transform is warped by position, not a clean linear shift.
- **PFNv arm is structurally weaker** (20 cells vs 40) and rarely realises its +2 prediction;
  the two phasor arms are asymmetric in a way the wiring histogram doesn't show.
- Ranked discriminators: amplitude scaling (0.42) > hd_recur_off (0.41) > **hd2pfn_off (0.32)**
  — the feedback loop, newly added, is already a top-3 discriminator.

## Lab 3: mushroom-body memory circuit (`sparse_associative_memory`, geometry `memory`)

Third circuit through the generic runner — a different observable class entirely: no
spatial geometry. Two overlapping KC "odors" (200 cells, 50% shared) are driven; the
measured transform is KC→MBON readout, and the free question is whether the KC↔APL
feedback loop provides gain control (compresses KC output as drive doubles).

**The first result was an honest negative, and it was an artefact of the lab rather than a fact about
the mushroom body.** It read: 18 members, 9 silent and 9 collapsed, no `gain_controlled` member;
count-calibrated APL feedback cannot compress. Two things were wrong with the measurement, and both
were visible in the artifact for anyone who looked at the right column.

**The odour was injected into the layer whose sparseness was being measured.** `kc_active` was exactly
0.049 in all eighteen members and under every perturbation — which is 200 driven Kenyon cells divided
by 4,064, not a property of the model at all. Driving Kenyon cells directly bypasses the expansion the
sparseness is supposed to come out of, so the observable could not move: the same arithmetically-pinned
term the [roadmap's A7](20-roadmap.md) documents twice over on the physiological benchmark. The odour
now arrives on the Kenyon cells' input pool (`pool:kc` — every external cell with ≥3 synapses onto at
least two Kenyon cells, read off the graph: 491 cells), and the layer's sparseness is a response.

**Silencing a population did nothing.** `clean()` reset threshold offsets, and every probe calls it
*after* the caller has raised them, so `apl_silence` — and `d7_silence` in Lab 1, and the silencing
perturbations in Lab 2 — ran an unperturbed network. The silenced set is now recorded on the network so
the reset cannot outlive it.

**With both fixed, the negative reverses.** 9 of 18 members are `gain_controlled` and the Kenyon-cell
code is under APL's control in exactly the way the sparse-memory hypothesis requires:

| | before | after |
|---|---|---|
| hypotheses | 9 silent, 9 collapsed, **0 gain_controlled** | 9 gain_controlled, 4 collapsed, 3 silent, 2 linear_passthrough |
| KC active fraction | 0.049 in every member (pinned) | 0.062–0.133, scaling inversely with APL gain (0.133 / 0.083 / 0.062 at gain 0.5 / 1 / 2) |
| KC active fraction, APL silenced | 0.049 (unperturbed run) | **0.093 → 0.858** |
| odour separation, APL silenced | unchanged | 0.78 → 0.25 |

Silencing APL densifies the Kenyon-cell code by a factor of nine and destroys the separation between
two 50%-overlapping odours. The structure does establish gain control; the previous conclusion was
measuring a stimulus and an unperturbed network.

What survives from the original reading is narrower and still worth having: the compression is weak in
absolute terms (the drive has to double before the composite moves), which is consistent with ~1 APL
synapse per Kenyon cell, and [doc 29](29-connectome-compiler.md)'s operator detector finds the same
thing structurally — APL clears the ≥3-synapse reconstruction threshold on only about half the layer.

**Meta-finding across all three circuits: structure overstates what dynamics delivers.**
Cosine kernel → realised; phase shift → realised at ~⅓ amplitude and only via dynamics
(never `wired_only`); ring attractor → only in a narrow tonic regime; gain control →
absent at count-calibrated weights. The structure-to-dynamics gap is the calibration
signal — and, on the MB, it localises exactly which parameter functional data must fix.

## The engineering benchmark (`scripts/bench_heading.py` + `scripts/ring_pde.py`)

The decompiled estimator vs. standard algorithms on one task: track heading from noisy angular
velocity + sparse landmarks with 15% outliers (±π corruption). `RingField` is an Amari-type
field on S¹ with measured parameters — Delta7 surround kernel (a−b·cos), EPG local recurrence
(the gain wiring doesn't fix), PEN shifted-feedback advection, and landmark anchoring via
ring-neuron-style disinhibition (global suppression with a gap at the landmark bearing).

| estimator | RMS err (rad) | post-outlier |
|---|---|---|
| dead reckoning | 0.679 | 0.633 |
| complementary α=0.35 | 0.701 | 1.143 |
| Kalman 1-D | 1.117 | 1.991 |
| Kalman + outlier gate | 0.489 | 0.710 |
| complementary α=0.05 (matched) | 0.604 | 0.633 |
| ring attractor (scalar reduced) | 0.641 | 0.668 |
| **ring field (PDE, advect mode)** | **0.48** | **0.53** |
| ring field + per-cell noise σ=0.15 | ~0.49 | ~0.53 |

(Benchmark numbers shown for the corrected two-inhibition-channel model — matching the
real Delta7-block result costs ~0.07 rad vs. the pure-Delta7 version, which scored 0.41.)

### The velocity pathway, done properly

The PEN shifted-feedback mechanism was derived rather than hand-tuned. Writing the bump as
u*(θ−φ(t)) and the PEN arm as an extra shifted kernel K in τ∂_t u = −u + W∗f(u) + v·K∗f(u),
projecting the perturbation onto the translation mode u*' (the marginal direction of the
translation-invariant field) gives the integration gain in closed form:

    phi_dot = v · ⟨u*', K∗f(u*)⟩ / (τ ⟨u*', u*'⟩)   →   pen_gain = 1/coef ≈ 0.27

With the literal shifted-synapse kernels at that predicted gain, the field tracks clean
velocity linearly at ~0.85× (the 15% deficit is the second-order correction — the shifted
input also distorts the bump profile, which the leading-order projection ignores). Under
fluctuating velocity, however, the literal mechanism degrades badly: each shifted injection
distorts the bump shape, not just its phase.

**Two-population PEN models discriminated how the real circuit must work.** Three
mechanisms were implemented and benchmarked under identical noisy drive:

| pen_mode | mechanism | noisy RMS |
|---|---|---|
| `shifted` | amplitude coding: om scales shifted-arm injection into EPG | 1.29 |
| `shifted2` | amplitude coding through a second attractor field | 1.61 |
| `shifted3` | **position coding**: om displaces the PEN bump; EPG pulled toward it | **0.60** |
| `advect` | idealized transport of u itself (reduced algorithm) | 0.41 |

Amplitude coding fails under sign-flipping drive regardless of filtering (τ_pen 0.02–0.3
scanned) or of a second field. Position coding — velocity displaces the PEN bump and the
summed shifted projections drag EPG toward it — halves the error and is robust, but
plateaus at ~0.60 because u always chases v with a stage of lag. Direct advection of u
(0.41) is the bound when transport acts on the transported field itself. The ~50% gap
between `shifted3` and `advect` is the price of indirect transport — and position coding
carries a testable neural signature the amplitude models lack: an EPG–PEN phase offset
during rotation, which is what calcium imaging of the fly circuit actually shows.

### Cross-formalism perturbation check (`scripts/perturb_pde.py`)

The same manipulations the LIF lab ranked were run on the field model, so outcomes can be
compared across formalisms. Agreement across model classes is stronger evidence than
agreement across parameters within one class. `hypothesis_lab.mjs` now reads
`public/data/perturb_pde.json` and emits a `cross_formalism` block: each ranked experiment
carries the PDE outcome, its mapping onto the LIF mechanism classes, and an explicit
`agrees_with_lif_majority` flag — at seed 42 the PDE lands in `d7_confines_width` while the
LIF majority is `d7_sculpts_sharp`, so the disagreement is recorded, not smoothed over.

**Delta7 suppression, graded (the LIF lab's #1 discriminator), corrected against withheld
data.** The first field model attributed all surround inhibition to Delta7 and dissolved
the bump below d7≈0.3 — contradicted by Turner-Evans et al. (2020), where Δ7 block leaves
a formed bump that tracks unreliably ("other sources of inhibition must act"). Adding the
second biological channel — a shallow ring-neuron surround (GABAergic Gall-EB/R neurons,
`rn_gain`, `rn_depth`) not gated by d7 — reproduces the real result: FWHM widens
monotonically 90° → 143° as Δ7 is fully blocked while the bump survives throughout. The
LIF majority class (`survives sharp`) is now disfavored by both the corrected field model
and the published data; the refined prediction is a quantitative width-vs-suppression
curve, a measurable discriminating experiment.

**PEN arm gating.** With only the om>0 arm intact the field integrates +om at ~unity gain
and is indifferent to -om; the converse for the other arm. Arm selectivity is exact —
unilateral PEN silencing should abolish integration in one direction only, matching the
fly result (PEN block → heading no longer follows turns).

**Local excitation sweep.** The bump is bistable above epg_recur ≈ 1.5 and absent below —
the one free gain of the field model has a measured viability threshold, and the observed
bump width (~100° FWHM) is stable across the viable range (94°–107°).

Two honest points:

1. **At the scalar level there is no magic** — a weakly-corrected complementary filter matches
   the reduced ring model. The biological advantage is not a better scalar filter.
2. **The advantage lives in the spatial representation.** A corrupt landmark must *win a
   competition* on the field, not just shift a point estimate — outlier robustness emerges
   without gating logic, and per-cell noise is corrected collectively by the attractor. The PDE
   model beats even the gated Kalman filter post-outlier while carrying no outlier-detection
   machinery at all.

Caveats: tuned to one noise regime; the excitatory gain is a free parameter (the wiring shows
EPG↔EPG/PEG recurrence exists but not its strength); real PEN dynamics are graded neurons, not
pure advection. The claim is "this mechanism class is competitive in this regime," not "the fly
beats Kalman filters."

## Every perturbation is now read against a measured floor, and one headline does not survive it

The ensembles are stochastic, and until now nothing said how stochastic. Two additions:

**Members are re-seeded from their own index.** The labs shared one global random stream, so anything
that changed one trajectory shifted every member after it. Measured directly: two runs of the ring spec
at the same seed disagreed on the *baseline* of 18 of 48 members, mean |Δconcentration| 0.149. Member
results were partly a function of execution order. They are now independent of it.

**Each member is drawn twice.** Every member records a `baseline_repeat` — the same parameters, a
different stream — so a perturbation's effect can be read against the spread of the thing it perturbs,
the way [doc 31](31-ablation-ladder.md) reads an ablation against its null rung.

| lab | observable | repeat-draw floor | perturbation effect |
|---|---|---|---|
| mushroom body | KC active fraction | 0.008 | **0.766** (APL silenced) |
| mushroom body | odour separation | 0.243 | 0.661 (APL silenced) |
| ring | bump concentration | **0.168** | 0.061 (Delta7 silenced) |
| ring | bump concentration | 0.168 | 0.186 (PEG lesion) |

**The mushroom-body result clears its floor by ninety-five times. The ring lab's top-ranked discriminator
does not clear its floor at all.** Delta7 silencing moves bump concentration by 0.061 against a
member-level spread of 0.168, and only 3 of 48 members show an effect twice their own floor. That is the
finding, and it costs this document its cleanest-looking claim: the mechanism classes `d7_sculpts`,
`d7_confines` and `d7_essential` were never resolved by the experiment that was supposed to separate
them. The classification is a sorting of noise for most of the ensemble.

Two things follow. The ranked-experiment table ranks by *outcome separation across members*, which
counts a member flipping class for any reason at all — so it will rank a noisy experiment highly, and
did. And a discriminating experiment has to be specified with an effect size, not just a direction: what
Lab 1 can actually ask for is a manipulation whose predicted effect exceeds 0.17 in bump concentration,
which Delta7 silencing does not, and which the real measurement below says it does not in the animal
either.

## The withheld prediction, closed — and it goes against this document's own model

The discriminating experiment this lab ranked first was Delta7 silencing, read out as bump width.
The measurement exists. In Turner-Evans et al. (2020), Δ7 neurons (line 55G08) were silenced with
shibire^ts and E-PG calcium imaged in the ellipsoid body at permissive and restrictive temperature,
in darkness and in closed-loop stripe tracking. The result:

| observable under Δ7 block | measured (Turner-Evans 2020) | field model (`perturb_pde.py`, d7 → 0) |
|---|---|---|
| bump survives | yes | yes |
| bump width (FWHM) | **unchanged**, adj. p = 0.45 and 0.48 | **90.5° → 143.1°**, +58% |
| bump amplitude | lower, adj. p = 0.015 | 106.6 → 95.8, −10% |
| heading tracking | erratic, slope distribution broadens (p = 0.0016, closed loop) | drift, not modelled as width |

**Which class it selects.** Of the three LIF mechanism classes, the data picks `d7_sculpts` — the bump
survives Δ7 silencing, at unchanged width — and rules out `d7_confines` and `d7_essential` outright:
nothing runs away and nothing extinguishes. The re-run LIF ensemble's majority class is the same one
(`sculpts_sharp`, 8 of the 10 members that hold a bump), so model and animal agree.

That agreement is worth less than it looks, and the floor measured above is why: the ensemble's Delta7
effect is smaller than its own member-level spread, so the LIF lab did not *discriminate* this class, it
defaulted to it. The data has resolved the question; the simulation had not. Which is the useful
direction for a lab like this to fail in — the real experiment turned out to be cheaper to interpret
than the ensemble it was supposed to arbitrate.

**But the class is not the interesting part; the magnitude is, and the field model got it wrong.**
The corrected two-channel field model was built to fix a failure that the same paper had already
exposed — the pure-Delta7 version dissolved the bump below d7 ≈ 0.3, which contradicts a bump that
survives. Adding the ring-neuron surround fixed survival, and in doing so predicted a monotonic
widening to 143° that the measurement says does not happen. The correction repaired the sign of the
result and overshot its size. The honest reading is that the second inhibitory channel is doing too
little of the width-setting work in the model: in the fly, whatever sets bump width is almost
entirely *not* Delta7, where the corrected model still has Delta7 supplying about a third of it.

**What the amplitude column adds.** Both agree that amplitude falls, and the model's −10% is at
least the right direction against a significant drop. Read together with an unchanged width, the
measured phenotype is a bump that is weaker but not broader, which is what a loss of *stabilising*
input looks like rather than a loss of *confining* input — exactly the authors' own reading, that
"the Δ7 neurons instead stabilize the bump's movements". The model's failure mode is that it has no
way to express that distinction: in an Amari field, removing surround inhibition necessarily widens
the bump, so no parameter setting of this model class can produce the measured phenotype. That is
a statement about the model class, and it is the most useful thing this closure produced.

**What it costs to fix, and why that is not done here.** Matching an unchanged width means the
width has to be set by something the current field does not carry — a saturating nonlinearity, a
second population with its own spatial scale, or an input tuning width that dominates the recurrent
one. Each is a different model class, and choosing among them from one width measurement would be
fitting a class to a single number. The benchmark numbers above already carry the cost of the first
correction (0.48 rad against 0.41 for the uncorrected version); a second correction should be made
against the width *and* amplitude curves together, which is the experiment to ask for rather than
the fix to guess.

## What's next

- **Effect sizes in the spec.** The floor measurement says a perturbation is only informative if its
  predicted effect exceeds the member-level spread. That number belongs in the spec next to each
  perturbation, and `rankExperiments` should score effect-over-floor rather than raw outcome
  separation — which would have demoted Delta7 silencing before the measurement did.
- **A width-and-amplitude field model.** The closure above shows no Amari-type field can produce the
  measured phenotype (amplitude down, width unchanged). Fitting a class that can — saturating
  nonlinearity, second spatial scale, or input-dominated width — against both curves at once.
- Provenance: each lab JSON records params, observables, perturbation outcomes, mechanism
  class, seed, and now a second draw of every member — the inspectable chain from wiring to claim.
