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
| Synaptic strength `wSyn` | 0.2 to 1.2 mV | 0.55 |
| Size exponent `sizeAlpha` | 0 to 1 | 0.61 |
| Kenyon cell threshold | 0 to 30 mV | 10.9 |
| Inhibitory gain | 0.5 to 5 | 0.61 |
| Inhibitory reversal | −85 to −55 mV | −76.4 |
| Minimum synapses | 3 to 10 | 6 |
| Adaptation | 0 to 3 mV | 0 |
| Refractory period | 2 to 6 ms | 3.8 |
| Lamina bias | 0 to 25 mV | 5.3 |

## Benchmarks and final results

| Benchmark | Source | Result |
|---|---|---|
| Labellar sugar drives MN9 | Shiu et al. 2024 | 59 Hz |
| Bitter silences MN9 | Shiu et al. 2024 | 0 Hz |
| Bitter vetoes sugar | Shiu et al. 2024 | 0 Hz |
| Front-leg sugar drives MN9 | Tarsal reflex | 34 Hz |
| Leg sugar suppresses walking drive | Stop on food | 9.2 to 4.6 Hz |
| Leg sugar does not drive backward walking | | 0.6 Hz |
| Kenyon cell sparseness | Turner 2008 | 7.4% |
| Looming drives takeoff neurons over self-motion | von Reyn 2014, Namiki 2018 | 33 versus 2 Hz |
| No giant-fibre spikes during self-motion | | 0 |
| Activity returns to baseline after stimulus | | Passes |
| BDN2 activates leg muscle groups | Pugliese et al. 2025 | Passes |

Overall score 0.746 (mean of six runs 0.725; the previous fit without neuromodulation scored 0.767 on one
run, 0.674 mean of six). The giant fibre no longer spikes to the tethered loom — the takeoff neurons carry
the response. Odour specificity in the Kenyon cells and projection neurons failed every
configuration; see [Limitations](19-limitations.md).

## Pitfalls found
- An objective that rewarded odour specificity when no Kenyon cells fired. Fixed by requiring activity.
- Reused wasm memory carried spike counts between runs. Fixed by resetting all state.
