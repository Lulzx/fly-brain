# The connectome compiler: one analysis, many animals

Doc 28 measures the algorithmic structures of the male fly CNS. This doc is the first step toward
making that machinery dataset-agnostic: a canonical **intermediate representation** for any
connectome, plus the generic analysis layer that runs on it. The fly-specific sections (Delta7
kernels, glomerular purity, …) stay in `algo_circuits.py`; everything below is the part that
compiles any nervous system.

## The IR

`scripts/connectome_ir.py` defines the schema every dataset is packed into:

| field | meaning |
|---|---|
| `names`, `types`, `scn`, `cln` | cell name, cell type (bilateral homologues share one), superclass, class |
| `side` | 1 = left, 2 = right, 3 = midline/other, 0 = unknown |
| `sign` | +1 excitatory, −1 inhibitory, 0 unknown/modulatory |
| `sensory`, `motor` | pins for the flow-hierarchy depth (sensors = 0, outputs = 1) |
| `indptr/indices/weights` | chemical graph, CSR, weight = synapse count |
| `gap_indptr/indices/weights` | electrical graph, symmetric CSR (empty where absent) |
| `meta` | provenance, sign convention, per-dataset thresholds |

Two loaders exist:

- **`load_fly()`** — reads the MaleCNS tables already packed for the browser sim
  (`graph_w3.bin`, `neurons.bin`, `ntsign.bin`, `meta.json`). Verified: every generic measure
  reproduces `algo_structures.json` exactly.
- **`load_worm()`** — Cook et al. 2019 adult hermaphrodite (corrected Jul 2020), from the
  Netzschleuder CSV dumps; neurotransmitter signs from the OpenWorm/WormAtlas cell dump
  (ACh = +1, GABA/Glu = −1, monoamines = 0; covers 179/302 neurons — the unassigned remainder is
  almost entirely pharyngeal). Types are neuron classes: bilateral suffixes are stripped only
  when a mirrored partner exists (`AVAL/AVAR → AVA`, but `RIR`, `PQR`, `AQR`, `PVR` stay single),
  and serial digits fold into the class (`DA01–DA09 → DA`): 169 types over 454 cells.
  Gap junctions are kept as a second, symmetric graph — a real edge type the fly IR lacks.

`scripts/algo_ir.py` runs the generic sections — flow depth, SCC/reciprocity, sign structure,
bilateral wiring, the type-graph motif census **with the same degree/sign-preserving null model
and FFL census** (imported from `algo_circuits.py`), the signed-matrix spectral footprint, and
hub tails — and writes `public/data/ir_generic.json`. Datasets accumulate by key, so per-species
reruns don't clobber each other.

## Worm vs fly, first comparison

| measure | *C. elegans* herm. (Cook 2019) | MaleCNS |
|---|---|---|
| cells / edges / synapses | 454 / 4,879 / 28,113 | 165,122 / 10.5M / 104M |
| forward / feedback / lateral weight | **12% / 72% / 16%** | 37% / 12% / 50% |
| giant SCC (chemical) | 0.61 | 0.97 |
| reciprocal weight | 0.29 | 0.27 |
| dominant neuron-level 2-cycle | **I↔I (371)** | **E↔I (616k)** |
| midline-crossing weight | 37% | 22% |
| FFI share of strong E type edges | 17% (z = 3.7) | 80% (z = 297) |
| FFL edges, coherent / incoherent | 29 / 33 (z = 1.4 / **3.0**) | 415k / 369k (z = 398 / 170) |
| spectral radius | 136 | 3,771 |
| dominant-eigenvector participation | **10.8 cells** | 49.9 cells |
| dominant-mode cell types | **RMD, RIA, SMD — the head-steering ring** | lLN2/lLN1 lateral-horn LNs |
| hub tail exponent (in / out) | 2.6 / 1.9 | 1.0 / 1.15 |

### What the comparison already says

- **Different dominant loop.** The fly's characteristic 2-cycle is feedback inhibition (E↔I);
  the worm's is mutual inhibition (I↔I) — the command-interneuron alternation (AVA↔AVB-style
  rivalry) that worm motor behaviour is famous for. At *type* level the worm's I↔I enrichment
  washes out (z ≈ −0.4): worm motor classes are single cells, so the motif lives at neuron
  resolution, not class resolution. The fly's FFI regime is far more extreme — 80% vs 17%.
