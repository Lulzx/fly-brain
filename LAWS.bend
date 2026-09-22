# Laws of the connectome compiler and of the male connectome's packing.
#
# Each law is an open claim about connectome.bend or dataset.bend; PROOF.bend closes it.
# `bend PROOF.bend` is the gate. The laws say what the lowering from the IR to the kernel
# must do (docs/05-brain-model.md, docs/29-connectome-compiler.md), in the order the code
# does it: the shape of a well-formed row, the per-edge decisions, their consequences for a
# whole row and a whole graph, the per-cell physiology, the kernel's fire rule and delay
# line, and the byte layout the loader assumes for MaleCNS v1.0.
import Base
import ./connectome.bend as C
import ./dataset.bend as D

# ================================================================= 1. Well-formed rows

# LAW: the empty row is well-formed for any cell count and threshold.
law row_ok_nil:
  for +n: U32
  for +minW: U32
  {C.IR.row_ok(Nil{}, n, minW) == True{} : Bool}

# LAW: well-formedness is closed under dropping the first edge: the tail of a well-formed
# row is a well-formed row. This is what lets a loader check a row edge by edge.
law row_ok_tail:
  for s: C.Syn
  for +row: List<&2, C.Syn>
  for +n: U32
  for +minW: U32
  for e: {C.IR.row_ok(s <> row, n, minW) == True{} : Bool}
  {C.IR.row_ok(row, n, minW) == True{} : Bool}

# LAW: every target of a well-formed row is a cell index below n.
law row_ok_bounded:
  for +row: List<&2, C.Syn>
  for +n: U32
  for +minW: U32
  for +e: {C.IR.row_ok(row, n, minW) == True{} : Bool}
  {C.IR.row_bounded(row, n) == True{} : Bool}

# ================================================================= 2. One edge

# LAW: an edge onto a sensory cell is cut, whatever its count, when presynaptic gain control
# is off. Sensory neurons fire only from their receptors.
law syn_onto_sensory_is_cut:
  for +minSyn: U32
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for motor: Bool
  for kenyon: Bool
  for lamina: Bool
  for oa: Bool
  for +post: U32
  for +count: U32
  for gain: F32
  {C.Compile.syn(minSyn, False{}, C.RSyn{C.Syn{post, count}, C.Cell{nt, side, region, True{}, motor, kenyon, lamina, oa}, gain})
    == C.CSyn{post, C.Cut{}} : C.CSyn}

# LAW: an edge with fewer synapses than the reconstruction threshold is cut, whatever its
# target and whether or not presynaptic gain control is on.
law syn_below_min_is_cut:
  for +minSyn: U32
  for keep: Bool
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for sensory: Bool
  for motor: Bool
  for kenyon: Bool
  for lamina: Bool
  for oa: Bool
  for +post: U32
  for +count: U32
  for gain: F32
  for e: {U32.is_ge(count, minSyn) == False{} : Bool}
  {C.Compile.syn(minSyn, keep, C.RSyn{C.Syn{post, count}, C.Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}, gain})
    == C.CSyn{post, C.Cut{}} : C.CSyn}

# LAW: an edge that reaches the threshold and lands on a non-sensory cell is kept with its
# count and its gain, and nothing else is done to it.
law syn_kept:
  for +minSyn: U32
  for keep: Bool
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for motor: Bool
  for kenyon: Bool
  for lamina: Bool
  for oa: Bool
  for +post: U32
  for +count: U32
  for +gain: F32
  for e: {U32.is_ge(count, minSyn) == True{} : Bool}
  {C.Compile.syn(minSyn, keep, C.RSyn{C.Syn{post, count}, C.Cell{nt, side, region, False{}, motor, kenyon, lamina, oa}, gain})
    == C.CSyn{post, C.Kept{count, gain}} : C.CSyn}

# LAW: with presynaptic gain control on (an inhibitory presynaptic cell and preInh > 0), an
# edge onto a sensory cell that reaches the threshold is kept: the kernel needs it to divide
# the sensory cell's release.
law syn_kept_onto_sensory_under_preinh:
  for +minSyn: U32
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for motor: Bool
  for kenyon: Bool
  for lamina: Bool
  for oa: Bool
  for +post: U32
  for +count: U32
  for +gain: F32
  for e: {U32.is_ge(count, minSyn) == True{} : Bool}
  {C.Compile.syn(minSyn, True{}, C.RSyn{C.Syn{post, count}, C.Cell{nt, side, region, True{}, motor, kenyon, lamina, oa}, gain})
    == C.CSyn{post, C.Kept{count, gain}} : C.CSyn}

# LAW: compiling never moves an edge: the compiled edge targets the cell the entry names.
law syn_preserves_post:
  for +minSyn: U32
  for keep: Bool
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for sensory: Bool
  for motor: Bool
  for kenyon: Bool
  for lamina: Bool
  for oa: Bool
  for +post: U32
  for +count: U32
  for gain: F32
  {C.CSyn.post(C.Compile.syn(minSyn, keep, C.RSyn{C.Syn{post, count}, C.Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}, gain}))
    == post : U32}

