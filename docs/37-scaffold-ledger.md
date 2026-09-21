# 37. The scaffold ledger

The standing rule, from the invention spec:

> Every non-graph mechanism is a named module. If it is required for a behaviour, the ledger says so.

The connectome produces spikes; it does not, by itself, produce behaviour. Between the graph and the
arena sit a dozen pieces of supplied machinery — a stepping generator, an escape gate, a bout
scheduler, a jump program, and more. Before this change they lived as anonymous constants and
inline blocks inside `motor.js`, `intrinsic.js`, `senses.js` and `fly.js`: real mechanisms with
real claims, but invisible to any accounting. An unnamed multiplier that improves walking is a
regression, so they are now plugins.

## The registry

`src/sim/scaffold/` holds one plugin per mechanism. A plugin is a plain object:

```text
id, title, claim      -- name and a one-sentence falsifiable claim
files                 -- where the code lives
defaultOn             -- all default on, so the calibrated animal is unchanged
params / paramSource  -- constants the plugin owns, or the host table it reads (INTRINSIC, READOUT)
kill                  -- the switch that removes it
```

`createScaffoldSet({id: false, ...})` builds a per-fly set; FlyAgent shares one set across Motor,
Senses and Intrinsic so a kill switch turns a mechanism off everywhere at once. Config travels in
`brainOpts.scaffolds`, so `evaluate({scaffolds:{cpg:false}})` or a ladder rung's
`patch: {scaffolds: {escapeGate: false}}` needs no new plumbing. Unknown ids throw at startup —
a typo in a kill switch cannot silently do nothing.

The plugins, grouped by host:

| host | plugin | mechanism |
|---|---|---|
| Motor | `cpg` | FlySuite-fitted tripod stepping generator (the largest piece of supplied machinery) |
| Motor | `steeringAdapt` | 4 s leak that cancels the steering DNs' standing L/R imbalance |
| Motor | `groomPattern` | 7 Hz antiphase front-leg head sweep while grooming DNs fire |
| Motor | `escapeJump` | GF-burst and loom-takeoff detection + the TTM jump program |
| Motor | `rightingReflex` | inverted >150 ms -> wing push + tripod flail |
| Senses + FlyAgent | `reafference` | efference-copy cancellation of self-generated footfall touch (0.85), plus the fitted self-motion visual cancel on the loom pathway's membrane drive (S3, docs/38) |
| FlyAgent | `escapeGate` | touch/pivot/grooming veto on the escape trigger (the measured negative of docs/38 keeps it required) |
| FlyAgent | `gfGap` | GF->TTMn electrical synapse, not in the chemical connectome |
| FlyAgent | `lc10Channel` | direct LC10 small-object drive from a nearby fly |
| Intrinsic | `boutScheduler` | stop/walk/groom/feed action selection + spontaneous saccades + voluntary takeoff draw + the active brake |
| Intrinsic | `feedingStop` | stop on food, hunger-gated proboscis drive, post-feed local search |
| Intrinsic | `avoidance` | head-on contact back-off/pivot, graze turns, heat escape |
| Intrinsic | `courtship` | male chase/station-keeping/song trigger from the pIP10+DNp13 readout |
| Intrinsic | `femaleRejection` | decamp run and hind-leg kick |
| Intrinsic | `flightSaccade` | spontaneous and collision-avoidance saccades in flight |
| Intrinsic | `oaArousalRule` | the single arousal signal (OA level, else energy deficit) every consumer reads; S5 tested four chemical-graph OA operators against it — none reproduce starved hyperactivity, still required (docs/40) |

Three named modules predate the registry and keep their own switches; the ledger lists them as
host-managed: `neuromod` (brainOpts.neuromod / neuromod.block), `song` (driven by
`courtship.courtSing`), `flight` (started by `motor.launchT`).

## Behavioural equivalence

