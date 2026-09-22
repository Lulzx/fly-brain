# 46. The cord in Bend: a checked subgraph, a gated kernel, and a search that found nothing

Doc 44 ends by asking for two things the walking programme did not have: a circuit site, where
a rhythm can be measured before the body has a chance to fall, and a way to name a mechanism
as a set of cells and edges rather than a parameter vector. Doc 45 put the connectome compiler
in Bend and proved what its lowering does. This document joins the two: the nerve cord's
leg-premotor subgraph as a checked object, the spiking kernel as a port that is bit-identical
to the shipped one, the three perturbation channels as proven operations, a gait instrument
that needs no body, and an ensemble run through all of it.

The result is a negative, and a specific one. **No member of a 64-member ensemble produces a
leg rhythm.** The instrument that says so is calibrated on synthetic gaits, and the whole path
from graph to answer is either proven or gated.

| file | contents |
|---|---|
| `scripts/prep_cord_ir.mjs` | writes `public/data/cord_ir.bin`: the subgraph, delta-encoded, with named sets |
| `cord.bend` | delta rows, the induced-subgraph walk, and the rank specification it is proven to implement |
| `cordcheck.bend` | checks the shipped file against the full connectome, and against the proven walk |
| `kernel.bend` | `lif_step` over Bend arrays, one member per lane |
| `scripts/cord_kernel_ref.mjs`, `cordrun.bend` | the bit-identity gate against the shipped WebAssembly kernel |
| `perturb.bend` | ablation, edge-class scaling and drive as operations, with nine laws |
| `src/exp/pools.js`, `scripts/pool_unit.mjs` | the gait instrument over motor-pool spike trains, and its unit tests |
| `cordens.bend`, `scripts/cord_ens_tab.mjs` | the ensemble: 64 members x 6 perturbations, one run per lane |
| `scripts/cord_search.mjs` | the instrument, the ranking, and the kill tests |

## 1. The cord as a checked object

Doc 39 froze the leg-premotor subgraph as a 14 MB JSON of CSR arrays: 21,843 cells (the leg
motor neurons plus their two-hop VNC and descending ancestors) and 1,615,182 edges. The same
object is now `public/data/cord_ir.bin`, 11.8 MB, with two changes that make it checkable.

**Rows carry gaps, not targets.** A row is a list of `(gap, count)` pairs: the first entry's
target is `gap` cells along, and each later one is `gap + 1` cells past the previous. A gap
list cannot express a descending target or a duplicate, so "the rows are sorted and
duplicate-free" stops being a property to test and becomes a property of the representation.
What is left to bound is the row's *span*, the index one past its last target.

**The subgraph is taken by walking a membership list, not by indexing.** `DSub.go` walks the
cells in order beside the row, widening a gap for each member it passes, emitting an entry when
a target is a member and carrying the gap across the hole when it is not. No index arithmetic
appears, which is what lets the theorems be structural inductions rather than facts about
32-bit comparison.

Seven laws, proven in `PROOF.bend`:

- **The targets a delta row denotes rise strictly.** Nothing checks this at run time and
  nothing can violate it; this is the proof that the representation has that property.
- **The induced row lands inside the member index space.** Walking the membership list can emit
  at most one entry per member and widen a gap at most once per member, so the induced span is
  bounded by the members alone — whatever the row it came from was.
- **The induced targets are the member ranks of the surviving targets.** This is the
  induced-subgraph property itself. `DSub.spec` counts members and emits that count at every
  surviving target, with no gap arithmetic at all; the construction is proven to agree with it.
  The gap bookkeeping — accumulate, reset, carry across a hole — is exactly where a bug lives,
  and the specification has none of it.
- Counts are carried unchanged and in order; a subgraph cannot manufacture a connection below
  the reconstruction threshold; and the induced row and graph are well-formed for the member
  index space at the same threshold.

`cordcheck.bend` then checks the shipped file. Every one of the 21,843 rows and all 1,615,182
entries match the full connectome's row for that cell, filtered to the members and relabelled,
entry by entry; no row exceeds the member index space; and 32 rows agree with the proven walk,
which ties the fast index-lookup route to the proven one. It runs in 1.2 s.

The file also carries what the perturbation work needs: 22 named sets (the six leg motor pools,
hemilineages 13A, 13B and 19B, the locomotion descending types, the roles, the 366
proprioceptors) and a commissural edge class of 309,435 midline crossings between cord
interneurons.

## 2. The kernel, bit-identical

