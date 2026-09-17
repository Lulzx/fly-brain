# 33. A differentiable whole-brain model

The calibrated model is fitted by cross-entropy search over nine global parameters
([doc 7](07-calibration.md)). Nine is what a population search can reach. It is not what a
connectome-constrained model has: the optic-lobe model this project depends on was fitted by gradient
descent over a parameter per cell type and per synapse class, which is why it predicts recorded
responses at single-neuron resolution ([doc 11](11-vision.md)). The rest of the nervous system has had
no equivalent, because nothing here could differentiate it.

`src/lifdiff.js` does. It runs the same dynamics as `src/lif.js` and adds an adjoint.

```sh
node scripts/grad_check.mjs 800 120        # verifies the adjoint against finite differences
node --max-old-space-size=14000 scripts/grad_fit.mjs 400 30 both   # fits the whole CNS
```

## What is differentiable, and what is not

This is a property of the model, not of the implementation, and it is worth stating before any result:

| | |
|---|---|
| differentiable | `wSyn`, `sizeAlpha`, `inhGain`, `eInh`, `vThresh`, `kcThreshold`, `laminaBias`, `adaptInc`, `depU`, and a log-gain on every neuron's outgoing weights — 165,122 more parameters |
| not | `minSyn`, a discrete gate on the graph; `tRef` and `delay`, integer counts of time steps; the Poisson drive, whose spikes are exogenous |

Two of the nine parameters the calibration searches have no gradient at all. A differentiable
whole-brain simulator is differentiable in most of its parameters, not all of them, and the ones it
misses are exactly the ones [doc 31](31-ablation-ladder.md) finds the benchmark most sensitive to among
the cheap manipulations — `minSyn` and the refractory period. Gradient fitting does not replace the
search; it extends it into dimensions the search cannot enter.

Spikes are not differentiable either. The forward pass spikes exactly as `src/lif.js` does, and the
backward pass substitutes the fast-sigmoid surrogate derivative for the threshold (Zenke & Ganguli
2018). A surrogate gradient is not an approximation of the true gradient — the true derivative of a
spike count is zero almost everywhere — it is the gradient of a different, smooth model, used as a
search direction for the real one.

## Checking the adjoint

That distinction is what makes the obvious test useless: comparing the surrogate against finite
differences of a spiking model compares two unrelated quantities. What can be checked is the smooth
model the surrogate stands in for. With `soft: true` the forward pass replaces the threshold with a
logistic, the whole simulation becomes genuinely differentiable, and the adjoint must match central
finite differences.

`scripts/grad_check.mjs` runs that on an induced subgraph of the real connectome — the same CSR
traversal, delay ring, size-scaling and inhibitory-gain code the whole-brain fit uses. On 800 neurons
and 120 steps:

| parameter | adjoint | finite difference | relative error |
|---|---|---|---|
| `wSyn` | 134.476344 | 134.474561 | 1.3e-5 |
| `sizeAlpha` | −12.904829 | −12.911610 | 5.3e-4 |
| `inhGain` | −125.951700 | −125.944853 | 5.4e-5 |
| `eInh` | −0.301471 | −0.301609 | 4.6e-4 |
| `vThresh` | −203.039716 | −203.036046 | 1.8e-5 |
| `kcThreshold` | −26.732526 | −26.732683 | 5.9e-6 |
| `laminaBias` | 23.267803 | 23.263124 | 2.0e-4 |
| `adaptInc` | −275.681306 | −275.673568 | 2.8e-5 |
| `depU` | −608.638884 | −608.658351 | 3.2e-5 |
| `logGain[0]` | −13.249949 | −13.251039 | 8.2e-5 |
| `logGain[400]` | −2.581730 | −2.582274 | 2.1e-4 |

The comparison allows for the finite difference's own error: the forward pass is `Float32`, so the loss
is good to about 1e-6 of its magnitude and a central difference divides that by the step. Step sizes
below roughly 1e-3 measure rounding rather than slope — an earlier run with `h = 1e-4` showed
"disagreements" up to 7.6e-2 that were entirely the difference's noise, not the adjoint's error.

