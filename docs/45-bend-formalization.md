# 45. The compiler and the male connectome, formalized in Bend

Doc 29 describes the connectome compiler as one analysis over any nervous system: a canonical
intermediate representation (cells with attributes, a CSR graph of synapse counts) and the
lowering from it to what the spiking kernel executes. Docs 05 and 06 describe that lowering
for the male CNS: a sign, a threshold and a bias per cell, a weight per edge, and the kernel
that consumes them. Until now the only statement of what the lowering *must* do was the
JavaScript that does it. This document adds a second statement, in [Bend](https://bend-lang.com):
a pure model of the IR, the compiler and the kernel's fire rule and delay line; a file of laws
about them; a file of proofs the checker accepts; and a program that runs the same functions
over the real MaleCNS tables and reproduces the shipped build's numbers.

| file | contents |
|---|---|
| `connectome.bend` | the IR (`Cell`, `Syn`, `IR`), well-formedness (`IR.row_ok`), the per-cell lowering (`Compile.sign`, `Compile.thr`, `Compile.bias`, `Compile.in_scale`), the per-edge lowering (`Compile.syn`, `Compile.row`), the kernel's integrate and fire rule (`Kernel.integrate`, `Kernel.fire`) and delay line (`Ring.step`) |
| `dataset.bend` | MaleCNS v1.0 as data: dimensions, the byte layout of `graph_w3.bin` and `neurons.bin`, the superclass and class code tables, cell decoding, IEEE 754 decoding |
| `LAWS.bend` | 34 laws over the two modules, each an open claim |
| `PROOF.bend` | their proofs; `bend PROOF.bend` prints `All terms check.` |
| `malecns.bend` | the loader: reads the tables, checks well-formedness, lowers every cell and edge with the proven functions in parallel, prints a summary |
| `scripts/bend_malecns.mjs` | writes `public/data/cellflags.bin`, computes the same summary with the JavaScript build, and diffs the two |

## What the model says

The compiled edge is symbolic. `Compile.syn` answers `CSyn{post, Cut{}}` or
`CSyn{post, Kept{count, gain}}`, and the only floating multiply happens later, in
`Weight.eval`. That is what makes the compiler's decisions provable: whether an edge survives
is a structural fact about Booleans and constructors, not about `F32`, whose arithmetic Bend's
checker does not evaluate. The gain an edge would carry (`inScale[post]` times the
presynaptic cell's inhibitory gain and output gain) is resolved before compiling, so the
per-edge function sees a `RSyn{syn, cell, gain}` and the laws quantify over the cell's
attributes one field at a time.

The kernel's fire rule is written so that its two decisions, "inside the refractory
period" and "at threshold", are Booleans handed to a helper; the laws then assume what those
Booleans are and state what follows. The delay line is a list of spike lists that delivers
its front and enqueues at its back, the ring of `lif.c` step 1 without the modular index.

## The laws

Well-formed rows. The empty row is well-formed; the tail of a well-formed row is well-formed
(a loader may check edge by edge); every target of a well-formed row is a cell index. A row
is well-formed when its targets are strictly ascending, every target is below N and every
count reaches the reconstruction threshold. Self loops are allowed: the male CNS has 54.

One edge. An edge onto a sensory cell is cut, whatever its count, when presynaptic gain
control is off. An edge below the threshold is cut, whatever its target. An edge at or above
the threshold onto a non-sensory cell is kept with exactly its count and its gain. With
presynaptic gain control on, an edge onto a sensory cell that reaches the threshold is kept.
Compiling never moves an edge.

One row. A compiled row has as many entries as its source, targeting the same cells in the
same order. In every row, every edge whose target is sensory is cut. A delivered spike reaches
exactly the kept targets, in order. The compiled graph has one row per presynaptic cell.

Per-cell physiology. With neuromodulation on, an octopaminergic cell's sign is zero whatever
its transmitter or graded prediction says; any other cell carries its graded sign; without a
graded prediction the sign is the transmitter table's. Kenyon cells get the raised threshold
and no one else does; lamina cells get the resting bias and no one else does. A cut edge
evaluates to no weight; a kept edge to count times gain.

The kernel. A neuron inside its refractory period never fires: it is held at reset, its timer
counts down one step, its spike count is unchanged. Outside it, a membrane at threshold plus
the cell's extra threshold fires, is reset, gets a full refractory period and one more spike.
Below threshold the neuron is left exactly as it is. The delay line is first-in first-out: a
spike list enqueued behind k slots is delivered after exactly k steps, whatever is enqueued
after it.

The male connectome. The graph table's layout (two words, N + 1 offsets, E targets, E
counts) accounts for exactly the 63,726,728 bytes of `graph_w3.bin`, and the neuron table's for
the 5,449,034 bytes of `neurons.bin`; the checker computes both from N = 165,122 and
E = 10,511,038. The code tables put `vnc_motor` in the cord, `ol_intrinsic` in the optic lobe,
`cb_intrinsic` in the central brain and `cb_sensory` among the sensory superclasses. Decoding a
cell's bytes puts the sensory bit where the compiler reads it.

## The proofs

Bend has no tactics. A law with computing sides (`syn_onto_sensory_is_cut`, every per-cell
law, the layout constants) is proven by reflexivity once its arguments are constructors. A
law with a hypothesis about a stuck Boolean (`U32.is_ge(count, minSyn) == False`) is proven
by rewriting that Boolean into the goal and letting it compute. Row laws are inductions on
the row with the induction hypothesis rewritten into the goal. `row_ok_tail` and
`row_ok_bounded` need three Boolean lemmas (a true conjunction has true conjuncts, and the
converse) and a refutation of `False == True` through a type-valued discriminator. `ring_fifo`
needs associativity of list concatenation, and is stated with an arbitrary suffix so that the
induction goes through: the queue grows by one empty slot per step.

## The run on the animal

`malecns.bend` reads the five tables (`graph_w3.bin`, `neurons.bin`, `ntsign.bin`,
`neuron_size.bin`, and `cellflags.bin`, one byte per cell with the sensory, motor, Kenyon,
lamina, octopaminergic and region bits that the JavaScript predicates on the string tables
produce), checks the two file sizes against the layout, decodes the cells, checks that the
flag bits the code tables can re-derive agree with them, compiles the per-cell sign, input
scale, threshold and bias, then streams the graph in 21 blocks of 8192 presynaptic rows. Each
block is read as 64 chunks of 128 rows; the decoding of the bytes, the resolution of every
target against the cell table, the well-formedness check, the compile and the counting all
run in the parallel fork tree over the chunks, with the cell table forked read-only into every
lane (`Array.fork`, the one unsafe primitive the program uses). The reads themselves are
sequential on the event loop.

With the calibrated parameters (`brain_params.json`: minSyn 6, neuromodulation on,
presynaptic gain control off, sizeAlpha 0.572, inhGain 0.577):

| quantity | value |
|---|---|
| cells | 165,122; 15,912 sensory, 1,019 motor or efferent, 4,064 Kenyon, 8,883 lamina, 37 octopaminergic |
| compiled signs | 105,923 excitatory, 58,645 inhibitory, 554 zero (517 unsigned plus the 37 octopaminergic cells) |
| regional median volume | optic lobe 1.446e8, central brain 3.251e8, nerve cord 5.427e8 |
| input scale of exactly 1 | 82,665 cells (at or below their regional median, or unmeasured) |
| rows | 165,122, all well-formed; 54 self loops |
| edges | 10,511,038: 5,016,094 kept, 5,313,640 below 6 synapses, 181,304 onto sensory cells |
| synapses on kept edges | 82,907,794 of 104,213,652 |
| time | about 2.2 s, of which the per-cell pass is 0.2 s |

`node scripts/bend_malecns.mjs check` builds the binary if the sources changed, runs it,
and compares every line against the same quantities computed with `brainScales`,
`modulatorySign` and `writeGraph`'s edge rule from `src/`. All 39 keys agree; the three
medians are the same float32 printed by two runtimes.

## What this does and does not establish

It establishes that the edge rule, the per-cell rules and the delay line the JavaScript
implements have a precise statement, that the statement has the consequences the docs claim
(no spike anywhere in the graph reaches a sensory cell; the compiler never moves, adds or
drops an entry; a refractory neuron is silent), and that running the stated rules over the
real tables gives the shipped build's numbers. The proofs are about `connectome.bend`; the
JavaScript is checked against it by the run, not by the checker. The kernel model covers the
fire rule and the delay line, not the membrane integration, whose arithmetic is opaque to the
checker and is compared bit for bit elsewhere (doc 33's twin audit). `Compile.in_scale`, the
sort behind the medians and `F32.from_bits` are run and cross-checked, not proven.

Two runtime facts worth recording. The compile of a block parallelises about six-fold across
the fork tree (185 ms to 31 ms for the first block), but the byte lists the file effects build
on the event loop slow down as more worker threads are added, so the wall time is the same at
one thread and at twelve. And `Array.fork` is how the runtime shares a table across lanes; the
checker flags every def that touches it, which is the correct reading: the proven functions
are the ones that do not.

```sh
bend PROOF.bend                        # the gate: every law proven
bend malecns.bend -o malecns && ./malecns
node scripts/bend_malecns.mjs check    # the same numbers from the JavaScript build
```
