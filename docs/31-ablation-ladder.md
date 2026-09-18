# 31. The substitution ladder

Which levels of physical description does a working model of this nervous system actually need? The
textbook's [Chapter 16](textbook/16-upload.md) frames the question as a ladder — connectivity, then
synaptic efficacy, then per-neuron biophysics, then neuromodulation and slow molecular state — and
argues that argument cannot settle it but substitution experiments can. Those experiments were scattered
across [Limitations](19-limitations.md), [Calibration](07-calibration.md) and
[Neuromodulation](25-neuromodulation.md) as individual findings. This document makes them a measurement.

```sh
node scripts/ablation_ladder.mjs 12      # ~3 min: 20 rungs x 12 paired seeds
node scripts/ablation_refit.mjs 12 20    # ~55 min: refits each of the same 20 rungs
```

Both write to `public/data/`. The benchmark is the 17-assay physiological suite of
[doc 7](07-calibration.md) — sugar and bitter taste through to the proboscis motor neuron, Kenyon-cell
sparseness, antennal-lobe specificity, baseline activity, leg-motor rhythm, looming escape and its
false-alarm control — scored as one composite in [0, 1].

## Two arms, and why one is not enough

Removing a mechanism and re-scoring measures **sensitivity**: how much the benchmark falls at the
fitted operating point. It does not measure **necessity**. The nine global parameters were fitted
together, so a mechanism whose removal costs 0.2 may be entirely compensable by the other eight, and a
table of single-parameter drops would report it as load-bearing when it was only a coordinate the
search happened to be using.

So every rung is measured twice: once at the calibrated parameters, and once after refitting the
parameters the ablation leaves free, with the same cross-entropy search that produced the original
calibration. What survives the refit is the part the model actually needs.

Comparisons in the first arm are paired — every rung sees the same twelve brain seeds as the baseline,
and the statistic is the mean per-seed difference with its standard error, so a rung that moves the
benchmark less than seed noise is visible as such. A term counts as broken when it drops by at least
0.1 of its range and by at least three standard errors.

## Arm one: sensitivity at the fitted point

