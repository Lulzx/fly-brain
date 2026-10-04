# 50. Cell-type mechanisms on the cord

[Doc 49](49-cord-scramble-alternation.md) added adaptation and rebound to every one of the cord's
33,004 cells and found no rhythm. A half-centre does not need them everywhere. It needs them in
specific cells. The inhibited excitatory cells must rebound and the active ones must tire, and
the inhibitory interneurons in many insect locomotor circuits release in graded fashion rather
than by spikes. This screen puts each mechanism only in the class a half-centre would use, and
adds the model's version of pilocarpine, the drug that makes isolated insect cords produce
fictive rhythms.

## Classes

Classes come from the real wiring, so no hemilineage list is chosen by hand. A **premotor** cell
is a cord interneuron (`super_class` ventral_nerve_cord_intrinsic) with at least one live edge
onto a leg motor neuron.

| class | cells | main hemilineages |
|---|---:|---|
| 1, inhibitory premotor | 2,864 | 13A, 21A, 12B, 8A, 16B, 13B, 14A, 19A, 9A |
| 2, excitatory premotor | 2,802 | 20A/22A, 3A, 4B, 1A |
| 0, everything else | 27,338 | |

A class belongs to the cell, so the scrambles carry the real wiring's classes. A scrambled class-1
cell keeps its sign and degrees, but its targets have been permuted and need not include motor
neurons any more. `scripts/prep_cord_x5.py` writes the class into the `hl` column of each
wiring's tab file, which these runners otherwise ignore.

## Axes

`cordx5.bend` is `cordx4.bend` with the class read in the threshold phase. There are 128 members
× {baseline, command silenced} × {real, deg, side}, with the loop open and no kick.

| bits | axis | levels |
|---|---|---|
| 0–1 | rebound gain, class 2 | 0, 15, 30, 60 mV |
| 2–3 | adaptation per spike, class 2 | 0.072 (shipped), 1, 3, 6 mV |
| 4 | graded release, class 1 | off, on |
| 5–6 | tonic depolarisation, classes 1 and 2 | 0, 2, 4, 6 mV |

A graded cell never spikes or resets. On each step it releases with probability
`0.05 · clamp((v − vRest) / (vThresh − vRest), 0, 1)`, through the same rows and delay line as
a spike. Only a class-2 cell's rebound variable ever moves, so the `gh · h` drive is restricted
to class 2.

**Identity check.** With every axis at its first level, the run is `cordx4.bend`'s member 0.
`cordx4_search.mjs --screen x5` compares the two outputs, and they are **byte-identical** in both
conditions on the real wiring. The class machinery changes nothing when it is switched off.

## Results

| wiring | population in-phase, peak / band | peak | live legs | antagonist band | surrogate | alternating calls | same call on surrogate | motor output |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| real | 0.904 / 0.711 | 15.6 Hz | 63 | **0.426** | 0.493 | 6 | 2 | 325 Hz |
| deg | 0.964 / 0.845 | 10.7 Hz | 82 | 0.751 | 0.505 | 0 | 7 | 263 Hz |
| side | 0.901 / 0.711 | 9.3 Hz | 20 | 0.586 | 0.486 | 0 | 1 | 276 Hz |

**The antagonist signature replicates, now against both scrambles.** Tonic drive gives the
side-preserving scramble live legs for the first time. In matched members, the real cord's
coxa-trochanter antagonists are less in phase than the degree scramble's in 44 of 45 pairs, and
less than the side scramble's in 8 of 9.

**There is still no rhythm.**

- The six alternating calls peak at 3.4, 5.9, 7.3, 7.8, 17.1 and 19.0 Hz.
- The best member, 39 (rebound 60 mV, adaptation 1 mV, tonic 2 mV), alternates on two legs.
  On one of them the rotated surrogate gets the same call, and the other peaks at 19 Hz.
- At 60 mV rebound the calls rise to 4 of 24 live legs, against 1 of 11 with none, and the band
  falls to 0.40. Doc 49 saw the same direction, and once more no shared frequency appears.

**Graded release as implemented silences the motor pools,** and this is a calibration fault, not a
biological result. Each release event carries a full spike's weight, and every depolarised
class-1 cell releases at up to 100 Hz. Across 2,864 cells that is tonic inhibition the motor
neurons cannot overcome. Median total motor output falls from 541 Hz to 105 Hz under the
command, and no leg is live in either condition. A fair test needs the event weight rescaled so
that a graded cell at its resting operating point delivers what the spiking cell did.

**Tonic depolarisation does what pilocarpine does for drive, but not for rhythm.** With the command
silenced, the live legs go from 0 to 0, 4 and 13 as tonic drive rises through 0, 2, 4 and 6 mV,
and motor output from 216 Hz to 447 Hz. It also lowers the antagonist band on the real cord
(0.48 to 0.38–0.40). It lowers it on the scrambles too (0.81 to 0.62), so that part is generic.

**Only the front legs are ever live.** Across every member, live legs are 17 for T1 left and 45 for
T1 right, 1 for T2 left and none for the other three. That holds under the command, under tonic
drive and under every mechanism. The middle and hind leg pools are not being reached, so no
mechanism screen can find a gait there.

## What this decides

1. **T2 and T3 drive comes first.** Before another mechanism axis, measure why their
   coxa-trochanter pools stay silent. The candidates are DNg100's projections into the posterior
   neuromeres, the input scale of their motor neurons (the volume rule in `prep_cord_banc.py`),
   and how far tonic drive must go before they fire.
2. **Recalibrate graded release** to match the spiking cell's mean delivered weight before
   counting it for or against anything.
3. **The positive control remains open.** Reproducing the published front-leg rhythm under
   descending drive is the test that tells pipeline failure from model-class failure. The T1
   pools are the only ones live, so it is also the only rhythm this setup could currently show.
4. Keep the antagonist anticorrelation as the wiring-specific readout. It replicated on a second
   ensemble and against both scrambles.

```sh
python3 scripts/prep_cord_x5.py --meta <banc_888_meta.feather>
bend cordx5.bend -o cordx5 && node scripts/cordx4_search.mjs --screen x5 run
```

Outputs are in `ext/x5/` (gitignored, about 15 minutes to regenerate): `x5_search.{json,md}` and
`x5.json`, which holds the class counts and file hashes.
