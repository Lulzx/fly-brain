# 20. Roadmap

Each item says what to build and what would count as success. Where the item is an experiment rather
than an engineering task, it also says what a negative result would mean — an item with no stated
failure mode is engineering, and an item with one is science, where the negative result is often the
more valuable outcome.

The ordering inside each part is by dependency, not by ambition. Part M is the current priority and
is reachable now. Part A is the rest of what is reachable from what is already in the repository.
Part B needs data this project does not have but that exists. Part C needs data nobody has yet, and
is stated precisely so that the cost of getting it is visible.

---

## M. The motor programme — the current priority

**Why the motor side goes first.** Every other benchmark in this repository is a number someone
chose. The physiological objective scores firing rates against published summaries; the behavioural
one scores against targets this project set ([doc 35](35-behaviour-ladder.md)); both can be gamed,
and [A7](20-roadmap.md) documents three separate occasions on which they were. Motor output is the
exception. A fly either holds its posture or falls over, and no weighting of terms changes that. The
motor neurons are the last stage the connectome owns before the body takes over, so they are the one
place where "does the wiring produce the behaviour" has an answer that is not a matter of scoring.

The motor side is also where this model's honest failures are concentrated, and they are already
measured rather than suspected:

| what | measured | where |
|---|---|---|
| leg motor neurons mapped to muscles | 439 cells, 170 muscle groups | [doc 9](09-bodymap.md) |
| motor neurons with no annotated muscle | **422 cells across 285 types** (abdominal, neck, haltere) | [doc 9](09-bodymap.md) |
| full-connectome motor mode | **cannot hold posture** | [Limitations](19-limitations.md) |
| wing motor pools, ground vs flight | 33–109 Hz either way; power pool changes **7%** at takeoff | [Flight](24-flight.md) |
| wing steering asymmetry vs commanded turn | **\|r\| ≤ 0.08** in all six pools (64 cells) | `scripts/wing_mn.mjs` |
| proboscis MN9 with no tastant | **26.6 Hz** against a 10 Hz target — the one benchmark term stuck at zero | [A7](20-roadmap.md) |
| motor-neuron rate to muscle force | half-maximal at 17 Hz, saturating | [Motor](12-motor.md) |

Read together these say something specific: the motor neurons are wired and active, and nothing that
reaches them carries the behaviour. That is a *locatable* gap rather than a general shortfall, which
is what makes it the right thing to work on next.

### M1. A descending command the wing system can follow
`scripts/wing_mn.mjs` measured the wing pools through a flight and found no flight-versus-ground
contrast and no steering asymmetry ([doc 24](24-flight.md)). The cause is upstream: flight is started
and maintained by the endogenous module, so no descending signal ever tells the wing motor neurons
that the animal is airborne. Find the descending population that should carry it — the candidates are
in the graph and unscored — and drive flight initiation and maintenance from it rather than from the
rule.

**Success:** the power pool separates flight from walking by more than the 7% it manages now, and at
least one steering pool's left–right asymmetry correlates with the commanded turn at |r| ≥ 0.5. Both
numbers come out of `wing_mn.mjs` as it stands, so the criterion is already implemented.
**The interesting negative:** if no descending population in the graph separates flight from walking,
then either the release's descending annotation is insufficient for flight or the model's excitability
is wrong in a way that erases a real signal — and the two are distinguishable, because the first
predicts that the *recorded* DN populations (B1) do separate them while the model's do not.

### M2. Stepping from the nerve cord
Moved here from [A2](20-roadmap.md), because it is the same problem as M1 one body-part over. The
full-connectome motor mode does not hold posture ([Gait](13-gait.md)), so walking is executed by a
CMA-ES-optimised tripod generator and the connectome supplies only the decision to walk. Fit the leg
premotor circuits against the FlySuite walking data using the adjoint from
[doc 33](33-differentiable-brain.md), rather than fitting a generator to trajectories.

**Success:** posture held in `'connectome'` mode for a full 20 s foraging scenario, and a stepping
rhythm that is measured rather than imposed — the FlySuite comparison in [doc 13](13-gait.md) is the
scoring function.
**The interesting negative:** if a fitted VNC still cannot hold posture, the missing quantity is not
in the graph. The candidates are proprioceptive feedback delay, the muscle force–frequency model
(M4), and the absence of the leg's own reflex loops at the timescale they operate on — and a failure
here would be the strongest evidence this project can produce that a connectome plus a fitted gain
per neuron is not sufficient for motor control, which is a claim about the abstraction level rather
than about the fly.

### M3. The proboscis motor neuron that cannot be quieted
`quietMN9` is the only scored term that sits at exactly zero in every seed and every rung of the
ladder: MN9 idles at 26.6 Hz with no tastant against a target of 10. [A7](20-roadmap.md) notes that
it is also the one term in the objective that punishes a busy baseline, and that the two facts are
probably the same fact. [Limitations](19-limitations.md) names the mechanism — MN9 is partly driven
by olfactory channels downstream of the antennal-lobe spread, so a fly in odour extends its
proboscis while walking.

