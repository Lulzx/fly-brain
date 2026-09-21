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
| motor-neuron spikes that cannot reach the body | **42.4%** | [M5](20-roadmap.md) |
| full-connectome motor mode | **cannot hold posture** | [Limitations](19-limitations.md) |
| wing motor pools, ground vs flight | 33–109 Hz either way; power pool changes **5%** at takeoff | [Flight](24-flight.md) |
| wing steering asymmetry vs commanded turn | **\|r\| ≤ 0.14** in all six pools (64 cells) | `scripts/wing_mn.mjs` |
| wing power pool's drive that is descending | **8.6%**; the other 90.4% is VNC intrinsic | [M1](20-roadmap.md) |
| proboscis MN9 with no tastant | **26.6 Hz** against a 10 Hz target — the one benchmark term stuck at zero | [A7](20-roadmap.md) |
| tarsal sugar's contribution to MN9 | **−0.16 ± 1.57 Hz** — the `tarsalPER` term was scoring the idle above it | [M3](20-roadmap.md) |
| motor-neuron rate to muscle force | per class now; a single 17 Hz constant before | [Motor](12-motor.md) |

Read together these say something specific: the motor neurons are wired and active, and nothing that
reaches them carries the behaviour. That is a *locatable* gap rather than a general shortfall, which
is what makes it the right thing to work on next.

**Where the part stands.** M1, M3, M4, M5 and M6 have been run;
M2 has been scoped out into [doc 36](36-vnc-stepping.md) as a project of its own. Three of them
converge on one place, which is not where the part expected to end up:

| item | what it found |
|---|---|
| [M1](20-roadmap.md) | the wing pools take **90.4%** of their drive from VNC intrinsic interneurons and 8.6% from every descending neuron together; the best descending candidate fires at 2 Hz and falls at takeoff |
| [M3](20-roadmap.md) | MN9's idle is 100% olfactory, the antennal lobe runs at **77 Hz per projection neuron**, and `tarsalPER` was scoring 0.85 on the idle `quietMN9` was punishing |
| [M4](20-roadmap.md) | the 17 Hz constant does not reach the legs in `'descending'` mode at all: there is no path from a leg motor neuron's rate to a leg joint |
| [M5](20-roadmap.md) | **42.4%** of motor-neuron spikes cannot reach the body |
| [M6](20-roadmap.md) | motor pools identify **12 of 12** simulated individuals; doc 34's behavioural observables identify **1 of 12**, at the null, with five of the six at ρ = 0 |

Two common findings, and they are the same one twice. The model's motor stage is driven by its own
intrinsic activity rather than by anything descending, and the benchmark was reading intrinsic or
supplied activity as behaviour — MN9's olfactory idle scored as a taste response in M3, the stepping
scheduler's own random draw scored as a walk-bout statistic in M6. Both point at
[M2](36-vnc-stepping.md), which is the item that replaces the supplied machinery with the graph.

### M1. A descending command the wing system can follow — the negative, and it is locatable
`scripts/wing_mn.mjs` measured the wing pools through a flight and found no flight-versus-ground
contrast and no steering asymmetry ([doc 24](24-flight.md)). The diagnosis was that the cause is
upstream: flight is started and maintained by the endogenous module, so no descending signal ever tells
the wing motor neurons that the animal is airborne. The item was to find the descending population that
should carry it and drive flight from it instead.

**The screen finds candidates, and it finds the right ones.** `scripts/dn_flight.mjs` drives each of the
480 descending types in turn at 150 Hz and measures what reaches the motor pools, scoring how much of
the change lands on the wings rather than the legs. **DNa08** ranks first (+30.7 Hz on the power pool,
85% of the change on the wings) and **DNg02_a** second (+30.4 Hz, 79%). DNg02 is independently the
population Namiki et al. 2018 assign to wing-amplitude control in flight, which the screen was not told
— so the graph does connect a plausible flight command to the wing motor neurons.

