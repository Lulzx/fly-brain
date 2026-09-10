# 12. Motor output

File: `src/sim/motor.js`.

## Descending-neuron readout
Firing rates are low-pass filtered with a 40 ms time constant.

| Role | Neurons | Source |
|---|---|---|
| Forward walking | DNg100 (BDN2), DNg97 (oDN1), DNp09 (P9) weight 1; DNa05, DNa07, DNp26, DNg25 weight 0.7; DNa01, DNa02 weight 0.4 | Cande 2018, Bidaye, Sapkal 2024 |
| Backward walking | MDN | Bidaye 2014 |
| Steering, ipsilateral | DNa02 1.0, DNa01 0.6, DNp09 0.5 | Rayshubskiy 2020 |
| Head grooming | DNg07, DNg08, DNg12 | Cande 2018 |
| Escape | DNp01 giant fibre | von Reyn 2014 |
| Takeoff | DNp02, DNp04 | Namiki 2018 |

## Readout constants

| Constant | Value | Meaning |
|---|---|---|
| fwdThreshold | 2.5 Hz | Forward drive needed to walk |
| fwdScale | 10 Hz | Drive above threshold for full speed |
| turnScale | 12 Hz | Left minus right steering for full turn |
| turnTau | 150 ms | Steering smoothing |
| groomScale | 40 Hz | Grooming activation |
| muscleHalf | 17 Hz | Motor neuron rate for half muscle activation |
| gfSpikes, gfWindow | 3 spikes in 50 ms | Giant-fibre escape criterion |
| takeoffThreshold, takeoffRatio | 70 Hz and 3 × baseline | Takeoff escape criterion |
| startupMs | 1500 ms | No escapes while vision settles |

## Muscles
Activation = 1 − exp(−rate × ln 2 ÷ 17 Hz). Insect force-frequency curves saturate at low rates.
Antagonist groups move each position-servo target within its range.

## Interlocks
- An inverted fly cannot jump.
- Grooming pauses walking.
- Jump, landing, and righting programs override the pattern generator while active.
