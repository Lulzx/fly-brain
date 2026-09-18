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
this size. The forward pass checkpoints every 16 steps and the backward pass recomputes one segment at
a time. Each segment is replayed exactly once whatever the checkpoint interval is, so the interval
trades segment memory against snapshot copies and nothing else.

### Truncation was not necessary, and was the largest source of error in the fit

This section used to say that the adjoint diverges if carried over hundreds of steps, that the first
whole-brain attempt returned `NaN`, and that the backward pass therefore cleared its state every 25
steps. `scripts/adjoint_window.mjs` tests that claim, and it is false. The script builds induced
subgraphs up to 20,000 neurons and 1.6 M connections, runs the smooth model for 150 ms, and compares
the adjoint against central finite differences of the loss — the truth the adjoint is supposed to
compute the limit of.

Relative error of the adjoint against central finite differences, by window length:

| neurons | steps | 12.5 ms | 25 ms | 50 ms | 100 ms | full window |
|---|---|---|---|---|---|---|
| 600 | 200 | −0.37 | −0.05 | 0.02 | 0.0002 | **0.0002** |
| 1,500 | 400 | −0.47 | −0.13 | −0.001 | 0.02 | **−0.0001** |
| 6,000 | 300 | 1.68 | 1.34 | 0.11 | −0.13 | **0.001** |
| 20,000 | 300 | 0.24 | 0.32 | −0.01 | −0.04 | **−0.005** |

(entries are `wSyn`; `adaptInc` is worse — 0.73 to 0.80 at 12.5 ms — and at 6,000 neurons the `depU`
gradient at a 25-step window is wrong by a factor of 13 *and* carries the wrong sign.)

Nothing overflows at any size tested, and the full-window adjoint matches finite differences to five
digits at 600 neurons and to better than 1e-2 everywhere. Truncation was never buying stability here.
What it was doing was biasing every gradient, in a fit that had no other source of bias to excuse it.
It also cost nothing to remove: each checkpoint segment is replayed exactly once either way, and the
whole-CNS backward takes 1,416 ms at a 25-step window and 1,389 ms with truncation off.

The default is now no truncation. Gradient norms remain heavy-tailed — 1e10 to 1e13 — and are clipped
by global norm.

### Why the adjoint cannot be made sparse in the way the forward pass is

The forward kernel in `src/lifwasm.js` is event-driven: only neurons with drive, drive-influenced
conductances or refractoriness are stepped. The obvious move is to make the backward pass the same.
It does not work as well as it looks, and the reason is a property of the surrogate rather than of the
implementation: the surrogate derivative `1 / (β(1 + |u − θ|/β)²)` is evaluated at *every* neuron,
whether or not it spiked, so a neuron silent in the forward pass still transmits gradient in the
backward pass. Sparsity is set by how far back the loss reaches, not by how much the network is doing.

Measured on the whole CNS at whole-CNS settings (200 steps, hard thresholds, sugar neurons driven),
the adjoint state is nonzero at **5,700 neurons per step (3.5% of N) with a 25-step window and 21,965
(13.3%) with truncation off**. So an event-driven backward pass is worth something — bounded by about
7× on the neuron loops at the full window, less on the total, since the CSR traversal below is not
neuron-indexed at all — but it is not the large factor the forward pass gets, and it is what the
worst-case (smooth, undriven) measurement would suggest: in that regime, 95% of the state is nonzero.

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

On the whole CNS at whole-CNS settings — 200 steps (100 ms), hard thresholds, the sugar neurons driven,
1,206 loss neurons — one forward pass with the tape recorded takes 0.60 s and one backward pass 1.39 s
in the WASM-free JavaScript adjoint, so a gradient over 165,122 parameters costs about what two
benchmark evaluations cost the cross-entropy search (`scripts/calib_eval.mjs`, 3.3 s each). The search
needs a population per generation to make progress in nine dimensions; the gradient moves all 165,131
at once.

That is where the time goes, and it is not where it was expected to be. A CPU profile of the backward
pass puts essentially all of it in two places: the fused per-neuron loop (one pass over eleven
165,122-element arrays per step) and the CSR traversal that delivers each spike to its fan-out. The
per-step *allocation* that the segment replay used to do — seven fresh `Float32Array`s per step of every
segment, 300 MB of garbage per segment — cost nothing measurable; a version rewritten to allocate from a
reused arena is the same speed. The fused loop, hoisting the mask and parameter loads out of it, and
writing the nine accumulated scalars back once rather than nine times per neuron is worth about 7%.
Garbage collection never exceeded 0.05% of samples.

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