**Embodied, that command is silent and has no flight signal in it.** Recording the same population
through a flight (`wing_mn.mjs`, 8 s, takeoff at 1.5 s):

| | ground | flight |
|---|---|---|
| DNa08 + DNg02 family, 27 cells | 2.35 Hz | 1.98 Hz |
| wing power pool, 24 cells | 101.7 Hz | 107.3 Hz |

A threshold on a 2 Hz signal that *falls* by 0.4 Hz at takeoff is a threshold on noise, so the flight
readout is computed and reported (`cmd.flightDrive`, `cmd.flightAsym` in `src/sim/motor.js`) and
nothing is gated on it. The steering half fails too: no wing pool's left–right asymmetry correlates
with the commanded turn above |r| = 0.14, against the |r| ≥ 0.5 the item asked for.

**Why it cannot work, measured rather than inferred.** Decomposing the drive onto the power pool at the
calibrated operating point gives the reason in one number:

| source of drive onto the wing power pool | share |
|---|---|
| VNC intrinsic interneurons (IN19B043, IN19B067, IN19B040 at 45–122 Hz) | **90.4%** |
| descending neurons (63 cells, 25 active) | 8.6% |
| ascending, motor, efferent, sensory | 1.0% |

The wing motor neurons are held at ~100 Hz by a self-sustaining nerve-cord interneuron network, and
every descending neuron in the graph together contributes under a tenth of their input. That is why no
descending population separates flight from walking here, and it is a different failure from the one the
item anticipated: the annotation is not missing and the candidate is not absent — the command is
drowned.

**Two descending signals do separate the two states, and neither is a command.** Fifteen gnathal types
(DNge037, DNge040, DNge059, DNge069, DNge137 and others) fire at 2–13 Hz on the ground and at exactly
zero in flight — a contrast of −1, and the largest in the table. They are feeding and proboscis
descending neurons, and they fall silent because the fly leaves the ground, not to make it leave. And
the strongest steering correlation of any descending type, DNa01 at r = 0.766, is circular: DNa01 is one
of the three types the commanded turn is *computed from* (`DN_ROLES.turn`), so the correlation measures
the readout against itself.

**What this means for the roadmap.** The item's stated negative was that if no descending population
separates flight from walking, either the release's descending annotation is insufficient or the model's
excitability is wrong in a way that erases a real signal. The measurement picks the second and says where:
the excitability is wrong *in the nerve cord*, not in the descending neurons, and the quantity to fix is
the 90% of wing-pool drive that is intrinsic. That is the same quantity [M2](36-vnc-stepping.md) is
about, one body-part over, which makes M1 a dependent of M2 rather than a peer of it — and it moves the
flight question from "which descending neuron" to "why does the nerve cord run at 100 Hz with nothing
telling it to".

The B1 discriminator in the original statement still holds and is now sharper: if *recorded* descending
populations separate flight from walking while the model's do not, and the model's nerve cord is a
hundred hertz too busy, then the descending signal is real and this model is burying it.

### M2. Stepping from the nerve cord — scoped out as a project of its own: [doc 36](36-vnc-stepping.md)
Moved here from [A2](20-roadmap.md), because it is the same problem as M1 one body-part over. The
full-connectome motor mode does not hold posture ([Gait](13-gait.md)), so walking is executed by a
CMA-ES-optimised tripod generator and the connectome supplies only the decision to walk. The item is to
fit the leg premotor circuits against the FlySuite walking data using the adjoint from
[doc 33](33-differentiable-brain.md), rather than fitting a generator to trajectories.

