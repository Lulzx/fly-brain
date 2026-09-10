# fly-brain

Interactive, in-browser simulation of the complete **male *Drosophila* central nervous system connectome**
(HHMI Janelia FlyEM + Google Research, male CNS v1.0, CC-BY 4.0).

- 165,122 traced neurons (brain + ventral nerve cord), 10.5 M connections with ≥3 synapses (104 M synapses).
- Every neuron is a leaky integrate-and-fire unit (parameters from Shiu et al. 2024, *Nature*), with
  spike-frequency adaptation and short-term synaptic depression added to keep activity bounded.
- Sign of each connection comes from the presynaptic neuron's predicted neurotransmitter
  (ACh / monoamines excitatory; GABA / glutamate / histamine inhibitory).
- Rendered with Three.js from downsampled skeletons; activity lights up neurons in real time.

## Run

```sh
npm install
# data (≈70 MB preprocessed) — regenerate with the scripts below, or copy public/data
npm run dev
```

## Data pipeline

```sh
uv venv .venv && uv pip install --python .venv/bin/python pyarrow pandas numpy scipy
# ~1.2 GB flat connectome tables
for f in body-annotations-male-cns-v1.0-minconf-0.5 body-neurotransmitters-male-cns-v1.0 connectome-weights-male-cns-v1.0-minconf-0.5; do
  curl -o data/raw/$f.feather https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/$f.feather; done
.venv/bin/python scripts/prep_graph.py 3          # -> public/data/{neurons.bin,graph_w3.bin,meta.json}
# 5.5 GB of neuroglancer skeletons (one file per neuron)
gsutil -m rsync gs://flyem-male-cns/v1.0/segmentation/skeletons-malecns/skeletons-precomputed/ data/skeletons/
.venv/bin/python scripts/prep_skeletons.py 48     # -> public/data/skeletons_lo.bin
```

## Model tests (Node)

```sh
node scripts/simtest.mjs type DNp01 100 500        # stimulate the giant fiber at 100 Hz for 500 ms
node scripts/persist.mjs class gustatory 50 0.275 2 0.2   # does activity die after stimulus off?
```

## Layout

- `src/lif.js` – pure LIF network core (usable in a worker, in Node, or one instance per fly)
- `src/sim.worker.js` – worker wrapper; `src/brain.js` – `FlyBrain` class (drive / pulse / onFrame)
- `src/main.js` – viewer + UI; `scripts/` – data prep and tests

Source: https://male-cns.janelia.org · https://neuprint.janelia.org
