# fly-brain

**Live demo:** [arena](https://lulzx.com/fly-brain/arena.html) · [connectome viewer](https://lulzx.com/fly-brain/) (desktop Chrome/Edge/Firefox; the viewer downloads about 30 MB, the arena about 23 MB)

Full documentation: [docs/README.md](docs/README.md).

Embodied, whole-CNS simulation of the **male *Drosophila* connectome** in the browser.
Each fly is a 165,122-neuron connectome brain (male CNS v1.0, Janelia FlyEM + Google, CC-BY 4.0) living in a
physics-simulated flybody body (MuJoCo, Janelia/DeepMind) with a trained compound-eye front end (flyvis,
Lappalainen et al. 2024). The brain turns what the fly senses into its actions. An endogenous-activity module
supplies the spontaneous drive the connectome model lacks: when to walk, pause, groom, turn or take off.
It acts only as synaptic input to identified descending neurons ([docs/23-behaviour.md](docs/23-behaviour.md)).

- `index.html` – the connectome viewer: 3D skeletons of all neurons, stimulate any cell type, watch activity.
- `arena.html` – the embodied arena: add flies, place sugar, odour, bitter patches, heat, blocks; launch a
  looming threat or activate a fly's takeoff neurons; change wind and light; follow a fly and watch its brain
  in the inset. `[` and `]` fold the side panels.

## Run
```sh
npm install
npm run dev            # http://localhost:5173/arena.html  (needs cross-origin isolation, set in vite.config.js)
```
The preprocessed data in `public/` is produced by the scripts below. The browser loads compact packed
versions of the connectome, skeletons and neuron table (27 MB in total, see [docs/22-codecs.md](docs/22-codecs.md)).

## What happens every simulated millisecond (per fly, in its own Web Worker)
1. **Senses** (`src/sim/senses.js`, `src/sim/vision.js`): taste (labellum, taste pegs, each leg), odour plumes
   per antenna (glomerulus-specific ORNs), phasic tarsal touch, leg proprioceptors, body bristles, halteres,
   antennal wind, heat. Vision: 2 × 721 rays → flyvis optic-lobe model (50 Hz) → drives the matching
   ~62,000 male-CNS optic-lobe neurons (same cell type, same retinotopic column).
2. **Brain** (`src/wasm/lif.c`, WebAssembly): conductance-based LIF over 10.5 M connections, parameters fitted
   to published behaviours (see PLAN.md).
3. **Motor** (`src/sim/motor.js`): descending-neuron populations → walking/turning/backing (stepping pattern
   generator), head grooming, escape jump (giant fibre / looming takeoff DNs); proboscis and antennae driven
   by their own motor neurons. Optional "full connectome VNC" mode drives every leg muscle from its MNs.
4. **Physics** (`src/sim/world.js`): flybody fly with exact inertias, adhesive claws, 0.2 ms MuJoCo steps.
5. **Endogenous behaviour** (`src/sim/intrinsic.js`): walk, pause and grooming bouts, saccades, turning away
   from obstacles and heat, feeding stops, local search, voluntary takeoff. All delivered as DN synaptic input.
6. **Flight** (`src/sim/flight.js`): takeoff after the jump, quasi-steady flight steered by the brain's
   steering DNs, collision-avoidance saccades, and landing ([docs/24-flight.md](docs/24-flight.md)).

## Data / model pipeline
```sh
uv venv .venv && uv pip install --python .venv/bin/python pyarrow pandas numpy scipy mujoco trimesh fast-simplification cma h5py
.venv/bin/python scripts/prep_graph.py 3        # neurons.bin, graph_w3.bin, meta.json   (flat connectome tables)
node --max-old-space-size=16000 scripts/prep_skel_tree.mjs   # skeletons.flys          (5.5 GB of skeletons -> 12 MB)
.venv/bin/python scripts/prep_body.py 0.25      # fly_physics.xml, fly_visual.*           (flybody model)
.venv/bin/python scripts/prep_bodymap.py        # bodymap.json: motor/sensory/eye neuron maps
.venv-flyvis/bin/python ...                     # flyvis export (see session notes) -> public/vision/
.venv/bin/python scripts/prep_flyvis_map.py     # flyvis node <-> male-CNS neuron map (retinotopy via connectome)
node scripts/pack_data.mjs                      # graph.flyg, neurons.flyn                 (packed for the browser)
node scripts/calib_search.mjs '{"coba":true}'   # fit brain parameters to behavioural benchmarks
.venv/bin/python scripts/gait_opt2.py 60        # stepping pattern generator (multi-condition CMA-ES)
```

## Headless experiments
```sh
node scripts/run_fly.mjs 6 nearodor     # walk toward food and odour
node scripts/run_fly.mjs 3 onfood       # tarsal sugar: stop / proboscis
node scripts/run_fly.mjs 2 threat       # looming object -> giant fibre -> jump -> run
node scripts/calib_eval.mjs "$(cat public/data/brain_params.json)"   # behavioural benchmark suite
```
Sources: male-cns.janelia.org · neuprint.janelia.org · github.com/TuragaLab/flybody · github.com/TuragaLab/flyvis ·
github.com/TuragaLab/FlySuite (real-fly walking kinematics).
