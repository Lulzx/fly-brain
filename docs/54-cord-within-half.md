# 54. Weakening the inhibition inside each half

[Doc 53](53-cord-hysteresis.md) found that in activity, each half of the cord's inhibitory
half-centre cancels its own recurrent excitation with inhibition that stays inside the half,
mostly 19A inhibiting 19A. It pre-registered a screen that weakens that inhibition. The
prediction: a half that can hold itself up should turn the antagonist switch into long dwells.
This document runs that screen and its 10-second follow-up. Neither passes.

It also finds that the instrument doc 53 chose cannot see what it was built to see. Doc 52's
"switches every 20 ms" is the 10 ms dwell measure's counting-noise floor, not a property of the
cord. The cord's switch is fast, but the honest bound is under about 50 ms.

## The screen

`cordx8.bend` is `cordx7.bend` with eight row-set groups of 32 members (256 members × 2
conditions × 3 wirings). `scripts/prep_cord_x8.py` writes two bits into the tab file's per-edge
column.

- **Bit 0**: inhibitory premotor → inhibitory premotor, *same hemilineage*. This is doc 53's
  pre-registered axis. It covers 5,685 of the loop's 51,667 live edges and 11.5% of its weight.
- **Bit 1**: inhibitory premotor → a cell in *its own leg's own half* (I_F → I_F or E_E,
  I_E → I_E or E_F, halves as in `scripts/cord_hysteresis.py`). That is 16,055 edges.

Bit 1 was added after preparing the inputs and before any run. Bit 0 carries only 9.8% of the
own-half inhibition that doc 53 measured cancelling the halves, so on its own it would barely
test the mechanism. The scrambles keep each cell's class and hemilineage, and their halves are
reassigned from their own motor edges: 2,623 and 2,974 bit-0 edges, 2,603 and 3,336 bit-1 edges.

| bits | axis | levels |
|---|---|---|
| 0–1 | tonic depolarisation, classes 1 and 2 | 0, 2, 4, 6 mV |
| 2 | graded release, class 1 | off, on |
| 3–4 | slow adaptation per spike, class 1, τ 300 ms | 0, 0.5, 1, 2 mV |
| 5–7 | row-set group | bit 0 ×1, ×0.5, ×0.25, ×0; bit 1 ×0.75, ×0.5, ×0.25, ×0 |

Member 0 is **byte-identical** to `cordx4.bend`'s member 0.

| wiring | live legs | antagonist band | alternating calls | same call on surrogate | members with ≥ 2 | motor output |
|---|---:|---:|---:|---:|---:|---:|
| real | 532 | **0.277** | **309** | 26 | 75 | 617 Hz |
| deg | 425 | 0.622 | 8 | 20 | 0 | 422 Hz |
| side | 290 | 0.554 | 5 | 10 | 0 | 287 Hz |

The antagonist signature replicates a fifth time. The real cord is lower than the scramble in
117 of 118 matched members against the degree scramble and 58 of 60 against the side scramble.
Graded release leaves no member with two live legs, which repeats doc 50's finding that it needs
recalibration.

## The pre-registered criterion: zero members

Doc 53 fixed the criterion as a median dwell of at least 100 ms with a dwell-time CV below 0.5
on the real wiring, and not on the degree scramble. `scripts/cord_dwell.mjs` reads a live leg's
10 ms flexor-minus-extensor trace as a two-state signal, and it reproduces doc 52 on cordx7
(639 live legs, median dwell 20 ms, CV 0.79).

| wiring | live legs | median dwell p10 / p50 / p90 | CV p50 | legs holding |
|---|---:|---|---:|---:|
| real | 532 | 10 / 20 / 20 ms | 0.835 | 0 |
| deg | 425 | 10 / 10 / 20 ms | 0.679 | 0 |

Every row-set group gives the same 20 ms median, including both ×0 groups. **No member passes.**

## The instrument's floor

The flatness was suspicious, so the dwell measure was run on a surrogate: each leg's extensor
trace rotated by 250 ms, which leaves no relation between the two pools.

| | real dwells | surrogate dwells | real CV | surrogate CV |
|---|---:|---:|---:|---:|
| x8, 532 legs | 20 ms (mean 18.5) | 20 ms (mean 16.5) | 0.835 | 0.828 |
| x7, 639 legs | 20 ms (mean 17.0) | 20 ms (mean 15.8) | 0.792 | 0.815 |

Unrelated pools give the same dwells. A coxa-trochanter pool has 5–11 cells firing a few Hz, so
a 10 ms bin holds a handful of spikes. The sign of the z-scored difference then flips on
counting noise about every other bin, whatever the cord is doing. **Doc 52's 20 ms dwell and
0.8–1.0 CV are this floor.** That inference ("dwells too short for a slow process to time")
needs restating. The dwell measure can register a state only when the state is strong enough to
beat counting noise in a 10 ms bin. Doc 53's criterion would have caught such a state, so the
zero above is a real negative, but it is blind to weaker states.

## A timescale the noise does not hide

Counting noise averages out in wider bins. If antagonist states last T ms, the pools should
anticorrelate more and more as the bins widen toward T. `scripts/cord_scale.mjs` reads the
zero-lag flexor/extensor correlation at 5–200 ms bins. In the 1.5 s screen windows, real wiring:

