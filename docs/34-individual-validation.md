# 34. What would count as identifying an individual

[C1](20-roadmap.md) asks whether two models fitted to two animals' recordings are separated by a
held-out assay in the direction that matches the animals. The honest time to decide what that test *is*
is before anyone holds a candidate model, because a test designed afterwards can always be tuned until
it passes. This document is that decision, and `scripts/identify_test.mjs` is its implementation, both
committed while the experiment is still several items away on the [roadmap](20-roadmap.md).

```sh
node scripts/identify_test.mjs grid 12 6 4000          # what the design can detect
node scripts/identify_test.mjs grid 12 6 4000 kappa    # and what it silently cannot
node scripts/identify_test.mjs sim 12 0 6 4000 1 1 1   # the null, which must come out at 1/M
node scripts/identify_test.mjs run data/identify.json  # once there is a dataset
```

Nothing in the script is specific to the fly. It takes a matrix of observed behaviours and a matrix of
model predictions and returns an identification rate.

## The statistic

Every observable is z-scored across animals using the **observed** mean and standard deviation —
observed, not predicted, so that all M models are compared in one coordinate system and a model cannot
buy an advantage by shrinking its own spread. Each animal is then assigned to the model whose predicted
vector is nearest in that space and counts as identified if that is its own model.

Under the null that the models are exchangeable, the argmin is uniform and the number identified is
Binomial(M, 1/M). At M = 12 the one-sided exact test rejects at **four or more identified**, which is
α = 0.0138.

Exchangeability is the assumption worth checking rather than asserting, because z-scoring and ties can
break it. `permutationNull` re-derives the null from the data by permuting which animal each observed
vector belongs to and leaving the models where they are — which destroys the true pairing and preserves
every marginal, every tie, and the z-scoring. On a simulated dataset with no individuation it returns
0.0837 identified per animal against the 0.0833 the binomial predicts, and 0.012 of runs crossing the
threshold against a nominal 0.0138. The pre-registration is that the **permutation** null governs, and
the binomial is only its closed-form ideal.

## The design

**M = 12 animals.** At M = 12 and a threshold of four, the exact test has α = 0.0138 and, if the
identification rate is a genuine 50%, power 0.93. Table of the trade at other M, from the closed form:

| M | threshold | α | power at rate 0.5 | power at 0.4 |
|---|---|---|---|---|
| 6 | 4 | 0.0087 | 0.34 | 0.18 |
| 8 | 4 | 0.0112 | 0.64 | 0.41 |
| 10 | 4 | 0.0128 | 0.83 | 0.62 |
| **12** | **4** | **0.0138** | **0.93** | **0.78** |
| 16 | 4 | 0.0151 | 0.99 | 0.94 |
| 20 | 4 | 0.0159 | 1.00 | 0.98 |

Twelve is the smallest M at which a true rate of 0.5 is detected with the power of an ordinary
experiment, and the cost of going to sixteen is 33% more animals and 2% more power. It is also well
short of what the closed form would want at rate 0.4, which is the honest limit of the design: **this
experiment is powered for a strong effect and only just powered for a moderate one.**

**The split.** A model is fitted to the first 70% of each animal's recording and never sees the last
30%. The test observable is drawn entirely from the held-out 30%, and additionally from an assay block
that does not appear in the training portion at all — a held-out *stimulus*, not only held-out *time*,
because the interesting failure is a model that predicts the rest of a familiar stimulus by
interpolation.

**The observable.** Six behavioural measures, fixed here, none of which is a fitting target:

| # | observable | why it is here |
|---|---|---|
| 1 | escape rate and latency to a looming stimulus | the phenotype [A3](20-roadmap.md) is already fitting toward, with a published between-animal distribution |
| 2 | tarsal PER threshold | the classic individual-difference measure in this animal; a threshold, not a rate, so it is not a gain in disguise |
| 3 | heading precision while tracking an odour plume | circular variance of heading, so it separates tracking quality from walking speed |
| 4 | walk-bout length distribution | mean and tail index; the observable [A2](20-roadmap.md) names as currently supplied by a scheduler |
| 5 | optomotor response gain | a reflexive visual loop with no obvious learning component |
| 6 | feeding latency after first tarsal contact | the interval to the first sustained bout, which is a timing rather than a rate |

