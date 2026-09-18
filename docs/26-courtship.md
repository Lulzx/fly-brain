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
- **Rejection.** A female with a male inside 0.55 cm turns away from his side and runs for 400–900 ms
  (decamping), and kicks with the hind leg on his side when he closes to 0.3 cm (Connolly & Cook 1973).
  This is the mirror of the male's `court` block and it is supplied machinery, not connectome output:
  see the limits below.
- **Song.** Close up and within a frontal bearing window, the wing on the side facing the other fly
  extends and vibrates. The vibration now has the real song's structure (`src/sim/song.js`) rather than
  a fixed flutter — see below. The envelope drives the flybody wing joints directly rather than the song
  motor neurons, which is a choice and not a limitation of the dataset: the steering muscles that
  produce song in the animal (b1, b2, b3, i1, i2, iii1, iii3, hg1–hg4) **are** annotated here, and
  [Flight](24-flight.md) measures what they do.

## The song has the real pulse structure

A courting male produces two modes, and their statistics are what distinguishes a song from a flutter:

| | pulse song | sine song |
|---|---|---|
| structure | trains of pulses, one per inter-pulse interval | continuous hum |
| interval / frequency | IPI 35 ms (Arthur et al. 2013: 34–36 ms at 25 °C) | 160 Hz (Bennet-Clark & Ewing 1968) |
| within-pulse carrier | ~250 Hz | — |
| when | he is moving, or further than 0.35 cm away | he is slow (< 0.6 cm/s) and close |
| wing reach | full extension | smaller display |

The IPI is the parameter that matters: it is the species-identifying quantity a female's auditory
pathway reads, and the previous 30 Hz flutter had no IPI at all. Mode choice follows his own motion and
his distance to her, after Coen et al. 2014, with a 120 ms minimum bout so the mode cannot chatter frame
to frame. `scripts/check_courtship.mjs` measures the produced song rather than trusting the parameters:
a moving male at 0.8 cm sings pulse song at a **median IPI of 36 ms** with 113 pulses in 4 s against
114 expected; a slow male at 0.2 cm sings continuous sine song with zero pulses and a smaller wing
excursion (0.45 against 1.0).

What this is not: acoustic output. There is no air, no sound pressure, and no female auditory pathway to
receive it — the male CNS release has Johnston's-organ input but the female's song-processing circuitry
is not in a male. The song is the wing envelope plus its timing, which is what the body can express.

And it is not read out of the song motor neurons, which exist. The next version of this is the one
[Flight](24-flight.md) needs too: drive the wing from the b1/b2/hg pools rather than from a rule, at
which point the inter-pulse interval becomes a *prediction* of the circuit instead of a parameter copied
from Arthur et al. That is the version worth wanting, because 35 ms is then a number the model has to
earn rather than one it is told.

## What was verified

Headless two-fly test (`scripts/_tmp/chase.mjs`): a scripted wandering female ~1 cm away — the male
detects her visually, closes to ~0.2–0.4 cm, enters `court` within 5 s, sustains it for the full 40 s,
and sings about 70% of the time while tracking her.

## Honest limits

- Courtship initiation is partially injected: the LC10 drive is geometric (angular size × frontal field),
  not a flyvis-computed feature, because the flyvis front end ends before the VPN layer.
- **The female rejects, and her rejection is rules rather than circuitry.** She decamps and kicks
  (`scripts/check_courtship.mjs`: 3 rejection bouts in 3 s with a male held at 0.4 cm, 6 kicks in 3 s at
  0.2 cm, and she turns away from his side rather than across him). But receptivity in the real animal
  is a decision made by pC1/pCd neurons and the vpoDN descending pathway in a *female* nervous system,
  and this is a male-CNS release: her brain here is a male's. So `P.receptivity` is a scalar parameter,
  not a state of a circuit, and nothing about her behaviour is evidence about female wiring. It exists
  so that the male is courting something that behaves like a fly, which is what changes *his* measurable
  behaviour.
- There is no copulation outcome, and no female auditory pathway: she does not hear the song. Her
  rejection is triggered by his proximity, not by what he is singing.
- The song is a wing envelope with real pulse timing, not acoustic output.