- The gradient is now taken over the whole trajectory, so it can see the slow adaptation and
  neuromodulatory timescales. What it still cannot see is anything outside the window it is given:
  a 100 ms fit cannot attribute a loss to a parameter that acted at 300 ms, because the trajectory
  does not reach that far. That is a limit of the experiment, not of the adjoint.
- The backward pass costs about 2.3× the forward pass at whole-CNS settings, and the remaining
  factor available is an event-driven backward pass (bounded at ~7× on the neuron loops by the 13.3%
  density above) or moving the kernel to WebGPU ([doc 27](27-webgpu.md)). Neither is done.
- No gradient flows to `minSyn`, `tRef` or `delay`. Three of the nine calibrated globals are still
  reachable only by population search.
- `Float32` state limits the finite-difference check to about four digits, which is enough to catch a
  wrong adjoint and not enough to catch a subtly wrong one.
- flyvis **is** in the graph now, and the section below is what that bought and what it did not. The
  short version: the chain is built and verified, and the fit it was built for does not run.

## Joining the optic lobe: what worked, and what it showed

The limitation above used to end this document: the optic lobe was a separate trained network, so a
visual assay could not be fitted through both halves. `src/visdiff.js` joins them. The chain is

```
luminance, 721 hex columns per eye
  -> flyvis, 45,669 nodes and 1,513,231 edges per eye, dt = 20 ms   (src/flyvisdiff.js)
  -> rate = clamp(gain * (v[node] - vRest[node])), 62,157 pairs     (the coupling)
  -> drive on 62,157 CNS neurons, 38% of the CNS, dt = 0.5 ms       (src/lifdiff.js, driveIdx)
  -> spikes, and a loss on any CNS neuron
```

```sh
node scripts/vis_equiv.mjs 35            # is the optic-lobe half the model that ships?  (yes, bit for bit)
node scripts/vis_grad_check.mjs          # is the joined adjoint correct?                 (yes)
node --max-old-space-size=14000 scripts/lifdiff_equiv.mjs       # the CNS half, sugar assay  (yes, within error)
node --max-old-space-size=14000 scripts/lifdiff_loom_equiv.mjs  # the CNS half, visual drive (no)
node --max-old-space-size=14000 scripts/vis_fit.mjs 6 both 1200 # the loom, end to end
```

The exogenous drive was the wall. It is a Poisson rate, and doc 33 listed it as non-differentiable
alongside `minSyn` and the integer delays. It is now an input: `driveIdx` names the neurons whose rate
is differentiated and `backward` returns dLoss/d(rate) per neuron per drive epoch. The surrogate is the
same construction the spike threshold uses. The smooth model it stands in for is `driveSoft: true`,
where a driven neuron spikes with graded amplitude `s = sd + (1 - sd) * st` — it fires because it was
driven, or, failing that, because it crossed threshold — and that model is exactly differentiable in
the rate. The sampling forward is left bit-identical to `src/lif.js` and the adjoint drops cross terms
of order `sd`, which the coupling's 200 Hz cap bounds at 0.1.

**The forward pass is bit-identical to the shipped kernel, and getting there was not free.**
`scripts/vis_equiv.mjs` compares the JavaScript optic lobe against `fv_step` in the wasm kernel on the
real loom at full scale: 0 of 3,196,830 node-steps differ, and 0 of 2,175,495 pair-steps of drive rate.
The first version was not: wasm rounds to f32 after every operation and JavaScript evaluates
`weight[k] * r` in double precision and rounds only on the store, one rounding fewer. That disagreed by
about 1e-6 on 60% of node-steps — and the coupling's deadband turns a 1e-6 disagreement into a 5 Hz
difference in what the CNS is told it saw. `Math.fround` at each operation closes it exactly.

**The joined adjoint is correct.** `scripts/vis_grad_check.mjs` makes every stage smooth — soft
threshold, soft drive, no deadband — and requires central finite differences to agree. Sixteen
gradients pass, including every one that crosses the join:

