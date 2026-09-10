# 19. Limitations

## Brain
- The connectome gives wiring, not strengths, neuromodulation, gap junctions, or plasticity.
- **Olfaction.** Cholinergic local neurons such as lLN1_bc make about 200,000 synapses onto projection
  neurons. One glomerulus recruits most projection neurons, so odour identity is lost downstream.
  GABA_B presynaptic inhibition, the main gain control, is not modelled.
- **Proboscis.** MN9 is partly driven by olfactory channels, so flies often walk with the proboscis out.
- **Tarsal reflex** is weak: 15 Hz, partial extension.
- **No intrinsic drives** such as circadian state or hunger peptides.

## Motor
- No connectome-only model produces coordinated walking from the whole nerve cord. Pugliese et al. found
  rhythm in a front-leg subnetwork for about 3% of descending neurons. Hence the descending-command mode.
- The full-connectome mode cannot hold posture.
- Descending-neuron roles and readout thresholds are chosen from the literature, not derived.
- No flight.

## Behaviour
- Looming escape is intermittent at the default visual gain; higher gain adds false escapes.
- Feeding rarely completes, because visual drive to walking outweighs the sugar stop signal.
- Occasional flips; righting recovers about two thirds.

## Body and senses
- flybody's proboscis servos are weak, so labellum contact is a 0.65 mm distance test.
- Legs slide along walls rather than climbing.
- flyvis uses about 410 of its 721 columns with the real eye map.
- Taste, odour, and heat fields are simple analytic models.
