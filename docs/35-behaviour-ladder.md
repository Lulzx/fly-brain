# 35. The substitution ladder against behaviour

[Doc 31](31-ablation-ladder.md) measures which levels of description a working model needs, by removing
each one and re-scoring a 17-assay *physiological* benchmark. Its closing section names the limit of
that measurement: the substitutions the textbook treats as most informative — posture, stepping, bout
structure — are produced by machinery outside the connectome ([Limitations](19-limitations.md)), so a
graph ablation cannot break them however much of the graph is deleted. A benchmark that reads firing
rates and sparseness fractions cannot see what a body does.

This document runs the same substitutions through the arena instead. Each rung of the ladder is applied
to a fly that is embodied, seeing, walking and being chased, and the score comes from what the animal
does over five scenarios. The rung list is shared with the physiological ladder
(`scripts/rungs.mjs`), so the two tables describe the same twenty manipulations and can be read against
each other row by row.

```sh
node scripts/behavior_ladder.mjs 12       # ~2 h: 20 rungs x 12 seeds on 12 workers
node scripts/behavior_refit.mjs [gens] [pop] [rung]   # arm two; see below
```

Writes `public/data/behavior_ladder.json`.

## What is scored

Five scenarios, each starting from a freshly reset brain and a clean environment, run for a seeded,
deterministic fly. They are the five of `scripts/behavior_report.mjs`, and each is placed so that one
behaviour is reachable and the others are not:

| scenario | seconds | start | what it can produce |
|---|---|---|---|
| `forage` | 20 | 0.6 m from the food, facing away | walking, turning, bout structure, approach to food |
| `onfood` | 4 | 5 cm from the food | feeding latency |
| `threat` | 4 | centre, a looming object from 2 s | escape jump or flight, or neither |
| `heat` | 4 | on the hot patch | avoidance, and death if it does not |
| `bitter` | 4 | on a bitter patch | avoidance, and feeding suppression |

Six observables come out of them, and six terms score them:

| term | weight | observable | target, and where it comes from |
|---|---|---|---|
| `alive` | 2.0 | survives all five scenarios | 1: no target, and none needed |
| `flips` | 1.0 | fraction of time spent righting | below 5%: a fly on its back is a failure of posture |
| `food` | 1.5 | closest approach to food in `forage` | within 1.2 m, linear below |
| `feed` | 1.5 | time to the first feeding bout in `onfood` | within 2 s, linear below |
| `bout` | 1.0 | median walk-bout length | 2.2 s, log-symmetric within a factor of e² |
| `escape` | 1.5 | a jump or flight during the loom | yes or no |

The weights are the only free choice in the objective and they encode a priority: surviving and eating
count for more than walking neatly. Total weight 8.5, so the composite runs from 0 to 1 like doc 31's.

`bout` is the term this document exists for. Walk-bout length is not a property of the connectome at
all — it is drawn by the endogenous scheduler in `src/sim/intrinsic.js`, which is fitted to a lognormal
with a 2.2 s median ([doc 23](23-behaviour.md), after Maye et al. 2007). The rung therefore *cannot*
break it, and the prediction is that the `bout` column stays flat across all twenty substitutions. If
it does, that is a direct measurement of how much of the animal's behaviour is scaffolding rather than
nervous system, which is the interesting negative this document was built to look for. If it moves, the
brain is reaching the scheduler, and the amount it moves is how much.

One measurement detail matters for reading the column. `boutMedian` is taken from the scheduler's own
walk state (`fly.intrinsic.state`), which is the quantity the 2.2 s target describes, and not from the
motor command. The two are different — a fly whose brain has stopped driving its legs still has a
scheduler that says "walk" — and the gap between them is itself informative: the motor-derived median is
reported alongside as `bodyBoutMedian`, unscored.

## How the arms work

**Arm one** is sensitivity at the fitted operating point. Every rung is applied to the calibrated
parameters of [doc 7](07-calibration.md) and scored on the same twelve seeds, and the statistic is the
mean paired per-seed difference from the baseline, with its standard error. Pairing matters here more
than it does physiologically: an embodied run has a large seed-to-seed spread, because a walk that
starts half a second earlier can put the fly somewhere else for the rest of the scenario, and the
baseline's own variance is the dominant uncertainty.

The seed count is not a detail. This ladder was first run at four seeds, the number the
[roadmap](20-roadmap.md) budgeted for, and at four seeds the standard error of the paired difference
runs between 0.03 and 0.10 — large enough that nineteen of twenty rungs sat within two standard errors
of zero, leaving a table that resolved exactly one manipulation (`no_inh_gain`). Twelve seeds is the
same sample as the physiological ladder, which lets the two be read against each other, and it is the
smallest number at which the table says anything beyond that one row.

A term counts as **broken** when the paired drop is at least 0.1 of its range and at least three
standard errors clear of zero, the same criterion as doc 31. A rung with a large score change and no
broken term is a rung that moved the composite without any single behaviour failing, which is worth
distinguishing from a rung that took something out.

