# 31. The substitution ladder

Which levels of physical description does a working model of this nervous system actually need? The
textbook's [Chapter 16](textbook/16-upload.md) frames the question as a ladder — connectivity, then
synaptic efficacy, then per-neuron biophysics, then neuromodulation and slow molecular state — and
argues that argument cannot settle it but substitution experiments can. Those experiments were scattered
across [Limitations](19-limitations.md), [Calibration](07-calibration.md) and
[Neuromodulation](25-neuromodulation.md) as individual findings. This document makes them a measurement.

```sh
node scripts/ablation_ladder.mjs 12      # ~3 min: 20 rungs x 12 paired seeds
node scripts/ablation_refit.mjs 12 20    # hours: refits each of the same 20 rungs
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
it ranks; the table below is the one it produces, and every substantial rung in it costs more than it
did under the objective it replaces ([A7](20-roadmap.md) lists the four largest of those shifts).

> **This whole table predates one more objective repair and has not been re-run against it.**
> [M3](20-roadmap.md) found `tarsalPER` scoring 0.85 on MN9's olfactory idle — the tarsal-evoked
> component of MN9 is −0.16 ± 1.57 Hz — and the feeding response terms now score the evoked increase
> rather than the raw rate. That moves the same parameters from 0.794 ± 0.005 to 0.697 ± 0.009. Every
> *absolute* score below is therefore the old objective's. The ordering is the quantity this document is
> about and there is no reason to expect it to move, since the repair touches two feeding terms that no
> rung selectively breaks — but that is a prediction until the ladder is re-run.

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
costs less, 0.392, which at this operating point reads as the loss being about *which* connection
carries *which* weight as much as about the weight distribution itself. Arm two keeps the sign of that
difference and shrinks it to the edge of what the refit can resolve. Connectivity alone, in the sense of
an unweighted graph, is a long way below the working model at any of these settings.
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
the same way returns 0.795 ± 0.006 against 0.796 un-refitted. The search does move — `wSyn` 0.562 to
0.541, `laminaBias` 2.86 to 4.86, `adaptInc` 0.072 to 0.11 — and gains nothing measurable for it, so the
procedure's own selection noise on the unablated model is 0.001. That is a change from the previous run
of this arm, where the refitted baseline landed 0.009 *below* the fit, and the reason is the
selection-rule repair in `scripts/calib_search.mjs` ([A7](20-roadmap.md)): candidate 0 of generation 0 is
now the incumbent rather than a perturbation of it, so a search can no longer finish below the point it
was seeded from on the seed it optimises.

It can still finish below on the other eleven seeds, and that is what sets the resolution here. The
table contains a manipulation that changes nothing — `no_lamina_bias`, whose arm-one cost is exactly
0.000 in all twelve seeds and all seventeen terms — and its refit lands 0.030 below the baseline.
Nothing was taken away, the search could not have done worse than standing still, and it still lost
0.030 across the twelve-seed re-score. **Every gap in the table therefore carries a 0.030 offset**, and
that offset is one-seed selection optimism rather than downhill drift: the winner beat the incumbent
where the search could see, and lost where it could not. [Doc 35](35-behaviour-ladder.md) measures the
same quantity at 0.17 in the embodied objective, where the seed-to-seed spread is far larger.

This arm is run against the same odour-repaired objective as arm one, so for the first time the two
arms are comparable row for row, and the M3 caveat at the head of arm one applies here equally. It
replaces an earlier table taken before the odour terms were repaired ([Calibration](07-calibration.md)),
whose refitted baseline was 0.785 and before that 0.708. Those scales are not this one and nothing below
is a change over time.

"Recovered" is the fraction of the un-refitted loss that refitting buys back. 100% means the mechanism
was a coordinate, not a requirement; 0% means the loss survives everything the other parameters can do.
It is a ratio whose denominator is the arm-one cost, which is small exactly where the mechanism turned
out to be nearly free, and that makes the column degenerate over a third of the table: `minsyn_1`
recovers 66% of 0.037, `no_kc_threshold` 2% of 0.058, `nominal_einh` −137% of 0.009, and for
`no_lamina_bias` the loss to recover is zero and the ratio does not exist. Each is the ±0.030 resolution
above divided by a denominator no larger than it, so neither its size nor its sign means anything. Read
the gap.
`recovered` is a convenience on top of it, and it is only meaningful when the arm-one cost is 0.12 or
more.

| rung | no refit | refitted | recovered | gap to refitted baseline |
|---|---|---|---|---|
| `w_binary` | 0.337 | 0.528 | 42% | **−0.267** |
| `sign_free` | 0.524 | 0.551 | **10%** | −0.244 |
| `w_shuffle` | 0.404 | 0.559 | 40% | −0.236 |
| `add_depression` | 0.387 | 0.596 | 52% | −0.199 |
| `add_adaptation` | 0.580 | 0.599 | **9%** | −0.197 |
| `no_size_scaling` | 0.469 | 0.617 | 45% | −0.178 |
| `no_refractory` | 0.553 | 0.628 | 32% | −0.167 |
| `w_eb_gated` | 0.500 | 0.660 | 55% | −0.135 |
| `no_inh_gain` | 0.486 | 0.681 | 63% | −0.115 |
| `minsyn_12` | 0.657 | 0.685 | **21%** | −0.110 |
| `w_eb` | 0.518 | 0.698 | 65% | −0.097 |
| `cuba` | 0.471 | 0.727 | **79%** | −0.069 |
| `no_delay` | 0.705 | 0.729 | 27% | −0.067 |
| `no_kc_threshold` | 0.738 | 0.738 | 2% | −0.057 |
| `lamina_bias_max` | 0.741 | 0.738 | −4% | −0.057 |
| `no_lamina_bias` | 0.796 | 0.765 | — | −0.030 |
| `nominal_einh` | 0.787 | 0.775 | −137% | −0.020 |
| `minsyn_1` | 0.759 | 0.782 | 66% | −0.013 |
| `no_neuromod` | 0.726 | 0.795 | **100%** | 0.000 |
| *(baseline)* | 0.796 | 0.795 | — | 0.000 |

The two arms mostly agree on the ordering — Spearman 0.81 across the nineteen rungs — and the
disagreements are where the reading changes. Four rungs move more than three places. `cuba` falls from
fifth-costliest to twelfth, 79% of its 0.325 recovered, and `no_neuromod` from fourteenth to last with
its whole 0.070 gone. `sign_free` rises from ninth to second and `add_adaptation` from eleventh to
fifth, because the search finds almost nothing to trade against either. Sensitivity at the fitted point
puts conductance-based synapses among the five most essential mechanisms in the model and switched-on
adaptation outside the top ten; the refit reverses both.

### The table calibrates itself, and the calibration is the binding constraint

Three of the twenty rungs exist to be nulls, and they say how much of the rest can be believed.

`no_lamina_bias` is a genuine null: at `laminaBias` = 0 the benchmark is bit-identical to the fit, in
every seed and every term, because the lamina monopolar cells are supplied by flyvis and the fitted
2.9 mV never reaches threshold anyway. Its refit scores 0.765 against the baseline's 0.795, and that
0.030 is the floor below which no difference here is a measurement. `nominal_einh`, −0.020, `minsyn_1`,
−0.013, and `no_neuromod`, exactly 0.000, are inside it. `lamina_bias_max` is a softer version of the
same check: a real substitution (arm one, −0.055) sitting at the extreme of a flat parameter, refitting
to a gap of 0.057 — twice the floor, and largely the search failing to walk back to the fit from the
edge of its own box rather than a mechanism being missed.

A second, accidental calibration came from the previous objective's run of this arm, and it agrees. Six
low-cost rungs were refit twice there, because the first run lost its output to a crash at the write
step, and the same code with the same seeds produced different winners: 0.767 and 0.736 for `minsyn_1`,
0.679 and 0.663 for `minsyn_12`, 0.772 and 0.745 for `no_kc_threshold`. Six of six moved in the same
direction, by between 0.008 and 0.044, mean 0.024 — a spread consistent with the 0.030 the null rung
measures here. Two draws are not a distribution, but the lesson carries: a single gap is a single draw
of a random variable, and where two rungs are compared below the comparison is against that spread and
not against the ±0.01 twelve-seed standard error in the table's own column, which measures the noise of
scoring a *fixed* parameter set and not the noise of the search that produced it.

The practical rule this leaves: a gap of 0.03 or less is zero, a gap of 0.1 is real but not ordered
against another gap of 0.1, and only differences of 0.2 are worth ranking against each other. Most of
what follows is stated at that resolution.

One term reads backwards throughout and should be discounted when scanning the per-rung scores below.
`quietMN9` is 0 at the fit, in every seed — MN9 idles at 26.6 Hz against a target of 10, the open half of
[A7](20-roadmap.md) — so it is the one assay an ablation can only improve, and seven refits clear 0.5 on
it: `w_eb` and `w_eb_gated` at 1.00, `w_shuffle` 0.97, `no_inh_gain` 0.96, `cuba` 0.75, `add_adaptation`
0.71 and `add_depression` 0.55. Each is a model that got quieter by losing drive it needed elsewhere, so
the score is a symptom and none of these rungs is a candidate fix. It does mean those seven are being
paid on a term the fit itself fails, which flatters their gaps by whatever weight it carries.

**The information in the weight values is worth almost nothing after a refit.** This is the clearest
negative result in the table. `w_binary` and `w_shuffle` are the two worst refits of any real mechanism
— only the all-excitatory control sits between them — but they are close to the *same* refit.
Un-refitted they are 0.067 apart, because a binary graph still assigns the right weights where they are
large, while a shuffled one assigns them nowhere. Refitted they land at 0.528 ± 0.016 and 0.559 ± 0.018,
a gap of 0.031 against a combined standard error of 0.024 and a search spread of 0.030: at the edge of
what this arm resolves, and not an ordering to build on. The search recovers 42% of binarisation's cost
and 40% of shuffling's.

What that says is not that the connectome's weights are unimportant — both rungs stay 0.23 or more below
the baseline, more than any real mechanism in the table costs. It says the *values* carry little beyond
what the topology already carries, at this objective. The assays neither rung can reach are the same
ones: `sugar` falls to 0.25 and 0.23 against the baseline's 0.79, `tarsalPER` to 0.26 and 0.10 against
0.99, `sugarStop` to 0.00 and 0.11 against 0.65, and the looming false-alarm control to 0.06 and 0.25
against 1.00. Graded synaptic efficacy is needed to pass the feeding and escape assays, but a refit
cannot tell the real gradients from permuted ones by much.

**Doubling the reconstruction threshold is not recoverable; removing it is.** The two directions of the
six-contact cut separate cleanly here, which they did not in arm one. `minsyn_12` costs 0.139
un-refitted and 0.110 refitted — a recovery of 21%, which is 0.029, inside the floor — and it is the
cleanest irrecoverable result in the table after the timing mechanisms. That cuts against the intuition
that a threshold is a knob: if twelve contacts were merely a stricter version of six, the other eight
parameters could have absorbed the difference the way they absorb `w_eb`'s 37% scale change. They
cannot, and the refitted terms say where it hurts — `loom` at 0.09 and `noMDN` at 0.08 against the
baseline's 0.92 and 0.97, an escape pathway that the search cannot rebuild once the weaker connections
along it are gone. Removing the threshold entirely, `minsyn_1`, recovers to a gap of 0.013, inside the
floor: the 0.037 arm one charged for keeping every detected connection is a cost the remaining
parameters absorb completely. `no_kc_threshold` refits to a gap of 0.057, twice the floor, on an
arm-one cost of 0.058 the search does not touch at all.

**Per-neuron size scaling is no longer mostly a coordinate.** It is the fourth most costly ablation in
arm one at −0.327, and 45% of that comes back on a refit, leaving a gap of 0.178 — the sixth largest,
and larger than removing the refractory period. The previous table put the recovery at 75%, and before
the odour repair at 91%, which supported reading the postsynaptic volume scaling as a way of setting an
overall gain that a different combination of `wSyn`, `inhGain` and the rest could reach without it. At
this objective it is not: the refit drives `sizeAlpha` to 0 and `wSyn` down to 0.382, and the result
still loses `kcSpecific` and `noMDN` outright and scores `sugarStop` at 0.03 and `loom` at 0.49.
[Chapter 16](textbook/16-upload.md) cites size scaling as evidence placing some cellular biophysics
below the sufficiency line; the previous two versions of this table weakened that claim and
this one supports it. Each repair to the objective has moved the rung the same way, which is worth
noting on its own: the mechanism did not change, the measurement of it did, three times in one
direction.

**Adaptation, depression and the refractory period are what a refit cannot buy back.** These three sit
at 9%, 52% and 32% recovered, with gaps of 0.197, 0.199 and 0.167. All three are timing mechanisms, and
the two that switch a mechanism *on* fail in the same place: the looming false-alarm control collapses
to 0.00 under both `add_depression` and `add_adaptation`, and the escape response falls to 0.60 of its
range where the baseline is 0.915. The refit's only move against adaptation is to pin `adaptInc` at 2.0,
the top of its range, and take 9% back — the smallest recovery of any rung whose cost is large enough to
measure. Note what this does *not* say: the fit chose `adaptInc` = 0.072, effectively off, so
`add_adaptation` measures the harm of switching a mechanism on, not the value of having it on. The
honest reading is that adaptation at an appreciable strength is incompatible with this objective, which
is a different claim from its being necessary. `no_refractory` fails differently and less: it keeps the
false-alarm control at 0.98 and loses `sugarStop` (0.01) and `noMDN` (0.30) instead, buying the search
32% back by raising the Kenyon-cell threshold to 21.6 mV.

**Axonal delay is recoverable after all, and the previous table's headline does not survive.** That
table made `no_delay` the least recoverable rung in the whole set at −17% — refitting made it *worse* —
and argued that no combination of gains, reversals or thresholds reconstitutes what a 1.8 ms conduction
delay does. Against the repaired objective it recovers 27% to a gap of 0.067, thirteenth of nineteen and
barely twice the floor. The earlier result was a negative recovery on a small denominator, which is
exactly the pattern this document now warns about, and it should not have been read as a finding. What
remains true is narrower: the refit still cannot hold the false-alarm control, which sits at 0.40 against
the baseline's 1.00 and is the one term that separates this rung from the fit.

**The floor reads as a floor in both columns now.** `sign_free` recovers 10%, against 24% in the
previous table, and its gap of 0.244 is the second largest here. But the recovery it does get is not
recovery, and the terms show it: refitted, `sugar`, `pnSpecific` and `tarsalPER` sit at exactly 1.0 and
`rhythm` at 0.90, while `bitter`, `kcSpecific`, `noMDN`, `sugarStop`, the false-alarm control and the
baseline-activity term are all at 0 — six assays annihilated to buy four. A weighted sum of
terms can be gamed by an all-excitatory model exactly because every cell responds to everything. The
difference from last time is that the ratio no longer hides it; the gap column caught it then and both
columns catch it now.

**Neuromodulation is free.** `no_neuromod` refits to 0.795, which is the refitted baseline to three
decimal places: 100% of arm one's 0.070 comes back. `cuba` recovers 79% to a gap of 0.069. Whatever the
fed octopamine tone, the modulatory synapse split and the conductance-based synapse contribute, the
remaining parameters supply it — which is consistent with [doc 25](25-neuromodulation.md) describing the
tone as a gain setting rather than a signal, and inconsistent with reading arm one's −0.070 and −0.325
as costs. `cuba` is the largest single collapse between the arms in this table: fifth-costliest at the
fitted point, twelfth after a refit.

**The two flat directions from arm one are on firmer ground.** Arm one found that `no_lamina_bias`
changes nothing and that `nominal_einh` costs −0.009 ± 0.007, indistinguishable from the fit, and it had
to argue from those small numbers. The refit arm argues from the other side: `nominal_einh` refits to
0.775, a gap of 0.020, inside the 0.030 the null rung establishes. A parameter whose removal costs
nothing at the fitted point and nothing again after an eight-parameter search is not constrained by this
objective in either direction. Two of nine calibrated parameters are therefore free, and the ablation
sweep is what shows it: the search cannot tell that it is not needed.

### The empirical-Bayes weights cost about two-thirds of what they appeared to, and the rest is ordinary

`w_eb` and `w_eb_gated` substitute the weights from [doc 32](32-synapse-uncertainty.md) for the raw
synapse counts, and cost 0.278 and 0.296 at the fitted operating point. That number should not be read
as the cost of the substitution. The empirical-Bayes weights shrink the graph from 104.2 M synapses to
65.6 M, a 37% change in overall synaptic scale, and `wSyn` was fitted against the raw counts — so part
of what the rung measures is a gain mismatch that the model has a parameter for. This is also why the
two rungs are not evidence against each other at arm one: the cost of a rung whose substitution changes
total synaptic drive is not comparable to the cost of one that does not.

The refit settles how much. Both rungs go through the same search as everything else:

| rung | no refit | refitted | recovered | gap to refitted baseline |
|---|---|---|---|---|
| `w_eb` | 0.518 | 0.698 | 65% | −0.097 |
| `w_eb_gated` | 0.500 | 0.660 | 55% | −0.135 |

Refitting buys back 65% of the ungated substitution — the search takes `wSyn` from 0.541 to 1.004,
almost exactly the scale change the shrinkage applied — and what is left, a gap of 0.097 ± 0.005, is the
cost of an ordinary mechanism removal. It is a little smaller than deleting inhibitory weight scaling
(0.681, a gap of 0.115 ± 0.015) and smaller than removing the refractory period. On this evidence the
empirical-Bayes weights are usable: the search absorbs the scale change almost entirely, and the
residual is no larger than what several mechanisms in the real graph cost.

The threshold is not the story either, and it still runs the wrong way. `w_eb` has no threshold at all
and `w_eb_gated` a light three-contact one; after refitting they are 0.038 apart, with the *gated*
variant worse. That clears the 0.030 floor and nothing more, so the light threshold costs something
rather than saving anything — the opposite of what a threshold is for — and the effect is the size of
the floor rather than the size of the substitution. Under the previous objective the two were 0.049
apart in the same direction, and before that 0.013, inside the noise.

Both rungs fail the same assay outright, `tarsalPER` at 0.00 and 0.02 against the baseline's 0.99, with
`sugar` at 0.47 and 0.40 against 0.79 — the same feeding block that the permuted-weight rungs fail, and
the one assay class that graded efficacy is genuinely needed for. The gated variant additionally loses
`noMDN` (0.25) and half of `loom` (0.54), which is the three-contact cut doing to the escape and
descending pathways a smaller version of what `minsyn_12` does.

What the residual 0.097 could still be is a real cost of the estimator, and the ladder cannot separate
that from a bad fit. Doc 32 estimates reliability from bilateral symmetry, so a connection whose left and
right copies disagree is discounted — and a connection that is real but asymmetric between the two sides
is discounted for the same reason. If the asymmetric ones are common, the shrinkage removes signal along
with noise. That remains a testable claim about doc 32's estimator rather than about this table, but the
table has stopped being evidence for it.

## What this says about the abstraction question

The agenda that motivated this document asks for detail to be dropped until prediction breaks. Run at a
fixed operating point, that procedure measures how much each parameter happened to be carrying at the
fit, which is not the same question. Against the repaired objective the two arms agree on the ordering
more than they disagree — Spearman 0.81 — but the agreement is not what the arm is for. Four rungs move
enough to change what they mean: conductance-based synapses and the neuromodulatory tone look
load-bearing at the fitted point and turn out to be coordinates the other parameters can supply (79% and
100% recovered), while the all-excitatory control and switched-on adaptation look moderate and turn out
to be the two things the search can do least about (10% and 9%). Sensitivity tells you what a parameter
was carrying; only the refit tells you whether anything else could carry it.

That distinction is also what makes a *low* recovery worth something. `minsyn_12` costs 0.139 at the
fitted point, less than half of what binarising the weights costs, and the search gives back a fifth of
it; `cuba` costs more than twice as much and the search gives back four fifths. On the fixed-point
ranking the second is the more essential mechanism and on this one it is the less. The refit arm is not
a refinement of the measurement; it is the measurement.

Three limits on how far this goes. The refit is a bounded search — twelve generations of twenty — so a
failure to recover is evidence that compensation is hard to find, not proof that none exists; a rung
that recovers has been shown compensable, which is the stronger direction of the two. The search is also
a random variable whose own spread, 0.030 measured on a rung that changes nothing, is within a factor of
two of the entire arm-one cost of six of the twenty substitutions — so the refit arm can speak to the
mechanisms that cost 0.1 or more and is silent about the rest. And the benchmark is physiological, not
behavioural: the substitutions that [Chapter 16](textbook/16-upload.md) treats as most informative —
posture, stepping, bout structure — are supplied by machinery outside the graph
([Limitations](19-limitations.md)), so they cannot break here.

That limit has since been measured rather than argued. [Doc 35](35-behaviour-ladder.md) runs the same
twenty rungs through the arena, and the two orderings agree at a Spearman correlation of −0.05 — a
disagreement an order of magnitude larger than the one between this document's own two arms. It runs
one way: the three substitutions this table ranks as the most costly things that can be done to the
graph — binarising the weights, permuting them, switching on depression — are free or better than free
when the score is what the animal does. Nothing below is withdrawn, because the two
documents score different objectives, but every sentence here about what the model *needs* should be
read as a statement about this benchmark until doc 35 agrees with it.

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
| `muscle_single` | per-class force–frequency curves ([M4](20-roadmap.md)) replaced by the single 17 Hz constant; behavioural only, and a null by construction whose measured +0.102 ± 0.042 is the assay's numerical noise floor — see [doc 35](35-behaviour-ladder.md) |
| `sign_free` | every neuron excitatory: the floor the benchmark must detect |
