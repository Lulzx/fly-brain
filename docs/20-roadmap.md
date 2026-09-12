# 20. Roadmap

In recommended order.

1. **Pathway-specific fitting.** Fit a few synaptic scale factors along the escape chain (LC4, LPLC2,
   giant fibre, DNp02, DNp04) and the feeding chain (GRNs, GNG232, DNge080, MN9) against looming and
   feeding data, as flyvis did for the optic lobe.
2. **Antennal lobe gain control.** Model GABA_B presynaptic inhibition of receptor terminals to restore
   odour identity and remove odour-driven proboscis extension.
3. **Aerodynamic flight.** The quasi-steady model flies ([Flight](24-flight.md)). Next: flybody's fluid model
   with the wing stroke driven by wing power
   and steering motor neurons.
4. **Wall climbing.** Train or fit a vertical-surface gait so legs can grip walls.
5. **Neuromodulation and state.** Started: hunger acts through AKH, insulin and octopamine
   ([Neuromodulation](25-neuromodulation.md)). Next: refit the brain with it on, octopamine's optic-lobe gain,
   dopamine gating of feeding, and bout structure from the circuits rather than rules.
6. **Speed.** Multi-threaded brain and physics, then WebGPU.
7. **Social behaviour.** Courtship song and male-specific fruitless and doublesex circuits, which this male
   dataset annotates.