- **The worm is shallower and more recurrent.** Only 12% of synaptic weight runs strictly
  forward (sensory→output), vs 37% in the fly — consistent with the worm's tiny recurrent
  interneuron core doing most of the work.
- **The dominant dynamical mode self-identifies.** On the worm, the leading eigenvector of the
  signed weight matrix lands on RMD/RMDV/RIA/SMD — the ring-interneuron/head-motor circuit that
  oscillates the head during foraging. Nobody told the analysis that; it fell out of the same
  measurement that found the lateral-horn LNs in the fly. That is the kind of "found, not
  annotated" result this layer exists for.
- **Hub tails differ in kind.** The fly's degree distribution is much heavier-tailed
  (exp ≈ 1.0 vs 2.6): 165k neurons have room for true super-hubs; 454 cells don't.

### Caveats specific to the worm pass

- Sign coverage is 179/302 neurons (pharyngeal cells mostly unassigned); unsigned edges are
  excluded from sign-conditioned counts rather than guessed.
- The null model swaps ~100 edges per rewire on a 330-edge graph — the worm's type graph is
  small enough that z-scores carry wide uncertainty; treat them as directional.
- Sign coverage bounds the electrical section below rather than the chemical one: 1,038 of the
  1,383 gap-coupled cell pairs have at least one partner with no neurotransmitter assignment,
  because most of them are muscle, hypodermis or the excretory cells.

## Electrical coupling, folded in

Gap junctions are unsigned and undirected, so they cannot be edges in a signed, directed census.
What they can do is change its answers, since an electrical contact makes a pair mutually coupled
whether or not the chemical graph says so — and mutual coupling is exactly what the reciprocity and
mutual-inhibition counts measure. `algo_ir.py` therefore reports the *difference* they make, at the
chemical census's own thresholds (≥3 junctions per target cell, ≥20 in total), rather than a second
table:

| measure | chemical only | with gap junctions |
|---|---|---|
| reciprocal type pairs | 15 | **68** |
| gap-coupled type pairs | — | 54, of which **47 have no strong chemical edge at all** |
| mutual-inhibition (I↔I) type pairs | 0 | 4 |
| recurrent-excitation (E↔E) type pairs | 6 | 9 |
| gap-coupled cell pairs | — | 1,383 (11,529 junctions), 751 with no chemical edge |
| neuron-to-neuron gap pairs | — | 1,109, of which 528 are electrical only |

**Most of the worm's mutual coupling is invisible to a chemical census.** Folding the electrical
graph in more than quadruples the reciprocal type pairs, 15 to 68, and 47 of the 54 gap-coupled type
pairs are pairs the chemical census records no strong edge between in either direction. A reciprocity
number computed from chemical synapses alone is not a measurement of how mutually coupled this
nervous system is; it is a measurement of one of its two wiring systems.

**The electrical layer is not a copy of the chemical one, and the sign composition says so.** The
worm's chemical 2-cycles are inhibition-dominated — 371 I↔I against 69 E↔E at cell level, the result
the comparison above leads with. Among gap-coupled pairs where both partners are signed, the three
categories are nearly equal: 114 E–E, 123 E–I, 108 I–I. Whatever the electrical graph is for, it is
not a second copy of the command-interneuron mutual-inhibition motif.

**The strongest electrical coupling is not between neurons at all.** The largest gap-coupled type
pairs are ALA–CAN (802 junctions), PVD–hmc (800), PVD–hyp (800) and ALA–PVD (500): the excretory
canal cell, the head mesodermal cell, hypodermis and body-wall muscle. This is why the sign table is
dominated by the unsigned category, and it is a fact about the animal rather than a gap in the data —
in *C. elegans* the electrical network reaches well outside the nervous system. The consequence for
this layer is that any cross-species electrical comparison has to state whether end organs are in or
out; here they are in, and the neuron-to-neuron subset (1,109 pairs, 528 of them electrical only) is
reported separately so the comparison can be made either way.

