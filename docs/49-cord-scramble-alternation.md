# 49. Scrambled cords and antagonist alternation

Docs 46–48 kept tuning one model class, LIF cells with static weights, and kept getting the
same answer: a bilateral in-phase population mode and no leg gait. This screen asks two
narrower questions in one ensemble:

1. **Is the in-phase mode a property of the wiring or of the model class?** Run the same members
   on degree-preserving scrambles of the cord and see whether the mode survives.
2. **Do a leg's antagonists alternate once the cells have the slow processes alternation
   needs?** Mutual inhibition alternates only if something wears the winner down. The shipped
   kernel's adaptation is 0.072 mV per spike, which is close to nothing, and it has no rebound.

The readout is no longer the whole-leg pool. BANC labels every leg motor neuron with the joint
it moves, so each leg gets a coxa-trochanter flexor pool (6–11 cells) and an extensor pool
(5–9 cells). This is the joint that separates stance from swing, and alternation here is the
target a deafferented insect cord can reach. A tripod cannot be expected without a body.

| file | contents |
|---|---|
| `scripts/prep_cord_x4.py` | repacks `ext/` three ways, real and two scrambles, on live edges only, with a 16-channel antagonist tally |
| `cordx4.bend` | `cordx2.bend`'s kernel with per-member adaptation constants and an h-like rebound variable in place of depression |
| `scripts/cordx4_search.mjs` | runs the three wirings and scores antagonist phase, the surrogate control and the population mode |

## Construction

**Live edges only.** Of the 3,180,883 cord edges, 2,234,631 have weight 0: they fall below
three synapses or target a sensory cell. A zero-weight edge delivers `w * s = 0` into a
conductance, so dropping it is exact. This was checked directly: a 16-lane, 200-step run on
the IR with every edge and on the IR with live edges only wrote **byte-identical** output.
Runs are about 3× faster.

**Scrambles.** Each live edge keeps its presynaptic cell and its synapse count, and its target
is permuted within a stratum. Self-loops and duplicate pairs are then resolved by swaps inside
the stratum. The weight is recomputed for the new target from the count, that target's input
scale and the presynaptic inhibitory gain, using the same formula as `prep_cord_banc.py`.

- `deg` stratifies by presynaptic sign class. Every cell keeps its out-degree and its number of
  excitatory and inhibitory inputs (asserted in the script).
- `side` also stratifies by presynaptic and postsynaptic side, so each cell additionally keeps
  its ipsilateral and contralateral input counts.

In both scrambles 99.97% or more of targets moved. The meta snapshot used for joint labels
agrees with the IR's side table on 99.91% of cells. The IR's own side table is authoritative.

**Axes**, 128 members × {baseline, descending command silenced} × 3 wirings, 4000 steps of
0.5 ms, scored from 0.5 s to 2 s:

| bits | axis | levels |
|---|---|---|
| 0–1 | threshold adaptation per spike | 0.072 (shipped), 0.5, 2, 5 mV |
| 2 | adaptation time constant | 100, 400 ms |
| 3–4 | rebound gain | 0, 6, 15, 30 mV |
| 5 | proprioceptive loop | open, split by side at 20 ms |
| 6 | unilateral kick | off, +40 Hz on left proprioceptors for 200 ms |

The rebound variable relaxes toward `clamp((vRest − v) / 10 mV, 0, 1)` with an 80 ms time
constant and adds `gh · h` to the membrane drive. At `gh = 0` it adds 0.0, an exact no-op.

**Antagonist score.** The flexor and extensor traces are z-scored at 1 ms so pool size does not
weight the phase. The score is the in-phase fraction of the sum against the difference over
1–20 Hz (`src/exp/spectrum.js`): 1 means co-activation, 0.5 no relation, 0 clean
alternation. A leg is called alternating when both pools fire at 2 Hz per cell or more, the
band fraction is at most 0.35, and at least 20% of the difference spectrum's band power sits
within one bin of its peak. Every leg is also scored against itself with the extensor trace
rotated by 250 ms. That surrogate gives the no-relation reference, and the same call is
applied to it.

## Results

