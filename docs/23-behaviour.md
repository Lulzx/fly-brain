# 23. Endogenous behaviour

File: `src/sim/intrinsic.js`. Called every millisecond from `FlyAgent.step` before the brain steps.

## Why it exists
The connectome model has no neuromodulation and no intrinsic dynamics, so it only reacts. Measured in the
arena before this module:

- **All-or-nothing walking.** With the body held still, the forward-walking DNs were silent. Once the fly
  moved, footfall touch bursts drove them to 10 to 13 Hz and the fly ran at full speed without stopping.
  Masking tarsal touch dropped them to about 3 Hz.
- **Constant turning.** The same footfall bursts made the steering DNs alternate, so steering was pinned at
  its limit for 20 to 50% of the time.
- **Stuck at walls.** Legs pass through walls, so the gait pushed the body up the wall until it stood
  nearly vertical. The striped wall then loomed on the eyes and fired repeated escape jumps into it.

Real flies alternate walking, pausing and grooming with heavy-tailed bout lengths, and turn in brief
saccades whose timing is neither random nor locked to stimuli (Maye et al. 2007; Brembs 2011 argues this
variability is the biological basis of "free will"). This module stands in for those missing central
inputs.

## How it acts on the brain
It never writes actuator commands. It delivers excitatory synaptic conductance to identified descending
neurons, and inhibitory conductance for stopping, so every command still passes through the connectome
and leaves through the normal DN readout (see [Motor](12-motor.md)). Inhibition from sensory pathways,
such as the sugar stop, still acts on the same neurons.

It uses conductance rather than current because the embodied brain holds these DNs in a high-conductance
state, with inhibition about three times the leak. An injected current of 9 mV moved them by about 2 mV.

| Target | Neurons | Used for |
|---|---|---|
| Walking command | DNg100 (BDN2), DNg97 (oDN1) | Walking bouts, speed |
| Steering | DNa02, DNa01, one side | Saccades, turning away |
| Backing | MDN | Backing off from head-on contact |
| Grooming | DNg07, DNg08, DNg12 | Grooming bouts |
| Braking (inhibitory) | All forward-walking DNs | Pauses, feeding |
| Takeoff | DNp02, DNp04 | Voluntary takeoff |
| Feeding | MN9, pharyngeal pump MNs | Proboscis extension when hungry and on sugar |

P9 (DNp09) is not driven. In this model the left P9 receives about twice the inhibitory conductance of
the right, and P9 also steers, so driving it made the fly circle.

## Behaviour it produces

| Behaviour | Rule | Source |
|---|---|---|
| Walk and pause bouts | Lognormal lengths: walk median 2.2 s, pause 1.4 s | Heavy-tailed bouts, Maye 2007 |
| Grooming | 20% of pauses, median 2.5 s | Seeds et al. 2014 |
| Speed variation | Slow random fluctuation of the walking drive | |
| Saccades | 0.7 per second walking, 0.3 standing, 120 to 260 ms; alternate direction 65% of the time | Geurten 2014 |
| Grazing an obstacle with one antenna | Turn away while walking; this produces wall-following | Thigmotaxis in open arenas |
| Head-on contact, or rearing up | Back off 350 ms, pivot away 0.5 to 0.9 s, walk on | |
| Leaving a wall by air | 10% of head-on contacts, after turning away | |
| Noxious heat at an arista | Turn away from the warmer side and run | |
| Sugar under the mouthparts, hungry | Stop and feed until sated or off the food | |
| Sugar underfoot only | Walk on slowly onto the food | |
| After leaving food | 12 s local search: three times the saccades, same direction 75% of the time, so the path loops back | Dethier 1957; Kim & Dickinson 2017 |
| Courtship (males) | When the connectome's own courtship readout (pIP10, DNp13 rates) is high and a female is within range: chase on her bearing, and sing with the wing facing her when close | Ewing & Bennet-Clark 1968; see [Courtship](26-courtship.md) |
| Voluntary takeoff | 10% of bout ends, more when hungry | |
| In flight | Saccades 1 per second, and collision-avoidance saccades toward open space | Tammero & Dickinson 2002 |
| Hunger | Longer walk bouts and shorter pauses, less grooming, more takeoffs, faster walking. Scaled by octopamine arousal from [Neuromodulation](25-neuromodulation.md) when it is on, otherwise by energy | Yang et al. 2015 |

## Senses added for it
See [Senses](10-senses.md): antennal and front-leg obstacle touch, heat per arista, and suppression of
footfall touch while stepping (reafference).

## What is still the brain's
Sensory steering, such as odour, optomotor and object responses, the sugar stop, bitter aversion, looming
escape and grooming triggered by touch, all come from the connectome. The module supplies timing and
intent. With [neuromodulation](25-neuromodulation.md) on, its hunger input for locomotion is the octopamine
level of identified neurons rather than the energy variable; feeding still reads energy. Where a pathway is missing from the model, such as turning away from a touched obstacle or from
heat, the module supplies it and this page lists it.