Baseline 0.796 ± 0.006 (n = 12), against 0.794 ± 0.008 for the same parameters before the odour terms
were repaired ([A7](20-roadmap.md)). The repair changed what the objective counts without changing what
it ranks; the table below is the one it produces, and [the last section](#the-repair-moved-every-number-and-no-rows)
records how it differs from the one it replaces.

| rung | level | score | change | assays that break |
|---|---|---|---|---|
| `w_binary` | efficacy | 0.337 | −0.459 ± 0.005 | sugar, mix, kcSparse, kcSpecific, pnSpecific, legs, rhythm, tarsalPER, sugarStop, loom, noFalseAlarm |
| `add_depression` | cellular | 0.387 | −0.410 ± 0.006 | sugar, mix, kcSparse, kcSpecific, legs, rhythm, tarsalPER, sugarStop, noMDN, loom, noFalseAlarm |
| `w_shuffle` | efficacy | 0.404 | −0.392 ± 0.013 | sugar, mix, kcSparse, kcSpecific, pnSpecific, baseline, legs, tarsalPER, sugarStop, loom, noFalseAlarm |
| `no_size_scaling` | cellular | 0.469 | −0.327 ± 0.010 | bitter, mix, kcSpecific, dm1PN, baseline, tarsalPER, sugarStop, noMDN, loom |
| `cuba` | cellular | 0.471 | −0.325 ± 0.008 | bitter, mix, kcSparse, kcSpecific, dm1PN, baseline, sugarStop, noMDN, loom, noFalseAlarm |
| `no_inh_gain` | cellular | 0.486 | −0.310 ± 0.010 | sugar, mix, kcSparse, kcSpecific, pnSpecific, tarsalPER, noMDN, loom |
| `w_eb_gated` | efficacy | 0.500 | −0.296 ± 0.006 | sugar, mix, kcSparse, kcSpecific, tarsalPER, sugarStop, loom |
| `w_eb` | efficacy | 0.518 | −0.278 ± 0.008 | sugar, mix, kcSparse, kcSpecific, tarsalPER, sugarStop, loom |
| `sign_free` | control (floor) | 0.524 | −0.272 ± 0.007 | bitter, mix, kcSparse, kcSpecific, dm1PN, baseline, sugarStop, noMDN, loom, noFalseAlarm |
| `no_refractory` | cellular | 0.553 | −0.243 ± 0.006 | bitter, mix, kcSparse, kcSpecific, baseline, sugarStop, noMDN, loom |
| `add_adaptation` | cellular | 0.580 | −0.216 ± 0.009 | sugar, kcSpecific, pnSpecific, tarsalPER, sugarStop, noMDN, loom, noFalseAlarm |
| `minsyn_12` | efficacy | 0.657 | −0.139 ± 0.008 | bitter, kcSpecific, sugarStop, noMDN, loom |
| `no_delay` | cellular | 0.705 | −0.091 ± 0.005 | tarsalPER, sugarStop, noFalseAlarm |
| `no_neuromod` | modulatory | 0.726 | −0.070 ± 0.011 | sugar, tarsalPER |
| `no_kc_threshold` | cellular | 0.738 | −0.058 ± 0.006 | kcSparse, kcSpecific, baseline, loom |
| `lamina_bias_max` | control | 0.741 | −0.055 ± 0.007 | baseline |
| `minsyn_1` | efficacy | 0.759 | −0.037 ± 0.007 | kcSparse, pnSpecific, sugarStop |
| `nominal_einh` | cellular | 0.787 | −0.009 ± 0.007 | (none) |
| `no_lamina_bias` | cellular | 0.796 | +0.000 ± 0.000 | (none) |

`sign_free` — every neuron made excitatory — is the control: a manipulation that destroys the
inhibitory half of the wiring, and one the benchmark must be able to detect if it detects anything. It
costs 0.272, and **eight of the nineteen ablations cost more than it does.** Replacing graded synapse
counts with their mean costs 1.7× as much.

That is worth pausing on, because it was meant to be a floor and is not one. Deleting every inhibitory
sign in a 165,122-neuron nervous system is a more violent manipulation than anything else in the table,
and the benchmark ranks it ninth. The composite is built from firing rates, sparseness fractions and
rhythm indices, and those are dominated by how much drive reaches each population — so a manipulation
that changes gain scores worse than one that changes the computation. This is a property of the
objective, not of the model, and it is the same property that makes `w_shuffle` recoverable in part
below. A benchmark assembled from literature summary statistics measures what those statistics measure.
Fixing it means scoring against recorded activity rather than summaries, which is item B1 on the
[roadmap](20-roadmap.md).

Three results are worth separating from the rest.

**Graded synaptic weight is the most load-bearing quantity in the model, and it no longer has the top
to itself.** `w_binary` keeps the entire topology — every connection, every sign, every threshold — and
replaces only the number of contacts with its mean. That costs 0.459, 1.7× the sign-free floor, and it
is now the top rung outright, 0.049 clear of `add_depression` at 0.410 — the two were tied at 0.407
before the odour terms were repaired. Permuting the counts across retained connections (`w_shuffle`)
costs less, 0.392, which at this
operating point reads as the loss being about *which* connection carries *which* weight as much as
about the weight distribution itself — an ordering that arm two does not preserve. Connectivity alone,
in the sense of an unweighted graph, is a long way below the working model at any of these settings.
[Doc 32](32-synapse-uncertainty.md) measures how well the reconstruction actually determines that
quantity, and the answer at low synapse counts is: to about a factor of two.

**The reconstruction threshold is not a knife edge, but it is no longer flat either.** Removing it
entirely (`minsyn_1`, every detected connection kept) cost 0.005 — inside the seed noise, and the
previous version of this table said so. Against the odour-repaired objective at the new fit it costs
0.037 ± 0.007, five standard errors, breaking `kcSparse`, `pnSpecific` and `sugarStop`. Doubling it to
twelve contacts costs 0.139. The fitted cut at six is still on a gentle part of the curve, which is
reassuring about the calibration and unhelpful as a way to choose it; what changed is that a threshold
the benchmark used to be blind to now registers. That is the second time a rung's cost has moved when
a term that could not move was repaired — `minsyn_12` roughly doubled when the loom objective was fixed
([A3](20-roadmap.md)) — and both are the same lesson about reading an ablation table built on a
partially dead objective.

**Two of the nine calibrated parameters are flat directions, not one.** `no_lamina_bias` changes the
benchmark by exactly nothing — 0.000 across all twelve seeds, in every one of the seventeen terms, at
three different fits now — while `lamina_bias_max`, at the top of the search range rather than at zero,
costs 0.055. So `laminaBias` is unidentifiable *near the fitted value*, though not inert: the lamina
monopolar cells are supplied by flyvis in this benchmark, and a 2.9 mV bias never reaches threshold on
its own. Joining it is `eInh`: `nominal_einh` — the fitted inhibitory reversal potential replaced by
the textbook value — scores −0.009 ± 0.007, indistinguishable from the fit. Two of nine parameters are
therefore not constrained by the objective they were searched against, which is a fact about the fit
that only an ablation sweep surfaces, and it is the strongest available argument that nine parameters
is not nine degrees of freedom.

## Arm two: what survives a refit

Each ablation refitted by cross-entropy search over the parameters it leaves free, then re-scored across
the same twelve seeds. The search runs at a single fixed seed, because CEM on a noisy score chases lucky
seeds; the winner is then scored across all twelve, which is the number below. Refitting the *baseline*
the same way gives 0.785 ± 0.007 against 0.794 un-refitted, so the procedure's own selection noise is
0.009, and every rung is compared against the refitted baseline rather than against the original fit.

CEM draws its population from `Math.random`, so each refit is a draw from a distribution, not a value.
The table happens to contain a manipulation that changes nothing — `no_lamina_bias`, whose arm-one cost
is exactly 0.000 in all twelve seeds and all seventeen terms — and its refit lands 0.019 below the
baseline. That is the procedure's resolution measured end to end, and it is the floor below which no
difference here should be read.

This table replaces an earlier one taken before the odour terms were repaired
([Calibration](07-calibration.md)). That repair lifted the whole scale — the old refitted baseline was
0.708 — so the two are not like-for-like and the numbers below are not a change over time. What is
comparable is the ordering, and there the two tables disagree.

"Recovered" is the fraction of the un-refitted loss that refitting buys back. 100% means the mechanism
was a coordinate, not a requirement; 0% means the loss survives everything the other parameters can do.
It is a ratio whose denominator is the arm-one cost, which is small exactly where the mechanism turned
out to be nearly free, and that makes the column degenerate over a third of the table: `minsyn_1`
recovers −27%, `no_kc_threshold` −35%, `nominal_einh` −173%, and for `no_lamina_bias` the loss to
recover is zero and the ratio does not exist. Negative values are not a mechanism fighting back; they
are the ±0.019 resolution above divided by a denominator smaller than it. Read the gap. `recovered` is
a convenience on top of it, and it is only meaningful when the arm-one cost is 0.12 or more.

| rung | no refit | refitted | recovered | gap to refitted baseline |
|---|---|---|---|---|
| `add_depression` | 0.387 | 0.559 | 45% | **−0.226** |
| `w_binary` | 0.386 | 0.561 | 45% | −0.224 |
| `w_shuffle` | 0.450 | 0.572 | 38% | −0.213 |
| `sign_free` | 0.548 | 0.598 | 24% | −0.188 |
| `no_refractory` | 0.535 | 0.600 | 28% | −0.185 |
| `add_adaptation` | 0.601 | 0.613 | **10%** | −0.173 |
| `w_eb_gated` | 0.523 | 0.637 | 45% | −0.149 |
| `minsyn_12` | 0.674 | 0.663 | −3% | −0.122 |
| `no_delay` | 0.701 | 0.677 | **−17%** | −0.109 |
| `no_inh_gain` | 0.489 | 0.681 | 66% | −0.104 |
| `w_eb` | 0.546 | 0.685 | 59% | −0.100 |
| `cuba` | 0.549 | 0.696 | 64% | −0.089 |
| `no_size_scaling` | 0.525 | 0.719 | **75%** | −0.067 |
| `minsyn_1` | 0.755 | 0.736 | −27% | −0.050 |
| `lamina_bias_max` | 0.740 | 0.742 | 19% | −0.044 |
| `no_kc_threshold` | 0.764 | 0.745 | −35% | −0.040 |
| `no_neuromod` | 0.724 | 0.758 | 61% | −0.028 |
| `nominal_einh` | 0.786 | 0.764 | −173% | −0.021 |
| `no_lamina_bias` | 0.794 | 0.767 | — | −0.019 |
| *(baseline)* | 0.794 | 0.785 | — | 0.000 |

The ordering changes almost completely, and the changes are the point.

### The table calibrates itself, and the calibration is the binding constraint

Three of the twenty rungs exist to be nulls, and they say how much of the rest can be believed.

`no_lamina_bias` is a genuine null: at `laminaBias` = 0 the benchmark is bit-identical to the fit, in
every seed and every term, because the lamina monopolar cells are supplied by flyvis and the fitted
2.9 mV never reaches threshold anyway. Its refit scores 0.767 against the baseline's 0.785. Nothing was
taken away and the procedure still lost 0.019, so **every gap in the table carries a 0.019 offset** and
differences smaller than that are not measurements. `nominal_einh`, −0.021, and `no_neuromod`, −0.028,
are inside or barely outside it. `lamina_bias_max` is a softer version of the same check: it is a real
substitution (arm one, −0.054) but sits at the extreme of a flat parameter, and it refits to a gap of
0.044, recovering only 19% of a cost that is largely the search failing to walk back to the fit from
the edge of its own box.

There is a second, accidental calibration. The six low-cost rungs were refit twice, because the first
run lost its output to a crash at the write step, and the same code with the same seeds produced
different winners: 0.767 and 0.736 for `minsyn_1`, 0.679 and 0.663 for `minsyn_12`, 0.772 and 0.745 for
`no_kc_threshold`. Six of six moved in the same direction, by between 0.008 and 0.044, mean 0.024. Two
draws are not a distribution, so the systematic component cannot be separated from chance at this
sample size — but the spread is consistent with the 0.019 the null rung measures, and it means a single
gap is a single draw. Where two rungs are compared below, the comparison is between a gap difference
and this spread, not against the ±0.01 twelve-seed standard error in the table's own column, which
measures the noise of scoring a *fixed* parameter set and not the noise of the search that produced it.

The practical rule this leaves: a gap of 0.02 or less is zero, a gap of 0.1 is real but not ordered
against another gap of 0.1, and only differences of 0.2 are worth ranking against each other. Most of
what follows is stated at that resolution.

**The information in the weight values is worth almost nothing after a refit.** This is the clearest
negative result in the table, and it contradicts the reading this document gave before the odour repair.
`w_binary` and `w_shuffle` are the two worst refits — nothing else in the table is as far below the
baseline — but they are the *same* refit. Un-refitted they are 0.064 apart, because a binary graph still
assigns the right weights where the weights are large, while a shuffled one assigns them nowhere.
Refitted they land at 0.561 ± 0.010 and 0.572 ± 0.022, a gap of 0.011 against a combined standard error
of 0.024: indistinguishable. The search recovers 45% of binarisation's cost and 38% of shuffling's, and
the residual difference between "graded counts" and "the same counts in the wrong places" is not
resolvable at twelve seeds.

What that says is not that the connectome's weights are unimportant — both rungs stay 0.21 or more below
the baseline, more than deleting inhibition or the axonal delay costs. It says the *values* carry little
beyond what the topology already carries, at this objective. The assays that neither rung can reach are
the same ones: `sugar` falls to 0.36 and 0.29 against the baseline's 0.82, `tarsalPER` to 0.12 and 0.26,
and the looming false-alarm control to 0.00 and 0.17. Graded synaptic efficacy is needed to pass the
odour and escape assays, but a refit cannot tell the real gradients from permuted ones by much.

**Doubling the reconstruction threshold is not recoverable, and removing it is not either.** Both
directions of the six-contact cut sit below the resolution floor in arm one but not here. `minsyn_12`
costs 0.119 un-refitted and 0.122 refitted — a recovery of −3%, which is to say the search does nothing
about it. That is the cleanest irrecoverable result in the table after the timing mechanisms, and it
cuts against the intuition that a threshold is a knob: if twelve contacts were merely a stricter
version of six, the other eight parameters could have absorbed the difference the way they absorb
`w_eb`'s 37% scale change. They cannot. Removing the threshold entirely, `minsyn_1`, also fails to
recover (−27%), but its whole arm-one cost is 0.039, below the floor, so that number is the resolution
divided by a small denominator and carries no information. `no_kc_threshold`, the third small-cost rung,
behaves the same way. The honest summary is that limb of the table is one real result — the threshold
cannot be doubled for free — and two unmeasured ones.

**Per-neuron size scaling is still mostly a coordinate, but not entirely.** It looked like the third
most costly ablation in arm one at −0.269. Seventy-five per cent of that comes back once the remaining
eight parameters are refitted, more than any other rung here. The postsynaptic volume scaling is largely
a way of setting an overall gain, and a different combination of `wSyn`, `inhGain` and the rest reaches
nearly the same place without it. But "nearly" is doing more work than it did in the previous table,
where the figure was 91%. The residual gap of 0.067 is now larger than the whole cost of removing
neuromodulation, so size scaling is a cheap coordinate rather than a pure one. This weakens, without
overturning, the claim in [Chapter 16](textbook/16-upload.md) that cites size scaling as evidence
placing cellular biophysics below the sufficiency line.

**Adaptation, depression and the refractory period are what a refit cannot buy back.** These three sit
at 10%, 45% and 28% recovered with the largest gaps of any single mechanism — 0.173, 0.226 and 0.185.
All three are timing mechanisms, and the assays they break in the refitted model are the same in each
case: the looming false-alarm control collapses to 0 (`no_refractory`), 0 (`add_depression`) and 0
(`add_adaptation`), and the escape response falls to 0.60 of its range where the baseline is 0.925.
Short-term depression at `depU` = 0.2 is the costliest single substitution in the entire table, worse
than deleting every inhibitory weight scaling, and twelve generations of search move it by 0.17 of the
0.41 it cost. Note what this does *not* say: the fit chose `adaptInc` = 0.072, effectively off, so
`add_adaptation` is measuring the harm of switching a mechanism on, not the value of having it on.
The honest reading is that adaptation at an appreciable strength is incompatible with this objective,
which is a different claim from its being necessary.

**Axonal delay is the least recoverable rung in the table, by an unstable margin.** It is nowhere near
the largest sensitivity — −0.093, one of the smallest — but refitting makes it *worse*: 0.677 against
0.701, a recovery of −17%. No combination of synaptic gains, reversal potentials or thresholds
reconstitutes what a 1.8 ms conduction delay does. Its refitted terms say why the search had nothing to
work with: the false-alarm control is at 0 and `quietMN9` at 0, and the delay is what separates the two.
Two caveats keep this from being as clean as it reads. A negative recovery is partly the search's own
noise floor acting on a small denominator, and the search is not guaranteed to improve — CEM can drift
downhill on a flat surface, and here it moved 0.024 in the wrong direction over twelve generations. What
survives both caveats is that the search found no compensating direction at all, where for every other
mechanism it found a substantial one.

**The floor still reads as a floor, but the recovered column no longer shows it.** `sign_free` recovers
24%, against 1% in the previous table — refitted it scores 0.598 where un-refitted it scored 0.548. That
gain is not recovery. Its refitted terms show a model that has traded the mechanism for saturation
elsewhere: `sugar`, `pnSpecific`, `rhythm` and `tarsalPER` all at exactly 1.0, while `bitter` and
`noMDN` are at 0, `sugarStop` at 0, the false-alarm control at 0, and the baseline-activity term at 0 —
six assays annihilated to buy four. A weighted sum of terms can be gamed by a model that is
all-excitatory exactly because every cell responds to everything. The gap column catches this, −0.188,
the fourth largest; the recovered column does not, because a 0.05 improvement on a 0.246 loss is 24% no
matter what produced it. This is the failure mode of the ratio, and the reason the control here is read
off the gap.

**Neuromodulation is nearly free.** `no_neuromod` refits to within 0.028 of the baseline, which is
inside the resolution floor, and `cuba` to within 0.089. Whatever the fed octopamine tone and the
modulatory synapse split contribute, the remaining parameters can supply almost all of it — which is
consistent with [doc 25](25-neuromodulation.md) describing the tone as a gain setting rather than a
signal, and inconsistent with reading arm one's −0.070 as a cost.

**The two flat directions from arm one are on much firmer ground now.** Arm one found that
`no_lamina_bias` changes nothing and that `nominal_einh` costs −0.008 ± 0.007, indistinguishable from
the fit, and it had to argue from those small numbers. The refit arm argues from the other side:
`nominal_einh` refits to 0.764, a gap of −0.021, and `no_lamina_bias` to 0.767, a gap of −0.019, both
inside the 0.019 the null rung establishes. A parameter whose removal costs nothing at the fitted point
and nothing again after an eight-parameter search is not constrained by this objective in either
direction. Two of nine calibrated parameters are therefore free, and the ablation sweep is what shows
it: the search cannot tell that it is not needed.

### The empirical-Bayes weights cost about half of what they appeared to, and the rest is ordinary

`w_eb` and `w_eb_gated` substitute the weights from [doc 32](32-synapse-uncertainty.md) for the raw
synapse counts, and cost 0.248 and 0.271 at the fitted operating point. That number should not be read
as the cost of the substitution. The empirical-Bayes weights shrink the graph from 104.2 M synapses to
65.6 M, a 37% change in overall synaptic scale, and `wSyn` was fitted against the raw counts — so part
of what the rung measures is a gain mismatch that the model has a parameter for. This is also why the
two rungs are not evidence against each other at arm one: the cost of a rung whose substitution changes
total synaptic drive is not comparable to the cost of one that does not.

The refit settles how much. Both rungs go through the same search as everything else:

| rung | no refit | refitted | recovered | gap to refitted baseline |
|---|---|---|---|---|
| `w_eb` | 0.546 | 0.685 | 59% | −0.100 |
| `w_eb_gated` | 0.523 | 0.637 | 45% | −0.149 |

Refitting buys back 59% of the ungated substitution, and what is left — a gap of 0.100 ± 0.009 — is the
cost of an ordinary mechanism removal. It is statistically indistinguishable from deleting inhibitory
weight scaling (0.681, a gap of 0.104 ± 0.013) and smaller than removing the refractory period or axonal
delay. On this evidence the empirical-Bayes weights are usable: the search can absorb almost all of the
scale change, and the residual is no larger than what several mechanisms in the real graph cost.

The threshold is not the story either, but it now runs the other way. `w_eb` has no threshold at all and
`w_eb_gated` a light three-contact one; after refitting they are 0.049 apart, with the *gated* variant
worse. That is the largest difference between any two rungs in the table and it clears the 0.019
resolution by a factor of two and a half, so it is the one ordering here that survives — but only just,
and 0.049 is not a large effect. Under the previous objective the two were 0.013 apart, inside the
noise. So the light threshold costs something rather than saving anything, which is the opposite of what
a threshold is for, and the effect is the size of the floor rather than the size of the substitution.

Both rungs also fail the same two assays, `tarsalPER` at exactly 0 and `sugar` at 0.37 and 0.38 against
the baseline's 0.82 — the same block that the permuted-weight rungs fail, and the one assay class that
graded efficacy is genuinely needed for.

What the residual 0.100 could still be is a real cost of the estimator, and the ladder cannot separate
that from a bad fit. Doc 32 estimates reliability from bilateral symmetry, so a connection whose left and
right copies disagree is discounted — and a connection that is real but asymmetric between the two sides
is discounted for the same reason. If the asymmetric ones are common, the shrinkage removes signal along
with noise. That remains a testable claim about doc 32's estimator rather than about this table, but the
table has stopped being evidence for it.

## What this says about the abstraction question

The agenda that motivated this document asks for detail to be dropped until prediction breaks. Run at a
fixed operating point, that procedure gives a ranking dominated by how much each parameter happened to
be carrying, and would have reported per-neuron size scaling as three times more essential than axonal
delay. Run with a refit, the ranking inverts. The refit arm is not a refinement of the measurement; it
is the measurement.

Three limits on how far this goes. The refit is a bounded search — twelve generations of twenty — so a
failure to recover is evidence that compensation is hard to find, not proof that none exists; a rung
that recovers has been shown compensable, which is the stronger direction of the two. The search is also
a random variable whose own spread, 0.019 measured on a rung that changes nothing, is larger than the
arm-one cost of six of the twenty substitutions — so the refit arm can speak to the mechanisms that cost
0.1 or more and is silent about the rest. And the benchmark is physiological, not behavioural. The substitutions that [Chapter 16](textbook/16-upload.md) treats as
most informative — posture, stepping, bout structure — are supplied by machinery outside the graph
([Limitations](19-limitations.md)), so they cannot break here. Extending both arms to the embodied
assays is the next item on the [roadmap](20-roadmap.md).

## The rungs

| rung | what it does |
|---|---|
| `w_binary` | graded synapse counts replaced by their mean over retained connections |
| `w_shuffle` | same count distribution, permuted across retained connections |
| `w_eb`, `w_eb_gated` | empirical-Bayes weights from [doc 32](32-synapse-uncertainty.md), with no threshold and with a light one |
| `minsyn_1`, `minsyn_12` | reconstruction threshold removed, and doubled from the fitted six |
| `no_size_scaling` | per-neuron PSP scaling by relative volume removed |
| `no_kc_threshold` | raised Kenyon-cell spike threshold removed |
| `no_lamina_bias`, `lamina_bias_max` | lamina monopolar bias at zero, and at the top of its range |
| `cuba` | conductance-based synapses replaced by current-based ones |
| `nominal_einh`, `no_inh_gain` | fitted inhibitory reversal and weight scaling replaced by nominal values |
| `no_refractory` | refractory period cut from 3.8 ms to one time step |
| `add_depression`, `add_adaptation` | short-term depression and spike-frequency adaptation switched on; the fit chose to leave both off |
| `no_delay` | axonal delay cut from 1.8 ms to one time step |
| `no_neuromod` | fed octopamine tone and the modulatory-synapse split removed |
| `sign_free` | every neuron excitatory: the floor the benchmark must detect |
