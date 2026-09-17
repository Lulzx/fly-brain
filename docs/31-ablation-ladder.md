# 31. The substitution ladder

Which levels of physical description does a working model of this nervous system actually need? The
textbook's [Chapter 16](textbook/16-upload.md) frames the question as a ladder — connectivity, then
synaptic efficacy, then per-neuron biophysics, then neuromodulation and slow molecular state — and
argues that argument cannot settle it but substitution experiments can. Those experiments were scattered
across [Limitations](19-limitations.md), [Calibration](07-calibration.md) and
[Neuromodulation](25-neuromodulation.md) as individual findings. This document makes them a measurement.

```sh
node scripts/ablation_ladder.mjs 12      # ~3 min: 20 rungs x 12 paired seeds
node scripts/ablation_refit.mjs 12 20    # ~40 min: refits each ablation
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

Baseline 0.722 ± 0.003 (n = 12).

| rung | level | score | change | assays that break |
|---|---|---|---|---|
| `w_binary` | efficacy | 0.259 | −0.463 ± 0.003 | sugar, mix, kcSparse, legs, rhythm, tarsalPER, sugarStop, loom, noFalseAlarm |
| `w_shuffle` | efficacy | 0.301 | −0.421 ± 0.012 | sugar, mix, kcSparse, baseline, legs, tarsalPER, sugarStop, loom, noFalseAlarm |
| `add_depression` | cellular | 0.306 | −0.416 ± 0.004 | sugar, mix, kcSparse, legs, rhythm, tarsalPER, sugarStop, loom, noFalseAlarm |
| `add_adaptation` | cellular | 0.429 | −0.293 ± 0.004 | sugar, mix, kcSparse, tarsalPER, sugarStop, loom, noFalseAlarm |
| `w_eb_gated` | efficacy | 0.454 | −0.268 ± 0.003 | sugar, mix, kcSparse, tarsalPER, sugarStop, loom |
| `w_eb` | efficacy | 0.458 | −0.264 ± 0.003 | sugar, mix, kcSparse, tarsalPER, sugarStop, loom |
| `no_inh_gain` | cellular | 0.466 | −0.256 ± 0.005 | sugar, mix, kcSparse, tarsalPER, noMDN, loom |
| `no_size_scaling` | cellular | 0.482 | −0.240 ± 0.007 | bitter, mix, kcSparse, baseline, tarsalPER, sugarStop, noMDN, loom |
| `no_refractory` | cellular | 0.484 | −0.238 ± 0.014 | bitter, mix, kcSparse, baseline, sugarStop, loom |
| `cuba` | cellular | 0.509 | −0.213 ± 0.005 | bitter, mix, kcSparse, baseline, sugarStop, loom |
| `sign_free` | control (floor) | 0.521 | −0.201 ± 0.003 | bitter, mix, kcSparse, baseline, sugarStop, noMDN, noFalseAlarm |
| `no_delay` | cellular | 0.606 | −0.116 ± 0.006 | tarsalPER, sugarStop, loom, noFalseAlarm |
| `minsyn_12` | efficacy | 0.651 | −0.071 ± 0.004 | bitter, kcSparse, sugarStop, noMDN, loom |
| `no_kc_threshold` | cellular | 0.660 | −0.063 ± 0.004 | kcSparse, baseline |
| `lamina_bias_max` | control | 0.678 | −0.044 ± 0.004 | baseline |
| `no_neuromod` | modulatory | 0.689 | −0.034 ± 0.010 | sugar, tarsalPER |
| `minsyn_1` | efficacy | 0.695 | −0.028 ± 0.007 | sugarStop |
| `nominal_einh` | cellular | 0.698 | −0.025 ± 0.007 | kcSparse, noMDN |
| `no_lamina_bias` | cellular | 0.722 | +0.000 ± 0.000 | (none) |

`sign_free` — every neuron made excitatory — is the control: a manipulation that destroys the
inhibitory half of the wiring, and one the benchmark must be able to detect if it detects anything. It
costs 0.201, and **ten of the nineteen ablations cost more than it does.** Replacing graded synapse
counts with their mean costs more than twice as much.

That is worth pausing on, because it was meant to be a floor and is not one. Deleting every inhibitory
sign in a 165,122-neuron nervous system is a more violent manipulation than anything else in the table,
and the benchmark ranks it eleventh. The composite is built from firing rates, sparseness fractions and
rhythm indices, and those are dominated by how much drive reaches each population — so a manipulation
that changes gain scores worse than one that changes the computation. This is a property of the
objective, not of the model, and it is the same property that makes `w_shuffle` recoverable to 41%
below. A benchmark assembled from literature summary statistics measures what those statistics measure.
Fixing it means scoring against recorded activity rather than summaries, which is item B1 on the
[roadmap](20-roadmap.md).

Three results are worth separating from the rest.

**Graded synaptic weight is the most load-bearing quantity in the model.** `w_binary` keeps the entire
topology — every connection, every sign, every threshold — and replaces only the number of contacts
with its mean. That costs 0.463, more than any item of cellular biophysics and more than twice the
sign-free floor. Permuting the counts across retained connections (`w_shuffle`) costs about as much,
0.421, confirming that the loss is about *which* connection carries *which* weight, not about the
weight distribution. Connectivity alone, in the sense of an unweighted graph, is a long way below the
working model. [Doc 32](32-synapse-uncertainty.md) measures how well the reconstruction actually
determines that quantity, and the answer at low synapse counts is: to about a factor of two.

**The reconstruction threshold is not a knife edge.** Removing it entirely (`minsyn_1`, every detected
connection kept) costs 0.028; doubling it to twelve contacts costs 0.071. The fitted cut at six is on a
gentle part of the curve, which is reassuring about the calibration and unhelpful as a way to choose it.

**`laminaBias` is a flat direction.** Setting it to zero changes the benchmark by exactly nothing —
0.000 across all twelve seeds, in every one of the seventeen terms. It is not an inert parameter:
pushed to the top of its search range it costs 0.044. It is unidentifiable *near the fitted value*,
because the lamina monopolar cells are supplied by flyvis in this benchmark and a 5.3 mV bias never
reaches threshold on its own. One of the nine parameters the calibration searches is therefore not
constrained by the objective it was searched against — a fact about the fit that only an ablation
sweep surfaces.

## Arm two: what survives a refit

Each ablation refitted by cross-entropy search over the parameters it leaves free, then re-scored across
the same twelve seeds. Refitting the *baseline* the same way gives 0.713 rather than 0.722: the search
selects on one seed and loses 0.009 to that when honestly re-scored, which is the procedure's own noise
floor and the reason every rung below is compared against 0.713 rather than against the original fit.

"Recovered" is the fraction of the un-refitted loss that refitting buys back. 100% means the mechanism
was a coordinate, not a requirement; 0% means the loss survives everything the other parameters can do.

| rung | no refit | refitted | recovered |
|---|---|---|---|
| `no_size_scaling` | 0.482 | 0.690 | **91%** |
| `no_neuromod` | 0.689 | 0.705 | 77% |
| `cuba` | 0.509 | 0.659 | 75% |
| `w_binary` | 0.259 | 0.586 | 73% |
| `add_depression` | 0.306 | 0.539 | 58% |
| `no_refractory` | 0.484 | 0.587 | 47% |
| `add_adaptation` | 0.429 | 0.556 | 47% |
| `w_shuffle` | 0.301 | 0.465 | 41% |
| `no_inh_gain` | 0.466 | 0.551 | 37% |
| `no_delay` | 0.606 | 0.630 | **28%** |
| `sign_free` | 0.521 | 0.513 | **1%** |

The ordering changes almost completely, and the changes are the point.

**Per-neuron size scaling was not load-bearing.** It looked like the third most costly ablation in arm
one at −0.240. Ninety-one per cent of that comes back once the remaining eight parameters are refitted. The
postsynaptic volume scaling is a coordinate the search was using to set an overall gain, and a different
combination of `wSyn`, `inhGain` and the rest reaches almost the same place without it. This directly
weakens a claim made in [Chapter 16](textbook/16-upload.md), which cites size scaling as evidence
placing cellular biophysics below the sufficiency line. Arm one supports that reading; arm two does not.

**Axonal delay is the most necessary mechanism tested.** It is nowhere near the largest sensitivity —
−0.116, ninth of seventeen — but it recovers the least, 28%. No combination of synaptic gains, reversal
potentials or thresholds reconstitutes what a 1.8 ms conduction delay does, and the assays it breaks say
why: looming escape and its false-alarm control, which depend on relative timing along the LC4/LPLC2 →
giant-fibre chain rather than on the gain anywhere in it. A mechanism can be modest in sensitivity and
irreplaceable in kind.

**The floor is a real floor.** `sign_free` recovers 1% — refitted, it scores 0.513 against 0.521
un-refitted, very slightly *worse*. Twelve generations of search over every remaining parameter
cannot rebuild a model whose inhibition has been deleted, which is the behaviour a control of this
kind has to show for the recovery column to mean anything.

**Graded weight remains load-bearing, but less than arm one suggested.** `w_binary` recovers 73%: most
of what binarisation destroys is a gain the global parameters can restore. The residual 27% — a gap of
0.127 against the refitted baseline, still larger than the entire un-refitted cost of removing the
threshold or the neuromodulation — is the part that needs the actual per-connection numbers. That the
matched control `w_shuffle` recovers much less (41%) sharpens it: a refit can absorb a uniform change of
scale far more easily than it can absorb weights assigned to the wrong connections.

**A shuffled connectome refits to 0.583 at its own seed.** That number deserves to be stated plainly,
because it bounds what the benchmark can attribute to the real wiring. Against the real graph's 0.730,
a graph with its weights randomly permuted reaches 0.583 when given the same search budget — and drops
to 0.465 when re-scored across seeds, since each seed draws a different permutation and the fit was to
one of them. The benchmark discriminates real wiring from permuted wiring, but by a smaller margin than
the raw scores suggest, and any single fit to a single graph carries a substantial component of
"the search found a way."

### The empirical-Bayes weights are not yet interpretable

`w_eb` and `w_eb_gated` substitute the weights from [doc 32](32-synapse-uncertainty.md) for the raw
synapse counts, and cost 0.264 and 0.268 at the fitted operating point. That number should not be read
as evidence against them. The empirical-Bayes weights shrink the graph from 104.2 M synapses to
65.6 M, a 37% change in overall synaptic scale, and `wSyn` was fitted against the raw counts — so most
of what the rung measures is a gain mismatch that the model has a parameter for.

Arm one cannot answer this. The comparison that can is the refit, and it is the obvious next thing to
run: `scripts/ablation_refit.mjs 12 20 'w_eb'` puts both rungs through the same search as everything
else. If the refitted empirical-Bayes model matches the refitted baseline, the six-synapse threshold
can be replaced by a per-connection uncertainty estimate at no cost, and nothing is discarded. That is
the result worth having, and it is not in this table.

## What this says about the abstraction question

The agenda that motivated this document asks for detail to be dropped until prediction breaks. Run at a
fixed operating point, that procedure gives a ranking dominated by how much each parameter happened to
be carrying, and would have reported per-neuron size scaling as three times more essential than axonal
delay. Run with a refit, the ranking inverts. The refit arm is not a refinement of the measurement; it
is the measurement.

Two limits on how far this goes. The refit is a bounded search — twelve generations of twenty — so a
failure to recover is evidence that compensation is hard to find, not proof that none exists; a rung
that recovers has been shown compensable, which is the stronger direction of the two. And the benchmark
is physiological, not behavioural. The substitutions that [Chapter 16](textbook/16-upload.md) treats as
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
