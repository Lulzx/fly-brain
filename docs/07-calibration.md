# 7. Calibration

Connectomes give wiring, not strengths. Global parameters were fitted so the model reproduces published
behaviour.

## Method
- `scripts/calib_eval.mjs` runs the benchmark suite for one parameter set in about 2 to 4 seconds.
- `scripts/calib_search.mjs` runs a cross-entropy search with 12 parallel evaluators.
- Final run: 20 generations of 24 candidates, with neuromodulation on (the octopamine neurons' fast
  synapses removed and their fed tone applied to their targets, [Neuromodulation](25-neuromodulation.md)).

## Parameters searched

| Parameter | Range | Final |
|---|---|---|
| Synaptic strength `wSyn` | 0.2 to 1.2 mV | 0.56 |
| Size exponent `sizeAlpha` | 0 to 1 | 0.57 |
| Kenyon cell threshold | 0 to 30 mV | 7.3 |
| Inhibitory gain | 0.5 to 5 | 0.58 |
| Inhibitory reversal | −85 to −55 mV | −69.1 |
| Minimum synapses | 3 to 10 | 6 |
| Adaptation | 0 to 3 mV | 0.07 |
| Refractory period | 2 to 6 ms | 3.7 |
| Lamina bias | 0 to 25 mV | 2.9 |

Two of these are barely constrained by the objective, which is only visible from
[the ablation sweep](31-ablation-ladder.md) rather than from the fit: `laminaBias` is exactly flat
across its local range, and `eInh` at its fitted value is no better than the textbook nominal. The
table above is what the search converged to, not what the benchmark requires. (`adaptInc` now lands at
0.07, effectively off but no longer pinned at the boundary; the ablation that forces adaptation on
costs 0.193, so near-zero is a finding rather than a flat direction.)

## Benchmarks and final results

| Benchmark | Source | Result |
|---|---|---|
| Labellar sugar drives MN9 | Shiu et al. 2024 | 53 Hz |
| Bitter silences MN9 | Shiu et al. 2024 | 0.4 Hz |
| Bitter vetoes sugar | Shiu et al. 2024 | 0.2 Hz |
| Front-leg sugar drives MN9 | Tarsal reflex | 26 Hz |
| Leg sugar suppresses walking drive | Stop on food | 7.5 to 4.3 Hz |
| Leg sugar does not drive backward walking | | 0.8 Hz |
| Kenyon cells responding to an odour | Turner 2008 | 1.3% evoked at 3σ, 11.9% effective, 24.5% raw |
| Kenyon-cell Jaccard, DM1 against VA2 | | 0.07 |
| Antennal-lobe PNs responding to DM1 | | 0.3% evoked at 3σ, 72.4% raw |
| DM1 lPN rate above baseline | | 48 Hz |
| Looming drives takeoff neurons over self-motion | von Reyn 2014, Namiki 2018 | 35 versus 7 Hz |
| Giant fibre spikes to a loom, none to translation | von Reyn 2014 | 1.9 versus 0 spikes/neuron |
| Activity returns to baseline after stimulus | | Passes |
| BDN2 activates leg muscle groups | Pugliese et al. 2025 | Passes |

The values above are means over the twelve seeds in `_benchmarks`; the odd-smelling pairs (evoked
against raw) are explained below.

Overall score 0.780 selected on one seed, 0.794 ± 0.005 re-scored across twelve. Both numbers moved,
and for different reasons. The previous fit selected at 0.797 before the loom objective was repaired
([A3](20-roadmap.md)) and the fit before that at 0.746; this one is the first against the fully
repaired odour objective ([A7](20-roadmap.md)). The giant fibre spikes 1.9 times per neuron to a
tethered loom and not at all to translation, matching von Reyn et al. 2014's 1 to 3, which it did not
do in any earlier fit.

The odour terms took three repairs, and each one moved the problem rather than removing it. The first
was an aliasing bug that made the DM1 and VA2 runs read the same array; the second a threshold on
*raw* spike counts that the 6 Hz baseline ORN drive carried most of the antennal lobe past; the third
the response criterion itself, which was a fixed one-spike count — the same bar at 0.5 Hz and 50 Hz,
cleared by 23% of Kenyon cells and 72% of ALPNs with no odour applied at all. A neuron now counts as
responding when it beats its own baseline by three Poisson sigmas, and the null is empty. The
sparseness term was then rebuilt on the *effective* number of responding cells, `(Σe)²/Σe²`, which is
invariant to how large the response is and so cannot be bought by making the layer more excitable —
the route a refit had already taken once. See [A7](20-roadmap.md), which also records that refitting
against the repaired objective does not improve on these parameters (−0.012 ± 0.010 paired over
twelve seeds) and why.

**What the repaired measure says about the model.** The Kenyon-cell response to DM1 is broad and weak
rather than sparse and strong: 11.9% of the population carries it effectively, against the 8% the
imaging literature reports, and only 1.3% of cells clear a single-stimulus significance bar. The ALPN
layer barely responds at all at that criterion — 0.3% against the 4.1% of ALPNs DM1 innervates
directly. Both are further from their targets than the pre-repair objective claimed, in the same
direction, and the fit cannot close the gap: `quietMN9`, the proboscis motor neuron running at 26.6 Hz
with no tastant against a target of 10, is still the only term pinned at exactly zero in every seed.
The one term that punishes a busy baseline and the one term the fit cannot satisfy are the same term,
and separating those two facts is the remaining work on [A7](20-roadmap.md).

## Pitfalls found
- An objective that rewarded odour specificity when no Kenyon cells fired. Fixed by requiring activity.
- Reused wasm memory carried spike counts between runs. Fixed by resetting all state.
- Every `LIFWasm` is laid out at the same base of one shared `WebAssembly.Memory`, so two networks built
  in the same expression expose the same `spikeCount` array. A benchmark that read counts off both was
  comparing a run with itself, and reported a Jaccard of exactly 1.000 for two different odours. Take a
  snapshot ([A7](20-roadmap.md)).