Four through six are the observables the model currently produces partly from machinery rather than
from the graph ([Limitations](19-limitations.md)), and they are included deliberately. If the supplied
gait and scheduling machinery is masking the brain's contribution, that is exactly the result
[A1](20-roadmap.md) says would be the interesting negative — and a test that excluded the exposed
observables would be unable to see it.

**The fit.** Per-neuron gains against the animal's own neural recording, by the adjoint from
[doc 33](33-differentiable-brain.md), with the nine globals held at the calibrated values so that the
only thing varying between models is what the recording says. Fitting the globals per animal as well
would let each model re-tune the whole brain toward its own animal, which is a different experiment
and a weaker claim.

## What the design can detect, and what it cannot

The pre-registered statistic has three inputs, and only one of them is measurable before the models
exist:

- **ρ — observable reliability.** The between-animal share of the observable's variance. This comes
  from the recording alone, by a one-way variance decomposition of the held-out trials with animal as
  the factor. No model, no connectome, no fit.
- **κ — readout sensitivity.** How much of the animal's fitted parameters actually reaches the
  behaviour. κ = 1 means the behaviour carries them undiminished; κ = 0 means it is produced by
  supplied machinery and every model predicts the same thing whatever its parameters say.
- **β — fit error.** The model's own prediction error, held constant across the animals a given model
  is asked about, because it is that model's fingerprint rather than a per-comparison noise.

Identification rate and power at ≥ 4/12, M = 12, six observables, 4,000 simulated datasets per cell:

| ρ \ β | 0.25 | 0.50 | 0.75 | 1.00 | 1.50 |
|---|---|---|---|---|---|
| 0.20 | 0.273 · 0.42 | 0.207 · 0.23 | 0.163 · 0.11 | 0.137 · 0.07 | 0.111 · 0.03 |
| 0.40 | 0.461 · 0.88 | 0.350 · 0.66 | 0.259 · 0.38 | 0.201 · 0.20 | 0.142 · 0.06 |
| 0.60 | 0.663 · 0.99 | 0.518 · 0.93 | 0.376 · 0.71 | 0.276 · 0.43 | 0.176 · 0.13 |
| 0.80 | 0.869 · 1.00 | 0.708 · 1.00 | 0.518 · 0.94 | 0.369 · 0.70 | 0.216 · 0.24 |

| ρ \ κ | 0.00 | 0.25 | 0.50 | 0.75 | 1.00 |
|---|---|---|---|---|---|
| 0.20 | 0.086 · 0.01 | 0.154 · 0.09 | 0.216 · 0.25 | 0.253 · 0.36 | 0.273 · 0.42 |
| 0.40 | 0.085 · 0.01 | 0.242 · 0.32 | 0.368 · 0.71 | 0.433 · 0.84 | 0.461 · 0.88 |
| 0.60 | 0.084 · 0.01 | 0.347 · 0.64 | 0.539 · 0.96 | 0.632 · 0.99 | 0.663 · 0.99 |
| 0.80 | 0.084 · 0.02 | 0.465 · 0.90 | 0.722 · 1.00 | 0.833 · 1.00 | 0.869 · 1.00 |

(the second table holds β at 0.25 and the first holds κ at 1)

Three things follow, and they are the reason this document exists rather than a paragraph in
[C1](20-roadmap.md).

**The design needs ρ ≥ 0.4 and β ≤ 0.5 to be worth running.** Every cell with ρ = 0.2 is below 0.5
power. Animals that differ by less than about 40% of their observable's variance cannot be individuated
by this test however good the fit is, because the signal is under the noise. That is not a limitation
of the statistic; it is what "these animals are behaviourally similar" means quantitatively.