# ================================================================= 3. One row

# LAW: a compiled row has exactly as many entries as the row it came from: the compiler
# reweights edges, it never adds or removes one (a dropped edge is a Cut entry).
law row_length:
  for +row: List<&2, C.RSyn>
  for +minSyn: U32
  for +keep: Bool
  {List.length(&2, C.CSyn, C.Compile.row(row, minSyn, keep)) == List.length(&2, C.RSyn, row) : Nat}

# LAW: a compiled row targets the same cells in the same order as its source row.
law row_posts:
  for +row: List<&2, C.RSyn>
  for +minSyn: U32
  for +keep: Bool
  {C.CRow.posts(C.Compile.row(row, minSyn, keep)) == C.Row.posts(row) : List<&2, U32>}

# LAW: in every row, every edge whose target is sensory is cut (presynaptic gain control
# off). No spike from anywhere in the graph can raise a sensory cell's conductance.
law row_sensory_cut:
  for +row: List<&2, C.RSyn>
  for +minSyn: U32
  {C.Row.sensory_cut(row, minSyn) == True{} : Bool}

# LAW: a delivered spike reaches exactly the kept targets of the compiled row, in order.
law deliver_reaches_kept:
  for +row: List<&2, C.CSyn>
  for +sign: F32
  {C.Deliver.targets(C.Deliver.row(row, sign)) == C.CRow.kept_posts(row) : List<&2, U32>}

# ================================================================= 4. The whole graph

# LAW: the compiled graph has one row per presynaptic cell, like the IR.
law rows_length:
  for +rows: List<&2, List<&2, C.Syn>>
  for +cells: List<&2, C.Cell>
  for +signs: List<&2, F32>
  for +inScale: List<&2, F32>
  for +p: C.Params
  for +j: U32
  {List.length(&2, List<&2, C.CSyn>, C.Compile.rows(rows, cells, signs, inScale, p, j))
    == List.length(&2, List<&2, C.Syn>, rows) : Nat}

# ================================================================= 5. Per-cell physiology

# LAW: with neuromodulation on, an octopaminergic cell's fast synapses leave the graph:
# its sign is zero whatever its transmitter or graded prediction says.
law sign_oa_silenced:
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for sensory: Bool
  for motor: Bool
  for kenyon: Bool
  for lamina: Bool
  for graded: Maybe<&2, F32>
  {C.Compile.sign(True{}, C.Cell{nt, side, region, sensory, motor, kenyon, lamina, True{}}, graded) == 0.0 : F32}

# LAW: a cell that is not octopaminergic carries its graded sign, neuromodulation on or off.
law sign_graded:
  for neuromod: Bool
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for sensory: Bool
  for motor: Bool
  for kenyon: Bool
  for lamina: Bool
  for +g: F32
  {C.Compile.sign(neuromod, C.Cell{nt, side, region, sensory, motor, kenyon, lamina, False{}}, Some{g}) == g : F32}

# LAW: without a graded prediction, the sign is the transmitter table's.
law sign_table:
  for +nt: C.NT
  for side: C.Side
  for region: C.Region
  for sensory: Bool
  for motor: Bool
  for kenyon: Bool
  for lamina: Bool
  for oa: Bool
  {C.Compile.sign(False{}, C.Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}, None{}) == C.NT.sign(nt) : F32}

# LAW: Kenyon cells get the raised threshold; every other cell gets none.
law kenyon_threshold:
  for +kc: F32
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for sensory: Bool
  for motor: Bool
  for lamina: Bool
  for oa: Bool
  {C.Compile.thr(kc, C.Cell{nt, side, region, sensory, motor, True{}, lamina, oa}) == kc : F32}

law other_threshold:
  for kc: F32
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for sensory: Bool
  for motor: Bool
  for lamina: Bool
  for oa: Bool
  {C.Compile.thr(kc, C.Cell{nt, side, region, sensory, motor, False{}, lamina, oa}) == 0.0 : F32}

# LAW: lamina monopolar cells get the resting bias; every other cell gets none.
law lamina_bias:
  for +lb: F32
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for sensory: Bool
  for motor: Bool
  for kenyon: Bool
  for oa: Bool
  {C.Compile.bias(lb, C.Cell{nt, side, region, sensory, motor, kenyon, True{}, oa}) == lb : F32}

law other_bias:
  for lb: F32
  for nt: C.NT
  for side: C.Side
  for region: C.Region
  for sensory: Bool
  for motor: Bool
  for kenyon: Bool
  for oa: Bool
  {C.Compile.bias(lb, C.Cell{nt, side, region, sensory, motor, kenyon, False{}, oa}) == 0.0 : F32}

# LAW: a cut edge evaluates to no weight at all, and a kept edge to count times gain.
law weight_of_cut:
  {C.Weight.eval(C.Cut{}) == 0.0 : F32}

