# 44. The walking compiler: the experiment compiler pointed at the nerve cord

Spec S8. [Doc 36](36-vnc-stepping.md) scoped stepping-from-the-cord as a project and named the
first thing it needed: an objective over quantities that survive not knowing the phase, because a
stepping generator knows its own phase and a nerve cord does not. [Doc 39](39-vnc-readout.md) then
recorded the first negative — a frozen premotor subgraph loses to a degree-matched scramble on the
readout objective. This document is the next step, and it is deliberately not a fit. It gives the
[experiment compiler](30-hypothesis-lab.md) three things it lacked for walking, runs one committed
experiment through them, and records what came out.

The framing is the compiler's: instead of searching for the parameter set that walks, run an
ensemble over the unmeasured gains, hit every member with the same named perturbations, and rank
the perturbations by how cleanly they split the ensemble. That is the question the sibling
walking programme has been answering one hypothesis at a time; here it is one spec.

## What was added

**A phase-free gait instrument** (`src/exp/gait.js`). From a 500 Hz trace of the six claw contact
sensors, the six tarsal load sensors and the thorax pose, it reads:

| field | definition | real-fly band |
|---|---|---|
| `cadence` | median over stepping legs of lifts per second (a lift is a debounced stance-to-swing transition) | 5–16 Hz |
| `duty` | median stance fraction over stepping legs | 0.5–0.83 |
| `swingMs` | median lift-to-touchdown duration | 15–60 ms |
| `contraPhase`, `contraR` | circular mean phase of the right leg's lifts inside the left leg's step cycles, pooled over the three segments, and its resultant length | 0.35–0.65 |
| `tripod` | (mean cos phase within tripod pairs − mean cos across tripod pairs) / 2: 1 for a clean tripod, 0 for a hop or a wave | — |
| `legsStepping`, `minLifts` | legs with ≥3 lifts; fewest lifts on any leg | — |
| `upright`, `support` | fraction of samples with the body up-vector above 0.5; with ≥3 feet down | — |
| `bodyHeight`, `bodyHeightRel` | median thorax height (cm); relative to the spawned standing height (first 50 ms of the trace) | — |
| `speed`, `path` | net displacement and path length per second (cm/s) | 0.2–4.5 |
| `loadRhythm` | each leg's load vector strength at that leg's own lift rate: separates a quiet leg from an incoherent one | — |

The bands are the ones the sibling registry carries (`CONSTRAINT-REGISTRY.json`: Mendes et al.
2013, DeAngelis et al. 2019), used for outcome classification only. Nothing in the instrument is
fitted. Doc 36's first stopping condition — *stop if the objective cannot tell the supplied
generator from a scrambled one* — is the instrument's unit test (`scripts/gait_unit.mjs`): a
synthetic tripod reads tripod 1.0 and contralateral phase 0.5, an in-phase hop reads tripod 0 and
phase 0, a metachronal wave reads tripod below 0.3, a standing fly reads cadence 0 with no phase,
and one-sample contact chatter does not count as a step.

**Two walking assays** (`scripts/behavior_eval.mjs`). Open floor, no obstacles, the bout scheduler
held in a walking bout for the whole assay so the forward descending neurons carry a walking
command throughout. `walk_cx` is connectome motor mode — the 328 leg motor neurons drive the
joints, no stepping generator. `walk_cpg` is the same command executed by the supplied tripod
generator: the instrument's positive control, run under every ensemble member so a read on the
cord is always next to a read on the generator under the same brain.

**Three perturbation channels the arena site could not express before.**

- `ablateType` now takes a neuron selector (`src/exp/select.js`): `hemilineage:13A`,
  `type:IN19B012@left`, `regex:^IN13`, `superclass:vnc_intrinsic`, `muscle:T3`. The hemilineage
  is parsed from the release's type names (`IN20A.22A039` carries both 20A and 22A), and a
  selector that matches nothing throws rather than ablating an empty set. Ablation silences by
  threshold, the sibling programme's own definition: the cell never spikes, so it is gone from
  every downstream synapse and from every readout that counts spikes. (It was first built as
  zeroed outgoing synapses; a "headless" fly kept walking because the motor readout reads
  descending-neuron rates directly and the scheduler was still driving them.)
- `scaleEdges` multiplies a named edge class. The class is declared once in `spec.edgeRules` as
  a (pre selector, post selector, `contra`|`ipsi`|`any`) triple and resolved in the worker to a
  per-edge multiplier on the delivered weight; the same class can be an ensemble axis
  (`edges.<rule>`). The first rule is the one the sibling programme's alternation route acts on:
  every midline-crossing synapse between VNC intrinsic neurons, 323,880 edges.
