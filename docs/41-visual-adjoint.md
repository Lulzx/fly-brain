# 41. Making the visual twin fittable

[Doc 33](33-differentiable-brain.md) ends with the joined chain built and verified and the visual fit
not running, for three reasons: most of the coupling sits outside the band where a gradient exists,
the carried adjoint overflows at 165,122 neurons over a 600 ms window, and the differentiable CNS was
not the shipped CNS. The third is fixed there (`src/diffsetup.js`). This document covers what the
first two became under S4.4 and S4.5, and what the first permitted fit — S4.6 step 4a, six gains on
the escape descending neurons — produced. The short version: the engineering all works, the
stabiliser that works is not the one the spec hypothesised, and the fit that then ran is a null
result worth keeping.

## S4.4 A C¹ coupling, shipped next to the hard one

The shipped flyvis→CNS join is `rate = a > 0.02 ? min(200, 250a) : 0` — a deadband whose edge is a
5 Hz discontinuity and a cap whose knee is a kink, so the adjoint has no defined derivative at
either. `src/visdiff.js` now carries a second map selected by `coupling: 'soft'`:

```
rate_soft(a) = inner(250a) * σ(8000 · (a − 0.02))
inner(x)     = 200 − srelu(200 − x, 0.05)        — a smooth min(x, 200)
```

The gate sigmoid moves the 0→5 Hz transition inside |a − 0.02| < 0.5e-3 and the smooth cap removes
the knee at 0.8. `scripts/coupling_error.mjs` measures it against the hard map and against the spec's
bands:

| region | |soft − hard| |
|---|---|
| a ≤ 0.02 − 0.5e-3 | 0.088 Hz (spec: < 0.5) |
| edge band | 2.50 Hz at a = 0.02 — exactly half the jump, the minimum any continuous map pays |
| live band | 0.092 Hz (0.05% of cap) |
| saturated | 0.005 Hz |
| a = 0 | 0 — the map invents no drive at rest |

On a grey field (40 optic-lobe steps × 30,946 mapped nodes) the mean quiet-column rate is 0.0000 Hz
under both maps, against the spec's 1 Hz ceiling. `FlyVisionFV` takes `coupling: 'soft'` as an
option so the arena can A/B the smoothing; the shipped default stays `hard`, and nothing in the
benchmark path changes.

The point of the soft map is that `vis_grad_check.mjs` can now run on the shipped constants instead
of suspending them: `--coupling=soft` passes the finite-difference gate with deadband 0.02 and cap
200 in place — 17 gradients checked, 7 under the FD noise floor, none wrong.

## S4.5 Stabilising the reverse kernel

Three engineering items and one gate.

**Checkpointing.** The CNS tape keeps its every-16-steps checkpoints. The optic-lobe tape now
checkpoints every 4 steps — a state snapshot (183 kB) plus the luminance input per step (2.9 kB),
with the backward pass replaying at most four steps per segment. A 1200-step LIF window is 300
optic-lobe steps: ~15 MB instead of ~500 MB per eye, and `vis_grad_check` passes unchanged.

**Adjoint clip.** `LIFDiff` takes `adjClip`: every carried adjoint component (`lv`, `lgE`, `lgI`,
`lad`, `lres`, and the propagated target/residual terms) is bounded to ±Amax at each backward step,
so Jacobian products cannot compound. On the 1200-step loom trajectory at the shipped `surrogateBeta`
of 2:

| Amax | result | ‖grad‖ over logGain |
|---|---|---|
| none | non-finite (the known overflow) | ~5e34 |
| 1000 | finite | 1.19e5 |
| 100 | finite | 1.31e4 |
| 10 | finite | 1.57e3 |
| 1 | finite | 1.98e2 |

**The window gate.** The spec's acceptance is cosine(gradient at a 150-step window, gradient at a
600-step window) ≥ 0.5 — below it, longer windows are a different direction and the window is
undefined. With `adjClip = 100`:

| surrogate configuration | cosine(150, 600) |
|---|---|
| β = 2 everywhere | 0.232 |
| β = 5 everywhere | 0.436 |
| typed: base 2, `ol_intrinsic` 5, `visual_projection` 5 | −0.142 |
| **β = 10 everywhere** | **0.822 — pass** |
| typed: base 5, `ol_intrinsic` 10, `visual_projection` 10 | 0.045 |
| typed: base 2, `visual_projection` 10 | 0.170 |