| row-set | 10 ms | 50 ms | 100 ms | 200 ms |
|---|---:|---:|---:|---:|
| bit 0 ×1 (control) | −0.123 | −0.368 | −0.256 | +0.098 |
| bit 0 ×0 | −0.127 | −0.365 | −0.454 | −0.362 |
| bit 1 ×0 | −0.244 | −0.442 | −0.440 | −0.205 |
| deg, any row-set | +0.07 to +0.13 | +0.24 to +0.31 | +0.29 to +0.41 | +0.42 to +0.54 |

Taken at face value, removing within-half inhibition stretches the anticorrelation from 50 ms
out to 200 ms. Paired by setting, the 200 ms difference is −0.22 (bit 0) and −0.27 (bit 1),
negative in 10 and 9 of 12 settings. But a 1.5 s window holds only seven 200 ms bins.

## The 10-second test: no effect

The test was fixed in `scripts/cord_scale_long.mjs` before running.

- **Picks** (`scripts/cord_scale_picks.mjs`): the eight lower-bit settings with the most
  negative real r at 100 ms under bit 0 ×0. These are tonic 0–6 mV, spiking, slow adaptation
  0.5 or 1 mV. Each runs paired under row-sets 0, 3 and 7 for 10 s, with the screen's seed and
  a fresh one, on the real wiring and the degree scramble. The runner is `cordx8L.bend`,
  generated by `scripts/cord_long_x8.py`.
- **Statistic**: per window (0.5–5 s, 5–10 s), the median over live legs of r at 200 ms.
- **Pass**: the paired effect (weakened − ×1) has a median ≤ −0.2 over the eight settings in
  both windows and on both seeds, the weakened median is below 0, and the degree scramble's
  effect is above −0.1.

All 24 screen-seed runs reproduce the screen's first 2 s **exactly**, on both wirings.

| row-set | seed 0, 0.5–5 s | seed 0, 5–10 s | seed 1, 0.5–5 s | seed 1, 5–10 s | verdict |
|---|---:|---:|---:|---:|---|
| bit 0 ×0 | −0.014 | −0.009 | +0.009 | +0.037 | fails |
| bit 1 ×0 | −0.135 | −0.047 | −0.051 | −0.119 | fails |
| deg, bit 0 ×0 | +0.145 | +0.189 | −0.048 | +0.106 | — |

The cells are paired effects on r at 200 ms. **Neither row-set passes.** The control is already
anticorrelated at 200 ms over 10 s (median −0.33 to −0.52), and removing within-hemilineage
inhibition adds nothing. Removing own-half inhibition shifts r by −0.05 to −0.14, consistently
but at under a third of the threshold.

The screen's effect was window noise. Cut the 10 s runs into 1.5 s windows and the paired
difference swings from −0.39 to +0.22 across windows and seeds. The screen-seed 0.5–2 s window
reproduces the screen's −0.25 exactly, and the fresh seed's same window gives +0.17.

## What the 200 ms anticorrelation is

Over 10 s the real cord's antagonists anticorrelate at 200 ms bins by about −0.48. The degree
scramble's correlate by +0.25. This is not slow drift. With each window's linear trend removed
the median is −0.52, and on first differences −0.59. It is not a persistent state either.

- **r saturates by 50 ms.** Control medians are −0.466, −0.469 and −0.469 at 50, 100 and 200 ms.
- **The difference trace has no memory.** Its autocorrelation at 50 ms bins, at lags of
  100 ms to 1 s, matches the rotated-extensor surrogate's to within 0.04 in every row-set.

The cord's flexor and extensor pools therefore receive strongly opposed fluctuations whose memory
is under about 50 ms. Counting noise hides them in 10 ms bins, and summing bins reveals them.
That is the antagonist switch docs 51–53 studied, measured properly. It is real-wiring-specific
and fast, and neither in-half inhibition nor slow adaptation lengthens it.

## What this decides

1. **The cancellation doc 53 measured is not what keeps the switch fast.** Removing the
   inhibition that cancels each half's recurrent excitation, by either definition, leaves the
   switch's memory under 50 ms. The pre-registered criterion finds zero members, and the 10 s
   test fails on both row-sets.
2. **Doc 52's 20 ms dwell figure is the instrument's floor.** Its qualitative conclusion stands
   (states too brief for a slow process to time), with the bound restated as under about 50 ms.
   Future screens should score timescale from correlation against bin width and from the
   difference trace's autocorrelation against a rotated surrogate, not from 10 ms dwells.
3. **What is left is input, not wiring.** In-half inhibition and slow adaptation are both ruled
   out. Doc 52's third route is the one still standing: each premotor cell gets its own private
   Poisson drive, independent of every other cell. A half-centre cannot hold a state when every
   cell in it is kicked independently every few ms. The next screen should make descending and
   proprioceptive drive correlated or tonic within a half, and score it on the timescale
   instruments above.
4. **Graded release in this form silences the legs.** No graded member has two live legs.
   Agrawal 2020's non-spiking interneurons need a release model calibrated to their rates first.

```sh
python3 scripts/prep_cord_x8.py --meta <banc_888_meta.feather>
bend cordx8.bend -o cordx8 && node scripts/cordx4_search.mjs --screen x8 run
node scripts/cord_dwell.mjs --screen x8
node scripts/cord_scale.mjs --screen x8 --wiring real --group 32
node scripts/cord_scale_picks.mjs && python3 scripts/cord_long_x8.py
bend cordx8L.bend -o cordx8L && node scripts/cord_scale_long.mjs run
```

Run one screen at a time. The runners read and write through the shared `ext/x8/cur` link.