- `wiring` as an ensemble axis: `real`, `weightShuffle` (synapse counts permuted over the real
  topology, seeded per assay seed) or `signFree` (every synapse excitatory). Doc 39's lesson is
  that a null arm has to run beside the real one under identical treatment; making it a member
  puts it in the same table as everything else, and the ranking reports whether any observable
  separates the two wirings.

The report (`renderMarkdown`) now carries the ensemble median of every baseline observable and a
table of the perturbed reads per perturbation, so a kill can be checked against the numbers that
produced it.

## The instrument on the real animal

One seed, the ledger's calibrated seed 7, the calibrated brain (`brain_params.json`), all
scaffolds on:

| assay | cadence | duty | swing | contra phase (R) | tripod | legs stepping | upright | support | speed |
|---|---|---|---|---|---|---|---|---|---|
| `walk_cpg` (generator) | 8.2 Hz | 0.61 | 56 ms | 0.50 (0.81) | 0.75 | 6 | 1.00 | 0.91 | 0.33 cm/s |
| `walk_cx` (cord) | 1.1 Hz | 0.24 | 86 ms | 0.65 (0.53) | 0.04 | 5 | 0.03 | 0.13 | 0.57 cm/s |

The generator reads inside every real-fly band the registry carries, without the instrument
knowing the generator's phase, and its tripod index is 0.75 against the synthetic tripod's 1.0
(the fitted gait has some phase jitter between legs). The cord read is doc 36's starting fact in
six numbers: the fly is down for 97% of the assay, three feet are on the floor 13% of the time,
five legs record a few lifts each and one hind leg cycles at 4 Hz while the body slides. Its
"speed" is that slide. That is the phenotype the committed experiment perturbs.

## The committed experiment: `walk-from-cord`

`src/exp/specs/walk-from-cord.js`. Ensemble 2 × 2 × 2, full grid: `wiring` ∈ {real,
weightShuffle}, `inhGain` ∈ {0.577 (calibrated), 1.0}, `edges.commissural` ∈ {1, 3}. Five
perturbations, each a named cord mechanism: ablate hemilineage 13A, ablate 13B (the two GABAergic
premotor hemilineages through which all leg antagonism runs in this animal, which has no
inhibitory leg motor neurons), ablate 19B, zero the commissural class, kill the footfall
reafference cancel. Eleven observables: the nine cord reads above plus the generator's cadence
and contralateral phase as the control. Split rule: the cord's leg rhythm dies with the
mechanism — `cadence < 0.5 × baseline.cadence && legsStepping < baseline.legsStepping`.

One assay seed. This is a BUILD-phase nomination in the sibling programme's vocabulary, not an
assertion: n=1 seed nominates, the run is there to show the machinery produces a table worth
reading and to record the first numbers.

### What came out

`public/data/experiments/walk-from-cord.{json,md}`, 48 arena evaluations, 8 workers, 8 minutes.

**The ensemble axes separate the animals harder than any perturbation does.** The ranking's top
nine rows are baseline observables, not perturbations: `upright` and `bodyHeightRel` each place
68% of member pairs in different classes, `legsStepping`, `duty` and `contraPhase` 61%. Whether the fly is up is decided
by which wiring it has and how strong its inhibition is, before any cord mechanism is removed.
The strongest perturbation, the reafference kill, separates 43%; the commissural cut 25%; the
three hemilineage ablations 0% — they kill on no member.

**One real-wiring member stands.** Member 2 (real wiring, `inhGain` 1.0, commissural ×1) is
upright 98% of the assay with all six legs lifting at 1.6 Hz, stance fraction 0.84 and
left-right phase 0.01, its thorax at 65% of the spawned standing height — a sagging fly that
shuffles its feet together. It is the only real
member that stays up; the calibrated `inhGain` 0.577 falls in every combination. Two shuffled
members also stand (members 5 and 7, upright 1.00 and 0.99) with one or two legs moving.
Standing is therefore not evidence of the wiring — doc 39's lesson at the whole-animal level —
and the compiler reports it as such rather than as a rescue.

**The commissural class carries what rhythm the standing member has.** `no_commissural` kills
exactly one member, that standing one: upright stays 0.995 while legs stepping drop from 6 to 2
and cadence from 1.58 to 0.53 Hz. On the shuffled standing members the same cut leaves the
count unchanged. It also weakens the generator's own cadence on member 0 from 8.2 to 5.0 Hz:
the walking command the descending neurons produce depends on cord crossings even when the
generator does the stepping.

