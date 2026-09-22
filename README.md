# fly-brain

The complete wiring diagram of a male fruit fly's nervous system is now a file: 165,122
neurons, 104 million synapses. This project runs that file as a spiking brain, inside a
physics-simulated body, in a web browser, and then asks a simple question: which of the
fly's behaviours does the wiring produce on its own, and which had to be added from
outside the graph? The second list turned out to be as interesting as the first.

**Try it:** [arena](https://lulzx.com/fly-brain/arena.html) ·
[connectome viewer](https://lulzx.com/fly-brain/) ·
[algorithmic structures](https://lulzx.com/fly-brain/structures.html) ·
[the textbook](https://lulzx.com/fly-brain/textbook/)
(desktop Chrome, Edge or Firefox; the viewer downloads about 30 MB, the arena about 23 MB)

## Start here

- [What this is](docs/guide/what-this-is.md). One fly is a 165,122-neuron connectome brain
  in a MuJoCo body with a trained compound eye. What the pieces are and why each one is there.
- [Run it](docs/guide/run.md). Two commands to get the arena running locally, and what the
  browser actually loads.
- [The four apps](docs/guide/apps.md). The connectome viewer, the structures page, the arena,
  and the 3D fly.

## How it works

- [What happens every simulated millisecond](docs/guide/loop.md). Senses, brain, motor,
  physics, endogenous behaviour, neuromodulation, courtship, flight. Each stage in a
  paragraph, with the file that implements it.
- [What the wiring gives you, and what it does not](docs/guide/what-the-wiring-gives.md).
  The honest boundary: which behaviours are read out of the connectome and which are
  supplied by code around it.
- [Building the data](docs/guide/pipeline.md). From the raw 10 GB of Janelia tables to the
  27 MB the browser loads, and the calibration and gait fits on top.
- [Headless experiments](docs/guide/experiments.md). Running flies in Node without a browser,
  and the behavioural benchmark suite.

## Going deeper

- [Full documentation index](docs/README.md). Thirty-five documents covering every subsystem,
  the calibration, the limitations and the roadmap.
- [Compiling the Fly Brain](docs/textbook/) is a research monograph on candidate
  computations, connectome-constrained model families, and experiments that distinguish
  them. It separates established biology, recorded model results, and open predictions.
  [Read online](https://lulzx.com/fly-brain/textbook/) or
  [download the PDF](public/fly-brain-textbook.pdf). Executable instructions live in the
  [technical reproduction companion](docs/textbook-reproduction.md).
- [Sources and credits](docs/guide/sources.md). The connectome, the body, the eye, the
  walking data, and the licences.

## Layout

| path | contents |
|---|---|
| `index.html`, `src/main.js` | connectome viewer |
| `arena.html`, `src/arena.js` | embodied arena |
| `structures.html`, `src/structures.js` | algorithmic-structure visualisation |
| `textbook/`, `src/textbook.js` | ebook reader for `docs/textbook/` |
| `src/sim/` | fly agent, world, senses, vision, motor, endogenous behaviour, neuromodulation, flight, worker |
| `src/lif.js`, `src/lifwasm.js`, `src/lifgpu.js`, `src/wasm/lif.c` | brain model in JavaScript, WebAssembly and WebGPU |
| `src/brainmodel.js`, `src/brainsetup.js` | calibrated brain construction, shared memory |
| `connectome.bend`, `dataset.bend`, `LAWS.bend`, `PROOF.bend`, `malecns.bend` | the compiler and the male connectome formalized in Bend: laws, proofs, and a run over the real tables |
| `cord.bend`, `kernel.bend`, `perturb.bend`, `cord*.bend` | the nerve cord in Bend: a checked subgraph, a bit-identical spiking kernel, proven perturbations, and the ensemble |
| `src/flyvis.js` | flyvis optic-lobe runtime |
| `public/` | preprocessed data served to the browser |
| `scripts/` | preprocessing, calibration, optimisation, analysis, tests |
| `docs/` | documentation, the guide, and the textbook source |