| wiring | population in-phase, peak / band | population peak | live legs | antagonist band, median | rotated surrogate | alternating calls | same call on surrogate | motor output |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| real | 0.870 / 0.704 | 14.6 Hz | 177 | **0.450** | 0.494 | 16 | 5 | 697 Hz |
| deg | 0.961 / 0.810 | 8.8 Hz | 53 | 0.826 | 0.476 | 0 | 5 | 184 Hz |
| side | 0.893 / 0.711 | 8.8 Hz | 0 | — | — | 0 | 0 | 171 Hz |

**The bilateral in-phase mode is a property of the model class.** It survives both scrambles.
Its band fraction is 0.81 on the degree scramble and 0.71 on the side-preserving one, against
0.70 on the real cord. Both scrambles peak at 8.8 Hz, the frequency doc 47 found on the real
cord. Destroying the wiring keeps the oscillation, so it is an excitatory–inhibitory population
resonance of LIF cells with a 5 ms synapse, a 20 ms membrane and a 2 ms delay. It is not a
cord pattern generator, and further tuning of it is not a route to a gait. The real wiring's
contribution is that it is *less* in phase than the scrambles and moves the peak higher.

**The real wiring has an antagonist signature the scrambles lack.** A leg's coxa-trochanter
flexor and extensor pools are anticorrelated on the real cord: median 0.45 against 0.49 for the
same traces rotated. On the degree scramble they are strongly co-active, at 0.83. In matched
members the real cord's antagonists are less in phase than the degree scramble's in **52 of 53**
pairs. This is the reciprocal inhibition between antagonists that the connectome encodes. It is
the first readout in docs 46–49 that separates the real cord from a scramble at the motor
neurons.

**It is not a rhythm.**

- The 16 alternating calls barely clear the cut (band 0.27–0.35), against 5 calls when the
  same criterion is applied to the rotated surrogate.
- Their difference-spectrum peaks are scattered across 2.4–18.6 Hz with no common frequency.
- Two calls survive with the command silenced.
- No member alternates on two legs.

The 20% concentration floor is below the median of all live legs (0.224), so it does not
separate a rhythm from broadband anticorrelation. What the data show is the latter.

**Adaptation and rebound do not produce a generator.**

- **Adaptation:** strong adaptation silences the pools. Live legs on the real cord fall from 59
  and 69 at the two weakest levels to 33 and then 16, and at 5 mV per spike there are no calls.
  The 400 ms time constant changes nothing measurable.
- **Rebound:** the calls rise with rebound gain, 0 at 0 mV, 3 at 6 mV, 3 at 15 mV and 10 at
  30 mV, and so do live legs. That is the right direction for a half-centre mechanism. Spread
  uniformly over all 33,004 cells, though, it deepens the broadband antagonism and does not
  produce a periodic one.

**Drive reaches the front legs only.** Under the DNg100 command, the real cord's live legs are
61 for T1 left and 95 for T1 right, against 2, 0, 15 and 4 for the middle and hind legs.
Scrambling cuts motor output by about 4×. The side scramble leaves no live antagonist pair at
all, so the matched comparison rests on the degree scramble alone.

## What this decides

- Stop tuning the population mode. Scrambles reproduce it.
- Antagonist reciprocity is real and wiring-specific, which makes the coxa-trochanter
  antagonist pair the right readout for the next screen. Alternation calls should now be scored
  against the surrogate call rate, not counted alone.
- Uniform intrinsic properties are not enough. The next axes should be **cell-type-specific**:
  rebound and adaptation confined to premotor inhibitory hemilineages (13A, 13B, 19A, 21A),
  graded release for nonspiking local interneurons, and a fit at hemilineage level with the
  degree scramble inside the objective.
- The drive question comes before the rhythm question for T2 and T3. A single command type
  barely reaches them. Reproducing the published front-leg rhythm under DN drive (Pugliese et
  al.) is still the missing positive control.

```sh
python3 scripts/prep_cord_x4.py --meta <banc_888_meta.feather>
bend cordx4.bend -o cordx4 && node scripts/cordx4_search.mjs run
```

The wirings, binary runs, `x4_search.{json,md}` and `x4.json` (pool sizes, scramble checks,
file hashes) are in `ext/x4/`, which is gitignored and takes about 15 minutes to regenerate.
