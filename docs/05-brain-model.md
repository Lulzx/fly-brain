# 5. Brain model

Files: `src/lif.js`, `src/brainmodel.js`, `src/wasm/lif.c`.

## Base model
Leaky integrate-and-fire neurons after Shiu et al. 2024:
rest −52 mV, threshold −45 mV, membrane time constant 20 ms, synaptic time constant 5 ms,
0.5 ms steps, 1.8 ms synaptic delay. Sensory neurons are driven as Poisson spike trains.

## Additions, each motivated by physiology

| Addition | Why |
|---|---|
| Conductance-based synapses, E_exc 0 mV, E_inh fitted near −74 mV | Excitation saturates and inhibition shunts. Current-based synapses let one neuron with 150 synapses fire any target. |
| PSP scaled by (volume ÷ regional median)^−α | Larger neurons have lower input resistance. After Pugliese et al. 2025. Regions: optic lobe, central brain, nerve cord. |
| Connections with 5 or more synapses | As in Pugliese et al. 2025 |
| Graded signs for unclear transmitters | 3,602 neurons lack a consensus call. Their sign is P(ACh + monoamines) − P(GABA + Glu + histamine) from per-synapse predictions. |
| Sensory neurons ignore central input | Their spikes originate at the receptor; central synapses on their terminals cannot make them fire. |
| Raised Kenyon cell threshold | Kenyon cells need coincident input from several projection neurons. |
| Lamina resting bias | L1 to L5 are graded neurons with a depolarised rest, so histaminergic photoreceptor input can modulate them. |
| Giant fibre to TTMn electrical synapse | Absent from the chemical connectome; added explicitly. |
| Background synaptic events | Optional random excitatory kicks standing in for spontaneous release. |

## What was tried and dropped
- **Firing-rate model of the whole CNS** after Pugliese et al.: ignited to about 25,000 active neurons.
  It stays stable for the nerve cord alone but gives slow waves, not stepping rhythm.
- **Spike-frequency adaptation and short-term depression**: stabilised activity but killed the
  sugar-to-proboscis pathway.
- **Unknown transmitter treated as excitatory**: spread odour activity to every antennal lobe glomerulus.

## Active parameters
Stored in `public/data/brain_params.json`. See [Calibration](07-calibration.md).
