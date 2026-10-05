# 53. Can the cord's wiring hold a half-centre's state?

[Doc 52](52-cord-slow-adaptation.md) ended with the antagonist switch flipping every ~20 ms. Dwells
that short leave no slow process anything to time, so doc 52 said the missing ingredient is
hysteresis, a state that defends itself, and asked two wiring questions before anything more is
simulated. This document answers them from the kernel's own weight files and doc 51's recorded
spike counts. It runs no new simulation.

The prompt was a perspective by Kording, Boyden and co-authors (2026, arXiv 2603.25713,
*Compiling molecular ultrastructure into neural dynamics*). It argues that the parameters a
connectome leaves out, local conductances and synaptic efficacies, should one day be read off
molecularly annotated ultrastructure. Hysteresis can come from the wiring or from cell-intrinsic
properties the wiring cannot show, so which one the cord needs decides which kind of data would
fix this model.

## The instrument

`scripts/cord_hysteresis.py` places every premotor cell (class 1 inhibitory, class 2 excitatory,
as in doc 50) in one leg's **flexor half** or **extensor half**. A cell's leg is the one it
weights most. Its pool is the coxa-trochanter pool that gets at least twice the weight of the
antagonist. A half is what wins when it is active:

- **flexor half**: excitatory cells driving the flexors (E_F) and inhibitory cells silencing the
  extensors (I_E, mostly 13A)
- **extensor half**: E_E and I_F (mostly 19A)

Each scramble's halves are reassigned from that scramble's own motor edges. For every source
group, the script compares its signed input (kernel `w · sign`) to its own half with its input to
the other half. A positive difference holds a winner.

## Wiring: the real cord's halves are built to hold

Signed weight per target cell, within a leg, summed over the six legs (real wiring):

| from \ onto | E_F | E_E | I_F | I_E |
|---|---:|---:|---:|---:|
| E_F | **26.3** | 6.9 | 43.4 | 31.2 |
| E_E | 8.7 | **14.3** | 46.2 | 15.3 |
| I_F | −24.8 | −8.0 | **−24.9** | −19.0 |
| I_E | −8.5 | −14.2 | −25.4 | **−11.0** |

| wiring | cells E_F / E_E / I_F / I_E | difference mode (own − other) | common mode (own + other) | ratio |
|---|---|---:|---:|---:|
| real | 774 / 1040 / 505 / 1038 | **+37.3** | 28.4 | **1.31** |
| deg | 628 / 858 / 523 / 901 | −0.6 | 2.0 | −0.32 |
| side | 592 / 921 / 479 / 959 | +0.8 | 2.4 | 0.35 |

Every source group in the real cord favours its own half (E_F +3.5, E_E +18.3, I_F +5.4,
I_E +10.0). Excitatory cells excite their own half's excitatory cells three times as strongly as
the other half's (26.3 against 8.7, 14.3 against 6.9). In the scrambles every group's bias sits
within ±0.6 of zero. The result holds when the preference threshold is 1.5 or 3 instead of 2
(difference mode +36.7 and +37.6). **Question 1 of doc 52 is answered yes.**

**Question 2 is answered no.** Per ordered cell pair in the same hemisegment:

| pair | weight per pair | pairs connected |
|---|---:|---:|
| 19A → 19A | −0.631 | 14.1% |
| 19A → 13A | −0.421 | 8.4% |
| 13A → 19A | −0.214 | 9.0% |
| 13A → 13A | −0.114 | 3.7% |

19A inhibits itself more than it inhibits 13A. In the table above, I_F → I_F (−24.9) is larger
than I_F → I_E (−19.0). Inhibition among the inhibitory cells works *within* halves, against the
hold.

## Activity: the hold is all cross-inhibition, and nothing holds a half up

Weighted by doc 51's recorded rates (`ext/x5/real/x5_cells.bin`, eight members, real wiring), the
mean input to a half cell in kernel units per second:

| member | own half: exc | own half: inh | own net | other half net | rest exc / inh | hold share |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | +98.9 | −106.8 | −7.9 | −104.1 | +319.5 / −101.9 | 18.0% |
| 3 | +150.6 | −131.3 | +19.3 | −117.9 | +372.2 / −134.8 | 21.3% |
| 32 | +123.3 | −135.6 | −12.3 | −140.3 | +342.5 / −142.9 | 20.1% |
| 64 | +141.1 | −168.4 | −27.2 | −184.7 | +361.0 / −195.2 | 20.5% |
| 96 | +185.3 | −220.5 | −35.2 | −244.0 | +423.7 / −293.0 | 21.0% |
| 39 | +116.3 | −129.4 | −13.2 | −129.5 | +329.2 / −126.8 | 19.4% |
| 67 | +197.0 | −201.4 | −4.4 | −206.8 | +423.4 / −223.9 | 23.6% |
| 99 | +232.4 | −240.9 | −8.5 | −248.2 | +459.4 / −317.5 | 23.2% |

