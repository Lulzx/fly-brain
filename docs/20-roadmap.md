# 20. Roadmap

In recommended order.

1. **Pathway-specific fitting.** Fit a few synaptic scale factors along the escape chain (LC4, LPLC2,
   giant fibre, DNp02, DNp04) and the feeding chain (GRNs, GNG232, DNge080, MN9) against looming and
   feeding data, as flyvis did for the optic lobe — the loom chain is now the clearest weak link
   ([Neuromodulation](25-neuromodulation.md) for the OA-gain negative result).
2. ~~Antennal lobe gain control~~ — done: divisive ORN normalisation for GABA_B presynaptic inhibition
   ([Senses](10-senses.md)).
3. ~~Aerodynamic flight~~ — done: blade-element forces on the real 218 Hz stroke ([Flight](24-flight.md)).
   Next level: wing power and steering MNs driving the stroke, or a trained stabiliser.
4. **Wall climbing.** Train or fit a vertical-surface gait so legs can grip walls.
5. **Neuromodulation and state.** AKH/insulin/octopamine are in, the brain is refitted with them on, and
   locomotion drives optic-lobe OA release ([Neuromodulation](25-neuromodulation.md)). Next: dopamine
   gating of feeding, and bout structure from the circuits rather than rules.
6. **Speed.** WebGPU brain kernel is in with a WASM fallback ([WebGPU](27-webgpu.md)); next: sharing the
   device across flies and moving flyvis up too.
7. ~~Social behaviour~~ — done: LC10 visual detection + cVA pheromone → pIP10/DNp13 pursuit and wing
   display through the male fru/dsx circuitry ([Courtship](26-courtship.md)). Next: a female that flees or
   rejects, and real song pulses.