It is now the only entry on this roadmap that is not finishable in a sitting, and it has been separated
rather than left to sit here looking like the others. [Doc 36](36-vnc-stepping.md) is the scoping: the
four things that have to be built before the first informative measurement (a stepping objective that
does not presume the phase; proprioceptive feedback at the timescale it operates on; a gradient that
reaches the body; and [M4](20-roadmap.md)'s muscle model), the two conditions that would count as
finishing it, and — the part worth writing down in advance — **the two points at which it should be
stopped instead.** The first measurement has now run: [doc 39](39-vnc-readout.md) records that the
frozen subgraph routes a replayed premotor state into muscle commands *worse* than a degree-matched
scramble of itself (0.285 vs 0.073 held-out ctrl MSE after the same gain fit) — the readout is a
reservoir task, so the wiring's contribution, if any, lives in the dynamics the assay replays rather
than in the last-mile edges it computes.

[M1](20-roadmap.md) has since made it more central rather than less. The wing motor neurons turn out to
take 90.4% of their drive from VNC intrinsic interneurons and 8.6% from every descending neuron in the
graph put together, which is the same finding as M2's, in the segment above: the nerve cord in this
model runs at its own hundred hertz and the brain barely reaches it. Fixing that is M2, and M1 is
downstream of it.

**Success:** posture held in `'connectome'` mode for a full 20 s foraging scenario, and a stepping
rhythm that is measured rather than imposed.
**The interesting negative:** if a fitted VNC still cannot hold posture, the missing quantity is not
in the graph — and a failure here would be the strongest evidence this project can produce that a
connectome plus a fitted gain per neuron is not sufficient for motor control, which is a claim about
the abstraction level rather than about the fly. [Doc 36](36-vnc-stepping.md) argues that this is the
outcome worth buying, and that it is cheap by the standards of the question.

### M3. The proboscis motor neuron that cannot be quieted — done, and the error was in two places
`quietMN9` was the only scored term sitting at exactly zero in every seed and every rung of the
ladder: MN9 idles at 26.6 Hz with no tastant against a target of 10. [A7](20-roadmap.md) noted that it
is also the one term that punishes a busy baseline and guessed the two facts were the same fact.
[Limitations](19-limitations.md) named a mechanism — MN9 is partly driven by olfactory channels
downstream of the antennal-lobe spread, so a fly in odour extends its proboscis while walking.

The stated success was MN9 below 15 Hz with no tastant while the `sugar` and `tarsalPER` terms hold,
and the stated interesting negative was that the bleed is structural. `scripts/mn9_quiet.mjs` measures
both, and the answer is neither: the term could not be satisfied because a heavier term in the same
objective was being *paid* by the activity this one wanted removed.

**The olfactory story is right, and it is the whole story.** MN9's idle tracks the benchmark's 6 Hz
spontaneous drive on the olfactory receptor neurons all the way down — 0.0 Hz at no drive, 17.5 Hz at
1 Hz, 26.3 Hz at 6 Hz — and cutting one population out of the network settles which one:

| cut from the network | cells | MN9 with no tastant |
|---|---|---|
| nothing | — | 26.3 Hz |
| antennal-lobe projection neurons | 686 | **0.0 Hz** |
| olfactory receptor neurons | 2,639 | **0.0 Hz** |
| antennal-lobe local neurons | 420 | 28.8 Hz |
| gustatory / Kenyon cells / MBON / CX / mechanosensory | 1,428–5,745 | 26–30 Hz |

The route is short and it is one cell wide. Of the 28,624 units of excitatory drive onto MN9 at rest,
**24,233 — 85% — come from a single GNG120 neuron** firing at 67.5 Hz, and every stage between the
antennal lobe and it goes to exactly zero when the lobe's output is cut: ALPN 77.0 → 3.8 Hz, GNG494
63.8 → 0, GNG120 41.3 → 0, MN9 26.3 → 0.

**The upstream number is the real one: the antennal lobe idles at 77 Hz per projection neuron.** The
imaging literature puts spontaneous ALPN rates at a few to twenty. 72% of the layer is above threshold
with no odour present, which [A7](20-roadmap.md) had already recorded from the other side without
naming the cause.

**The gain control the model has does not apply here, and the one the connectome has is deleted.** Two
separate facts, and both matter.

The model already carries a divisive antennal-lobe normalisation, `AL_NORM` in `src/sim/senses.js`
([Senses](10-senses.md)), standing in for GABA_B presynaptic inhibition. It divides the *evoked* part of
each receptor neuron's drive by the total evoked drive on that antenna and leaves `ORN_SPONTANEOUS`
alone — so the 6 Hz spontaneous rate, which is the entire input in the benchmark's resting condition,
passes through it untouched. The physiological benchmark does not even reach it: `calib_eval.mjs` sets
the receptor drive directly, so the one gain-control mechanism the model owns is bypassed by the
measurement that scores `quietMN9`.

The connectome's own version is present and zeroed. `writeGraph` in `src/lifwasm.js` drops every synapse
whose postsynaptic neuron is sensory, because sensory neurons are Poisson-forced and an input onto one
could have no effect. That clause removes **51,958 connections onto the olfactory receptor neurons**,
301,608 synapses; of the 121,683 inhibitory synapses among them, 118,990 — **97.8%** — are ALLN→ORN: the GABAergic
presynaptic gain control of Olsen & Wilson 2008, which is what bounds the real lobe's spontaneous
throughput. Across all sensory neurons the clause deletes 1.5 M synapses, 1.44% of the graph.

So it was restored. `preInh` (in `src/wasm/lif.c`, `src/lif.js` and the graph build, JS and wasm checked
against each other) keeps the inhibitory edges onto driven neurons and divides their transmitter
release by `1 + preInh · |gI|` — presynaptic inhibition proper, which scales release without changing
the receptor neuron's spike rate. **It does not fix it.** ALPN's resting rate falls from 77.0 Hz to
68.0 at `preInh` 1, 67.4 at 8, and only 53.0 in the limit, and MN9 does not move. Two reasons, both
measurable: 605 of the 2,639 receptor neurons receive no local-neuron inhibition at all in v1.0, and
the lobe sustains itself once ignited — which is also why cutting the receptor neurons from the start
silences it completely and throttling them after it has started does not.

**And then the objective turned out to contain the same class of error A7 found twice.** `tarsalPER`
rewards MN9 at 30 Hz with sugar on the front tarsi; `quietMN9` punishes it above 10 Hz with nothing
applied. Both read the same cell over the same 400 ms window. Paired over eight seeds at the fitted
point, the tarsal-evoked component of MN9 is:

**−0.16 ± 1.57 Hz.**

There is no tarsal pathway to MN9 in this model. `tarsalPER` — weight 1.5, the joint-third-heaviest
term in the objective — was scoring 0.854 on the olfactory idle that `quietMN9`, weight 0.5, was trying
to remove. The two terms were one number read with opposite signs, and the heavier one won every fit.
That is why no parameter set ever satisfied `quietMN9`: satisfying it cost three times as much
elsewhere, and the fit was correct to refuse.

**The repair.** The feeding block now shares one seed across its runs and scores the *evoked increase*
for the response terms, leaving the quiescence terms (`bitter`, `quietMN9`) absolute, because "is it
quiet" is a question about a rate and not about a change in one. Re-scored at the unchanged calibrated
parameters over twelve seeds:

| | before | after |
|---|---|---|
| `tarsalPER` | 0.854 | **0.049** (evoked 1.5 Hz against a 30 Hz target) |
| `sugar` | 0.716 | **0.452** (evoked 26.1 Hz against 60; raw was 52.7) |
| every other term | — | unchanged to three decimals |
| composite | 0.794 ± 0.005 | **0.697 ± 0.009** |

As in A7, the repair is not a regression; it is a change in what is being counted. Of the model's
quoted 0.794, about **0.098 was MN9's olfactory idle being counted as a taste response.**

**What M3 located.** A whole-brain error read out at one motor neuron, exactly as the item hoped —
except that it is two errors at one cell. The antennal lobe runs an order of magnitude too hot because
its gain-control circuit is deleted by the sensory-input clause, and the benchmark was crediting the
overflow to the feeding circuit. The second is now fixed. The first can be made to go away by a gain,
and the next section is what that costs.

**Fitted against the repaired objective, the criterion is met outright and the composite does not move.**
Five parameter sets, twelve seeds each, all scored on the repaired objective so the column is comparable:

| parameters | composite | `quietMN9` | `tarsalPER` | `sugar` | MN9 idle |
|---|---|---|---|---|---|
| calibrated (fitted on the old objective) | 0.697 ± 0.009 | 0.000 | 0.049 | 0.452 | 26.6 Hz |
| nine globals refitted on the repaired objective | 0.681 ± 0.007 | 0.000 | 0.049 | 0.455 | 21.2 Hz |
| + AL gains, calibrated globals | 0.682 ± 0.019 | 0.625 | 0.441 | 0.921 | 3.8 Hz |
| + AL gains, globals refitted on the *old* objective | 0.707 ± 0.013 | 0.531 | 0.243 | 0.912 | 14.3 Hz |
| **+ AL gains, globals refitted on the repaired objective** | 0.686 ± 0.013 | **0.948** | 0.371 | 0.930 | **0.52 Hz** |

The "AL gains" are `classGain {ALLN: 8}` with `typeGain {GNG232: 3, DNge080: 3, LgLG3: 2, LgLG4: 2,
LgAG2: 2}` — the antennal lobe's lateral inhibition raised eightfold and the shared gustatory relay
re-gained. The two fitted points are in `data/calib_best_repaired_plain.json` and
`data/calib_best_repaired_algains.json`; neither is promoted.

**The last row is the answer to the item as it was written.** MN9 idles at **0.52 Hz** against a 10 Hz
target — and stably, at 0 Hz in nine of twelve seeds and never above 2.5, where the same gains on
unfitted globals were bistable. The tarsal response is real for the first time, 22.0 Hz evoked against
1.5 for the calibrated model, and the sugar response is 159 Hz evoked. Every one of M3's stated
conditions holds at once.

**And the composite does not care.** All five rows sit inside about two standard errors of each other.
What the antennal-lobe fix wins on the feeding terms it pays back on the odour ones: `sugarStop` falls
0.823 → 0.061, `pnSpecific` 0.932 → 0.335, `dm1PN` 0.804 → 0.405, `kcSpecific` 0.727 → 0.151. The lobe
that was overflowing into the proboscis was also carrying the odour code, and turning it down does both
things at once. That is the item's interesting negative arriving after its success criterion was met
rather than instead of it, and it is a statement about the objective as much as the model: **seventeen
weighted terms cannot distinguish a fly whose proboscis is quiet and whose odour code is weak from one
whose odour code is strong and whose proboscis hangs out.**

One methodological note, because it repeats A7's: the nine-global refit *without* the gains selected at
0.756 on its search seed and re-scored at 0.681 across twelve — below the 0.697 it started from. Ten
generations of twelve is a small search and this is its selection noise, not evidence that the repaired
objective is unfittable. Any conclusion from the table above about which row is *best* would need a
search the size of the ones in [doc 7](07-calibration.md); what it does support is that the criterion is
reachable and that reaching it is free in composite terms.

### M4. The force–frequency model between motor neuron and muscle — built; the ladder run measured the ladder
Muscle activation was `1 − exp(−rate · ln 2 / 17 Hz)` for every muscle in the animal
([Motor](12-motor.md)). One saturation constant stood in for the whole neuromuscular junction: no
per-muscle force–frequency curve, no fibre-type difference between the fast tergotrochanteral muscle
and a slow postural one, no calcium dynamics, and no history dependence.

**What is built.** `MUSCLE_FF` in `src/sim/motor.js` gives each muscle class its own curve,
`1 − exp(−ln 2 · (rate/f₅₀)ⁿ)`, with the classifier reading the bodymap's annotated muscle names:

| class | groups | f₅₀ | n | what it is |
|---|---|---|---|---|
| `legSlow` | 12 | 60 Hz | 1 | accessory (slow) leg units: tonic, fuse late, hold posture |
| `legFast` | 78 | 25 Hz | 1 | the main extensor/flexor pools |
| `ltm` | 36 | 12 Hz | 1 | long tendon muscle and claw adhesion: a grip, near-maximal once recruited |
| `feed` | 32 | 17 Hz | 1 | proboscis — the original constant, kept because nothing better is sourced |
| `other` | 12 | 17 Hz | 1 | unclassified: unchanged |
| `flight` / `steer` / `jump` | — | 5 / 20 / 8 Hz | 1 / 1 / 2 | defined and *currently unreachable*, because the wing muscles are not driven by their motor neurons at all — see [M1](20-roadmap.md) |

These are estimates from the insect muscle literature rather than Drosophila measurements of these
particular muscles; there is no per-muscle force–frequency dataset for this animal. What the classes
encode is an ordering that is not in doubt, and the ladder answers the item's question whatever the
numbers are. `perClassMuscles` switches the whole thing back to the single constant, which is the rung
`muscle_single` in `scripts/rungs.mjs`.

**What the ladder will find, checked directly rather than waited for.** In `'descending'` mode — the
mode the behavioural ladder runs in — the force–frequency curve reaches only the proboscis, antennae
and labrum, because the legs are driven by the stepping generator and `muscleCtrl` is called for the leg
joints only under `'connectome'`. Both of those classes keep f₅₀ at 17 Hz. Two otherwise identical 3 s
embodied runs, `perClassMuscles` on and off, agree **exactly**: position and rostrum control identical
to six decimals at every sample, maximum difference 0 (`scripts/muscle_check.mjs`). The rung is a **null in the behavioural ladder by
construction**, and the physiological benchmark never reaches a muscle at all.

That is not a wasted rung; it is the item's interesting negative arriving early and with a reason
attached. The stated negative was that if the ladder cannot tell a per-class muscle model from a single
constant, then motor-neuron *rate* is not the quantity the body reads at this level of description.
The sharper version the code says is: **in the mode this model actually walks in, motor-neuron rate is
not read by the legs at all** — there is no path from a leg motor neuron's firing rate to a leg joint.
The muscle model matters exactly where [M2](36-vnc-stepping.md) is, which is why doc 36 lists it as one
of the four things that have to be right before a fitted nerve cord means anything.

**Run, and the null rung scored +0.102 ± 0.042.** `muscle_single` went through
`scripts/behavior_ladder.mjs` on the same 12 seeds as the rest of the table. The result is not zero,
and the reason it is not zero is pinned exactly: the per-class path evaluates
`1 − exp(−ln2·(rate/17)¹)` where the single-constant path evaluates `1 − exp(−rate·(ln2/17))`, and
the two orderings differ by at most one ulp — 2.2e-16, for 4.4% of rate values. Over 36 s of embodied
simulation the body–brain loop amplifies a last-ulp difference in six driven actuators into an O(0.1)
score difference. The rung is a null by construction and the ladder measured +0.102, so **±0.1 in
score is the behavioural ladder's numerical noise floor, not a biological signal**.

The proof that the whole difference lives in that ulp is in the table itself: `muscle_single` —
`perClassMuscles` off, which is the old formula bit-for-bit — reproduced the previous baseline row
*exactly* (score 0.8598, escapes 0.583, every observable identical), while the new baseline running the
reordered formula scored 0.7576. Two rows separated by one floating-point associativity differ by more
than most real substitutions move. The biggest single term is `escape` at +0.5 ± 0.19, a six-of-twelve
seeds flip in a binary outcome, which is what ulp noise looks like at a threshold.

What the rung therefore says is not the null result it was queued for — it is that the nineteen of
twenty rungs sitting within two standard errors of the baseline cannot be read as robustness: the
eval itself moves by that much under a provably-zero change. Effects worth claiming from this table
have to clear ±0.1, or be re-measured with the paired-seed difference between two runs of *identical*
math as the comparator. `scripts/muscle_check.mjs` missed this because it sampled to six decimals over
3 s; the divergence is real but still below 1e-6 at that horizon.

### M5. The 422 motor neurons with nowhere to go — the bound is measured
285 motor-neuron types — 422 cells — carry no muscle assignment in v1.0: abdominal (115 types), neck
(42), haltere and some wing. They are simulated, they spike, and nothing they do can reach the body.

The item asked for an assignment for the neck and haltere pools *and* for the rest as a bound. **The
bound is done and it is larger than the cell count suggests.** `scripts/motor_bound.mjs` censuses every
motor neuron over 20 s of ordinary foraging and asks which of their spikes can reach an actuator:

| | |
|---|---|
| motor neurons | 815 |
| the body can read | 465 |
| stranded | **350** (42.9% of cells) |
| mean rate, reachable | 21.89 Hz |
| mean rate, stranded | 21.42 Hz |
| **spikes that cannot reach the body** | **42.4%** |

The two rate rows are the point. A stranded pool that never fired would strand nothing; these fire
at the same rate as the pools that drive the animal, so the cell fraction and the output fraction agree
to half a percent and the bound is not softened by the stranded cells being quiet.

Reconciling the bodymap's own list against reachability also corrects a count this repository has been
quoting: of the 422 cells listed as unmapped, **82 are reachable after all** through `bodymap.wing`, and
ten stranded motor neurons are not on the list. The bound is computed from reachability, which is the
property that decides whether a spike can move anything, and the subclass table holds the 340 cells that
are on the list and stranded:

| subclass | cells | rate | share of stranded output |
|---|---|---|---|
| abdominal | 214 | 20.9 Hz | 59.7% |
| **neck** | 44 | 29.0 Hz | **17.0%** |
| haltere (hm) | 16 | 47.2 Hz | 10.1% |
| rm | 7 | 56.7 Hz | 5.3% |
| wing (remainder) | 8 | 31.8 Hz | 3.4% |
| xm / haltere (hl) / mesothoracic | 51 | 0.9–20.7 Hz | 3.5% |

**What this changes.** The stated interesting negative was that *if* the unmapped pools carry
substantial descending drive, then every behavioural score in this repository is being produced by a
motor system missing a known fraction of its output, and that fraction belongs in
[Limitations](19-limitations.md) as a number. They do, and it now is: **42.4%**.

The neck pool is the consequential one for the same reason the item gave: 44 cells firing at 29 Hz,
17% of the stranded output, and head stabilisation is a visual-feedback loop the model cannot close at
all without them. The haltere pools are the second: 37 cells whose whole function is to report body
rotation to the wing system, in a model whose flight controller supplies a haltere-*like* loop by hand
([Flight](24-flight.md)).

**What is not done.** The assignment. Giving the neck and haltere pools muscles needs three things this
item does not have yet: neck and haltere muscle geometry in `public/body/fly_physics.xml` (the head is
currently a rigid child of the thorax with no actuated neck joint), a mapping from motor-neuron type to
muscle taken from the morphology and the nerve rather than from the release's annotation — which is what
is missing in the first place — and a decision about what the halteres should drive, since the flight
controller's attitude loop already occupies that role. The first of those is a body-model change and is
the natural unit of work; the bound above is what says how much it is worth.

### M6. Motor output as the identifiability observable — answered: the motor neurons, and it is not close
[Doc 34](34-individual-validation.md) freezes six *behavioural* observables for the individual-identifiability
experiment, on the argument that behaviour is what a body makes measurable. Between the motor neurons and
the trajectory sit a saturating force–frequency curve, six legs and a supplied stepping generator, which
is a low-pass filter. The item asked whether motor-neuron activity carries more individuating information
than the behaviour it produces — answerable in simulation now, and now answered.

`scripts/motor_identify.mjs` makes twelve simulated individuals by drawing a lognormal gain (σ = 0.25) on
every neuron — the same quantity [doc 33](33-differentiable-brain.md)'s adjoint fits and the one C1 varies
between animals — and runs each twice through the full five-scenario arena battery with different noise
seeds. The first run is the "animal", the second is its model's prediction of it. Both observable vectors
come off the *same* runs, so the only thing that differs between them is the read-out. Doc 34's statistic,
threshold and permutation null are imported from `scripts/identify_test.mjs` rather than re-implemented.

| read-out | K | identified | exact p | mean ρ | largest β with power ≥ 0.9 |
|---|---|---|---|---|---|
| doc 34's behavioural observables | 6 | **1 / 12** | 0.648 | 0.129 | **none — it fails at β = 0** |
| motor pools | 12 | **12 / 12** | < 0.0001 | 0.836 | **1.0** |
| motor pools, cut to six for a matched K | 6 | 11 / 12 | < 0.0001 | 0.826 | 0.5 |

The permutation null lands at 0.083–0.085 per animal against the 1/12 the binomial predicts, so the
threshold is the right one. **Behaviour is at chance and the motor neurons are perfect.** Cutting the
motor read-out to six pools, so that it gets exactly the K the behavioural one gets, costs one animal.

**ρ is where the answer actually lives, and it is per-observable:**

| behavioural observable | ρ | | motor pool | ρ |
|---|---|---|---|---|
| escape rate | **0.00** | | wing power | 0.96 |
| feeding latency | **0.00** | | wing pitch | 0.95 |
| flip fraction | **0.00** | | leg T2 | 0.97 |
| distance to food | **0.03** | | leg T3 | 0.96 |
| walk-bout median (*scheduler*) | **0.00** | | unmapped pool | 0.96 |
| walk-bout median (*body*) | 0.74 | | proboscis | 0.51 |

Doc 34 gates C1 at ρ ≥ 0.4. **Five of the six behavioural observables are at or within rounding of zero**, which means that on
this model, run against these assays, C1 would return "inconclusive by design" — its own fourth outcome
row — no matter how good the per-animal fits were.

**The two bout rows are the finding in miniature.** They are the same quantity read in two places.
`boutMedian` is the supplied scheduler's own walk state, which is what [doc 35](35-behaviour-ladder.md)'s
`bout` term is scored on; `bodyBoutMedian` is what the animal actually did, read off the motor command.
The scheduler's version carries **no** individual information, because its durations are a lognormal draw
reseeded every run and the brain is not in that draw. The body's version carries ρ = 0.74. One read-out
of one behaviour, and the choice of which side of the supplied machinery to read it from is the
difference between a usable observable and the null.

Two of the others are assay artefacts rather than deep facts, and saying so is part of the result:
`feedLatency` is **exactly 20 ms in all twenty-four runs** because the `onfood` scenario starts the fly
touching food, and `flipFrac` is zero in every run but one. Neither can individuate anything because
neither varies. `escapes` and `foodDist` do vary — by 0.46 and 0.26 — and still return ρ of 0.00 and 0.03, which is
worse: their variance is entirely within-animal. The same individual escapes on one run and not the
other.

**What this decides.** The observable C1 should record is the motor neurons. It is the read-out that
survives a fit error as large as the whole between-animal spread (β = 1.0 at power 0.97) where the
behavioural one fails with no fit error at all.

**What it does not decide, stated so the result is not over-read.** Doc 34 already says a neural
observable has κ ≈ 1 by construction, so *some* gap was expected; what is new is that the gap runs all
the way to the null rather than merely being large. And the measurement is of this model in this arena:
the individuals are a lognormal gain draw rather than real animals, three of doc 34's six observables
(optomotor gain, plume heading precision, tarsal PER threshold) have no arena assay and are replaced by
whole-animal measures that `behavior_eval.mjs` does produce, and the assays are seconds long. A longer
or better-designed behavioural assay could raise ρ. What it could not do is make the supplied scheduler's
own random draw individuate an animal, and that is the part of the result that is about the model rather
than the experiment.

**The interesting negative, for the record, did not happen.** It would have been the behaviour separating
individuals while the motor rates did not, which would have meant the body *adds* individuating structure
rather than removing it. The measurement is emphatically the other way, and the low-pass story is right.

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
  agree is expensive and which a refit of the other eight parameters cannot absorb when it is tightened,
  rather than the weight values.
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
