# 32. Per-connection uncertainty

The graph this project executes is a measurement, and it is reported without error bars. `prep_graph.py`
keeps connections of three or more synapses ([doc 3](03-data-pipeline.md)); the calibrated model
discards anything under six ([doc 7](07-calibration.md)). Both numbers are chosen before any model is
fitted, and once chosen they are invisible: the fit sees a 40-synapse connection and a 6-synapse
connection as the same kind of object, differing only in weight. It has no way to know that one of them
is measured far better than the other.

This document reports what happens when the uncertainty is estimated instead of assumed away.

```sh
python3 scripts/synapse_confidence.py     # ~30 s, writes edge_reliability.u8, edge_w_shrunk.u16,
                                          # edge_uncertainty.json in public/data
```

## The replicate the animal supplies

Estimating measurement error needs the same thing measured twice. The male CNS was imaged once, so
there is no second scan — but there is a second copy of most of the wiring, because the animal is
bilaterally symmetric. For a cell type with exactly one cell on the left and one on the right, the
connection `a -> b` and its mirror `a' -> b'` are two reconstructions of the same piece of wiring, in
different tissue, segmented and proofread independently. That is a test-retest design.

5,247 cell types have exactly one cell per side, covering 10,494 cells — 6.4% of the CNS, but enough to
calibrate a model that then applies to all of it. 657,126 connections have a mirror defined; 434,896 of
those have their mirror present in the graph, so a third of them do not reproduce at all.

The caveat has to be stated before the results, because it bounds every one of them: left-right
disagreement mixes reconstruction error with genuine asymmetry and with ordinary developmental
variability between two sides of one animal. Everything below is therefore a *lower* bound on the
reconstruction's precision, and the estimator cannot separate a segmentation mistake from a fly whose
two sides differ.

## Existence is reliable; weight is not

The first result is that these are separate questions with opposite answers.

A connection of exactly three synapses has its mirror present only 32% of the time, which looks
alarming until it is compared with chance. Under a degree-preserving null — the configuration model,
where a pair with out-degree k_out and in-degree k_in is connected with probability k_out·k_in/E — the
mirror would be present 0.71% of the time. Observed reproduction beats chance by a factor of 45 at the
floor and by around 100 across the rest of the range.

| synapses | connections | mirror present | chance | enrichment | reliability of the weight |
|---|---|---|---|---|---|
| 3 | 128,450 | 32.0% | 0.71% | 45× | 0.87 |
| 4 | 81,681 | 42.9% | 0.74% | 58× | 0.88 |
| 5 | 57,448 | 52.1% | 0.76% | 68× | 0.89 |
| 6–7 | 77,193 | 62.8% | 0.78% | 80× | 0.90 |
| 8–9 | 50,706 | 73.4% | 0.80% | 92× | 0.91 |
| 10–12 | 50,686 | 82.3% | 0.80% | 103× | 0.92 |
| 13–16 | 43,734 | 89.2% | 0.83% | 108× | 0.93 |
| 17–21 | 36,013 | 93.5% | 0.83% | 113× | 0.94 |
| 22–29 | 35,933 | 96.4% | 0.86% | 112× | 0.95 |
| 30–39 | 26,674 | 97.9% | 0.92% | 106× | 0.95 |
| 40–59 | 27,998 | 98.7% | 0.94% | 105× | 0.96 |
| 60–99 | 22,524 | 99.3% | 0.99% | 100× | 0.97 |
| 100+ | 18,086 | 99.6% | 1.34% | 74× | 0.98 |

Weak connections are not noise. They are 45 times more likely to have a bilateral counterpart than a
randomly rewired graph with the same degrees, which is not what a false-positive population looks like.
What fails to reproduce at the floor is the *number*: a connection observed at three synapses has a
median mirror count of zero, and one observed at five has a median mirror of three.

That distinction matters here more than it usually would, because [doc 31](31-ablation-ladder.md)
measures the model's sensitivity to exactly these two things and finds the graded weight to be the most
load-bearing quantity in the whole model, worth more than any item of cellular biophysics. The quantity
the model depends on most is the quantity the reconstruction measures least well at low counts.

## Reliability, and why the obvious estimator is wrong

The natural way to quantify weight error is to bin mirror pairs by synapse count and take the
within-pair variance. Done directly, that gives a reliability of **0.96 at three synapses** falling to
**0.76 at eight** — highest exactly where the measurement is worst. The artefact is selection: at the
floor, a pair only enters the sample if its mirror also cleared three synapses, so the discordant pairs
are precisely the ones removed.

