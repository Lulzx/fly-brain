# 48. Cracking the in-phase mode: a mechanism screen on the external cord

Doc 47 found that the external cord, under the shipped kernel, settles into a bilateral
in-phase population mode near 8 Hz and never produces an anti-phase leg gait. This document
asks the follow-up: what does it take to break that mode? Five candidate mechanisms were
added to the kernel and screened as ensemble axes, each checkable on its own and in
combination.

| file | contents |
|---|---|
| `cordx2.bend` | the extended ensemble: a 16-slot delay ring with per-cell delay classes, a synaptic resource term, side-split proprioceptive feedback, a transient unilateral drive protocol, and an inhibitory-gain axis |
| `scripts/prep_cord_banc.py` | the packer, extended: a per-cell delay column (a volume^(1/3) cable-length proxy, mean-matched to the nominal 4 steps, clamped to the ring) and side-coded proprioceptor entries |
| `scripts/cordx2_search.mjs` | the same in-phase statistic as doc 47, plus matched-pair mechanism deltas and per-member axes |
| `ext/cord2_search.{bin,json,md}` | the screen output and report (gitignored) |

## 1. The screen

512 members over nine bits: the commissural, 13A, and 13B gain axes; inhibitory gain
(normal, x0.6); a two-bit proprioceptive mode (open, shared 20 ms, side-split 20 ms,
side-split 80 ms); per-cell delay classes (off, on); synaptic depression (off, depU 0.2 with
resource recovery 0.0025/step); and a unilateral kick (off, or +40 Hz on the left
proprioceptors for the first 200 ms). Crossed with the same six named perturbations as
doc 47. 2000 steps of 0.5 ms, 3072 runs.

Depression is implemented as a presynaptic resource `res`: each firing decrements it by
depU, it recovers toward 1 at kRec per step, and `depU = 0` is an exact no-op. Side-split
feedback routes each motor pool's tally to the proprioceptors of the same side only, so the
loop is no longer symmetric by construction.

## 2. What the median says, and what the tail says

| mechanism | matched median delta in-phase | median on | min on |
|---|---|---|---|
| delay classes | +0.001 | 0.804 | 0.181 |
| depression depU 0.2 | -0.005 | 0.784 | 0.242 |
| kick | +0.014 | 0.821 | 0.181 |
| inhibitory x0.6 | +0.027 | 0.823 | 0.181 |

Read by medians, nothing works: the baseline in-phase fraction sits at 0.797 and every axis
leaves it within +/-0.03. But the median hides a bimodal break — 71 of 512 members fall
below 0.55, and they break along two different routes.

**Route one: starvation.** Most depU members that lose the lock lose it because the pools
go silent — depU costs ~200 Hz of median pool rate, and its low-in-phase members sit at
0-20 Hz of motor output. Depression converts synchrony into asynchrony by starving the
network, not by organising alternation.

**Route two: decorrelation with live pools.** The delay-classes members that crack the mode
keep the motor pools firing (m=65: in-phase 0.19, pool 186 Hz; m=94: 0.20, 214 Hz), and so
do the kick members (m=257: 0.25, 181 Hz). The standout is m=329 — commissural x3, reduced
inhibition, delay classes, kick, loop open — which reaches in-phase 0.18 with a pool rate of
603 Hz. Its bilateral spectrum is anti-phase *dominated*: the odd power P- exceeds P+ by
~4.5x at 3.9 Hz and ~18x at 11.7 Hz. That is not the 0.5 floor of unrelated sides; the two
hemicords are oscillating in opposition. Delay heterogeneity is the ingredient the
population-level break needs — nearly every member of the deep tail carries it — and a
symmetry breaker (kick or commissural gain) pushes it over.

The proprioceptive modes, matched against open twins: shared 20 ms -0.003, split 20 ms
-0.044, split 80 ms +0.016. Side-split feedback at a short delay is the only loop setting
that pulls the median down, and several mid-tail members carry it — but it does not produce
anti-phase structure on its own.

## 3. What did not happen

No member produced a coordinated anti-phase leg gait. The leg-pair medians sit at
0.41-0.51 — the silent-pool floor — and the three members that pass the gait instrument's
periodicity bar (m=73, 77, 93) do so on pool rates of 450-625 Hz with leg pairs still
in-phase at 0.58-0.99: coherent bilateral bursts, not stepping. The anti-phase structure the
screen finds lives in the population mode, not in the motor pools' relative phasing.

Reduced inhibition moved the wrong way (+0.027): weakening inhibition strengthens the lock,
which suggests the in-phase mode is not maintained by an inhibitory scaffold — consistent
with it being an excitatory resonance the inhibition was holding in check.

## 4. Where this leaves the question

The doc-47 conclusion — the in-phase mode is a model-class property — survives, but the mode
is not unbreakable. The crack needs two ingredients at once: delay heterogeneity, which lets
distant cells stop sharing one loop time constant, and an asymmetry source that selects which
side leads. A transient kick was enough to tip some members into an anti-phase-dominated
state that persisted for the remaining 1.8 s of the run — so the anti-phase basin exists, is
not a knife-edge, and is reachable.

What the anti-phase state lacks is structure: population-level opposition without leg-pool
phasing is churn, not a gait. The missing piece is plausibly whatever couples the two-sided
mode to motor output — in a real animal that coupling is the musculoskeletal plant feeding
side-specific proprioceptors, which the side-split mode here only gestures at (a shared
pool tally, not a limb signal). The candidate list that remains is narrower than the one
this screen started with: not delays alone, not depression, not inhibition — but an
asymmetric, body-coupled sensory return on top of heterogeneous delays.