Baseline condition. The hold share is (own − other) over the total absolute input. The
no-command runs give 7–22%.

Within each half, recurrent excitation is cancelled by recurrent inhibition, to within 10% in
seven of eight members. Own-half net input is negative in 15 of 16 runs. The cancellation comes
from rates more than from wiring. I_F cells (19A-heavy) fire 5–16 Hz, three to four times
faster than any other group, and their largest target is their own group. A half therefore never
holds itself up. It only pushes the other half down, and that cross-inhibition is about a fifth of
everything a half cell receives. The other four-fifths is drive from outside the loop,
independent per cell, which is what flips the state.

Doc 52's second route to hysteresis, population-level rather than cell-level inhibition, has now
been measured. As wired and as active, the loop is cell-level: its strongest inhibition stays
inside 19A.

## What the literature adds

A literature check on the intrinsic route found the following.

- **No one has measured intrinsic bistability in 13A or 19A.** No recordings of either
  hemilineage turned up. Both can now be identified transcriptomically. Soffers et al. 2025
  (*eLife* RP106042) assigned hemilineages to clusters of the Allen et al. 2020 VNC atlas
  (*eLife* 9:e54074): 13A is dbx+ dmrt99B+, 19A is dbx+ scro+. No published analysis reports
  ion-channel expression in those clusters, so plateau-supporting channels (cac, Ca-α1T,
  Nmdar1/2, Ih, persistent Na) are open to a direct check in public data. That is the
  molecular-to-physiology step the perspective proposes, done crudely, with mRNA standing in for
  current.
- **The nearest physiology argues for graded, not bistable, units.** The one GABAergic leg
  interneuron recorded, a 13B neuron (Agrawal et al. 2020, *eLife* 9:e60299), fires no spikes and
  reports limb position tonically without adapting.
- **Two connectome models get leg rhythm from circuits alone.** Syed, Ravbar & Simpson (*eLife*
  106446) get grooming rhythm from reciprocal inhibition between antagonist 13A groups, with
  proprioceptive feedback. Pugliese et al. 2025 (bioRxiv 10.1101/2025.09.12.675944, rate model,
  untested experimentally) find a three-cell walking core: recurrent excitation (IN17A001,
  INXXX466) followed by delayed inhibition (IN16B036), with no intrinsic bursting. 13A and 19A
  are not in that core.

No data contradict intrinsic bistability, and none support it. The circuit routes have published
models behind them.

## What this decides

1. **The wiring has a winner-take-all layout this model does not use.** The real cord's premotor
   halves favour themselves (difference/common mode 1.31, against −0.32 and 0.35 for the
   scrambles), and excitatory recurrence within a half is three times the cross-half recurrence.
2. **In activity, 19A's self-inhibition cancels that recurrence.** A half's own excitation and
   own inhibition balance within 10%, so no half holds itself up. The switch is driven by the
   four-fifths of each cell's input that comes from outside the loop.
3. **The next screen tests the cancellation, not another slow variable.** Two axes, each
   byte-identical to `cordx7.bend` at its first level:
   - scale class-1 → class-1 edges *within* a hemilineage (×1, ×0.5, ×0.25, ×0), leaving
     cross-hemilineage inhibition intact. This edits the connectome, so it is a diagnosis, not a
     model.
   - a graded-release mode for class 1, following Agrawal 2020.

   The success criterion is set now, before any run: median dwell ≥ 100 ms with a dwell-time
   coefficient of variation below 0.5 on the real wiring, and not on the degree scramble. Doc 51's
   10 s two-seed test then applies unchanged.
4. **Open check: Pugliese et al.'s three-cell walking core.** It may exist in this cord. If
   IN17A001 / INXXX466 / IN16B036 have BANC counterparts, they are a candidate rhythm source
   outside the 19A/13A loop entirely.

```sh
python3 scripts/cord_hysteresis.py --meta <banc_888_meta.feather>   # writes ext/x6/hysteresis.json
```