`kernel.bend` is `src/wasm/lif.c` over Bend arrays. Every arithmetic step is the shipped
kernel's, in the shipped kernel's order. Three departures, each exact rather than approximate:
the short-term depression resource is dropped because the calibrated `depU` is 0, so it is 1
for ever and multiplying by it is exact; the trace is dropped because `lif.c` maintains it and
never reads it back; and the zero-sign skip is dropped because a zero sign delivers `w * 0`,
which is an exact no-op.

One structural change matters. Delivery splits the arriving spikes by the sign of the cell that
fired and scatters the two groups separately. Excitatory cells only ever write to `gE` and
inhibitory ones only to `gI`, so splitting leaves each accumulator's additions in their
original order — which is what a float sum depends on. Without the split, a lane would need two
sequential reads of one conductance array per cell, which the language cannot express in a
single self-recursive definition.

The gate: `scripts/cord_kernel_ref.mjs` builds the cord's brain through the shipped path
(`brainScales`, `modulatorySign`, `writeGraph`), runs `public/lif.wasm` for 1000 steps, and
writes the constants, the compiled weights, the drive and the answer.

| run | spikes | neurons mismatched | per-step checksum |
|---|---|---|---|
| baseline | 139,582 | 0 | identical |
| ablate hemilineage 13A | 137,276 | 0 | identical |
| ablate hemilineage 13B | 142,120 | 0 | identical |
| ablate hemilineage 19B | 134,097 | 0 | identical |

The gate earned its keep immediately. Rotating five ring slots delivers a spike one step later
than `lif.c`'s ring index arithmetic does. That cost 2% of the spikes and was invisible in every
summary statistic; the first five steps matched exactly, because delivery had not yet mattered.

The compiled weights are handed to Bend rather than recomputed, because `writeGraph` multiplies
in double and rounds once at the end, which float32 arithmetic cannot reproduce. What Bend
checks about the compile is the part that is exact — which edges are cut — against
`connectome.bend`'s proven `Compile.syn`.

## 3. Perturbations as proven operations

`perturb.bend` models the three channels a walking spec pulls, with a selector represented by
the mask it resolves to. Nine laws:

- A silenced cell does not fire, whatever its membrane has done and whether or not it is out of
  its refractory period. A living cell's rule is the kernel's original condition, so carrying
  the flag costs the unperturbed model nothing.
- **Silenced cells contribute nothing to a step's spikes**: taking them out of the sweep's input
  does not change its answer. That is "an ablated cell fires at no step", as an equation.
- Ablation and drive leave every cell the mask does not name exactly as it was, and give every
  cell it does name the value asked for.
- A class scaling multiplies its class, leaves every other weight alone, and never moves, adds
  or drops an edge.

The shipped backend silences a cell by raising its threshold to 1e6, which is a claim about
float comparison rather than something a match can decide. The kernel therefore carries the
flag, and `cordrun.bend` runs the two against each other: they agree bit for bit on all three
hemilineage ablations, which ties the proven mechanism to the shipped one by measurement.

## 4. The instrument, with no body

`src/exp/pools.js` is doc 44's gait instrument over the six leg motor pools' firing rates
instead of six claw contacts. Every field is defined the same way and survives not knowing the
phase. Two things are new.

The on/off sequence a rate is turned into uses the pool's own half-way point between its 10th
and 90th percentile, so the threshold is a property of the trace rather than a number anyone
chose, and a pool whose rate barely moves is called unmodulated rather than thresholded into
noise. A tonically firing pool and a silent pool both read as no rhythm — the honest reading,
since neither is stepping — and `meanHz` tells them apart.

**A threshold-free frequency sweep**, `bestPeriodicity`, reports the strongest periodicity
between 1 and 20 Hz and where it sits. This was added after the first ensemble run, and it
changed the answer. Threshold crossings alone read a plausible 10 Hz "cadence" off pools that
are not oscillating at all: Poisson counting noise crosses any threshold at a plausible-looking
rate. The sweep does not. `scripts/pool_unit.mjs` holds the instrument to 30 cases carried over
from `gait_unit.mjs` — a synthetic tripod reads cadence 10 Hz, duty 0.6, contralateral phase
0.5, tripod index 1 and periodicity above 0.5 at 10 Hz; an in-phase hop reads tripod 0; a
metachronal wave reads tripod below 0.3; a tonic pool and twelve-trial binomial counting noise
both read no periodicity.

## 5. The search

`cordens.bend` runs six binary axes over the gains the connectome does not fix, crossed with six
named perturbations: 64 members, 384 runs, one per lane. Every lane derives its own
configuration from its index, so there is no config file to drift.

