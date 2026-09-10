# fly-brain

**Live demo:** [arena](https://lulzx.com/fly-brain/arena.html) · [connectome viewer](https://lulzx.com/fly-brain/) (desktop Chrome/Edge/Firefox; downloads ~190 MB of data)

Full documentation: [docs/README.md](docs/README.md).

Embodied, whole-CNS simulation of the **male *Drosophila* connectome** in the browser.
Each fly is a 165,122-neuron connectome brain (male CNS v1.0, Janelia FlyEM + Google, CC-BY 4.0) living in a
physics-simulated flybody body (MuJoCo, Janelia/DeepMind) with a trained compound-eye front end (flyvis,
Lappalainen et al. 2024). The brain alone decides what the fly does.

- `index.html` – the connectome viewer: 3D skeletons of all neurons, stimulate any cell type, watch activity.
- `arena.html` – the embodied arena: add flies, place sugar, odour, bitter patches, heat, blocks; launch a
  looming threat; change wind and light; follow a fly and watch its brain in the inset.

## Run
```sh
npm install
npm run dev            # http://localhost:5173/arena.html  (needs cross-origin isolation, set in vite.config.js)
```
The preprocessed data in `public/` (~190 MB) is produced by the scripts below.

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

## Data / model pipeline
```sh
uv venv .venv && uv pip install --python .venv/bin/python pyarrow pandas numpy scipy mujoco trimesh fast-simplification cma h5py
.venv/bin/python scripts/prep_graph.py 3        # neurons.bin, graph_w3.bin, meta.json   (flat connectome tables)
.venv/bin/python scripts/prep_skeletons.py 40   # skeletons_lo.bin                        (5.5 GB of skeletons)
.venv/bin/python scripts/prep_body.py 0.25      # fly_physics.xml, fly_visual.*           (flybody model)
.venv/bin/python scripts/prep_bodymap.py        # bodymap.json: motor/sensory/eye neuron maps
.venv-flyvis/bin/python ...                     # flyvis export (see session notes) -> public/vision/
.venv/bin/python scripts/prep_flyvis_map.py     # flyvis node <-> male-CNS neuron map (retinotopy via connectome)
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