**Arm two** is the refit: each ablation is refitted by the same cross-entropy search the physiological
ladder uses, and the recovered score is compared against a baseline refitted the same way.

Arm two is the expensive half and is run differently here. An embodied evaluation takes about 335 s
against 3.3 s for a physiological one, so a full twenty-rung refit at twelve generations of twenty would
be about ninety hours rather than the physiological ladder's one. The cost is paid down three ways, and
all three bound what the arm can say.

The rung set is restricted to the manipulations arm one *resolved* — the paired drop is at least three
standard errors, or at least one term broke. That is eleven of the twenty, and it is the same criterion
arm one uses to decide what counts as a result, so nothing that arm one could not see is refitted. The
search is shortened from twelve generations of twenty to **five of twelve**, and the winner is re-scored
on all twelve of arm one's seeds, so the two arms are paired seed for seed. That is 72 evaluations per
rung and 864 for the arm: about fifteen hours on twelve workers, against the ninety a full-size search
over all twenty rungs would have cost.

The re-score is not an optional extra here, and the baseline row shows why. The search selects on a
single seed, where the winning point scores 0.981; the same point across twelve seeds scores 0.812. A
one-seed-selected winner is optimistic by about 0.17 in this objective — far more than the 0.009 the
physiological search's own selection noise comes to ([doc 31](31-ablation-ladder.md)) — because an
embodied run's seed-to-seed spread is large and CEM will happily climb it. Every number in the table
below is the twelve-seed re-score, and the single-seed figure is reported alongside only to show the
size of that gap.

The shortened search makes a failure to recover weaker evidence than it is in
[doc 31](31-ablation-ladder.md), where the search is nearly three times the size; a recovered rung still
shows compensability, and that is the direction that survives.

## Arm one

Baseline 0.860 ± 0.030 (n = 12). The calibrated model survives every scenario in every seed, spends less
than a ten-thousandth of its time righting, feeds at the first sample after being placed on food in all
twelve seeds, comes within 0.31 m of the food in a 20 s forage, escapes the loom in seven of twelve, and
walks in bouts whose median is 2370 ms against the 2200 ms the scheduler was fitted to.

| rung | level | score | change | terms that break |
|---|---|---|---|---|
| `no_inh_gain` | cellular | 0.532 | **−0.328 ± 0.045** | alive, escape |
| `minsyn_12` | efficacy | 0.646 | −0.214 ± 0.061 | flips |
| `sign_free` | control (floor) | 0.688 | −0.172 ± 0.052 | feed, bout |
| `minsyn_1` | efficacy | 0.706 | −0.154 ± 0.051 | (none) |
| `no_size_scaling` | cellular | 0.742 | −0.118 ± 0.036 | flips, feed |
| `no_refractory` | cellular | 0.742 | −0.118 ± 0.030 | (none) |
| `cuba` | cellular | 0.752 | −0.107 ± 0.047 | alive, flips |
| `w_eb_gated` | efficacy | 0.754 | −0.105 ± 0.046 | (none) |
| `no_delay` | cellular | 0.770 | −0.090 ± 0.030 | escape |
| `w_eb` | efficacy | 0.784 | −0.076 ± 0.043 | (none) |
| `nominal_einh` | cellular | 0.800 | −0.060 ± 0.044 | (none) |
| `no_kc_threshold` | cellular | 0.802 | −0.057 ± 0.039 | (none) |
| `lamina_bias_max` | control | 0.818 | −0.042 ± 0.041 | (none) |
| `no_lamina_bias` | cellular | 0.860 | +0.000 ± 0.000 | (none) |
| `no_neuromod` | modulatory | 0.871 | +0.011 ± 0.043 | (none) |
| `w_binary` | efficacy | 0.879 | +0.019 ± 0.036 | bout |
| `w_shuffle` | efficacy | 0.890 | +0.030 ± 0.040 | (none) |
| `add_adaptation` | cellular | 0.907 | +0.047 ± 0.032 | bout |
| `add_depression` | cellular | 0.916 | +0.056 ± 0.032 | bout |

**The two ladders do not rank the substitutions the same way, and not even close.** The Spearman
correlation between the physiological and behavioural orderings of these nineteen manipulations is
−0.05. The median absolute drop is 0.245 physiologically and 0.076 behaviourally: the same twenty
substitutions move the animal about a third as much as they move the benchmark. The three largest
disagreements are all in the same direction. Binarising the connectome is the single most costly
substitution the physiological benchmark can find — 0.407, tied with switching on short-term depression
— and it is free here, +0.019 ± 0.036. So is permuting the weights (+0.030) and so is depression
(+0.056).

That is the interesting negative this document was built to look for, and it is large. Whatever
[doc 31](31-ablation-ladder.md) is measuring when it says graded synaptic efficacy is the most
load-bearing quantity in the model, it is not something the animal's outcomes depend on. The animal
walks, finds food, feeds, escapes and survives whether or not the graph carries its weights.