| axis | low | high |
|---|---|---|
| commissural class | x1 | x3 |
| hemilineage 13A gain | x0.5 | x2 |
| hemilineage 13B gain | x0.5 | x2 |
| hemilineage 19B gain | x0.5 | x2 |
| tonic drive on cord interneurons | 0 mV | 4 mV |
| proprioceptive loop delay | 5 ms | 20 ms |

The proprioceptive loop is closed: each step's leg motor-pool spikes come back as drive on the
366 proprioceptors `pdelay` steps later, which is doc 36's second item as a dial rather than a
constant. The perturbations are the baseline, ablation of each of the three premotor
hemilineages, cutting the commissural class, and silencing the descending command.

384 runs of 1000 steps took 29.5 s of wall time at 739% CPU — 222 s of work in 30 s, a 7.4-fold
speedup across 12 cores, with the graph shared read-only between lanes.

### What came out

**Nothing walks.** The ensemble's best periodicity is 0.404, against the 0.5 a synthetic tripod
reads through the same instrument. Two members cross the 0.3 floor, and both sit inside the
ensemble's own spread (median 0.232, minimum 0.146). There is no rhythm here to name.

| condition | median pool rate | median periodicity |
|---|---|---|
| baseline | 632.5 Hz | 0.232 |
| ablate 13A | 720 Hz | 0.240 |
| ablate 13B | 740 Hz | 0.222 |
| ablate 19B | 680 Hz | 0.216 |
| cut the commissural class | 1102.5 Hz | 0.168 |
| silence the command | 372.5 Hz | 0.234 |

**The cord is responsive, and in the direction its anatomy predicts.** Silencing the descending
command halves the pools' firing. Ablating any of the three GABAergic premotor hemilineages
raises it, which is what removing inhibition should do. Cutting the 309,435 midline crossings
raises it most of all and lowers the periodicity most of all: the commissural class is the
strongest single lever on the pools in this ensemble, and what it does is hold the rate down
rather than build a rhythm.

**The ranking puts the command first.** By the experiment compiler's own statistic — the
fraction of member pairs whose outcome class differs — silencing the command separates 90.5% of
pairs and changes the class of 95% of members. The hemilineage ablations follow at 0.80, 0.75
and 0.69; the commissural cut is last at 0.50, because it pushes nearly every member into the
same saturated class.

**The two members above the floor are command- and commissural-dependent.** Both carry the
tripled commissural class, and both lose what periodicity they have when the command is
silenced or the crossings are cut. That is the shape a walking rhythm would have, at an
amplitude that is not one.

## 6. What this does and does not establish

It establishes that the machinery is sound, and it is worth being precise about which part is
established how. The subgraph is the induced subgraph, proven as a construction and checked
against the connectome entry by entry. The kernel is the shipped kernel, gated bit-identical on
four runs. The perturbations do what they say, proven as operations and tied to the shipped
implementation by a bit-identical ablation. The instrument would see a rhythm, shown on
synthetic gaits with known answers. So when the answer is "no rhythm", the answer is about the
nerve cord rather than about the pipeline.

It does not make the cord walk, and it does not close doc 36's question. Three limits are worth
naming. The ensemble is 64 points on six binary axes, which is a coarse grid over a space
nobody has mapped; a rhythm could live between the corners. The hemilineage gains are applied
through the presynaptic sign rather than through `writeGraph`'s `outScale`, which is the same
quantity with a different rounding — fine for a sweep, not for a gate. And the run is one
second of a cord with no body, so anything that needs load-bearing mechanics to close its loop
cannot appear here by construction.

Doc 39 found that a frozen premotor subgraph loses to a degree-matched scramble at routing a
replayed state onto muscles, and concluded that the informative measurement was whether the
subgraph *produces* the premotor pattern rather than merely routes it. This document is that
measurement, at the resolution a 64-point grid affords, and the answer is that it does not —
not at any of the 64 settings of the six dials the sibling programme names, with the
proprioceptive loop closed and the descending command driving.

```sh
node scripts/prep_cord_ir.mjs && bend cordcheck.bend -o cordcheck && ./cordcheck
node scripts/cord_kernel_ref.mjs && bend cordrun.bend -o cordrun && ./cordrun
bend PROOF.bend                                    # 51 laws, including the cord and perturbation ones
node scripts/pool_unit.mjs                         # the instrument, on synthetic gaits
node scripts/cord_ens_tab.mjs && bend cordens.bend -o cordens && ./cordens
node scripts/cord_search.mjs                       # the instrument, the ranking, the kill tests
```
