# 22. Data codecs

The browser loads three packed files instead of the flat binary tables: `graph.flyg` (connectome),
`skeletons.flys` (neuron geometry) and `neurons.flyn` (per-neuron table). Together they are about 27 MB,
down from about 160 MB of flat tables (110 MB after the host's gzip). The graph and neuron table decode
to exactly the original arrays. The skeletons are re-simplified from the raw data, so geometry is lossy.

Rebuild them after changing the source data:
```sh
node --max-old-space-size=16000 scripts/prep_skel_tree.mjs   # data/skeletons/*     -> skeletons.flys
node scripts/pack_data.mjs                                    # graph_w3.bin, neurons.bin -> graph.flyg, neurons.flyn
```
`pack_data.mjs` reads `skeletons.flys` to order the graph, so run the skeleton step first. Both scripts
decode what they wrote and exit non-zero if the result differs from the input.

| File | Flat table | gzip (as served before) | brotli -q 11 | Packed | Decode |
|---|---|---|---|---|---|
| Connectome | `graph_w3.bin` 63.7 MB | 33.4 MB | 21.2 MB | `graph.flyg` 14.6 MB | 0.85 s |
| Skeletons | `skeletons_lo.bin` 94.1 MB | 75.3 MB | 60.8 MB | `skeletons.flys` 11.6 MB | 0.95 s |
| Neuron table | `neurons.bin` 5.4 MB | 2.0 MB | 1.7 MB | `neurons.flyn` 1.0 MB | 0.04 s |

Decode times are single-threaded on the development machine (Apple silicon, Node 26). The packed files
are entropy-coded, so gzip on top of them saves nothing.

## The entropy coder
All three formats share `src/codec/rc.js`: a binary adaptive range coder of the kind LZMA uses, with
12-bit probabilities that move 1/32 of the way towards each coded bit. That part is a standard
technique. What makes the files small is the modelling on top of it: what gets coded, in what order,
and which earlier values choose the probability for each bit.

Integers go through one model, `UInt`. A value `v` is coded as the bit length `k` of `v + 1` (five
binary decisions down a tree, with separate probabilities per context), then the bits below the
leading one. The top two of those bits have their own adaptive probabilities, and the rest are coded as
equiprobable bits, 16 at a time. A context is a small integer the caller computes from values already
decoded, so the decoder can always compute the same one. `SInt` maps signed values onto `UInt` by
zigzag.

Encoder and decoder share one routine per model: `io.bit(p, i, b)` returns `b` when encoding and the
decoded bit when decoding. The decoder also has an inlined copy of the integer path (`UInt.dec`) that
keeps the coder state in int32 locals. V8 stores uint32 values of 2^31 and above as doubles, and
keeping the arithmetic in int32 (`Math.imul`, unsigned compares done as xor with 0x80000000) roughly
halved decode time.

## FLYG: the connectome
The graph is a CSR matrix: for each presynaptic neuron, the sorted list of postsynaptic neurons and a
synapse count for each. 10,511,038 connections, counts from 3 to 2,591.

### Renumbering
Target lists are coded as gaps between consecutive ids, so the cost per connection
depends on how far apart connected neurons are numbered. In the original numbering (sorted by body id)
the gaps average 11.8 bits of entropy. The encoder renumbers neurons by cell type, then by a Morton
code (10 bits per axis) of the neuron's skeleton centroid. Connected neurons are usually near each
other, and neurons of one type connect to similar partners. That brings the gaps to 8.2 bits. The
permutation costs 18 bits per neuron (0.37 MB) and is stored in the file.

### Copying from the previous row
After renumbering, row `r - 1` is usually a neuron of the same type
as row `r`, and 28% of a row's targets also appear in the previous row's list. For each target of the
previous row the encoder writes one bit: does row `r` also connect to it? The bit's context is the
previous copy bit and how the two rows' degrees compare. Only the remaining targets are coded as gaps.

### One row, in order
1. Degree, context: bit length of the previous row's degree.
2. One copy bit per target of the previous row.
3. Remaining targets: the first as a signed offset from the row's own id, the rest as `gap - 1`, with
   the bit length of the previous gap as context.
4. Synapse counts minus 3, in target order. For a copied connection the context is the count of the
   same connection in the previous row, otherwise the previous count in this row.

Synapse counts barely compress: 4.04 bits each on their own, 3.95 bits with the best context found.
They take about 4 of the 11.1 bits spent per connection.

### Decoding
Decoding runs in two passes. The first decodes rows in the new numbering. The second maps ids
back and does a counting sort by target, which leaves every row sorted by target exactly as in
`graph_w3.bin`. `pack_data.mjs` checks the arrays match element for element.

## FLYS: neuron skeletons
### Geometry
The raw skeletons have 270 M vertices. The earlier bundle cut each neuron to its ~20
longest unbranched paths and kept every k-th vertex. That gave 13.5 M vertices in 3.2 M paths, whose
branch points were stored once per path, and the connecting branches were missing: the 165,122
neurons fell apart into 2.1 M disconnected pieces.

`prep_skel_tree.mjs` rebuilds each neuron from the raw skeleton:
1. Spanning tree rooted at the vertex nearest the soma, which breaks any cycles.
2. Fragments shorter than 20 µm are dropped (the largest one is always kept).
3. Terminal twigs shorter than 20 µm are removed, in two rounds.
4. Each unbranched run between branch points is simplified with Douglas-Peucker at 2 µm.
5. Coordinates snap to a 700 nm grid.

That leaves 5.28 M vertices in one connected tree per neuron. At the viewer's zoom levels it shows more
of each arbor than the old bundle.

### Coding
Each tree is written in depth-first preorder. Per vertex:
- The number of children, with the previous vertex's count as context. The decoder rebuilds the parent
  of every vertex from these counts with a stack.
- For the root, the xyz offset from the previous root.
- For every other vertex, the step from its parent, per axis, as magnitude then sign. The magnitude's
  context is the bit length of the parent's own step on that axis, and whether the parent is a branch
  point. The sign's context is the parent's sign on that axis, because neurites tend to keep going the
  same way.

The result is 17.6 bits per vertex, including tree structure. The decoder outputs the arrays Three.js
draws directly: vertex positions, index pairs `(parent, child)` for `LineSegments`, and each neuron's
vertex range for colouring.

## FLYN: the neuron table
Body ids are sorted, so they are coded as gaps. Superclass is coded first and chooses the context for
class, transmitter and side. Soma positions are integer voxel coordinates. A bit marks whether the
neuron has one (25,098 do not), and present positions are coded as offsets from the previous soma.
In- and out-degree are not stored because the graph determines them.

## Loading
`src/data.js` fetches each packed file in a worker (`src/codec/decode.worker.js`), decodes it there and
transfers the arrays back. The viewer draws somas as soon as `meta.json` and `neurons.flyn` arrive
(about 1.7 MB on the wire), then loads the graph and skeletons in parallel. The simulation starts when
the graph is ready. The arena does not load skeletons.

At build time `vite.config.js` hashes each data file and injects the hashes and sizes as
`__DATA_FILES__`. URLs carry the hash (`graph.flyg?v=...`), so the worker can keep responses in Cache
Storage indefinitely and returning visitors skip downloading them again. Progress uses the known
size because GitHub Pages gzips responses and reports the compressed length.

## Things tried and not kept
- Coding each neuron's incoming instead of outgoing connections: 1.4% smaller, but the decoder would
  need an extra transpose.
- Linear prediction of skeleton steps (continue the parent's step): worse than plain parent offsets.
- A 7.3 MB skeleton file (40 µm pruning, 1.5 µm simplification): visibly thinner neuropils.
