# 51. Where the cord's leg posture comes from

[Doc 50](50-cord-cell-types.md) found both coxa-trochanter antagonists live only in the front
legs. In the middle and hind legs one pool of each pair fires and the other stays near zero, so
those legs hold a fixed posture. This document finds what holds them there. It then tests the
half-centre that the answer points to.

## The instrument

`cordx5c.bend` is `cordx5.bend` cut down to eight members (0, 3, 32, 64, 96, 39, 67, 99). After
each run's channel tally it writes every cell's spike count. Its tallies match `cordx5.bend`'s
runs of the same members **byte for byte, 16 of 16**, so the counts belong to the runs already
scored in doc 50.

`scripts/cord_drive.py` pushes the counts through the wiring. For a pool `p` and a source group
`g` it computes

`drive(p, g) = Σ w_ij · sign_i · rate_i` over live edges i→j with j in p and i in g,

per cell of the pool. That is the conductance the run's mean activity delivers, in the kernel's
own units. Groups are hemilineages for cord interneurons and super-classes otherwise.

## Posture is set by two inhibitory hemilineages

Baseline condition, mean over the eight members, real wiring, per pool cell:

| pool | Hz per cell | excitation | inhibition | net | strongest inhibition |
|---|---:|---:|---:|---:|---|
| T1 L flexor | 2.08 | 1299 | −2831 | −1531 | 19A −1627, 16B −588, 12B −311 |
| T1 L extensor | 5.44 | 2356 | −2477 | −122 | 13A −1017, 13B −335, 16B −271 |
| T2 L flexor | 3.47 | 1924 | −2498 | −573 | 19A −896, 16B −860, 13A −289 |
| T2 L extensor | **0.70** | 1928 | −3445 | **−1517** | 13A −1246, 13B −663, 21A −457 |
| T3 L flexor | **0.04** | 520 | −1778 | **−1258** | 16B −899, 19A −294, 12B −211 |
| T3 L extensor | 11.55 | 3228 | −2441 | 787 | 13A −1073, 12B −275, 21A −274 |
| T1 R flexor | 4.85 | 1721 | −2541 | −821 | 19A −941, 16B −803, 13A −236 |
| T1 R extensor | 6.46 | 2006 | −1711 | 295 | 13A −852, 16B −165, 13B −162 |
| T2 R flexor | 1.88 | 1409 | −2314 | −905 | 19A −961, 16B −611, 12B −348 |
| T2 R extensor | **0.35** | 1518 | −2801 | **−1284** | 13A −913, 13B −547, 21A −332 |
| T3 R flexor | 0.84 | 1159 | −1741 | −582 | 19A −898, 16B −400, 12B −97 |
| T3 R extensor | 1.54 | 2345 | −2374 | −29 | 13A −952, 13B −328, 14B −281 |

The split is clean and holds on every leg. **19A** (with 16B) is the largest inhibitor of the
**flexors**, and **13A** (with 13B and 21A) is the largest inhibitor of the **extensors**. The
silent pools are the ones whose inhibitor wins.

- In both middle legs, 13A holds the extensors down (net −1517 and −1284).
- In the left hind leg, 16B and 19A hold the flexors down (−1258).

Wiring alone does not predict this. On static weights the T2 extensors receive the most net
excitation of any pool. The posture is a property of which premotor cells are *active*.

## The inhibitory premotor loop

Within each segment and side, the inhibitory premotor hemilineages inhibit one another. In
weight per target cell, summed over the six hemisegments:

| from \ onto | 19A | 16B | 13A | 13B | 21A | 12B |
|---|---:|---:|---:|---:|---:|---:|
| 19A | 35.2 | 9.4 | 23.8 | 1.0 | 12.8 | 0.1 |
| 16B | 20.0 | 4.5 | 13.7 | 1.4 | 7.1 | 0.3 |
| 13A | 25.4 | 11.6 | 13.4 | 1.5 | 12.2 | 0.4 |
| 13B | 4.5 | 2.4 | 1.9 | 4.3 | 1.4 | 5.3 |
| 21A | 22.6 | 5.7 | 6.7 | 0.8 | 12.4 | 0.5 |
| 12B | 1.6 | 0.3 | 1.3 | 2.6 | 0.8 | 4.7 |

19A and 13A inhibit each other almost symmetrically (23.8 and 25.4), and 16B and 21A sit on the
same loop. Their excitation from excitatory premotor cells is an order of magnitude larger
(about 350 per 19A cell and 167 per 13A cell), so as wired the mutual inhibition is weak against
the drive. Over all inhibitory premotor cells the loop has 51,667 live edges in the real cord,
against 32,914 and 33,023 in the two scrambles, a **1.57× enrichment**. Mean rates at member 0
are 19A 6.4 Hz, 13A 2.5 Hz, 16B 2.0 Hz and 21A 1.2 Hz. They rise together under tonic drive, to
13.7, 7.5, 6.8 and 5.8 Hz at 6 mV.

The two antagonist inhibitors therefore form a mutually inhibitory pair that targets opposite
pools. Structurally that is a half-centre. Doc 50 put fatigue and rebound in the *excitatory*
premotor class, and these cells are inhibitory, so it never tested this one.

## The inhibitory half-centre screen

`cordx6.bend` is `cordx5.bend` with adaptation and rebound moved from class 2 to class 1, graded
release off, and a second row-set. `scripts/prep_cord_x6.py` flags every class-1 → class-1
edge in the tab's per-edge column, and members 64–127 run that loop at ×3. There are 128
members × 2 conditions × 3 wirings. Member 0 is again **byte-identical** to `cordx4.bend`'s.

