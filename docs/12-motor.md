# 12. Motor output

File: `src/sim/motor.js`.

## Descending-neuron readout
Firing rates are low-pass filtered with a 40 ms time constant.

| Role | Neurons | Source |
|---|---|---|
| Forward walking | DNg100 (BDN2), DNg97 (oDN1), DNp09 (P9) weight 1; DNa05, DNa07, DNp26, DNg25 weight 0.2; DNa01, DNa02 weight 0.1 | Cande 2018, Bidaye, Sapkal 2024 |
| Backward walking | MDN | Bidaye 2014 |
| Steering, ipsilateral | DNa02 1.0, DNa01 0.6, DNp09 0.5 | Rayshubskiy 2020 |
| Head grooming | DNg07, DNg08, DNg12 | Cande 2018 |
| Escape | DNp01 giant fibre | von Reyn 2014 |
| Takeoff | DNp02, DNp04 | Namiki 2018 |
| Courtship circuit | pIP10, DNp13 | Deutsch et al. 2020 |

## Readout constants

| Constant | Value | Meaning |
|---|---|---|
| fwdThreshold | 4 Hz | Forward drive needed to walk |
| fwdScale | 12 Hz | Speed = 1 − exp(−(drive − threshold) / fwdScale) |
| backMax | 0.35 | Backward speed limit as a fraction of top forward speed (MDN walking is slow) |
| turnScale | 25 Hz | Left minus right steering for full turn |
| turnTau, flightTurnTau | 150 ms, 50 ms | Steering smoothing when walking and in flight |
| turnAdaptTau | 4 s | Slow adaptation that removes standing left/right imbalance |
| groomScale | 40 Hz | Grooming activation |
| muscleHalf | 17 Hz | Motor neuron rate for half muscle activation |
| gfSpikes, gfWindow | 4 spikes in 50 ms | Giant-fibre escape criterion |
| takeoffThreshold, takeoffRatio | 70 Hz and 3 × baseline | Takeoff escape criterion |
| startupMs | 1500 ms | No escapes while vision settles |
| courtPBase/Scale, courtDNBase/Scale | 5/4 Hz and 12/8 Hz | Courtship level: baseline-subtracted pIP10 and DNp13 rates, normalised |

## Why these values
- DNa05, DNp26 and DNa07 fire at 15 to 55 Hz from vision alone. At weight 0.7 they kept the fly walking
  during every pause, so the walking command neurons now carry the drive.
- A linear readout with fwdScale 10 put the fly at full speed or at rest. The saturating curve grades it.
- In this model the right DNa02 and P9 get more tonic excitation than the left. Without adaptation the fly
  circled right. Adaptation keeps saccades, plume steering and object responses, which are transient.

## Turning on the spot
A standing fly with a steering command above 0.25 pivots: the stepping generator runs at 55% amplitude and
the inner legs step backwards.

## Muscles
Activation = 1 − exp(−rate × ln 2 ÷ 17 Hz). Insect force-frequency curves saturate at low rates.
Antagonist groups move each position-servo target within its range.

## Courtship song
While a male courts close up, the wing on the side facing the target extends and flutters — a visible
display standing in for the sine/pulse song; the wing muscle MNs that would produce a real song are not
annotated in this dataset. See [Courtship](26-courtship.md).

## Interlocks
- An inverted fly cannot jump, nor can a flying one.
- **Escape gating.** Escapes are suppressed for 0.5 s after the antennae, front legs or body touch something,
  or a surface comes within 1.7 mm ahead. They are also suppressed for 0.3 s after a pivot, and during
  grooming. A wall the fly walks into, backs from or pivots past looms on the eye. So do its own grooming
  legs. Real flies tell these apart from a predator by touch, by optic flow that matches their own motion,
  and by efference copies of their movements (Kim et al. 2015). Without the gate the fly jumped
  repeatedly into walls. The looming threat is not a static surface and still triggers escape.
- Voluntary takeoffs bypass the gate, but not while the body or antennae press against something.
- Grooming pauses walking.
- Jump, landing, and righting programs override the pattern generator while active.