**κ is the axis that fails silently.** At κ = 0 the statistic returns 0.08 — the null — no matter how
reliable the observable is or how good the fit is, and the run does not look different from a real
negative. A model whose behaviour is generated by outside machinery produces identical predictions for
every animal, and identical predictions are exactly what the null hypothesis predicts. **A negative
result on an observable with low κ is uninterpretable as evidence about individuation**, and the
pre-registration is that κ is estimated for each observable and reported beside its result rather than
being discovered in the interpretation.

**β competes with ρ directly.** A fit whose own error is as large as the real between-animal spread
(β = 1) caps power at 0.70 even when the observable is excellent (ρ = 0.8). The limiting factor in this
experiment is the quality of the per-animal fit, not the number of animals and not the assay — which is
the same conclusion [B1](20-roadmap.md) reaches from the other direction, and the reason B1 is listed
before C1.

None of ρ, κ and β appears in the pre-registered test statistic. They are here so that a failure can be
attributed rather than merely reported.

## The outcome table

Both the identification rate and the gate are reported, always, and the interpretation is fixed here
rather than chosen afterwards. The gate is **ρ ≥ 0.4 and β ≤ 0.5**, which is where the first table
crosses 0.88 power.

| identified | gate met | pre-registered reading |
|---|---|---|
| ≥ 4 / 12 | yes | **per-neuron parameters carry individual-specific information reachable from functional recording** — the claim [Chapter 16](textbook/16-upload.md) argues is load-bearing |
| ≥ 4 / 12 | no | suggestive only. Identification against a weak assay has not been separated from the fit's own fingerprint, and the split-half control has to carry the interpretation |
| < 4 / 12 | yes | **the informative negative.** The animals differ and the fit is good enough to see them differ, and the representation still cannot express the difference. Individuation would then require a different level of description, not a better fit |
| < 4 / 12 | no | inconclusive by design. Report the three inputs, not a conclusion about individuation |

The two middle rows are the point of writing this down in advance. A negative from a well-powered run
and a negative from an underpowered one are the same number on the page, and the difference between
them is the whole scientific content.

## The controls

Three, and the first two must pass for any result to be readable at all.

1. **Permutation null.** Reported with every run, as described above. If it does not land near 1/M on
   the actual dataset, the z-scoring or the tie structure has broken exchangeability and the closed-form
   threshold is not the right one.
2. **Scrambled-identity refit.** Each animal's recording is refit with its trials reassigned across
   animals, destroying identity while preserving every animal's marginal stimulus statistics. The
   resulting models must **not** identify. This is the control the permutation null cannot provide: the
   permutation test assumes the models are fixed, and this one tests whether the fitting procedure
   itself stamps a recoverable fingerprint on whatever it is given.
3. **The species-typical competitor.** The single calibrated model from
   `public/data/brain_params.json`, the same one for every animal, is entered as a thirteenth
   candidate. It should win about one animal in twelve. If it wins substantially more, the per-animal
   models are not doing anything the species model was not already doing.

## Cost

The fitting is no longer the expensive part: at the [doc 33](33-differentiable-brain.md) timings a
200-iteration per-neuron fit is minutes on one core, so twelve of them is an afternoon. The cost is the
data — twelve animals recorded densely enough to carry individual-specific information, with behaviour
in the same session and a registration from recording to connectome neurons at cell resolution, which
is [B2](20-roadmap.md) and is the single largest item on the roadmap. There is no version of C1 that is
cheaper than B2.

## What is frozen here, and what is not

Frozen, by this document and by the script committed with it: the statistic, the threshold of four, M =
12, the six observables, the 70/30 split, the three controls, the gate, and the outcome table.

Not frozen, and legitimately decidable later: the fitting hyperparameters; the stimulus parameters of
each assay, provided the observable's ρ is still measured on the final version; the two-dimensional
imaging method; and which connectome release the registration targets. None of these can move the
statistic in a direction the experimenter chooses, which is the test of whether they belong in this
list.

One thing that would invalidate the document rather than change it: if the animals turn out not to be
individually different in these observables — if ρ comes out near zero — then the experiment as
specified has no effect to find, and C1 has to be redesigned around an observable where they do differ.
That is a measurement on twelve flies, and it can be made before any of the modelling work starts.