The fix is to model the censoring rather than bin around it:

    theta_e ~ N(mu, tau^2)                    true log-weight of the connection
    y_i     ~ N(theta_e, sigma(theta)^2)      one side's reconstruction of it, i = L, R
    log sigma(theta) = alpha + beta * theta   noise scale free to depend on strength
    y observed only when count >= 3           otherwise the side is absent from the graph, not measured

fitted by maximum likelihood with Gauss-Hermite quadrature over theta, conditioned on at least one side
clearing the floor — pairs where neither does are never in the sample, and ignoring that biases every
parameter. On 120,000 mirror pairs the fit gives

    mu -0.551   tau 1.886   log sigma = -0.120 - 0.241 * theta

so the measurement's standard deviation is 0.64 log units at three synapses, 0.39 at thirty and 0.29 at
a hundred. In plain terms: **a connection reported at three synapses has a true weight uncertain by
about a factor of two.** Reliability, tau²/(tau² + sigma²), is nonetheless high everywhere (0.87 at the
floor) because the population of true weights is spread far wider than the measurement error — the
count tells you a great deal about where a connection sits in the distribution, and rather little about
its absolute strength.

## What comes out, and what a fit should do with it

Two arrays, both in `graph_w3.bin` CSR order:

| file | contents |
|---|---|
| `public/data/edge_reliability.u8` | reliability lambda per connection, byte/255 |
| `public/data/edge_w_shrunk.u16` | empirical-Bayes weight: the posterior mean of the true weight |

The empirical-Bayes weight is the estimate that minimises squared error: it leaves well-measured
connections alone and pulls poorly-measured ones toward the population mean. Where a connection's mirror
is also in the graph, both observations are pooled, and that is the only genuinely per-connection part
of the estimate — everything else is a function of the count. It is worth what it costs:

| observed count | connections | EB weight | EB weight when bilaterally confirmed |
|---|---|---|---|
| 3 | 2,619,323 | 1.3 | 2.9 (n = 41,156) |
| 6 | 831,715 | 3.1 | 5.4 (n = 25,988) |
| 12 | 220,091 | 6.8 | 8.3 (n = 12,381) |
| 30 | 30,010 | 19.4 | 22.0 (n = 3,338) |
| 100 | 1,196 | 69.9 | 68.4 (n = 302) |

Two connections reported at three synapses differ by a factor of 2.2 in estimated strength depending on
whether the other side of the animal confirms them. A threshold cannot express that; it keeps or
discards both.

Across the graph the shrinkage moves 99.4% of weights and takes the total from 104.2 M synapses to
65.6 M. The absolute scale is not meaningful on its own — the model's `wSyn` is fitted and absorbs any
uniform factor — so what the shrinkage actually changes is the *ratio* between weak and strong
connections, which is the thing the ablation in [doc 31](31-ablation-ladder.md) shows the model to care
about.

## What the six-synapse threshold is doing

The calibrated cut at six contacts is not arbitrary, and it is not free either:

| minSyn | connections kept | mean reliability of those kept | synapse mass kept |
|---|---|---|---|
| 1 or 3 | 10,511,038 | 0.90 | 100% |
| 5 | 6,235,682 | 0.92 | 87% |
| 6 | 5,092,668 | 0.93 | 81% |
| 8 | 3,630,343 | 0.94 | 71% |
| 10 | 2,749,407 | 0.95 | 62% |
| 12 | 2,168,143 | 0.96 | 55% |

The fitted threshold discards 52% of the connections and 19% of the synapses, and buys three points of
mean reliability for it. [Doc 31](31-ablation-ladder.md) measures what that trade is worth on the
benchmark: removing the threshold entirely costs 0.028, and doubling it costs 0.071.

## Limits

- The calibration set is 6.4% of the CNS, and it is not a random 6.4%: cell types with exactly one cell
  per side are central and individually identified, not columnar. Optic-lobe connections, where the
  types have hundreds of members, inherit a model fitted elsewhere.
- Biological asymmetry is inseparable from reconstruction error here. A method with a second scan of a
  second animal would separate them; there is not one.
- Counts are discrete and the model is continuous in log(1 + count), which matters most at the floor,
  where three to four synapses is a large step in log space.
- The empirical-Bayes weights are a *better* point estimate, not a distribution. A fit that propagated
  the full posterior would weight each connection by its precision rather than substituting its mean.