**Success:** MN9 below 15 Hz with no tastant, *without* losing the sugar-evoked extension (the
`sugar` and `tarsalPER` terms hold).
**The interesting negative:** if no parameter set does both, the olfactory bleed into MN9 is
structural, and fixing it means the antennal-lobe lateral inhibition that
[Limitations](19-limitations.md) records as unmodelled — which makes this item a test of the AL gap
rather than of the feeding circuit, and locates a whole-brain error at one measurable motor neuron.

### M4. The force–frequency model between motor neuron and muscle
Muscle activation is `1 − exp(−rate · ln 2 / 17 Hz)` for every muscle in the animal
([Motor](12-motor.md)). One saturation constant stands in for the whole neuromuscular junction: no
per-muscle force–frequency curve, no fibre-type difference between the fast tergotrochanteral muscle
and a slow postural one, no calcium dynamics, and no history dependence. It is the smallest piece of
supplied machinery on the motor side and the one that M1 and M2 will both run into.

**Success:** per-class force–frequency curves from the insect muscle literature, with the ladder
re-run to say what the single constant was costing.
**The interesting negative:** if the behavioural ladder cannot tell a per-class muscle model from the
single constant, then motor-neuron *rate* is not the quantity the body reads at this level of
description, and the modelling effort belongs upstream — which would be a useful thing to know before
anyone fits 165,122 gains against motor output.

### M5. The 422 motor neurons with nowhere to go
285 motor-neuron types — 422 cells — carry no muscle assignment in v1.0: abdominal (115 types), neck
(42), haltere and some wing. They are simulated, they spike, and nothing they do can reach the body.
The neck motor neurons matter most, because head stabilisation is a visual-feedback loop that the
model currently cannot close at all.

**Success:** an assignment for the neck and haltere pools from the morphology and nerve, with the
rest stated as a bound: what fraction of motor output this model structurally cannot express.
**The interesting negative:** if the unmapped pools turn out to carry substantial descending drive,
then every behavioural score in this repository is being produced by a motor system missing a known
fraction of its output, and that fraction belongs in [Limitations](19-limitations.md) as a number.

### M6. Motor output as the identifiability observable
[Doc 34](34-individual-validation.md) freezes six observables for the individual-identifiability
experiment, and [C1](20-roadmap.md) is the experiment the rest of this roadmap exists to make
possible. The observables are behavioural because behaviour is what a body makes measurable — and the
motor neurons are where the model's behaviour is generated, which makes them the natural place to
read an individual difference out.

The question this item asks is narrow and answerable in simulation now: **does motor-neuron activity
carry more individuating information than the behaviour it produces?** The body is a low-pass filter
with 17 Hz saturation, six legs and a stepping generator in between; if two models differ at their
motor neurons but not in what the fly does, the observable to record in C1 is the motor neurons, not
the trajectory.

**Success:** run `scripts/identify_test.mjs`'s statistic on simulated pairs, scoring once on motor
pool rates and once on doc 34's behavioural observables, and report which separates the models at a
smaller fit error.
**The interesting negative:** if the behaviour separates individuals and the motor rates do not, the
low-pass story is backwards and the body is *adding* individuating structure rather than removing it
— which would matter to anyone proposing to validate an upload against recorded neural activity
rather than against what the animal does.

---

## A. Reachable now

### A1. The substitution ladder against behaviour
[Doc 31](31-ablation-ladder.md) runs both arms — sensitivity and refit — against the 17-assay
*physiological* benchmark. The substitutions that [Chapter 16](textbook/16-upload.md) treats as most
informative are behavioural, and they cannot break there, because posture, stepping and bout structure
are supplied by machinery outside the graph ([Limitations](19-limitations.md)).

Build the same two arms over `scripts/behavior_report.mjs` and `scripts/diag_walk.mjs`: five
scenarios, four seeds, scored on flips, deaths, distance to food, feeding latency, bout-length
distribution and escape rate. An embodied evaluation takes ~40 s against 3.3 s for a physiological
one, so a 20-rung by 12-seed sweep is about three hours rather than three minutes, and the refit arm
needs either a cheaper surrogate objective or a reduced rung set.

**Success:** a table with the same shape as doc 31, for behaviour.
**The interesting negative:** if the embodied assays prove *less* sensitive than the physiological
ones, the supplied gait and scheduling machinery is masking the brain's contribution. The model would
be robust for the wrong reason, and the ladder would be measuring the scaffolding rather than the
nervous system.

### A2. Close the supplied-machinery gaps, one at a time
Four behaviours are produced by code rather than read out of the graph. Each is separable work with
the same test: does the behaviour survive when its rule is deleted? Two of the four are motor and
have moved into Part M — stepping is [M2](20-roadmap.md) and the flight command is
[M1](20-roadmap.md). What is left here:

- **Bout structure from the circuits.** Walk, pause and saccade timing comes from a scheduler whose
  statistics are taken from Maye et al. 2007 and Geurten et al. 2014 ([Behaviour](23-behaviour.md)).
  The candidate substrate is the descending network of Braun et al. 2024.
