# 7. Calibration

Connectomes give wiring, not strengths. Global parameters were fitted so the model reproduces published
behaviour.

## Method
- `scripts/calib_eval.mjs` runs the benchmark suite for one parameter set in about 2 to 4 seconds.
- `scripts/calib_search.mjs` runs a cross-entropy search with 12 parallel evaluators.
- Final run: 22 generations of 36 candidates.

## Parameters searched

| Parameter | Range | Final |
|---|---|---|
| Synaptic strength `wSyn` | 0.2 to 1.2 mV | 0.60 |
| Size exponent `sizeAlpha` | 0 to 1 | 0.66 |
| Kenyon cell threshold | 0 to 30 mV | 10.7 |
| Inhibitory gain | 0.5 to 5 | 0.68 |
| Inhibitory reversal | −85 to −55 mV | −74.4 |
| Minimum synapses | 3 to 10 | 5 |
| Adaptation | 0 to 3 mV | 0 |
| Refractory period | 2 to 6 ms | 2.9 |
| Lamina bias | 0 to 25 mV | 3.4 |

## Benchmarks and final results

| Benchmark | Source | Result |
|---|---|---|
| Labellar sugar drives MN9 | Shiu et al. 2024 | 89 Hz |
| Bitter silences MN9 | Shiu et al. 2024 | 0 Hz |
| Bitter vetoes sugar | Shiu et al. 2024 | 0 Hz |
| Front-leg sugar drives MN9 | Tarsal reflex | 15 Hz, partial |
| Leg sugar suppresses walking drive | Stop on food | 9.4 to 3.0 Hz |
| Leg sugar does not drive backward walking | | 3.8 Hz |
| Kenyon cell sparseness | Turner 2008 | 5.6% |
| Looming drives takeoff neurons over self-motion | von Reyn 2014, Namiki 2018 | 49 versus 20 Hz |
| No giant-fibre spikes during self-motion | | 0 |
| Activity returns to baseline after stimulus | | Passes |
| BDN2 activates leg muscle groups | Pugliese et al. 2025 | Passes |

Overall score 0.767. Odour specificity in the Kenyon cells and projection neurons failed every
configuration; see [Limitations](19-limitations.md).

## Pitfalls found
- An objective that rewarded odour specificity when no Kenyon cells fired. Fixed by requiring activity.
- Reused wasm memory carried spike counts between runs. Fixed by resetting all state.
