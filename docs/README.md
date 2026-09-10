# fly-brain documentation

An embodied simulation of the male *Drosophila* central nervous system connectome, running in the browser.
Each fly is a 165,122-neuron spiking brain inside a physics-simulated body, seeing through a trained
compound-eye model. The brain alone decides what the fly does.

## Index

### Start here
1. [Overview](01-overview.md): what the system is and how the pieces fit
2. [Quickstart](02-quickstart.md): install, run, and use the apps

### Data
3. [Connectome data pipeline](03-data-pipeline.md): downloading and preprocessing male CNS v1.0
4. [Connectome viewer](04-connectome-viewer.md): the `index.html` brain viewer

### Brain
5. [Brain model](05-brain-model.md): conductance-based LIF and its physiological additions
6. [WebAssembly kernel](06-wasm-kernel.md): shared-memory brains and the flyvis kernel
7. [Calibration](07-calibration.md): fitting parameters to published behaviour

### Body
8. [Body and physics](08-body-physics.md): flybody in MuJoCo, contact layers, timestep
9. [Neuron-to-body map](09-bodymap.md): motor neurons to muscles, sensory neurons to sensors
10. [Senses](10-senses.md): taste, smell, touch, proprioception, heat, wind
11. [Vision](11-vision.md): flyvis optic-lobe model and retinotopic mapping
12. [Motor output](12-motor.md): descending-neuron readout and muscle activation
13. [Gait](13-gait.md): stepping pattern generator from real-fly kinematics
14. [Reflexes](14-reflexes.md): escape jump and righting

### World
15. [Arena app](15-arena.md): workers, rendering, presets, controls
16. [Physiology](16-physiology.md): energy, hunger, feeding, damage

### Results and status
17. [Experiments and scripts](17-experiments.md): headless tools and the behaviour report
18. [Performance](18-performance.md): where time goes and what was optimised
19. [Limitations](19-limitations.md): what does not work yet, and why
20. [Roadmap](20-roadmap.md): recommended next steps
21. [References](21-references.md): datasets, models, and papers used

### Delivery
22. [Data codecs](22-codecs.md): how the connectome, skeletons and neuron table are packed for the browser

## Repository layout

| Path | Contents |
|---|---|
| `index.html`, `src/main.js` | Connectome viewer |
| `arena.html`, `src/arena.js` | Embodied arena |
| `src/sim/` | Fly agent, world, senses, vision, motor, worker |
| `src/lif.js`, `src/lifwasm.js`, `src/wasm/lif.c` | Brain model in JS and WebAssembly |
| `src/brainmodel.js`, `src/brainsetup.js` | Calibrated brain construction, shared memory |
| `src/flyvis.js` | flyvis optic-lobe runtime |
| `public/` | Preprocessed data served to the browser |
| `scripts/` | Preprocessing, calibration, optimisation, tests |
| `PLAN.md` | Condensed design notes |
