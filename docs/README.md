# fly-brain documentation

An embodied simulation of the male *Drosophila* central nervous system connectome, running in the browser.
Each fly is a 165,122-neuron spiking brain inside a physics-simulated body, seeing through a trained
compound-eye model. The brain turns what the fly senses into what it does. An endogenous-activity module
supplies the spontaneous drive the model lacks, and hunger reaches the brain as hormones and octopamine.

## Index

The short version of all this is the [guide](guide/what-this-is.md) linked from the
repository README. The long version is the textbook, [Compiling the Fly Brain](textbook/),
which covers the structural analysis and the model ensembles.

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
20. [Roadmap](20-roadmap.md): the motor programme first, then what is reachable now, what needs data that exists, and what needs data nobody has
21. [References](21-references.md): datasets, models, and papers used

### Delivery
22. [Data codecs](22-codecs.md): how the connectome, skeletons and neuron table are packed for the browser

### Behaviour
23. [Endogenous behaviour](23-behaviour.md): bouts, saccades, obstacle and heat avoidance, feeding, search
24. [Flight](24-flight.md): takeoff, blade-element flight on the 218 Hz stroke, collision avoidance, landing
25. [Neuromodulation](25-neuromodulation.md): hunger through AKH, insulin and octopamine; OA optic-lobe gain
26. [Courtship](26-courtship.md): LC10 detection, cVA pheromone, pIP10/DNp13 pursuit, wing display
27. [WebGPU](27-webgpu.md): GPU LIF kernel with WASM fallback

### Analysis
28. [Algorithmic structures](28-algorithmic-structures.md): what the wiring computes — hierarchy, recurrence, motifs, ring attractor, expansion coding, convolution kernels
29. [Connectome compiler](29-connectome-compiler.md): dataset-agnostic IR + generic analysis, worm vs fly first comparison
30. [Hypothesis lab](30-hypothesis-lab.md): model ensembles, discriminating-experiment ranking, PDE ring-attractor benchmark
31. [Ablation ladder](31-ablation-ladder.md): which levels of description the benchmark needs, measured — with and without refitting
32. [Per-connection uncertainty](32-synapse-uncertainty.md): reconstruction error estimated from bilateral replicates, and empirical-Bayes weights
33. [Differentiable brain](33-differentiable-brain.md): surrogate-gradient adjoint over the whole CNS and the optic lobe joined to it, and the three things that stop a visual assay fitting end to end
34. [Individual validation](34-individual-validation.md): testing the model against one identified fly rather than against population averages — and which observable to record, now measured
35. [Behavioural ladder](35-behaviour-ladder.md): the same substitutions, measured in the arena instead of on the physiological benchmark
36. [Stepping from the nerve cord](36-vnc-stepping.md): roadmap item M2 scoped as a project of its own — what it needs, what would finish it, and the two points at which to stop
37. [Scaffold ledger](37-scaffold-ledger.md): every named mechanism that isn't the graph, what it costs, and the kill tests that say whether it is required
38. [Reafference](38-reafference.md): learning to cancel self-generated sensory input — what it fixed, and what it could not
39. [VNC readout](39-vnc-readout.md): fitting leg-motor gains on the frozen subgraph — and the scramble that beats the real wiring
40. [Octopamine operators](40-oa-operators.md): four typed OA mechanisms and the discriminator assay that split them
41. [Visual adjoint](41-visual-adjoint.md): the C¹ coupling, the stable reverse kernel, and the first permitted visual fit — a recorded negative
42. [Engram](42-engram.md): the mushroom-body memory harness — anatomy-derived compartments, a named per-edge gain, a teach rule, and whether the written engram can be read back
43. [GPU adjoint](43-gpu-adjoint.md): the backward sweep on WebGPU — kernels, packing, and the correctness gates
44. [Walking compiler](44-walking-compiler.md): the experiment compiler pointed at the nerve cord — a phase-free gait instrument, cell-type and edge-class perturbations, null wirings as ensemble members, and the first walk-from-cord run

## Repository layout

| Path | Contents |
|---|---|
| `index.html`, `src/main.js` | Connectome viewer |
| `arena.html`, `src/arena.js` | Embodied arena |
| `structures.html`, `src/structures.js` | Algorithmic-structure visualisation ([doc 28](28-algorithmic-structures.md)) |
| `src/sim/` | Fly agent, world, senses, vision, motor, endogenous behaviour, neuromodulation, flight, worker |
| `src/lif.js`, `src/lifwasm.js`, `src/lifgpu.js`, `src/wasm/lif.c` | Brain model in JS, WebAssembly and WebGPU |
| `src/lifdiff.js` | Differentiable LIF: same dynamics, plus an adjoint ([doc 33](33-differentiable-brain.md)) |
| `src/flyvisdiff.js` | Differentiable optic lobe: `fv_step`'s dynamics bit-for-bit, plus an adjoint |
| `src/visdiff.js` | The two joined into one differentiable chain, luminance to spikes |
| `src/diffsetup.js` | The per-neuron structure `makeBrain` applies, in the form the adjoint takes |
| `src/brainmodel.js`, `src/brainsetup.js` | Calibrated brain construction, shared memory |
| `src/flyvis.js` | flyvis optic-lobe runtime |
| `public/` | Preprocessed data served to the browser |
| `scripts/` | Preprocessing, calibration, optimisation, tests |
| `PLAN.md` | Condensed design notes |