## Running it on 165,122 neurons

Reverse mode needs the forward trajectory, and storing every state at every step is 3 MB per step at
this size. The forward pass checkpoints every 64 steps and the backward pass recomputes one segment at
a time, which brings the peak to about 250 MB.

Truncation is not optional either. Carried across hundreds of steps of a recurrent spiking network the
adjoint diverges — products of Jacobians grow without bound and overflow `Float32`. The first
whole-brain attempt returned `NaN`. The backward pass therefore clears its adjoint state every 25 steps
(12.5 ms), so the gradient accounts for influences up to that far back. This is a bias, and a
deliberate one: it is the same truncation used to train recurrent networks everywhere else. Gradient
norms remain heavy-tailed even so — 1e10 to 1e13 — and are clipped by global norm.

## The fit

The assay is the sugar-to-proboscis chain from the calibration benchmark: sugar-sensing neurons driven
at 100 Hz, motor neuron MN9 to reach the recorded rate of 60 Hz, with a second loss term holding the
mean network rate at its starting value, because a model can always reach one target by exciting
everything.

Adam, 30 iterations, all nine globals and all 165,122 per-neuron gains, 400 steps (200 ms) per
iteration:

| iteration | loss | MN9 (Hz) | network (Hz) |
|---|---|---|---|
| 1 | 0.3403 | 25.0 | 3.41 |
| 2 | 0.3105 | 27.5 | 3.73 |
| 5 | 0.1863 | 40.0 | 4.08 |
| 10 | 0.0435 | 47.5 | 3.39 |
| 20 | 0.0278 | 70.0 | 3.43 |
| 30 | 0.0083 | 62.5 | 3.61 |

Loss falls 41-fold and MN9 goes from 25 Hz to 62.5 Hz against a target of 60, while mean network
activity stays within 6% of where it started. 3,722 of the 165,122 gains moved by more than 1e-3 — the
gradient is sparse, which is what a chain-specific objective should produce and a useful sanity check
that the fit is not simply turning the whole brain up.

One forward pass takes about 2 s and one backward pass about 6 s on twelve cores, so a gradient over
165,122 parameters costs roughly what eight benchmark evaluations cost the cross-entropy search
(`scripts/calib_eval.mjs`, 3.3 s each). The search needs a population per generation to make progress in
nine dimensions; the gradient moves all 165,131 at once.

## What this does and does not establish

It establishes that the whole-brain model can be fitted by gradient, that the adjoint is correct, and
that a high-dimensional connectome-constrained fit is affordable on a laptop. It does not establish
that the fitted parameters are right. The objective here is a literature summary statistic — the same
kind of species-typical target that [the textbook's Chapter 16](textbook/16-upload.md) argues cannot
individuate an animal. Fitting 165,122 parameters against one scalar is radically underdetermined, and
the sparsity of the solution reflects Adam's path as much as the biology.

The point of building it is that the identifiability experiment on the roadmap needs it. Testing
whether two individuals' recordings produce distinguishable models requires fitting a per-neuron
parameter set against dense functional data, and that fit is not reachable by population search. The
gradient is the prerequisite, not the result.

## Limits

- Truncation at 25 steps means the gradient cannot see the slow neuromodulatory and adaptation
  timescales, which run at 100–200 ms. Fitting those needs either much longer truncation windows or a
  different parameterisation.
- The backward pass is dense over neurons and sparse only over spikes. The forward kernel in
  `src/lifwasm.js` has an event-driven wake list; the adjoint does not, and would be several times
  faster with one.
- `Float32` state limits the finite-difference check to about four digits, which is enough to catch a
  wrong adjoint and not enough to catch a subtly wrong one.
- flyvis is not in the graph here: the optic lobe is a separate trained network ([doc 11](11-vision.md)),
  so visual assays cannot be fitted end-to-end through both without joining the two models.