**For the fly this section is empty, and that is the finding.** The MaleCNS release ships no
gap-junction table, so `load_fly()` leaves the electrical graph unset. The sim adds exactly one
electrical edge by hand — GF→TTMn, without which escape does not work at all
([Roadmap A2](20-roadmap.md)). The worm numbers above are the argument for why that omission is not
a detail: if the fly's electrical graph resembles the worm's in how much mutual coupling it carries
that the chemical graph does not, then a chemical-only fly connectome is missing a comparable share
of its recurrence, and no amount of fitting the chemical weights recovers it.

## Operator detectors: the compressed layer as output

`scripts/algo_operators.py` looks for three computational operators in the wiring of any dataset in the
IR, and reports each with the evidence that fired it. The detectors are given the graph, the cell counts
and the signs, and nothing else — no glomerulus names, no compartment tables, no "this is the mushroom
body". Writes `public/data/ir_operators.json`.

| detector | what it looks for |
|---|---|
| `expansion` | a layer whose cells each sample a few cells of a common, much smaller input pool |
| `normalization` | one cell, or a pair, that reads a whole population and writes back to all of it |
| `ring` | a recurrent population whose effective kernel depends only on distance around a circle, plus the groups that shift activity along it |

The test is the fly, where the answers are known and written down in [doc 28](28-algorithmic-structures.md)
by name. What the detectors return:

**The ring detector recovers the heading circuit, and names its partners.** EPG ranks first of 1,587
recurrent populations examined. Its kernel is circulant at cosine R² = **0.754** on the coordinate the
detector recovers, the top eigenvalue pair is degenerate to **0.923** and every cell has comparable
amplitude (CV 0.15) — the two pieces of evidence that separate a ring from two clusters. The kernel is
circulant **through Delta7 specifically**: each inhibitory population that the candidate both drives and
is driven by is tested on its own, and Delta7 is the one that makes the kernel a cosine. The shifter with
the most synapses back onto the ring is **PEN1+PEN2**, and its per-cell angular offsets split in both
directions (+0.19 / −0.16 rad). None of those five names was supplied.

Two honest points about it. The PEN offsets the detector measures are small — ±0.17 rad against the
±1.5 columns (≈ ±1.2 rad) that [doc 28](28-algorithmic-structures.md) measures with the protocerebral
bridge's own column tags, because a coordinate recovered from eigenvectors is not calibrated in columns
and the population median mixes both hemispheres. And the ER ring-neuron groups come out as "shifters"
too, with larger offsets (±1.1–1.4 rad); they are not shifters but landmark input, and the detector
cannot tell the difference from wiring alone, because both read the ring and write back at an offset.

Below EPG the list is 77 more candidates, led by the fan-body columnar types (hDeltaE, hDeltaG, hDeltaF,
hDeltaB, each through its own FB tangential inhibitory partner) — which is a prediction rather than a
confirmation: the same measurement that finds the known ring says the fan body has several more.

**The expansion detector returns exactly one layer in the whole fly, and it is the right one.** Of 196
candidate groups assembled into 182 layers, one passes: 2,000 Kenyon cells drawn from four subtype
groups, against a pool of **418** cells whose largest identified contributors are antennal-lobe
projection neurons (DA1_lPN, VM5d_adPN, DA2_lPN). Expansion ratio 4.78, median fan-in **7 cells per
Kenyon cell** (p10–p90: 4–9), each cell sampling 1.7% of the pool. Two details had to be right for this
to work at all, and both are stated in the code: an expansion layer arrives split into subtypes and has
to be re-assembled by shared input pool, and "input" has to exclude peers and feedback — without that
rule a Kenyon subtype's pool is half Kenyon cells and the ratio comes out at 1.07.

The sampling is **4.8× less independent than random**: two Kenyon cells' input sets overlap at Jaccard
0.041 where independent draws of the same size would give 0.0084. The random-projection story is the
right shape and quantitatively loose, which is the same conclusion doc 28 reaches from the PN-pair
correlation (0.0234 against 0.0125 shuffled) by a different route.