**The hemilineage dials are live; the rule could not fire.** No hemilineage ablation kills, but
none is a flat dial either. Removing 19B on member 0 halves the generator's cadence (8.2 → 4.2
Hz) and moves the cord's own lift rate from 1.05 to 2.9 Hz; removing 13B on member 0 raises the
stepping-leg count from 5 to 6 and the stance fraction from 0.24 to 0.50. The split rule asks
for the cord's lift rate to *halve*, and on the real wiring that rate is about 1 Hz to begin
with: halving 1 Hz in a 3.8 s window is the difference between four lifts and two. A rule
about the rhythm of a fallen fly cannot discriminate mechanisms. The fix is in the spec, not
the machinery: the next spec starts from the standing member and asks the rule of a live
rhythm.

**The control sees the wiring where the cord read cannot.** The generator's cadence under the
same brain is inside the band on every real member (6.8–8.7 Hz) and below it on every shuffled
member (3.7–5.5 Hz), with left-right phase 0.46–0.51 throughout. A weight-shuffled wiring
produces a weaker walking command, and the instrument reads that off the generator's step rate.
This is the first observable in the repository that separates real from shuffled wiring in the
embodied animal.

**Determinism, checked for free.** The four member pairs that differ only in the commissural
multiplier become identical conditions under the commissural cut (0 × 1 = 0 × 3), and their
perturbed reads agree to the printed digit across all eleven observables. The whole path — seed,
graph build, ablation table, edge gain, MuJoCo, instrument — replays.

## S9: the response battery — real experiments as the objective

A hand-written band is still a drawn target. The proposal that followed the S8 run (recorded in
the session that produced it) replaces it with the fly's own response operator: for each real
perturbation experiment with a measured behavioural change, ask whether the model responds the
way the animal did. A parameter set that reproduces the animal's response to a battery of
manipulations shares its causal structure, whether or not anyone can name the mechanism. This
section builds the battery as data and runs it through the compiler with no gradient; the
gradient version needs per-type dynamics in the twin first (doc 33, doc 43) and is not here.

**The battery** (`src/exp/responses.js`). One row per experiment: what was done to the animal,
what changed, the gait-instrument measure that reads it, a comparator, and the source. Rows are
graded by what the source gives, and the grade travels into every report:

| row | status | experiment | animal | comparator |
|---|---|---|---|---|
| `mdn_backward` | qualitative | MDN activation while walking | backward walking (Bidaye et al. 2014) | fore-aft travel negative |
| `dng100_dose` | qualitative | BDN2/DNg100 driven at rising rates | speed and cadence rise with drive (Sapkal et al. 2024) | both monotonic over the series |
| `b13_slowdown` | measured | 13B premotor activation, 720 ms pulse | 40–80% slowdown (Agrawal et al. 2020, Fig 8) | speed ratio in [0.2, 0.6] |
| `decapitated_stands` | measured | brain removed | stands, 0 of 90 locomote ≥1 mm (Yellman et al. 1997) | displacement ≤ 1 mm and upright unchanged |
| `no_command_stands` | qualitative | command neurons silenced | no sustained walking | speed ≤ 0.05 cm/s |
| `dng93_stop` | prediction | DNg93 driven during the command | sibling-model prediction: walking stops | never counted as animal agreement |
| `dnge036_walks` | prediction | DNge036 driven, no command | sibling-model prediction: walking starts | never counted |
| `mdn_silenced`, `load_removed` | pending | named by the programme | no primary read yet | on record, not scored |

A comparator on an undefined value reports `undefined`, not a mismatch. Prediction rows are
evaluated and printed on their own line; the report's headline counts only `measured` and
`qualitative` rows. The registry the numbers come from carries about five perturbation rows,
most of them a sign or an ordering rather than a delta with a tolerance; that thinness is the
battery's main limit and is why it is data rather than code, so a primary read adds a row
without touching the runner.

**The binding is a homology hypothesis.** A row does not say which cells to drive; the spec
does, next to the seed. `respond-like-the-fly` drives the four annotated MDN cells, the two
DNg100 cells at three doses, the whole 13B hemilineage (Agrawal's driver covers a subset, and
pulses rather than holds), ablates every head superclass for decapitation, and silences the two
forward command types for the no-command row. Each choice is written in the spec header so a
mismatch can be charged to the binding rather than to the wiring.

**Two new channels.** `driveType` puts a constant depolarising bias on a selected population
(the model's optogenetic activation; `driveHz` reports the driven cells' rate so a dial that
never reaches threshold is visible), and `rest_cpg` is an assay with no endogenous scheduler,
where the descending neurons receive only the senses and the spec's drive — the site for
sufficiency and stop rows. The spec's `responses` block binds row, observable and perturbation
series, and the runner evaluates every row per member and writes a response-operator table:
rows × members, matched or not, with the comparator's own arithmetic beside each verdict.

