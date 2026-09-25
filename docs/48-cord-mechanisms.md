# 48. Mechanism screen and phase-score audit on the external cord

Doc 47 found a bilateral in-phase population mode in the external BANC cord and no leg gait.
This screen asked whether delay heterogeneity, synaptic depression, side-split feedback, a
unilateral kick or reduced inhibition could turn that mode into alternation. The original
version of this report claimed a persistent anti-phase state for member 329. **That claim was
an analysis error.** The spike trace itself is unchanged; the hand-written FFT used to score
it omitted the bit-reversal permutation required by its radix-2 butterflies. Its reported
frequencies and phase fractions were therefore not Fourier spectra. A separate error called
the post-kick observation 1.8 seconds, although the entire run was only 1 second.

`src/exp/spectrum.js` now compares its FFT bins against a direct DFT in
`scripts/spectrum_unit.mjs`. Both cord screens use that one implementation and select the
largest **total** bilateral power, `P+ + P-`, in 2–20 Hz, so the peak choice does not favour
either phase. `P+` is the power of left plus right; `P-` is the power of left minus right.
The band fraction sums each across 2–20 Hz. The corrected one-second results below come
from rescoring the saved `ext/cord2_search.bin`; no neural simulation was rerun for them.

## Screen and corrected results

`cordx2.bend` runs 512 members across nine bits and six named perturbations, for 3072 runs
of 2000 steps at 0.5 ms. The bits vary commissural, 13A and 13B gain, inhibitory gain,
proprioceptive return (open, shared 20 ms, side-split 20 or 80 ms), per-cell delay classes,
presynaptic depression and a 200 ms left-proprioceptor kick. Delay classes are a
volume-based proxy, not measured conduction times. The motor-pool gait instrument is the
one in doc 46.

| axis | matched median change in peak in-phase fraction | median with axis on | median pool-rate change |
|---|---:|---:|---:|
| delay classes | +0.036 | 0.805 | +2.2 Hz |
| depression, depU 0.2 | −0.307 | 0.579 | −202.2 Hz |
| unilateral kick | −0.008 | 0.761 | +2.2 Hz |
| inhibitory gain x0.6 | +0.014 | 0.767 | +43.3 Hz |

The baseline median is 0.780 at the total-power peak and 0.656 over the band. The
side-split 20 ms loop changes the matched peak fraction by only −0.012 versus loop-open;
shared 20 ms changes it by −0.007, and split 80 ms by +0.019. No single axis produces a
population-wide alternating mode. Depression has the largest median phase effect but also
starves the motor pools; delay plus depression has median pool output of only 2.2 Hz.

At the peak, 139 of 512 baseline members read below 0.55, but only 17 of those have motor
pool output above 100 Hz. A low value at one selected frequency is insufficient evidence
of a mode: it can coexist with an even-power majority across the band. Member 329, the old
headline, is **0.722 at the corrected peak and 0.776 across the band**, at 603 Hz of pool
output in its original one-second run. Members 65 and 257, also cited previously as
anti-phase examples, are 0.952 and 0.958 at the corrected peaks. Three members pass the
instrument's preliminary periodicity bar, but their leg pairs do not form an alternating
gait.

## Longer, preselected follow-up

`cordx3.bend` extends eight configurations to four seconds, each with its original random
seed and a second seed shared across configurations. The original-seed first second matches
the saved one-second binary **entry for entry**. The selection includes the three members
with live pools and the strongest odd-power band fractions in the corrected first second
(62, 92 and 260), unmodified member 0, and a 2x2 delay/kick set (329, 73, 265, 9) at fixed
commissural and inhibitory gains. The kick ends at 0.2 s; all windows below start at 0.5 s.

| member | original seed, band in-phase 0.5–1 s | 1–2 s | 2–4 s | fresh seed, 0.5–4 s |
|---|---:|---:|---:|---:|
| 62 | 0.450 | 0.875 | 0.738 | 0.795 |
| 92 | 0.362 | 0.755 | 0.796 | 0.865 |
| 260 | 0.342 | 0.765 | 0.877 | 0.742 |
| 329 | 0.776 | 0.786 | 0.840 | 0.769 |

None of the 16 runs has live pools and band odd-power dominance in both 1–2 and 2–4 s.
The three apparent candidates lose that dominance immediately after the original scoring
window. The extended m329 trace has band fractions 0.776, 0.786 and 0.840 in successive
windows; the kick did not put it into a persistent anti-phase basin. Pairing the original
left trace with the fresh-seed right trace of the **same configuration** yields band
fractions 0.480–0.588 across the eight configurations, a control for shared fluctuations
within a run. These are two seeds for selected configurations, not an exhaustive search of
parameter space.

## Decision

The cord still has a bilateral in-phase population mode, and the screen still has no
coordinated anti-phase leg gait. The earlier claim that delay heterogeneity plus a symmetry
breaker exposed a persistent anti-phase basin is withdrawn. The corrected evidence does not
identify a mechanism that connects the population mode to alternating motor output. A
future model of limb-specific sensory return remains a hypothesis, not an inference from
this screen.

```sh
node scripts/spectrum_unit.mjs
node scripts/cordx_search.mjs && node scripts/cordx2_search.mjs
bend cordx3.bend -o cordx3 && ./cordx3 && node scripts/cordx3_long.mjs
```

The external IR and binary runs are in `ext/`, which is gitignored; doc 47 records how to
recreate the IR from the public BANC source. `ext/cord3_long.{json,md}` holds all 16
four-second scores and per-window leg-pair reads.