| parameter | adjoint | finite difference | rel. error |
|---|---|---|---|
| `wSyn`, through the optic lobe | 55.4917 | 55.4890 | 3.2e-5 |
| `vThresh` | −62.4424 | −62.4438 | 2.6e-5 |
| `depU` | −163.503 | −163.530 | 1.4e-4 |
| coupling `gain` | 0.538859 | 0.538830 | 5.4e-5 |
| flyvis `bias[243]` | 4.98018 | 4.98012 | 2.4e-6 |
| flyvis `weight[5886]` | 25.9231 | 25.9231 | 3.7e-7 |

An earlier version of that script reported twenty rows passing and it was worthless: its tolerance
included the finite difference's own noise floor, so ten rows whose adjoint and difference were both
under that floor counted as agreement, and three more were structural zeros — probes on optic-lobe
nodes the loss could not reach, because the coupling read the photoreceptors rather than the interior.
Rows under the floor are now labelled rather than passed, which is the same failure doc 33 already
records for `h = 1e-4` and is worth stating twice: a gradient check that cannot resolve the gradient
reports agreement.

### The fit does not run, for three reasons, and none of them is the join

`scripts/vis_fit.mjs` fits the benchmark's visual term — a looming disc should make the giant fibre
DNp01 spike about twice and translational flow should not make it spike at all (von Reyn et al. 2014) —
on the benchmark's own timing. It runs at full scale: 165,122 CNS neurons and two 45,669-node optic
lobes, one forward pass 5 s, one backward 15 s, 570 MB. The loss does not move, and the three reasons
are worth more than the fit would have been.

**Most of the coupling is dark.** On a loom, 94% of the 62,157 pair-steps sit at or below the
deadband and 0.3% are saturated at the 200 Hz cap, leaving 5.7% in the band where a gradient exists.
The deadband is also a discontinuity rather than a soft floor: `rate = a > 0.02 ? min(200, 250a) : 0`
jumps from 0 to 5 Hz as a node rises past rest. No gradient exists there in either direction. That is
a property of the shipped coupling, not of the adjoint, and it is the first number to check when a
visual fit will not move — `VisualChain.stats()` reports it.

**The adjoint overflows at this scale over this window.** At the `surrogateBeta` of 2 that
`src/lifdiff.js` ships and `grad_fit.mjs` uses, a 1200-step visual assay returns 19,619 of the 165,122
per-neuron gradients and all nine globals as non-finite. They used to be silently zeroed; `backward`
now returns the count, because a zero from an overflow is indistinguishable from a zero from a
parameter having no influence, and that is how a 1e34 gradient reads as a plausible one. The cause is
not the join: this loss reaches 38% of the CNS where the sugar chain reaches a few hundred neurons, so
far more of the network transmits adjoint at every step. Widening the surrogate stops the overflow and
does not rescue the direction. On one taped trajectory, changing only `surrogateBeta` between backward
passes:

| beta | ‖grad‖ over the gains | gains zeroed | cosine to the previous beta |
|---|---|---|---|
| 2 | 2.0e31 | 19,619 | — |
| 5 | 9.1e13 | 0 | −0.0000 |
| 10 | 1.2e19 | 0 | 0.0004 |
| 20 | 9.8e19 | 0 | 0.9047 |
| 50 | 6.8e7 | 0 | 0.5812 |
| 100 | 3.6e1 | 0 | 0.0012 |

Adjacent surrogate widths give very nearly orthogonal gradients. Clipping fixes a scale and cannot fix
a direction, and a descent direction that rotates that far when a smoothing constant moves is not a
property of the model. **This also revises the claim above** that truncation was never buying
stability. That was measured at up to 20,000 neurons and 300 steps, where it holds; at 165,122 neurons
over 1,400 steps the full-window adjoint reaches 1e34 and the windowed ones are no better — 700 ms and
400 ms agree at cosine 0.98 and every shorter window is orthogonal to its neighbour. Truncation is not
a workaround here because there is no window at which the direction is stable.

**And the differentiable CNS was not the shipped CNS.** This one predates the join and was the largest
of the three. `makeBrain` in `scripts/calib_eval.mjs` applies four things `src/lifdiff.js` had no
equivalent of: a per-cell-type gain on outgoing weights (`typeGains`), per-class thresholds and
physiology (`applyClassPhysiology`), the sign of modulatory neurons (`modulatorySign`), and a static
octopamine tone (`Neuromod`, and `neuromod: true` is the fitted default). `src/diffsetup.js` now calls
those same four functions and returns what `LIFDiff` takes, so there is one definition rather than two:

| | carried by | fitted? |
|---|---|---|
| size-based PSP scaling | `sizeLog` | `sizeAlpha` is |
| Kenyon-cell threshold | `thrMask` | `kcThreshold` is |
| lamina monopolar bias | `biasMask` | `laminaBias` is |
| octopamine tone, and the rest of the class physiology | `thrOffset`, 14,074 neurons | no |
| per-cell-type outgoing gain | `outScale` | not here; `logGain` is its learnable version |
| octopaminergic fast synapses removed | `preSign`, 554 neurons zeroed | no |

`outScale` and `thrOffset` are new inputs to `LIFDiff`, threaded through the forward pass and the
adjoint alike — `scripts/grad_check.mjs` now runs with a random gain and threshold offset on every
neuron, so all fourteen of its rows are also a check that they reached the backward pass. The one
`VisualChain` fixes itself is the sensory mask: the shipped model marks every flyvis-coupled neuron
sensory so its CNS inputs are gated off, and the superclass-derived mask marks none of the 62,157 —
they are `ol_intrinsic` and `visual_projection`, not sensory.

On the sugar assay this closes the gap. `scripts/lifdiff_equiv.mjs`, against the numbers
`brain_params.json` records for the same parameters:

| observable | before `diffsetup` | with it | the shipped kernel |
|---|---|---|---|
| MN9, sugar | 33.6 Hz (0.64) | 50.00 ± 2.65 Hz (0.95) | 52.71 Hz |
| GNG232 relay | 22.19 Hz (1.28) | 17.50 ± 1.35 Hz (1.01) | 17.40 Hz |
| DNge080 relay | — | 19.69 ± 3.12 Hz (0.95) | 20.73 Hz |

That comparison had to be built twice, and the first version was wrong in a way worth recording.
`sugarMN9` is not a rate over the stimulus: `calib_eval` runs 400 ms of sugar, then 300 ms with the
drive switched off, counts spikes over the whole 700 ms and divides by 0.4 s, deliberately including the
persistent firing after the stimulus ends. Scoring a flat 400 ms against it charged the model for a tail
it never ran and read as a 41% shortfall where the real one was 36%.

### The visual pathway still disagrees, and in the opposite direction

Matching on the sugar chain is not matching. `scripts/lifdiff_loom_equiv.mjs` holds the optic lobe and
the coupling identical by construction — it records the drive rate the shipped brain computes for all
62,157 coupled neurons at every epoch of the benchmark's loom, then replays that recording into
`LIFDiff` — so anything left is the spiking CNS:

| | shipped kernel | `LIFDiff`, same drive |
|---|---|---|
| DNp01, spikes/neuron after onset | 2.00 | **27.00** |
| LC4 | 2.21 | 13.52 |
| LPLC2 | 0.17 | 0.89 |
| DNp02 | 20.00 | 51.50 |
| total network spikes | 433,130 | 740,717 (1.71x) |

The differentiable model is *hyperactive* under visual drive, not silent, which rules out the class of
explanation that fixed the sugar assay: a missing gain or a missing threshold offset would suppress
activity, not multiply it. What distinguishes the two assays is the drive regime. Sugar drives a few
hundred neurons at 100 Hz and agrees; the loom drives 62,157 neurons — 38% of the CNS — at a mean of
1.7 Hz, and does not. Whatever is left only shows up when most of the network is receiving a little
input, which is the regime every visual assay is in. That is where to look next, and the two equivalence
scripts are the instruments for it.

This reaches backwards. The whole-CNS fit reported earlier in this document started from MN9 at 25 Hz
and drove it to 62.5 Hz against a 60 Hz target, while the shipped model at those parameters sits at
52.7 Hz. The fit was real and the adjoint was right; the 25 Hz was the missing structure, not the
model's resting behaviour, and that fit is worth rerunning now that `grad_fit.mjs` goes through
`src/diffsetup.js`. **The gradient machinery is built end to end and verified end to end: the forward
pass is bit-identical to the shipped kernel on the optic-lobe half and within sampling error on the
sugar chain, and every gradient that crosses the join matches finite differences. What still blocks a
visual fit is not the join and not the adjoint — it is that the CNS half diverges under sparse drive,
and that the surrogate gradient has no stable direction at this scale over this window.**