**Site.** The bindings run on the generator site, where the descending readout decides and the
supplied tripod executes. That tests the connectome's *decision* — the part the wiring supplies
today — not the cord's stepping. The same bindings apply to `walk_cx` once the cord stands; on
the generator site the decapitation row is satisfied by construction and the battery says so.

### What came out

`public/data/experiments/respond-like-the-fly.{json,md}`, 4 members × 9 perturbations × 3
assays, 40 arena evaluations. The first run of this spec found two instrument faults, both
fixed before the numbers below: ablation had been built as zeroed outgoing synapses, which
leaves a silenced descending neuron visible to the motor readout (a "headless" fly kept walking
under the scheduler), so ablation now silences by threshold; and the DNg100 doses of 10, 20 and
40 mV reached 2.5, 4.5 and 28 Hz on the real wiring against 100–150 Hz on the shuffled one,
because the embodied descending neurons sit in a high-conductance state ([doc 23](23-behaviour.md)).
`driveHz` is what caught both. The `walk-from-cord` report re-ran under the new ablation and is
bit-identical: for cord interneurons nothing reads their spikes, so the two definitions agree.

**The calibrated real wiring matches four of the five animal rows.** Member 0 (real,
`inhGain` 0.577): MDN at 95 Hz walks it backward (fore-aft −0.66 cm/s); 13B at 62 Hz slows it to
a ratio of 0.206, inside Agrawal's 40–80% band; decapitation leaves it standing and still;
silencing the two command types drops its speed to 0.05 cm/s. The row it fails is the dose:
DNg100 at 28, 45 and 125 Hz gives speed 0.38, 0.60, 0.48 cm/s and cadence 8.2, 7.9, 4.5 Hz — an
inverted U with the cadence falling at the top, the same shape the sibling programme recorded
for its own champion ("inverted-U speed, flat cadence"). At 125 Hz the fly starts to lose its
footing (upright 0.93); the readout's saturating speed map and the generator's capped cadence
are where the shape comes from, and the row now says so in numbers.

**Inhibition gain decides the sign of two rows.** Member 1 (real, `inhGain` 1.0) walks
*backward* under a forward command at baseline (95% of its movement rearward) and, driven at
13B, speeds up by 47% instead of slowing — the same sign flip the sibling programme recorded
for its 13B arm (+11%). It matches MDN and decapitation and just misses the no-command ceiling
(0.079 against 0.05 cm/s). The calibrated gain is the one that behaves like the animal.

**The weight-shuffled wiring fails the rows that need the wiring.** Both shuffled members walk
forward at 4.0–4.6 cm/s of fore-aft travel at baseline, their forward descending neurons
saturated, and nothing moves them: MDN at 112–124 Hz leaves them at +3.2 and +3.8 cm/s;
silencing the command types leaves them at 0.4–0.6 cm/s, because a permuted wiring drives the
other forward neurons without a command. One shuffled member matches the 13B row (ratio 0.52)
and both match decapitation. The ranking puts the command silencing, the MDN row and the 13B
row at the top (0.667 separation each): those are the experiments that tell the wirings apart.

**Decapitation is satisfied by construction on this site.** Every member matches it, because
the readout needs descending spikes and a silenced head has none. The row is on the table so
that it is *not* on the table by construction once the cord drives the legs.

**Neither sibling prediction reproduces on the real wiring.** DNg93 at 89–136 Hz during the
command slows member 0 by 26%, short of the 50% the row asks; DNge036 at 117–155 Hz on the
rest site starts no walking on either real member. These are prediction rows and count for
nothing either way; they are recorded because the sibling programme registered them as
predictions about reconstructable cells.

**One instrument caveat, carried.** The brain's noise stream is not reseeded between assays, so
a member's read depends on which assays precede it in the job; a spec's assay set is part of
the condition. The `walk-from-cord` and `respond-like-the-fly` baselines for the same brain
differ for that reason and no other.

## What this does and does not give the walking problem

It gives the cord a scoreboard that does not assume a phase, a way to name a population or an edge
class in a spec and have it resolved once in the process that builds the graph, and a null
wiring in the same table as the real one. It gives the sibling programme's own experiments a
form: the commissural route, the 13B membership split and the 19B typed gains it recorded as
screens are one spec each here, and the report they produce carries the kill rule, the seed and
the resolved config alongside the numbers.

It does not make the cord walk, and nothing here is a fit. The standing baseline is still a
fallen fly, so a split rule about the rhythm is a rule about the rhythm of a fallen fly's legs.
The next two things, in order: the standing problem itself (doc 36's second item, proprioceptive
feedback at its own timescale, is now a perturbable delay rather than a uniform constant only in
the differentiable twin), and a circuit site for the cord — the same instrument over motor-pool
spike trains with no body, the sibling programme's `nobody` read — so a rhythm can be measured
before the body has a chance to fall.
