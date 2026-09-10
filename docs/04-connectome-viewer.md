# 4. Connectome viewer

`index.html` renders every traced neuron and runs the calibrated brain model live.

## Features
- 3D skeletons of all 165,122 neurons, about 13 M vertices, drawn as line segments in Three.js.
- Colour by superclass, neurotransmitter, or side. Click legend entries to hide groups.
- Show skeletons, somas only, or active neurons only.
- Stimulate any superclass, class, or cell type, on one side or both, at a chosen rate, or pulse it.
- Click a neuron to see its type, transmitter, spike count, and strongest inputs and outputs.
- Background synaptic activity control.

## Implementation
- `src/main.js` builds the scene. Neuron colour and activity live in two textures indexed by neuron id,
  so one draw call covers all skeletons.
- `src/sim.worker.js` runs the same WebAssembly brain and parameters as the arena flies.
- Activity is shown as a decaying trace per neuron.