- **The giant-fibre gap junction.** Added by hand, because the packed chemical graph carries no
  electrical edges. The male CNS release ships no gap-junction table; the IR in
  [doc 29](29-connectome-compiler.md) already carries a second symmetric graph for the worm, so the
  slot exists as soon as a table does.
- **Dopamine gating of feeding** (Marella et al. 2012) — the one major modulator not yet in
  [Neuromodulation](25-neuromodulation.md).

### A3. Pathway-specific fitting, by gradient — the goal was met, and not by a gradient
The long-standing version of this item proposed fitting a handful of synaptic scale factors along the
escape chain (LC4, LPLC2, giant fibre, DNp02, DNp04) and the feeding chain (GRNs, GNG232, DNge080,
MN9). [Doc 33](33-differentiable-brain.md) makes the scale factors unnecessary: fit a gain on every
neuron in the chain and let the gradient decide where the correction belongs.

The premise was that `loomGF` is 0 — escape riding on DNp02 and DNp04 rather than on the giant fibre,
and [Neuromodulation](25-neuromodulation.md) recording that an octopamine gain change did not fix it.
That premise was false, and in the way most likely to be mistaken for a modelling failure: the
benchmark was measuring a number that could not move. Photoreceptors are histaminergic, so driving them
inhibits L1–L5 rather than exciting them, and the lamina relay is silent at every stage — but the
photoreceptor-driven block wrote its `loomGF` over the flyvis-driven measurement above it, so 60% of
the loom term's weight was reading a structurally-zero quantity and the fit was being told that zero was
correct. [Doc 31](31-ablation-ladder.md) was already carrying the symptom without recognising it:
`no_delay` broke the loom term hardest of any ablation, which is not what a dead term looks like.

Repairing the benchmark and refitting the nine globals puts `loomGF` at 1.0–2.0 spikes per neuron
against von Reyn et al. 2014's 1–3, with `flowGF` at 0 in all twelve seeds — the stated success
criterion, reached by the population search rather than by the per-neuron gradient this item proposed.
The per-neuron gradient is still the right tool for the feeding chain and for anything the nine globals
cannot reach, but it is now a method in search of a target rather than a fix for a known break, and it
belongs with [B1](20-roadmap.md) and [C1](20-roadmap.md) where there is an objective with enough
dimensions to need it.

**What the repair did not fix** is the subject of A7 below.

### A4. Uncertainty inside the objective, not beside it
[Doc 32](32-synapse-uncertainty.md) produces a reliability and an empirical-Bayes weight for every
connection, and the benchmark then consumes the weight as a point estimate — throwing away the
uncertainty it just measured. Two steps:

- Weight each connection's contribution to the loss by its precision, so a fit is free to move a
  3-synapse connection and constrained on a 100-synapse one. This matters because doc 31 finds graded
  weight to be the most load-bearing quantity in the model, and doc 32 finds it to be the one the
  reconstruction measures worst. [Doc 35](35-behaviour-ladder.md) complicates the first half — the same
  weights are free in the arena — so the item's justification is now the *threshold*, which both ladders
  agree is expensive and neither can refit away, rather than the weight values.
- Extend the calibration set to the optic lobe. The one-cell-per-side trick covers 6.4% of the CNS and
  excludes every columnar type by construction, so the optic lobe currently inherits a noise model
  fitted elsewhere. Columnar types have a different replicate available: the columns themselves, which
  repeat across the retinotopic array.

