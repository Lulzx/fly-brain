# 3. Connectome data pipeline

## Source
Male CNS connectome v1.0, Janelia FlyEM with Google Research and collaborators, CC-BY 4.0.
Public bucket: `gs://flyem-male-cns/v1.0/`.

| File | Size | Used for |
|---|---|---|
| `body-annotations-male-cns-v1.0-minconf-0.5.feather` | 14 MB | Types, classes, sides, nerves |
| `body-neurotransmitters-male-cns-v1.0.feather` | 43 MB | Consensus transmitter per neuron |
| `connectome-weights-male-cns-v1.0-minconf-0.5.feather` | 1.1 GB | Neuron-to-neuron synapse counts |
| `tbar-neurotransmitters-male-cns-v1.0.feather` | 2.7 GB | Per-synapse transmitter probabilities |
| `database/neuprint-inputs/Neuprint_Neurons.feather` | 4.3 GB | Neuron volume (`size`) |
| `segmentation/skeletons-malecns/skeletons-precomputed/` | 5.5 GB | Neuron skeletons |

Downloads go to `data/raw/` and `data/skeletons/`, which are git-ignored.

## Steps
```sh
.venv/bin/python scripts/prep_graph.py 3
node --max-old-space-size=16000 scripts/prep_skel_tree.mjs
.venv/bin/python scripts/prep_bodymap.py
.venv/bin/python scripts/prep_flyvis_map.py
node scripts/pack_data.mjs
```

| Script | Output | Notes |
|---|---|---|
| `prep_graph.py` | `neurons.bin`, `graph_w3.bin`, `meta.json` | 165,122 traced neurons; CSR graph of 10.5 M connections with 3 or more synapses |
| `prep_skel_tree.mjs` | `skeletons.flys` | One pruned, simplified tree per neuron (5.3 M vertices), packed. See [Data codecs](22-codecs.md) |
| `prep_bodymap.py` | `bodymap.json` | See [Neuron-to-body map](09-bodymap.md) |
| `prep_flyvis_map.py` | `vision/flyvis_map.json` | See [Vision](11-vision.md) |
| `pack_data.mjs` | `graph.flyg`, `neurons.flyn` | Lossless packed copies of the two tables for the browser. See [Data codecs](22-codecs.md) |

Neuron volumes are extracted from the neuPrint table into `neuron_size.bin`. Graded transmitter signs are
computed from per-synapse probabilities into `ntsign.bin`. See [Brain model](05-brain-model.md).

## Binary layouts
- `neurons.bin`: header of two uint32, then body ids, soma xyz, in-degree, out-degree, class, transmitter,
  superclass, side. Fields are ordered to keep typed arrays aligned.
- `graph_w3.bin`: uint32 N and E, then indptr, target indices, uint16 synapse counts.

The node scripts and the Python pipeline read these flat tables. They are not deployed: the browser
loads the packed files described in [Data codecs](22-codecs.md).