| bits | axis | levels |
|---|---|---|
| 0–1 | rebound gain, class 1 | 0, 15, 30, 60 mV |
| 2–3 | adaptation per spike, class 1 | 0.072, 1, 3, 6 mV |
| 4–5 | tonic depolarisation, classes 1 and 2 | 0, 2, 4, 6 mV |
| 6 | class 1 → class 1 edge gain | ×1, ×3 |

| wiring | live legs | antagonist band | alternating calls | same call on surrogate | members with ≥ 2 | motor output |
|---|---:|---:|---:|---:|---:|---:|
| real | 593 | **0.366** | **219** | 24 | 62 | 6389 Hz |
| deg | 376 | 0.607 | 5 | 16 | 0 | 759 Hz |
| side | 295 | 0.571 | 2 | 12 | 0 | 766 Hz |

Fatigue in the inhibitory premotor cells changes the picture more than any earlier axis did.
Ten times as many legs have both antagonists live, and the real cord's antagonists anticorrelate
in every matched member: 122 of 122 against the degree scramble and 60 of 60 against the side
scramble. Live legs and calls rise with adaptation (80 and 20 at 0.072 mV, 192 and 81 at 6 mV)
and with tonic drive. The loop gain mostly adds live legs. The scrambles, given the same cells
and the same mechanisms, make no alternation at all.

The calls are not yet a rhythm, though. Their peaks spread evenly over 1.5–19.5 Hz.
`scripts/cord_rhythm.mjs` scores periodicity directly: a rhythmicity index (the height of the
first autocorrelation peak after the first zero crossing of the 10 ms flexor-minus-extensor
trace) against the same index after shuffling 50 ms blocks.

- Over all live legs, the index matches its null (median 0.162 against 0.157).
- At 10 ms resolution, 145 real legs anticorrelate at r < −0.2, against 0 in either scramble.
- Eight members had two or more legs passing in the 1.5 s window. The best, member 116
  (adaptation 1 mV, tonic 6 mV, loop ×3, no rebound), had four legs agreeing on 320–390 ms.

## The 10-second test

Following doc 48's lesson, the candidates were rerun long before being believed. `cordx6L.bend`
runs 16 members chosen by rule, the top eight of each loop-gain group ranked by rhythmic
alternating legs and then by calls. Each runs 10 s under the command, with the screen's seed and
with a fresh one, on the real wiring and the degree scramble. All 32 original-seed runs reproduce
the screen's first 2 s **exactly**.

The criteria were fixed in `scripts/cord_rhythm_long.mjs` before scoring.

- **A leg** is sustained when it is live, anticorrelated (r < −0.2) and rhythmic (index ≥ 0.2 and
  above all 20 block-shuffled copies) in both 0.5–5 s and 5–10 s, with periods within 20%.
- **A member** passes when at least two legs are sustained with agreeing periods on both seeds,
  and the two seeds agree.

| wiring | live leg-windows | anticorrelated | rhythmic | both | members passing |
|---|---:|---:|---:|---:|---:|
| real | 384 / 384 | **244** | 2 | 2 | **0** |
| deg | 372 / 384 | 0 | 0 | 0 | 0 |

**No member passes.** Member 116's 2.8 Hz agreement does not survive. On the screen's seed its
windows read periods of 370 and 120 ms on T1 left, and 310 and 580 ms on T2 left, and its median
index, 0.106, is below the median shuffled maximum of 0.149. The anticorrelation, though, is
sustained across 10 s and both seeds.

Dwell times show what it is. In member 116's legs the dominant pool switches about 30 times a
second, with a median dwell of 20 ms (10th–90th percentile 10–60 ms) and a dwell-time coefficient
of variation of 0.8–1.0. That is the signature of a noisy two-state switch, where a random
telegraph process gives about 1. A rhythm would give well below 0.3.

## What this decides

1. **The connectome supplies the antagonist switch.** Its inhibitory premotor hemilineages
   assign flexors to 19A and extensors to 13A. These hemilineages inhibit one another, and the
   loop between them is 1.6× denser than chance. Once those cells can tire, the switch makes a
   leg's antagonists mutually exclusive on 10–60 ms timescales, robustly and only on the real
   wiring. Of everything in docs 46–51, this is the strongest thing the wiring does that a
   scramble cannot.
2. **The switch is not a clock.** Nothing in this model class sets how long a state lasts, so
   dwell times are exponential-like. A half-centre needs a slow process whose time constant sets
   the period: adaptation that builds over hundreds of milliseconds and not per spike, a
   persistent inward current, or a mechanical phase from the leg itself. The 400 ms adaptation
   constant of doc 49 was applied to every cell and never to this loop. It is the next axis.
3. The alternating-call count from `cordx4_search.mjs` counts switching as well as rhythm. From
   here on the 10-second periodicity test is the gate, and the calls are a screen only.

```sh
python3 scripts/prep_cord_x6.py
bend cordx6.bend -o cordx6 && node scripts/cordx4_search.mjs --screen x6 run
node scripts/cord_rhythm.mjs --screen x6 --wiring real
bend cordx6L.bend -o cordx6L && node scripts/cord_rhythm_long.mjs run
bend cordx5c.bend -o cordx5c && python3 scripts/cord_drive.py --meta <banc_888_meta.feather> --run
```