**The normalization detector finds 125 candidates, 86 of them inhibitory, and the famous one is not
first.** The top rows are TuTuA_1 over LC10c (reads 0.88 of the population, writes back to 0.99),
FB4H over the vDelta columnar types (0.91 / 0.96) and AOTU041 over LC10d (0.80 / 0.85) — all inhibitory,
all real gain-control candidates, none of them the mushroom body. APL appears eight times, once per
Kenyon subtype and once on the assembled layer, at 0.53 coverage in and 0.52 out. That is not the
detector failing: APL makes about one synapse per Kenyon cell (4,210 edges over 4,064 cells), so at the
≥3-synapse reconstruction threshold this graph uses, half of its coverage is invisible. The operator that
[doc 30](30-hypothesis-lab.md) finds hardest to demonstrate dynamically is also the one the threshold
hides structurally, and those two facts have the same cause.

**On the worm, all three detectors return nothing, and the thresholds are the reason the zero means
something.** Sizes scale with the dataset — a 454-cell animal has no 150-cell population — so the worm
runs at min_layer 20, min_pop 20 and ring_min_cells 5. It still examined 4 candidate layers, 4
populations and 10 recurrent populations, and rejected all of them. The rejection is reported with the
counts (`candidates_examined`) so a reader can tell "no candidates" from "candidates, all rejected";
this is the second. That is a real negative about a nervous system with no expansion layer, no global
normaliser at this resolution, and no circulant recurrent population of five or more cells — and it is
weakly powered, because the worm's cell classes are mostly singletons and a ring of four cells is
something this detector cannot see.

## Where this goes

1. **Third dataset: MICrONS mm³.** Connectivity + measured activity + a functional digital twin.
   Needs CAVE credentials, boundary-aware completeness filtering (most arbors are cut), and
   class-inferred sign. The payoff: every detected operator becomes falsifiable against real
   responses.
2. ~~**Operator detectors.**~~ Built: `scripts/algo_operators.py`, above. What is left of the item is
   the part the build showed to be harder than the detection: **telling an operator from its
   look-alike**. The ring detector cannot separate a shifter from landmark input, and the
   normalization detector cannot separate divisive gain control from subtractive feedback — both
   distinctions need dynamics or a nonlinearity, not wiring. The detectors' output is a candidate list
   for [doc 30](30-hypothesis-lab.md)'s ensembles to adjudicate, which is the pipeline as it now
   stands: measure structure, hand the ambiguity to a dynamical test.
3. **Invariant search.** Any detector that fires on worm AND fly is a candidate computational
   universal. With the operator detectors built, the first pass can be reported rather than proposed,
   and it is short:

   | structure | fly | worm |
   |---|---|---|
   | feedforward inhibition (type census) | 80% of strong E edges, z = 297 | 17%, z = 3.7 |
   | reciprocal/mutual coupling | E↔I dominant | I↔I dominant, and mostly *electrical* (above) |
   | expansion layer | 1 (Kenyon cells, ratio 4.8) | **0** of 4 candidates |
   | global normalisation cell | 125 candidates, 86 inhibitory | **0** of 4 populations |
   | ring / circulant recurrence | 78 candidates, led by EPG | **0** of 10 populations |

   **One structure fires on both, and it is the simplest one.** Feedforward inhibition is enriched
   against a degree- and sign-preserving null in both animals, three orders of magnitude apart in cell
   count. Everything larger — expansion, normalisation, rings — is fly-only at these thresholds. That
   is a candidate universal with a specific shape: the invariant is a *motif*, not an *operator*, and
   the operators may simply be what a nervous system builds once it has 10⁵ cells to spend.

   Two limits keep this from being a result yet. The worm's zeros are weakly powered (its cell classes
   are mostly singletons, so a four-cell ring is invisible to a detector that needs five), and two
   animals are not a sample. The male/female fly comparison is the same trick at smaller evolutionary
   distance and is [A6](20-roadmap.md); a third dataset is item 1 above.

See also: doc 28 for the fly circuit sections, `scripts/check_structures.py` for the
fly invariants. The IR numbers regenerate with `python3 scripts/algo_ir.py`.