The typed-surrogate hypothesis is falsified in every split tested: widening the surrogate only where
the adjoint is densest does not stabilise the window — widening it *globally* does. That is worth
stating plainly because doc 33 recorded the opposite worry, that widening β rotates the gradient
(betas 2→5→20 gave near-orthogonal directions on one taped trajectory). Both are true: between close
betas the direction rotates, and at β = 10 the rotation settles — the surrogate at that width is a
genuinely different smooth model, and it happens to be one whose 150- and 600-step gradients agree.
β = 10 is adopted for visual fits on that evidence, not because it produced a descent; the gate is a
consistency check between windows, which a descent-shaped screenshot cannot pass. `typedBeta` in
`src/diffsetup.js` remains available — `LIFDiff` accepts a per-neuron β array — and the negative is
recorded here rather than silently reverting the option.

**Finite-difference gate.** Before any full-CNS visual fit, `vis_grad_check.mjs` on a 2k-neuron
visual subgraph: PASS, 17 gradients checked, 7 under the FD floor.

## S4.6 step 4a: the escape-chain gains

The first permitted class is deliberately minimal: per-neuron `logGain` on the six neurons of the
three escape-DN types — DNp01 (the giant fibre, 2 neurons) and the takeoff pair DNp02/DNp04 — deployed
through the existing `neuronGainTable` → `typeGains` path. `scripts/loom_refit.mjs` fits them on the
benchmark's loom/flow stimuli through the soft coupling, β = 10, `adjClip` = 100.

**The twin converges.** Three Adam iterations take the loss 1.02 → 0.016: the twin's loom GF count
goes 1.0 → 2.0 against the 2.0 target, takeoff-DN rate holds ~33 Hz, flow false alarms stay at zero.
Only 4 of 6 gains move (all to ≈ −0.13). That number is the finding: `logGain[i]` scales neuron *i*'s
outgoing weights, and a neuron's outgoing gain cannot change its own spike count except through
recurrence — DNp01 #0 received exactly zero gradient. The gains that moved did so through feedback
loops, which is a weak and incidental lever for an objective defined on the neuron's own firing.

**The kernel disagrees.** Deploying the fitted table into the shipped benchmark, three seeds:

| seed | sugar term | loom term | score | loomGF |
|---|---|---|---|---|
| 7 | 0.488 → 0.344 | 0.933 → 0.817 | 0.701 → 0.676 | 2.0 → 1.5 |
| 8 | 0.456 → 0.638 | 0.975 → 0.967 | 0.712 → 0.725 | 2.5 → 2.0 |
| 9 | 0.519 → 0.481 | 0.975 → 0.958 | 0.728 → 0.722 | 2.0 → 2.0 |

Nothing is consistently moved: the frozen tests are unbroken within noise (the spec's fail bound is
sugar ±0.05 of *benchmark*; the per-seed swings average to ~0), `quietMN9` stays at its known
pinned-wrong 0 (that term is reserved for 4b), and the loom term does not improve. In the arena's
disk-loom assay the fitted table changes escapes from 0/10 to 1/10 — one Bernoulli flip, not a hit
rate.

**Why the twin's win did not transfer.** The twin under the soft coupling sits at a different
operating point — GF count 1.0 where the shipped kernel under hard coupling reads 1.9–2.5 on the same
stimulus — so the direction that fixes the twin's shortfall is fitted against a gap the kernel does
not have. A gain class fitted in one model does not repair another model's deficit; it only perturbs
trajectories, which is what the ±0.1-term noise shows.

**Verdict: recorded negative.** 4a as specified — output-side gains on the escape DNs — is a null.
The parameter class is structurally mismatched to the objective: what would move `loomGF` and the
takeoff-DN rates are gains on the *input* side of those neurons (T4/T5 → LC4/LPLC2 → DNp), which is
the 4c class. The ladder is ordered and 4a produced no stable improvement, so 4b and 4c are not
entered; if they are, the honest starting point is input-side gains, and the operating-point gap
above says the fit should be validated against the shipped kernel's baseline, not the twin's.

`loom_refit.json` (4 nonzero gains, versioned metadata) is committed as the artifact. Rejecting the
fit means the shipped `brain_params.json` is unchanged.

## Status against S4.8 acceptance

| criterion | state |
|---|---|
| twin audit green | yes — bit-identical on all three traces ([doc 33](33-differentiable-brain.md)) |
| `vis_grad_check` finite | yes — and now passes on shipped coupling constants via the soft map |
| 4a improves disk-loom hit rate without breaking sugar→MN9 by > 0.05 | **no** — 0/10 → 1/10, within noise; frozen tests unbroken |
| GPU adjoint (optional) | done — [doc 43](43-gpu-adjoint.md); both gates pass, CPU replay is the remaining share |

The spec's named interesting negative — a correct twin that cannot fit loom and self-motion together
— is not yet established: 4a's failure is a parameter-class mismatch, not a demonstrated
identifiability conflict. That claim needs the 4c fit (input-side gains) run under the same frozen
gates.