### A5. Make the adjoint affordable — partly done, and the measurement changed the item
The three wins this item proposed have now been measured
([doc 33](33-differentiable-brain.md#truncation-was-not-necessary-and-was-the-largest-source-of-error-in-the-fit)),
and two of them do not survive:

- **Longer truncation windows — done, and it was never a cost problem.** The premise that the adjoint
  diverges without truncation is false: at 20,000 neurons and 1.6 M connections over 150 ms the adjoint
  stays finite and matches central finite differences to better than 1e-2, while a 25-step window is
  wrong by up to 76% (and once by a factor of 13 with the wrong sign). Truncation was pure bias, and it
  costs nothing to remove — the backward pass is 1,389 ms with the full window against 1,416 ms with a
  25-step one. The default is now no truncation, in `src/lifdiff.js` and in `scripts/grad_fit.mjs`.
  This was the scientifically consequential half of the item and it is closed.
- **The event-driven wake list is worth much less than it looks.** The surrogate derivative is evaluated
  at every neuron, spiking or not, so the adjoint's sparsity is set by how far back the loss reaches
  rather than by how active the network is. Measured on the whole CNS, the adjoint state is nonzero at
  3.5% of neurons per step with a 25-step window and 13.3% with the full window — bounded at ~7× the
  neuron loops, and nothing at all on the CSR traversal, which is not neuron-indexed.
- **WebGPU for the adjoint** ([doc 27](27-webgpu.md)) is what is left, and it is still the right target:
  the remaining cost is one pass over eleven 165,122-element arrays per step plus a scatter over 10.5 M
  edges, both of which are exactly the shape a GPU wants.

**What success would now look like:** the WebGPU adjoint, at which point a gradient over 165,122
parameters costs less than one benchmark evaluation rather than two.

### A6. A second individual, through the IR
[Doc 29](29-connectome-compiler.md) runs on the fly and the worm. FlyWire (139,255 neurons, adult
female) is the obvious third dataset, and it is more than a count: it is a *different individual of
the same species*, which makes it the only cross-individual comparison available anywhere in this
project.

**Success:** run the generic analyses on both and report which measured structures are conserved
between two individual flies and which are not.
**Why it matters:** this is the cheapest available bound on how much of a connectome is individual
rather than species-typical, which [Chapter 16](textbook/16-upload.md) argues is the load-bearing
question. It is confounded by sex, preparation and reconstruction pipeline — and it is still worth
having, because every one of those confounds pushes toward *over*-estimating individual variation, so
any structure that survives them is a safe finding.

### A7. One scored term was arithmetically pinned, and two were reading the baseline — repaired, and the repair has a failure mode
Starting from the [ladder](31-ablation-ladder.md)'s list of terms that never leave zero. In all twelve
seeds at the fitted point and in every rung, `kcSpecific`, `pnSpecific` and `quietMN9` are exactly zero.
(`quietMN9` is a separate and probably genuine failure — the proboscis motor neuron sits at 31 Hz with
no tastant present — and is not part of this item.)

**The first cause is a bug in the benchmark, not in the model.** `kcSpecific` compares the Kenyon cells
active under DM1 with those active under VA2, and the two runs were made in a single expression:

```js
const a = sim(cfg, [...base, [DM1, 80]], 400), b = sim(cfg, [...base, [VA2, 80]], 400);
```

Every `LIFWasm` is laid out at the same base of the one shared `WebAssembly.Memory`, so
`a.net.spikeCount` and `b.net.spikeCount` are two views of the same `Uint32Array`. Reading counts off
both compares a run with itself. The two Kenyon-cell sets were therefore identical in every evaluation
this project has ever run, and `kcJaccard` came out as 1.000 to three decimals — which is what gave it
away, since a genuine Jaccard between two different odour responses landing on exactly 1.000 every time
is not a result, it is a signature.

**The second cause is the same class as A3.** Both terms thresholded a **raw** spike count at more than
one spike in 400 ms — 2.5 Hz — and the 6 Hz baseline drive the benchmark puts on every ORN already
carries most of the antennal lobe past that before any odour arrives:

| | raw | odour-evoked |
|---|---|---|
| `Jaccard(DM1, VA2)` over Kenyon cells | 0.790 | **0.212** |
| Kenyon cells responding to DM1 | 5.7% | 2.5% |
| antennal-lobe PNs responding to DM1 | 72.0% | **41.4%** |

So even with the aliasing repaired, the terms were scoring whether two nearly identical baseline sets
are nearly identical.

Scoring baseline-subtracted counts instead — the ordinary definition of an odour-evoked response, with
the three runs forced to share a seed so the subtraction measures the odour and not the Poisson draw —
leaves all three quantities inside their ranges at the *unrefitted* parameters:

| | before | after |
|---|---|---|
| `kcJaccard` | 1.000 (pinned) | 0.212 |
| `pnFrac` | 0.724 | 0.414 |
| `kcFrac` | 0.057 | 0.025 |
| `kcSpecific` | 0.000 | 0.646 |
| `pnSpecific` | 0.000 | 0.272 |
| `kcSparse` | 0.822 | 0.430 |

Only `quietMN9` is still pinned at zero. Three of the seventeen terms were measuring nothing, and the
composite the rest of this repository quotes — 0.754 — was a composite of the fourteen that worked.
Re-scored on the repaired objective the same parameters give 0.755, so the repair is not itself a gain;
it is a change in what is being counted.

The model's odour coding was specific all along, and the wiring says so independently: DM1 projects
directly to 28 of 686 projection neurons (4.1%), VA2 to 19 (2.8%), and the two target sets overlap at
Jaccard 0.15. The DM1-innervated neurons fire at 5.45 Hz against 1.03 Hz for everything else.

**Refitting against the repaired objective** settles the first of the two open questions and sharpens
the second. Twenty generations of twenty-four, same search as every other fit here: the winner selects
at 0.838 on one seed and re-scores at **0.786 ± 0.006** across twelve. Against the previous fit's
0.754 ± 0.005 that is **+0.026 ± 0.008 paired over the same twelve seeds** — about two thirds of the
0.04 of weight the two repaired terms carry, with `kcSpecific` landing at 0.46 and `pnSpecific` at
0.50. The terms were not unreachable; the old fit had simply never been shown a gradient that pointed
at them. `kcSparse`'s 8% target is reachable too — the refit reaches a 12.2% mean evoked Kenyon-cell
fraction — so the target was not the problem either.

**What the refit did instead is the real finding.** It bought the specificity partly by making the
population busier: baseline Kenyon-cell activity went from 5.1% of cells above one spike to 22.8%, and
the baseline-activity term fell from 0.459 to 0.393. The two repaired terms count per-neuron threshold
crossings in `max(0, odour − baseline)`, and at a high baseline most such crossings are Poisson
turnover rather than response. The arithmetic makes it unambiguous: DM1 lifts the raw Kenyon-cell
fraction by 1.7 points, 22.79% to 24.47%, while the evoked measure calls 12.2% of the population
responsive — seven times the whole net change. A response measure cannot exceed the population change
it is measuring by that factor, so the honest reading is that the repaired term is *satisfiable by an
active baseline*, and the fit found the loose joint rather than the odour code. The Jaccard between
the DM1 and VA2 Kenyon-cell sets agrees: it is a set comparison rather than a rate, and it rose with
the baseline, from 0.212 to 0.323, which is what two independently-thresholded sets do when more of
both populations is crossing threshold for reasons that have nothing to do with the odour.

So the composite improved, the dead terms are alive, and the repaired measure has a failure mode that
was not visible until something was fitted against it. That is the same lesson as the original bug at
one remove: an objective term that cannot be moved hides one kind of error, and a term that can be
moved by the wrong thing hides another. Fixing it means either bounding the evoked count by the raw
increase — a neuron cannot respond more than the population rate rose — or scoring specificity on the
signed population change rather than on per-neuron crossings. It is worth doing before B1, because the
same construction would otherwise be inherited by the per-neuron activity objective that item proposes.

**The second open question is unchanged.** `quietMN9` — the proboscis motor neuron runs at 26.6 Hz with
no tastant, against a target of 10 — is still the only term at exactly zero in every seed. Note that it
is also the one term in the objective that punishes a busy baseline, and it is the one the fit cannot
satisfy; the two facts are probably related, and separating them is the same piece of work. That
separation is now [M3](20-roadmap.md), because the term is pinned at a motor neuron and the mechanism
that pins it is an antennal-lobe one — which makes it the cheapest available test of a whole-brain
error, read out at a single cell.

**Why it was worth doing before B1:** the objective is the thing every fit in this repository is
measured against. Nothing downstream of it means what it says until the terms in it can move.

### A7 continued — the repair was measured, and the measurement moved the loophole twice

The paragraph above ends by naming the failure mode and proposing two fixes. Both were built, and
building them turned up a third problem that neither the original bug nor the first repair could see.

**The response criterion was not a criterion.** `ev > 1` is the same threshold at 0.5 Hz and at 50 Hz,
so at the 6 Hz baseline drive it is a test of Poisson turnover rather than of response. Measured at the
fitted point: **23% of Kenyon cells and 72% of ALPNs clear it with no odour applied**, and two
independently seeded *baseline* runs agree at Jaccard 0.925. Under it DM1 was credited with 18.4% of
Kenyon cells and 60.5% of ALPNs while the raw population fraction rose by **2.1 and 0.6 points** — an
overshoot of eightfold, and inflatable, because raising the baseline raises the count without raising
the bound. That is the mechanism by which the first refit collected 0.786.

The replacement counts a neuron as responding when its evoked increase exceeds **three Poisson sigmas
of its own baseline**, plus a cap at the population's total evoked count over the same number of
sigmas — the correct form of the "cannot respond more than the population changed" bound, since a
cell crossing the threshold and another falling back cancel in a fraction and not in a total. The bar
now scales with the baseline, and **the null collapses to zero**: at the fitted point 1.3% of Kenyon
cells and 0.27% of ALPNs respond to DM1, against no Kenyon cells and 0.17% of ALPNs for a second
baseline run. The smaller numbers are the supported ones — DM1 drives 28 of 686 ALPNs (4.1%) directly
in the wiring — and both layers come out *sparser* than their targets, which is the opposite of what
the fixed threshold reported.

**Which is where the loophole turned out to have moved rather than closed.** Sparseness was still
scored as the fraction of cells crossing the bar, and that fraction can be bought by making the layer
more excitable. A refit against the repaired objective did exactly that: baseline Kenyon-cell activity
rose from 23% of cells to **62%**, the crossing fraction doubled (0.015 to 0.030) — and the response it
bought is *broader and weaker*, so a scale-invariant measure of the same thing went the other way,
from 0.163 to 0.364. The effective number of responding cells, `(Σe)²/Σe²`, is invariant to the
amplitude of the odour response, so no gain change can move it; only concentrating the response can.
Scoring that instead — target 0.08, the imaging literature's sparseness for a food odour — closes the
route, and the same parameters that gamed the fraction measure score 0.24 on it.

**The repaired objective is more sensitive, not merely different.** It moves the composite for the
unchanged fitted parameters from 0.786 to **0.794 ± 0.005** across twelve seeds, and the
[substitution ladder](31-ablation-ladder.md) run under it keeps the same ordering while every
substantial rung costs more: `w_binary` −0.407 to −0.459, `w_shuffle` −0.344 to −0.392,
`no_size_scaling` −0.269 to −0.327, `cuba` −0.245 to −0.325. The assays that were pinned now register:
`pnSpecific` breaks under five rungs where it was previously incapable of moving, and `dm1PN` under
three. `quietMN9` is still the only term at exactly zero in every seed — 26.6 Hz with no tastant
against a target of 10 — and remains the open half of this item.

**Refitting against it does not improve the model, and the reason is the selection rule.** Twenty
generations of twenty-four, seeded from the current fit, select a point scoring 0.808 on the single
seed the search optimises and **0.785 ± 0.009 across twelve, against 0.796 ± 0.006 for the parameters
it started from — paired −0.012 ± 0.010**. The search is not at fault; selecting on one seed is. This
is the same arithmetic that makes the current fit's `_score` of 0.780 sit below its honest 0.794, and
it is now visible directly because the search stopped discarding its own starting point: candidate 0
was a perturbation rather than the incumbent at generation 0, so a search could finish *below* the
point it was seeded from, which the first of these runs did. That is fixed in `scripts/calib_search.mjs`
(`scripts/behavior_refit.mjs` already had it right), and it is worth stating plainly that a
one-seed-selected winner in this repository is not evidence of a better model.

**What this leaves open.** Sparseness, specificity and baseline activity are three quantities that a
single KC threshold trades against each other, and the objective now prices all three rather than two.
Whether the balance it lands on is right is a question the literature targets can only partly answer:
the 8% sparseness figure is a summary statistic of the same kind [B1](20-roadmap.md) exists to
replace. The finding to carry forward is that each repair made the terms movable and each time
something was fitted against them, a further loosened joint appeared — first aliasing, then a
threshold, then sparseness-by-excitability — which is the argument for B1 in miniature.

### A8. Make the engram expressible, then ask in simulation whether it is recoverable
Nothing in the model changes with experience, and the shape of that gap is more specific than "learning
is missing". `public/data/sparse_associative_memory_lab.json` describes the 44,000 Kenyon-cell-to-output
connections as *plastic in vivo* and then hands the ensemble a single scalar, `kc2mb`, swept over
{0.5, 1, 2}. An individual's entire olfactory engram is currently one global gain. [Textbook chapter
11](textbook/11-mushroom-body.md) reaches the same place from the other side: the probe tests
fixed-pattern readout, there is no teaching rule, and recall is never tested.

The engineering half is small and self-contained:

- **A plastic scalar per KC→MBON connection**, initialised at the empirical-Bayes weight from
  [doc 32](32-synapse-uncertainty.md), sign-restricted and bounded. 44k floats against the model's
  10.5 M connections.
- **A compartment map**, so dopaminergic gating is local rather than global. The graph already carries
  the argument for putting the gate at the presynaptic terminal: DAN→KC contacts outnumber DAN→MBON
  89,036 to 37,972.
- **A teaching rule with a stated time window, and a recall protocol that is not the training
  protocol.** Scored baseline-subtracted, per [A7](20-roadmap.md) — a mushroom-body assay in this
  repository that counts raw threshold crossings has already been wrong twice.

The experiment that follows needs no new data at all. Install a known weight vector, discard it,
generate synthetic recordings and behaviour from the model that holds it, and try to recover it with
the adjoint from [doc 33](33-differentiable-brain.md) holding the graph and the nine globals fixed.
Ground truth is known exactly, and fit error is zero by construction, so what is being measured is
identifiability alone.

**Success:** the installed vector is recovered above chance, *and* the recovered model expresses the
trained preference on a recall protocol it was not fitted against.
**The interesting negative:** if a 44k-dimensional engram cannot be recovered even from data the same
model generated, no quantity of real recording will do it either. That is [doc
34](34-individual-validation.md)'s κ measured for memory specifically, in simulation, before an animal
is on a rig — and κ is the axis that otherwise fails silently.

**The trap to design against.** 44,000 free parameters is exactly how doc 34's β blows up, and β = 1
caps power at 0.70 against even an excellent observable. Constrain the plastic subspace to what the
biology permits — depression-only within the taught compartment, sparse, bounded — so that the
regulariser and the biological claim are the same object. A free 44k-parameter fit that reproduces the
behaviour has established that 44k parameters can reproduce behaviour.

---

## B. Needs data that exists

### B1. Fit against recorded activity, not literature summaries
Every number the calibration is scored against is a summary statistic from published work: a firing
rate, a sparseness fraction, a rhythm index. The nine-parameter fit reaches a composite of 0.794
against them, and [Chapter 16](textbook/16-upload.md) argues that this procedure can only ever produce
a species-typical animal.

Pan-neuronal calcium imaging in behaving flies makes a different objective possible: predict held-out
activity, per neuron, per time point. That is the objective flyvis was trained on for the optic lobe,
and the reason it predicts single-neuron responses ([Vision](11-vision.md)).

**Success:** held-out correlation above chance on neurons not used in fitting, reported per cell type.
**The interesting negative:** a model that fits the recording well and predicts held-out neurons at
chance would mean the 165,122 gains are absorbing the recording rather than learning the circuit. That
is the overfitting failure mode the identifiability experiment in C1 would then inherit, so it is
worth finding here, where it is cheap.

### B2. Register recordings to connectome neurons
B1 has a prerequisite that is a substantial project in itself. Calcium imaging gives a voxel; the
connectome gives a skeleton. Matching them at the level of cell types is tractable now. Matching them
at the level of individual cells is the hard version — and it is the one C1 needs, because a
cell-type-level registration can only ever identify a species-typical model.

### B3. The ladder in a second species
The IR runs on *C. elegans* ([doc 29](29-connectome-compiler.md)), which has a complete connectome, a
body model, and a century of behavioural data. Running both ladder arms there answers whether the
abstraction-level findings in [doc 31](31-ablation-ladder.md) are facts about nervous systems or facts
about this fly model.

Axonal delay turning out to be the least compensable mechanism in a 302-neuron animal with a 1 mm body
would be a strong result. Its absence would be equally informative, and would localise doc 31's
finding to circuits of this size and speed.

---

## C. The long program

These are the items the textbook argues are decisive. They are stated with their costs visible rather
than as aspirations.

### C1. Individual identifiability
Fit the same connectome separately against recordings from two individuals, then test whether a
held-out behavioural assay separates the two resulting models in the direction that matches the two
animals. Per [Chapter 15](textbook/15-synthesis.md), the assay and the observable must be fixed before
the comparison, or the result is a consistency check rather than a test.

This is the experiment the rest of the roadmap exists to make possible. It needs the gradient (A5),
the activity objective (B1), per-cell registration (B2), and two animals recorded densely enough and
long enough that the functional record carries individual-specific information.

**The negative result is the valuable one.** If a held-out assay cannot separate the two models, then
the parameters recoverable this way are dominated by species-typical structure, and individuation
requires either a different measurement or a level of description the current representation cannot
express. That is a real answer to a question the upload literature generally assumes away, and it is
reachable at fly scale for a small fraction of what the same question costs at any larger one.

### C1b. The installed-memory experiment, pre-registered separately
[Doc 34](34-individual-validation.md) freezes six observables, and this item does **not** amend it. A
seventh observable added to a frozen design is the failure the document exists to prevent, so the
memory assay is a second pre-registration with its own outcome table, run alongside C1 rather than
inside it, and doc 34's result stands or falls on its own six either way.

It is worth running because it removes the one assumption C1 cannot control. C1 has to *hope* that
ρ ≥ 0.4 — that the animals happen to differ enough in behaviours that arose on their own. A memory can
be installed: assign each of the twelve animals a different randomly chosen training odour, and
between-animal variance becomes a design variable. It is also the only observable in either design
whose correct answer is known in advance, so a failure is attributable rather than merely negative.

The statistic is `scripts/identify_test.mjs` unchanged, over a preference vector across the odour
panel. Doc 34's three controls carry over, and the design needs three more, all of which test the same
worry from different sides:

- **Freeze the plastic weights and remove DAN drive at test.** A model that re-learns during the assay
  has preserved nothing.
- **The naive competitor.** An untrained but otherwise identical model, entered alongside doc 34's
  species-typical thirteenth candidate. It separates *this model holds a memory* from *this model holds
  this animal's memory*.
- **The swap.** Exchange the fitted plastic vectors between two animals' models. Identification must
  follow the weights, not the fly.

**Dependencies, and the one that is worse here than anywhere else.** A8 for the representation, B1 for
the objective, and B2 for registration — but B2 at Kenyon-cell resolution rather than cell-type
resolution, which is the hard version of an already hard item. A memory is defined over the identity of
individual Kenyon cells, they are not individually named cell types, and doc 32's bilateral-replicate
trick excludes them by construction. There is no version of this experiment that a cell-type
registration can reach.

### ~~C2. Design the validation before there is anything to validate~~
Committed: [doc 34](34-individual-validation.md) fixes the assay, the six observables, the number of
animals, the split, the statistic, the threshold, the controls and the outcome table, and
`scripts/identify_test.mjs` implements the statistic and can be exercised on simulated data now. What
it adds beyond the original statement of the item is the part that turned out to be the design problem:
the test has three inputs — observable reliability, readout sensitivity and fit error — of which only
the first is measurable before the models exist, and the second fails *silently*, producing the null
result no matter how good everything else is. The pre-registration therefore bounds what a negative
result can mean, which is the only thing that makes a negative worth having.

### C3. A scan-to-model compiler with uncertainty end to end
[Doc 29](29-connectome-compiler.md) starts at a published table, and [doc 32](32-synapse-uncertainty.md)
estimates uncertainty after the fact. The full version starts at raw electron micrographs —
segmentation, synapse detection, proofreading — and carries a confidence per synapse forward into the
fit, so the model knows what to trust for reasons the pipeline can state rather than reasons a
modeller inferred from symmetry.

Proofreading is the part that does not scale. FlyWire took roughly a decade of consortium effort for
139,255 neurons. The mouse, at ~71 million neurons, is the scale at which human proofreading stops
being affordable and the pipeline has to be trusted without a human in the loop — which makes
automated proofreading, and a calibrated confidence attached to its output, the load-bearing problem
rather than the imaging.

**Why it belongs here even though it is out of reach in this repository:** the estimate in doc 32 is a
lower bound derived from bilateral symmetry, and it exists only because the pipeline discarded its own
confidence upstream. A pipeline that kept it would make that entire document unnecessary. That is an
argument for building the pipeline, not for improving the workaround.

### C4. Does the scan carry the engram?
[Doc 32](32-synapse-uncertainty.md) already treats a contact count as a noisy measurement of an
efficacy rather than as a fact. If associative learning moves contact number or active-zone size at the
taught compartment's KC→MBON connections, then part of an individual's memory is in the micrographs,
and it is preservable by scanning in the same sense that wiring is. If it does not, the engram is
reachable only by fitting against function — and only for associations the animal expressed while the
recording was running ([Chapter 16](textbook/16-upload.md)).

Nothing decides this by argument, and it is a fly-scale experiment: train animals on one odour, scan
them alongside naive controls, and compare the taught compartment's weights against the *untaught*
compartments of the same animal. The within-animal contrast is the one to score, because doc 32 shows
between-animal weight disagreement to be large at low counts and inseparable from reconstruction error.

**The measurement problem has to be stated with the design, not after it.** At the floor the
reconstruction's standard deviation is 0.64 log units — a connection reported at three synapses is
uncertain by about a factor of two — and Kenyon cells have no one-cell-per-side replicate, so doc 32's
noise model is *inherited* for exactly the connections that hold the memory rather than fitted on them.
A per-connection test is therefore hopeless and the compartment-wide aggregate is not, since the
prediction is compartment-wide to begin with. Powering it means estimating the detectable effect size
from the fitted σ(θ) before any tissue is cut.

**Success:** a compartment-specific weight shift in trained animals, absent in their own untaught
compartments and in naive controls.
**Why the negative is worth the cost:** it would establish that electron microscopy is blind to
acquired state, which converts "preserve a memory" from a scan problem into a recording problem with a
known information bound — and that bound then propagates into every upload roadmap that assumes a
sufficiently good scan is sufficient.

---

## Done

- ~~**Antennal lobe gain control**~~ — divisive ORN normalisation for GABA_B presynaptic inhibition
  ([Senses](10-senses.md)).
- ~~**Aerodynamic flight**~~ — blade-element forces on the real 218 Hz stroke ([Flight](24-flight.md)).
  The next level was to drive the stroke from the wing power and steering motor neurons; those motor
  neurons turn out to be annotated (64 cells over six pools), and `scripts/wing_mn.mjs` measures them
  through a flight. They cannot drive anything yet: every pool fires at 33–109 Hz on the ground and in
  the air alike, and no pool's left-right asymmetry tracks the commanded turn (|r| ≤ 0.08). The item is
  therefore **not** "wire the motor neurons up" but "put a descending flight command in the graph for
  them to follow", with those two measurements as its success criterion. It is now
  [M1](20-roadmap.md).
- ~~**Social behaviour**~~ — LC10 visual detection and cVA pheromone driving pIP10/DNp13 pursuit and
  wing display through the male *fru*/*dsx* circuitry, with a song that has the real pulse/sine
  structure (35 ms IPI) and a female who decamps and kicks ([Courtship](26-courtship.md)). Both new
  pieces are supplied machinery, and the female's is unavoidably so: a female nervous system is not in
  a male connectome. That makes her one more entry on [A2](20-roadmap.md)'s list rather than a
  circuit result.
- ~~**Neuromodulation**~~ — AKH, insulin and octopamine are in, the brain is refitted with them on, and
  locomotion drives optic-lobe octopamine release ([Neuromodulation](25-neuromodulation.md)). Dopamine
  gating of feeding remains, as A2.
- ~~**Speed**~~ — WebGPU brain kernel with a WASM fallback, one device and one cached connectome per
  context, and flyvis on the same device (three dispatches, verified to 3e-4 against the reference
  model) ([WebGPU](27-webgpu.md)). What is left is the adjoint, which is [A5](20-roadmap.md).
- ~~**Substitution ladder**~~ — both arms, sensitivity and refit
  ([Ablation ladder](31-ablation-ladder.md)). The embodied version is A1.
- ~~**Per-connection uncertainty**~~ — estimated from bilateral replicates
  ([doc 32](32-synapse-uncertainty.md)). Putting it inside the objective is A4.
- ~~**Differentiable whole-brain model**~~ — `src/lifdiff.js` and a verified adjoint
  ([doc 33](33-differentiable-brain.md)). Making it affordable is A5; using it on recordings is B1.

## Open, not yet scheduled

- **Wall climbing.** Train or fit a vertical-surface gait so the legs can grip walls. Deliberately
  left here rather than promoted into Part M: it is another supplied gait, and fitting a second
  generator would add a behaviour while moving the motor question backwards. It becomes worth doing
  once [M2](20-roadmap.md) says whether a fitted nerve cord can hold posture at all.
- **A female fly.** The male CNS connectome is the only whole-CNS release, so courtship currently plays
  against a target that cannot respond. She now decamps and kicks by rule
  ([Courtship](26-courtship.md)), which is enough for the male's behaviour to be measurable and is not
  evidence about anything female.
- ~~**Learning.**~~ Scheduled as [A8](20-roadmap.md), which states the build and the simulation
  experiment that follows it. The observation that promoted it: a plastic model's parameters are no
  longer constants to be fitted, so every fitting procedure above inherits the complication — which is
  the argument for measuring the identifiability of an engram in simulation, where it is free, before
  any of them depends on the answer.