**The floor is detected, and it outranks most of the real mechanisms.** `sign_free` — every neuron made
excitatory — is third of twenty at −0.172 ± 0.052, and one of its terms fails completely: the fly never
feeds in any of the twelve seeds, against a baseline that feeds at the first sample in all twelve, so
the `feed` term falls by 0.990 ± 0.000. Its walk bouts also fall by 0.194. Physiologically the same
manipulation ranked ninth of twenty, above seven intact mechanisms. Behaviourally it ranks above
thirteen of them.

The control fails to fail in an instructive way, though. A model with no inhibition at all still
survives every scenario in ten of twelve seeds, still gets within 0.17 m of the food, and escapes the
loom *more* often than the baseline does. It is not a broken animal; it is a busy one that cannot do the
one thing feeding requires. That is a narrower detection than "the benchmark must be able to see this",
but it is a real one, and it is the strongest floor signal in either ladder.

**Death is the sharpest thing either objective measures.** Three substitutions kill flies. Deleting the
inhibitory weight scaling kills ten of twelve and drops the `alive` term by 0.833 ± 0.112 — the largest
single term movement anywhere in this table. Replacing conductance-based synapses with current-based
ones kills half, and leaves the survivors on their backs for 6.7% of the time (`flips` −0.611 ± 0.128).
Removing the six-contact reconstruction threshold entirely — `minsyn_1`, which physiologically costs
0.039 and sits inside the seed noise — kills four of twelve and drops escape from 0.58 to 0.08. None of
those three is distinguishable physiologically in anything like this way, and the `minsyn_1` case is a
direct reversal: cheap on the benchmark, fatal in the arena.

**Walk-bout structure is where the graph does show up, which is the opposite of the prediction.** The
prediction at the top of this document was that `bout` would stay flat across all twenty rungs, because
the bouts are drawn by the scheduler rather than by the connectome. It moves. Four rungs break it by
more than three standard errors — `w_binary` by 0.448, `add_depression` by 0.357, `add_adaptation` by
0.315, `sign_free` by 0.194 — and `w_shuffle` very nearly does, at 0.251.

The reason is that the scheduler supplies the bout *distribution*, not the bouts. In
`src/sim/intrinsic.js` the walk state is entered on sugar, heat or a looming avoidance and left for
feeding, grooming or a stop, and bout length is multiplied by an arousal term the brain sets. The
distribution is a constant; how much of it is expressed is not. Binarising the weights leaves the
scheduler's median at 757 ms against the baseline's 2370 ms with nothing removed from the scheduler at
all, because the fly spends the difference feeding, avoiding, or on its back.

**The body shows about a tenth of the walking the scheduler decides on.** That gap is measurable
directly and it is the cleanest statement of how much scaffolding there is. At the baseline the
scheduler's walk bouts have a 2370 ms median; the same runs, read off the motor command instead, have a
240 ms median. Ten per cent of the process that decides to walk survives into the walk. This is why the
scored quantity is taken from the scheduler: the motor reading is not a noisy version of the walk, it is
a different and much smaller thing.

**Four substitutions make the animal do better, and the objective's weighting is why.** `add_depression`
(+0.056) and `add_adaptation` (+0.047), both mechanisms the calibration chose to leave off, improve the
composite — and so does binarising the weights. All three do it the same way: the fly gets busier,
escapes in twelve of twelve instead of seven of twelve, and reaches the food sooner, while its walk
bouts shorten by a factor of two and a half. The composite rewards that, because survival carries weight
2.0 and escape 1.5 while bout structure carries 1.0, and because a fly that never stops moving is easier
to keep alive in a 4 s heat or bitter scenario. The weight vector is doing real work here, and it is
arguably mis-set: an animal that survives by twitching is scored above one that behaves.

**Two rungs are null in both objectives.** `no_lamina_bias` is exactly 0.000 ± 0.000 here — not every
term, every *observable*, identical to the baseline in all twelve seeds — in the same way and for the
same reason as in [doc 31](31-ablation-ladder.md), where the fitted 2.9 mV never reaches threshold
because the lamina monopolar cells are supplied by flyvis. A parameter that two independent objectives
are both blind to is not a parameter the data constrains. `no_neuromod` is nearly the same story here,
at +0.011 ± 0.043, against a physiological cost of 0.070 that arm two of doc 31 already showed to be
mostly recoverable.

**Escape is a weak instrument and the table shows it.** Ten of the nineteen rungs reduce escape and seven
raise it, but only two clear three standard errors, and the baseline is seven of twelve — the intermittent escape
already recorded in [Limitations](19-limitations.md). A binary outcome with a 0.58 base rate and
genuine seed dependence cannot carry much. The `feed` term is weaker still: it is 1.0 in every baseline
seed and 0 in every `sign_free` seed, and no rung lands between the two, so it is a one-bit test of
whether the feeding circuit works at all rather than a measurement of latency. Both terms are kept
because they are the two behaviours the arena exists to show, but a next version of this objective
should make escape graded (latency to first jump, or takeoff probability over repeated looms) and space
the feeding placement so that latency has somewhere to land.

## Arm two

*(pending)*

## What this says about the abstraction question

*(pending)*
