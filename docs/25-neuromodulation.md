# 25. Neuromodulation

File: `src/sim/neuromod.js`. Stepped every millisecond from `FlyAgent.step`, before the endogenous-behaviour
module. On when `brain_params.json` has `"neuromod": true` and `public/data/neuromod.json` exists.

## What it replaces
The endogenous-behaviour module ([23](23-behaviour.md)) used to read hunger straight from the energy
variable. Now, for locomotion, it reads the octopamine level of identified neurons in the connectome, and
hunger reaches those neurons through hormones. Feeding still reads energy, because hunger gates feeding
through other pathways (dopamine, sNPF, taste receptor gain) that are not modelled.

## The chain

| Step | Model | Source |
|---|---|---|
| Haemolymph sugar | The energy variable | |
| AKH (glucagon-like) | Secreted by the corpora cardiaca as sugar falls: sigmoid of sugar, half at 0.5, time constant 5 s (time compressed like energy) | The corpora cardiaca are outside the CNS, so this is not in the connectome |
| Insulin (DILP) | The 16 insulin-producing cells (IPC) in the connectome are glucose-sensing: sugar gives them excitatory conductance, and insulin follows their firing rate (10 s) | |
| AKH and insulin receptors | AKH excites, insulin inhibits the OA-VUMa and OA-VPM neurons (17 cells) | Yu et al. 2016. Which OA types carry AKHR is not resolved; the ventral SEZ clusters are assumed |
| Octopamine release | Each of the 37 OA neurons releases in proportion to its firing rate, low-pass filtered over 2 s | |
| Action | Release lowers the spike threshold of every neuron the OA cell synapses onto, up to 2 mV, saturating (12,851 targets) | Octβ receptors raise cAMP. Receptor types per cell are not in the connectome, so all targets are treated alike |
| Arousal | Mean release of the AKHR neurons, 2 Hz = 0 and 12 Hz = 1 | Starvation-induced hyperactivity needs octopamine (Yang et al. 2015) |

Arousal replaces hunger in the rules for walk and pause bout lengths, grooming, voluntary takeoff and walking
speed ([23](23-behaviour.md)).

Knockouts: `block: 'OA'` (Tβh null, no release), `'AKHR'`, `'InR'` (FlyAgent option `neuromod.block`).

## Changes to the brain model
- **No fast octopamine synapses.** The OA neurons' synapses leave the LIF graph (`modulatorySign` in
  `brainmodel.js`); octopamine acts only through release. Before, the model treated octopamine, like
  dopamine and serotonin, as a fast excitatory transmitter.
- **Slow afterhyperpolarisation.** OA neurons and IPCs get a threshold that rises 0.5 mV per Hz of their
  firing over the last 2 s. Without it they switch between silence and 100 Hz for small changes in network
  input, and no single threshold holds them at a tonic rate.
- **Calibrated resting thresholds.** In the embodied network, OA neurons fired at 100 to 200 Hz.
  `scripts/neuromod_calib.mjs` holds a fed fly (energy 0.85) for 60 s while each OA neuron's and IPC's
  resting threshold moves until it fires at 2 Hz (OA) or 5 Hz (IPC). It writes `neuromod.json`. Rerun it
  after changing the drives in `NEUROMOD`.

## Results
`node scripts/starvation.mjs 40 3`: empty arena (no food or hot patches; the vinegar odour plume stays, it
drives the OA neurons), energy held fed (0.85) or
starved (0.15), 10 s to settle, then 40 s. Three seeds. "Moving" is the fraction of time the walking command
is above 0.05 in either direction.

| Genotype | What differs | Moving, fed | Moving, starved | OA Hz fed → starved | Arousal starved |
|---|---|---|---|---|---|
| rules | Neuromodulation off; rules read energy (the previous model) | 0.68 | 0.78 | – | – |
| wt | Full chain | 0.55 | 0.73 | 3.0 → 13.4 | 1.00 |
| Tbh | No octopamine release | 0.51 | 0.56 | 1.8 → 10.7 | 0 |
| AKHR | No AKH receptor | 0.64 | 0.65 | 2.5 → 7.4 | 0.64 |
| direct | Rules blind to arousal; only octopamine's action on the connectome | 0.60 | 0.57 | 3.0 → 13.2 | (1.00, unused) |

Seed-to-seed sd of "moving" is 0.01 to 0.13.

- **Hunger reaches the OA neurons.** Starvation raises their firing from about 3 to 13 Hz. All 17 AKHR cells
  respond.
- **Octopamine is required.** With no release (Tβh null), starved flies are no more active than fed ones, as
  in Yang et al. 2015 — even though their OA neurons still fire at 11 Hz.
- **AKH signalling is required.** With no AKH receptor the OA neurons still fire faster when starved
  (insulin falls), reaching 7 Hz and arousal 0.64, yet moving does not rise — matching Lee & Park 2004,
  where AKH signalling is required for starvation hyperactivity.
- **Octopamine's action on the connectome does not by itself make starved flies walk more** (`direct`: the
  rules do not see arousal). Starved `direct` flies if anything walked less (1.1 versus 1.3 cm/s fed). The
  behaviour still comes from the bout rules, which now read octopamine instead of energy. Of the
  descending neurons OA neurons synapse onto, steering (DNa01, DNa02) and backward (MDN) neurons receive
  more OA synapses than the forward-walking DNg97 and DNg100.

Arousal against held energy (15 s, two seeds): 0.85 → 0 to 0.1, 0.7 → 0.2, 0.6 → 0.4, 0.45 → 0.9, 0.3 and below → 1.

## Effect on the rest of the model
- Brain benchmarks (`calib_eval.mjs`, fed octopamine tone, six runs each): with the parameters fitted
  before neuromodulation the score fell from 0.674 to 0.639 — the giant fibre stopped firing to the
  tethered loom (0.8 spikes to 0) and the takeoff DNs fired less (45 to 25 Hz); OA-AL2i and OA-ASM neurons
  project to the optic lobe and visual projection neurons, so their fast excitation had probably been
  adding visual gain. Refitting the global parameters with neuromodulation on (`calib_search.mjs`,
  `{"coba":true,"neuromod":true}`, 20 generations) recovered the score to 0.725 mean of six (best single
  run 0.746) and the takeoff-DN response to about 30 Hz against 2 Hz for self-motion, though the giant
  fibre still does not spike to the tethered loom. The refit also strengthened the tarsal-sugar pathway
  (MN9 34 Hz, was 15) and silenced MDN during leg sugar (0.6 Hz).
- In the embodied fly, looming escape is unchanged: 1 of 5 to 10 trials with and without.
- Backward walking is unchanged (11% of the time, four seeds of 18 s).
- The connectome viewer runs the module at the fed steady state.

## Octopamine → optic-lobe gain (Suver et al. 2012)
Walking and flight excite the optic-lobe octopamine neurons (OA-AL2i, OA-ASM) through a locomotor
corollary discharge (`locoDrive`), and their release then lowers the spike thresholds of their
optic-lobe targets — restoring in slow form the visual gain their removed fast synapses used to provide.
Measured: optic-lobe OA release rises from ~124–194 Hz standing to ~396–424 Hz walking, a 2–3× gain
increase on visual targets.

**Negative result:** this did not rescue the looming response — walking giant-fibre rates did not recover
and the jump rate was unchanged or slightly lower. The weak link in the loom chain sits upstream of, or
parallel to, the OA gain mechanism rather than in it.

## Next
- Dopamine and serotonin still act as fast excitatory transmitters. Hunger gating of feeding (dopaminergic
  TH-VUM onto the proboscis motor circuit, Marella et al. 2012) is the next candidate.
