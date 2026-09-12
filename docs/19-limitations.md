# 19. Limitations

## Brain
- The connectome gives wiring, not strengths, neuromodulation, gap junctions, or plasticity.
- **Olfaction.** Cholinergic local neurons such as lLN1_bc make about 200,000 synapses onto projection
  neurons. One glomerulus recruits most projection neurons, so odour identity is lost downstream.
  GABA_B presynaptic inhibition, the main gain control, is not modelled.
- **Proboscis.** MN9 is partly driven by olfactory channels, so flies often walk with the proboscis out.
- **Tarsal reflex** is weak: 15 Hz, partial extension.
- **Few intrinsic drives.** Hunger reaches the octopamine neurons through AKH and insulin
  ([Neuromodulation](25-neuromodulation.md)), but the bouts it lengthens are still rules
  ([Endogenous behaviour](23-behaviour.md)): octopamine's action on the connectome alone does not make starved
  flies walk more. No circadian state; dopamine and serotonin are still fast excitatory transmitters.
- With octopamine's fast synapses removed, the tethered looming benchmark lost its giant-fibre response.
  Brain parameters have not been refitted.
- Left/right imbalances: the right DNa02 and P9 get more tonic excitation than the left, so the steering
  readout adapts slowly to cancel standing asymmetry.

## Motor
- No connectome-only model produces coordinated walking from the whole nerve cord. Pugliese et al. found
  rhythm in a front-leg subnetwork for about 3% of descending neurons. Hence the descending-command mode.
- The full-connectome mode cannot hold posture.
- Descending-neuron roles and readout thresholds are chosen from the literature, not derived.
- Flight is quasi-steady. Net forces are applied and the wing stroke is drawn, not simulated
  aerodynamically ([Flight](24-flight.md)). Speed and height are held by the flight motor, not by optic
  flow through the brain.

## Behaviour
- Looming escape is intermittent. The takeoff DNs reach their 70 Hz trigger during self-motion and
  grooming, and real looms reach only 70 to 100 Hz. Escape gating removes the false alarms near walls, but
  2 of 10 test looms produced an escape (the original readout produced none away from walls).
- Feeding completes only with the endogenous feeding stop and hunger-gated MN9 drive. The model's own
  sugar stop and tarsal-sugar to MN9 pathway are too weak on their own.
- Turning away from touched obstacles and from heat is supplied by the endogenous module. The connectome
  responds to these senses, but only weakly steers away.
- Occasional flips; righting recovers about two thirds.

## Body and senses
- flybody's proboscis servos are weak, so labellum contact is a 0.65 mm distance test.
- Legs pass through walls rather than climbing them. Obstacle touch is computed geometrically for the
  antennae and front claws.
- flyvis uses about 410 of its 721 columns with the real eye map.
- Taste, odour, and heat fields are simple analytic models.