law weight_of_kept:
  for +count: U32
  for +gain: F32
  {C.Weight.eval(C.Kept{count, gain}) == F32.mul(U32.to_f32(count), gain) : F32}

# ================================================================= 6. The kernel

# LAW: a neuron inside its refractory period never fires: it is held at reset, its timer
# counts down by one step, and its spike count is unchanged.
law refractory_never_fires:
  for +dt: F32
  for vRest: F32
  for vThresh: F32
  for +vReset: F32
  for tRef: F32
  for kM: F32
  for dE: F32
  for eExc: F32
  for eInh: F32
  for cE: F32
  for cI: F32
  for v: F32
  for +gE: F32
  for +gI: F32
  for +refr: F32
  for +count: Nat
  for thr: F32
  for e: {F32.is_gt(refr, 0.0) == True{} : Bool}
  {C.Kernel.fire(C.Dyn{dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI}, C.Neuron{v, gE, gI, refr, count}, thr)
    == (C.Neuron{vReset, gE, gI, F32.sub(refr, dt), count}, False{}) : C.Neuron & Bool}

# LAW: a neuron outside its refractory period whose membrane reaches threshold plus its
# extra threshold fires: reset, a full refractory period, one more spike counted.
law fires_at_threshold:
  for dt: F32
  for vRest: F32
  for +vThresh: F32
  for +vReset: F32
  for +tRef: F32
  for kM: F32
  for dE: F32
  for eExc: F32
  for eInh: F32
  for cE: F32
  for cI: F32
  for +v: F32
  for +gE: F32
  for +gI: F32
  for +refr: F32
  for +count: Nat
  for +thr: F32
  for e1: {F32.is_gt(refr, 0.0) == False{} : Bool}
  for e2: {F32.is_ge(v, F32.add(vThresh, thr)) == True{} : Bool}
  {C.Kernel.fire(C.Dyn{dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI}, C.Neuron{v, gE, gI, refr, count}, thr)
    == (C.Neuron{vReset, gE, gI, tRef, 1n+count}, True{}) : C.Neuron & Bool}

# LAW: a neuron outside its refractory period and below threshold is left exactly as it is.
law silent_below_threshold:
  for dt: F32
  for vRest: F32
  for +vThresh: F32
  for vReset: F32
  for tRef: F32
  for kM: F32
  for dE: F32
  for eExc: F32
  for eInh: F32
  for cE: F32
  for cI: F32
  for +v: F32
  for +gE: F32
  for +gI: F32
  for +refr: F32
  for +count: Nat
  for +thr: F32
  for e1: {F32.is_gt(refr, 0.0) == False{} : Bool}
  for e2: {F32.is_ge(v, F32.add(vThresh, thr)) == False{} : Bool}
  {C.Kernel.fire(C.Dyn{dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI}, C.Neuron{v, gE, gI, refr, count}, thr)
    == (C.Neuron{v, gE, gI, refr, count}, False{}) : C.Neuron & Bool}

# LAW: the delay line is a first-in first-out queue: a spike list enqueued behind k slots
# is delivered after exactly k steps, whatever is enqueued after it.
law ring_fifo:
  for +pre: List<&2, List<&2, U32>>
  for +s: List<&2, U32>
  for +post: List<&2, List<&2, U32>>
  {C.Ring.drain(List.length(&2, List<&2, U32>, pre), C.Ring.cat(pre, s <> post)) == s : List<&2, U32>}

# ================================================================= 7. The male connectome

# LAW: the graph table's layout accounts for exactly the bytes of public/data/graph_w3.bin
# (63,726,728), and the neuron table's for those of public/data/neurons.bin (5,449,034).
# The loader checks these two numbers against the files at run time; here they are pinned
# to the dimensions and the field widths the pipeline documents.
law graph_layout:
  {D.MaleCNS.graph_bytes() == 63726728 : U32}

law neurons_layout:
  {D.MaleCNS.neurons_bytes() == 5449034 : U32}

# LAW: the code tables. vnc_motor (23) is nerve cord, ol_intrinsic (11) is optic lobe,
# cb_intrinsic (4) is central brain; cb_sensory (6) is sensory and cb_intrinsic is not.
law region_of_vnc_motor:
  {D.Superclass.region(23) == C.Cord{} : C.Region}

law region_of_ol_intrinsic:
  {D.Superclass.region(11) == C.Optic{} : C.Region}

law region_of_cb_intrinsic:
  {D.Superclass.region(4) == C.Central{} : C.Region}

law cb_sensory_is_sensory:
  {D.Superclass.is_sensory(6) == True{} : Bool}

law cb_intrinsic_is_not_sensory:
  {D.Superclass.is_sensory(4) == False{} : Bool}

# LAW: decoding a cell's bytes puts each flag bit where the compiler reads it.
law cell_of_bytes_sensory:
  for +flags: U32
  for nt: U32
  for side: U32
  {C.Cell.sensory(D.Cell.of_bytes(flags, nt, side)) == D.Flags.bit(flags, 0n) : Bool}
