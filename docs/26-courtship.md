# 26. Courtship and social behaviour

Files: `src/sim/fly.js` (detection), `src/sim/senses.js` (pheromone plume), `src/sim/motor.js` (circuit
readout and song), `src/sim/intrinsic.js` (court state). This is the male dataset, so the fruitless- and
doublesex-annotated courtship circuitry is present and used.

## The circuit in the model

- **Detection.** Two channels, as in the animal. Close range: a cVA-like pheromone plume around each
  other fly (`FLY_ODOR`, strength 0.9, σ = 0.28 cm) drives the DA1/VA1v/VA1d glomeruli through the normal
  odour path. Longer range: the other fly's angular size and bearing drive the LC10a/LC10d small-object
  visual projection neurons ipsilateral to the target — LC10 is how a male first notices a moving fly
  (LC10a → pC1/pIP10, Ribeiro et al. 2018). This is the one deliberately injected stage: flyvis covers the
  early optic lobe, so the connectome carries the signal from LC10 onward.
- **Readout.** The connectome propagates both channels to the courtship circuit: the motor module reads
  pIP10 (fru⁺ P1→VNC interneuron, Deutsch et al. 2020) and DNp13 (the courtship pursuit descending
  neuron), baseline-subtracted and normalised into a courtship level. Both roughly double their firing
  near another fly.
- **Pursuit.** Above threshold the intrinsic module enters `court`: it steers toward the target's bearing,
  drives forward in proportion to distance, and keeps the state for ~1.5 s of losing the target.
- **Song.** Close up and within a frontal bearing window, the wing on the side facing the other fly
  extends and vibrates (a visible unilateral wing display standing in for the sine/pulse song; the wing
  muscle MNs that would generate a real song are not annotated in this dataset).

## What was verified

Headless two-fly test (`scripts/_tmp/chase.mjs`): a scripted wandering female ~1 cm away — the male
detects her visually, closes to ~0.2–0.4 cm, enters `court` within 5 s, sustains it for the full 40 s,
and sings about 70% of the time while tracking her.

## Honest limits

- Courtship initiation is partially injected: the LC10 drive is geometric (angular size × frontal field),
  not a flyvis-computed feature, because the flyvis front end ends before the VPN layer.
- The female is kinematic — she does not run away or reject, and there is no copulation outcome.
- The song is a wing display, not acoustic output; no song-pulse timing is modelled.