The refactor moves code; it does not move draws. Every `this.rand()`/`gauss()`/`lognormal()` call
executes at the same point in the same order as the monolith — the plugins call `host.rand()` —
and every constant keeps its value and its owner (INTRINSIC and READOUT are bound live, so
`scripts/diag_walk.mjs`'s `Object.assign(INTRINSIC, ...)` still reaches the plugins). The one
deliberate non-equivalence is timing metadata: `escapeGate`'s `lastTouch`/`lastPivot` live on the
plugin now instead of the agent, and `gfTimes` only accumulates while `escapeJump` is on.

The doc-35 lesson applies: the arena amplifies last-ulp differences into ±0.1 score, so "the same
code in a plugin" is verified by running it, not asserted. `scripts/scaffold_ledger.mjs --run` is
that check.

## The ledger artifact

`node scripts/scaffold_ledger.mjs` prints the manifest — every module, claim, params, kill switch —
as JSON. `--run [n]` evaluates the kill matrix on n seeds through the same worker pool as the
behaviour ladder (all on, all off = graph-only, each off alone) and writes
`public/data/scaffold_ledger.json`: the conditions, their per-scenario observables, and the
`behaviour | graph-only | with scaffolds | required | kill` table the spec asks for. `--minimal`
then runs the greedy minimal-enabling-set search on top. The UI's Scaffolds checkboxes and the
`?off=id1,id2` URL flag drive the same `scaffolds` map live.

The metrics live in `src/sim/scaffold/ledger.js`, one entry per behaviour, each reading a named
assay in `scripts/behavior_eval.mjs` rather than the headline score: `walk`/`steer`/`groom` read
`forage`, `stand` reads `stand_2s` (connectome motor mode, no stepping generator), `loomEscape`
reads `loom_disk` (an expanding disk in an emptied arena), `starveWalk` reads a starved-fly forage,
`court`/`reject` read the decoy assays, `feed` reads `onfood`, `bout` reads the scheduler median.
A scaffold is `required` when turning it off alone costs more than half the all-on metric or drops
it under the floor; a row that survives every single kill and only collapses at `graph_only` is a
finding, not an error.

`graph_only` — every plugin off at once — is the honest reference, and it is expected to be bad:
the connectome cannot yet hold the animal up, which is precisely what the ledger is for. Each
`off_<id>` row is a kill test that can lose: if turning a scaffold off changes nothing measurable,
the claim was wrong or the scaffold is dead code, and either is worth knowing.

## The first measurements

`--run 4` (seeds 1000/8919/16838/24757, 72 evaluations): `all_on` scores 0.62, `graph_only` 0.12 —
the connectome alone cannot hold the animal up, and the gap is the sum of the supplied machinery.
The four cleanest attributions are the ones a biologist would predict: `walk` needs `cpg` +
`boutScheduler` (no legs, or no reason to move them), `feed` needs `feedingStop`, `court` needs
`courtship`, `reject` needs `femaleRejection`. `starveWalk` survives every single kill — no one
scaffold removes it; the starvation effect needs the combination, which is the correct reading of a
modulatory mechanism rather than a missing attribution.

Three rows carry warnings, and the warnings are the point of printing the table:

- **`stand` is degenerate, correctly.** `graph_only` stands perfectly — nothing drives it to move,
  so it never falls. `all_on` only manages 0.58 upright because walking bouts sometimes tip it. The
  metric measures "is upright", not "can hold itself up", and the row exists to show a behaviour
  the scaffolds *hurt* rather than supply.
- **`loomEscape`'s required list is noise-inflated.** The all-on metric is 0.25 (one escape in
  four), so a 50% drop is one unlucky seed. `reafference`, `avoidance`, `gfGap` and
  `rightingReflex` "required" there is the binary escape term's variance wearing a causal costume —
  the 1-ulp lesson from doc 35 at assay scale. More seeds, or a graded loom-response metric, before
  believing any name on that row but `escapeJump`.
- **`groomPattern` is invisible to its own metric.** `groomMs` reads `cmd.grooming`, which is the DN
  state — exactly the "reports grooming while standing still" case the plugin's claim describes.
  Its kill test needs a leg-kinematic observable (T1 sweep amplitude), which the eval does not yet
  record. Until then the claim is unfalsified, not confirmed — noted here so it is not silently
  taken as tested.

The headline score is also the wrong yardstick for a kill: `off_cpg` scores 0.66, *above* `all_on`'s
0.62, because a frozen fly does not flip and does not blunder into hazards. The ledger uses
per-behaviour metrics precisely because the weighted score can reward a broken animal.

## Verification

The refactor moves code, not draws — and that claim was tested, not asserted: `evaluate({}, [7])`
over the five default scenarios is **bit-identical** between the pre-refactor monolith and the
plugin architecture (score, all six terms, every observable). `--run` produced the table above;
`cpg` off was additionally verified to freeze the animal end-to-end (score 0.55, dead on the heat
hazard) in an earlier single-seed kill.

## What is still not a plugin

The sensory transduction curves in `senses.js` (odour/taste/touch/heat -> afferent rates) are the
model's input layer, not behaviour machinery; they are covered by the twin audit's "identical
sensory masks" requirement instead. The `INTRINSIC`/`READOUT` tables themselves, the DN->drive
readout math in `Motor.apply`, and MuJoCo physics are the substrate the plugins act on.

## Where this goes next

- **S2** ran to its kill test (docs/39-vnc-readout.md): the frozen 21,843-neuron leg-premotor
  subgraph, replayed boundary spike trains in, fitted per-neuron `logGain` readout out. The gains
  learn real signal (held-out ctrl MSE 0.401 raw -> 0.285 fitted) and deploy through
  `typeGains`' `neuronGainTable` — but the degree-matched scramble fits 4× *better* (0.073), so
  the readout is a reservoir task: the wiring is not the load-bearing part at this level. The
  fitted table is in `public/data/stand_fit.json`, on by default in the eval, killable with
  `standFit: false`.
- **S3** shipped as a recorded negative (docs/38-reafference.md): the learned cancel exists and is
  real -- wall false-alarms fall 8/10 to 2/10 with `escapeGate` off -- but the reafferent LC4 drive
  is scene-dominated (a command-conditioned model predicts ~4-19% of it), the blind floor is ~2/10,
  and the disk assay cannot reach 8/10 at baseline. `escapeGate` stays required.
- **S5** ran the octopamine operator family to its split table (docs/40-oa-operators.md): four
  postsynaptic OA actions (`synFast`, `thrField`, `gainField`, `thrTyped`, all killable via
  `oaMode`) over 4 conditions × fed/starved. `synFast` is eliminated on direction — OA's fast
  synapses are net inhibitory, starvation *reduces* walking (0.84×). No operator reproduces
  starved hyperactivity with `oaArousalRule` off (ratios 0.85–1.09 at full OA tone), so the rule
  keeps its required label; the field family members separate from each other only weakly.
  `oaArousalRule` row: still required, now with the sharper statement that the need was tested
  against three rival postsynaptic actions, not asserted.
