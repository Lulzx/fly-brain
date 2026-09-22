# The connectome compiler, formalized.
#
# This module is the pure core of the compiler described in docs/29-connectome-compiler.md
# and implemented in src/lif.js, src/lifwasm.js (writeGraph) and src/brainmodel.js: a
# connectome arrives as a canonical intermediate representation (cells with attributes, a
# CSR graph of synapse counts) and is lowered into what the spiking kernel executes (a sign,
# a threshold and a bias per cell, a weight per edge). Everything here is total, first-order
# and free of IO, so that LAWS.bend can state what the lowering must do and PROOF.bend can
# prove it. malecns.bend runs the same functions over the real male CNS tables.
#
# Conventions. Indices and synapse counts are U32, as in the packed tables. Gains are F32
# and stay symbolic in the compiled edge (`Kept{count, gain}`): the decision the compiler
# makes about an edge is structural, so it is provable, and `Weight.eval` is the only place a
# floating multiply happens.
import Base

# =============================================================================== 1. The IR

# Transmitter, in the order of meta.json "nts":
# unknown, acetylcholine, gaba, glutamate, dopamine, serotonin, octopamine, histamine.
type NT is Data:
  NTUnknown{}
  ACh{}
  GABA{}
  Glu{}
  DA{}
  Ser{}
  OA{}
  His{}

# EXC_SIGN in src/lif.js: [0, 1, -1, -1, 1, 1, 1, -1]. Unknown is 0 (no invented sign);
# monoamines are excitatory as in Shiu et al. unless a graded sign overrides.
def NT.sign(nt: NT) -> F32:
  match nt:
    case NTUnknown{}:
      0.0
    case ACh{}:
      1.0
    case GABA{}:
      F32.neg(1.0)
    case Glu{}:
      F32.neg(1.0)
    case DA{}:
      1.0
    case Ser{}:
      1.0
    case OA{}:
      1.0
    case His{}:
      F32.neg(1.0)

def NT.table() -> List<&2, NT>:
  [NTUnknown{}, ACh{}, GABA{}, Glu{}, DA{}, Ser{}, OA{}, His{}]

def NT.of_code.fin(m: Maybe<&2, NT>) -> NT:
  match m:
    case None{}:
      NTUnknown{}
    case Some{nt}:
      nt

# the transmitter byte of neurons.bin
def NT.of_code(code: U32) -> NT:
  NT.of_code.fin(List.get(&2, NT, NT.table(), U32.to_nat(code)))

# side byte of neurons.bin: 0 unknown, 1 left, 2 right, 3 midline/other
type Side is Data:
  SideUnknown{}
  Left{}
  Right{}
  Midline{}

def Side.of_code.fin(m: Maybe<&2, Side>) -> Side:
  match m:
    case None{}:
      SideUnknown{}
    case Some{s}:
      s

def Side.of_code(code: U32) -> Side:
  Side.of_code.fin(List.get(&2, Side, [SideUnknown{}, Left{}, Right{}, Midline{}], U32.to_nat(code)))

# The three regions whose median neuron volume is the reference for PSP scaling
# (REGION_OF in src/ratenet.js): 0 optic lobe, 1 central brain, 2 nerve cord.
type Region is Data:
  Optic{}
  Central{}
  Cord{}

def Region.of_code.fin(m: Maybe<&2, Region>) -> Region:
  match m:
    case None{}:
      Central{}
    case Some{r}:
      r

def Region.of_code(code: U32) -> Region:
  Region.of_code.fin(List.get(&2, Region, [Optic{}, Central{}, Cord{}], U32.to_nat(code)))

def Region.code(r: Region) -> U32:
  match r:
    case Optic{}:
      0
    case Central{}:
      1
    case Cord{}:
      2

# One cell of the IR: the attributes the compiler reads. `sensory` and `motor` are the
# flow-hierarchy pins of docs/29; `kenyon`, `lamina` and `oa` are the three cell classes
# whose physiology the uniform LIF misses (docs/05-brain-model.md).
type Cell is Data:
  Cell{nt: NT, side: Side, region: Region, sensory: Bool, motor: Bool, kenyon: Bool, lamina: Bool, oa: Bool}

def Cell.unknown() -> Cell:
  Cell{NTUnknown{}, SideUnknown{}, Central{}, False{}, False{}, False{}, False{}, False{}}

def Cell.sensory(c: Cell) -> Bool:
  match c:
    case Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}:
      sensory

def Cell.region(c: Cell) -> Region:
  match c:
    case Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}:
      region

def Cell.nt(c: Cell) -> NT:
  match c:
    case Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}:
      nt

# One CSR entry: the postsynaptic cell and the synapse count.
type Syn is Data:
  Syn{post: U32, count: U32}

def Syn.post(s: Syn) -> U32:
  match s:
    case Syn{post, count}:
      post

def Syn.count(s: Syn) -> U32:
  match s:
    case Syn{post, count}:
      count

# The IR: n cells, their attributes, and one row of outgoing synapses per presynaptic cell.
type IR is Data:
  IR{n: U32, cells: List<&2, Cell>, rows: List<&2, List<&2, Syn>>}

# ----------------------------------------------------------------- well-formedness
# A row is well-formed for n cells and a reconstruction threshold minW when every target is
# a cell index, every count reaches the threshold, and the targets are strictly ascending
# (no duplicate edges; self loops are allowed, the male CNS has 54 of them).
def IR.row_ok.go(row: List<&2, Syn>, +n: U32, +minW: U32, +prev: U32) -> Bool:
  match row:
    case Nil{}:
      True{}
    case Syn{+post, count} <> t:
      Bool.and(U32.is_lt(prev, post), Bool.and(U32.is_lt(post, n), Bool.and(U32.is_ge(count, minW), IR.row_ok.go(t, n, minW, post))))

def IR.row_ok(row: List<&2, Syn>, +n: U32, +minW: U32) -> Bool:
  match row:
    case Nil{}:
      True{}
    case Syn{+post, count} <> t:
      Bool.and(U32.is_lt(post, n), Bool.and(U32.is_ge(count, minW), IR.row_ok.go(t, n, minW, post)))

def IR.rows_ok(rows: List<&2, List<&2, Syn>>, +n: U32, +minW: U32) -> Bool:
  match rows:
    case Nil{}:
      True{}
    case r <> t:
      Bool.and(IR.row_ok(r, n, minW), IR.rows_ok(t, n, minW))

# every target of a row is below n
def IR.row_bounded(row: List<&2, Syn>, +n: U32) -> Bool:
  match row:
    case Nil{}:
      True{}
    case Syn{post, count} <> t:
      Bool.and(U32.is_lt(post, n), IR.row_bounded(t, n))

def IR.ok(ir: IR, +minW: U32) -> Bool:
  match ir:
    case IR{+n, cells, +rows}:
      Bool.and(Nat.is_eq(List.length(&2, Cell, cells), U32.to_nat(n)),
        Bool.and(Nat.is_eq(List.length(&2, List<&2, Syn>, rows), U32.to_nat(n)), IR.rows_ok(rows, n, minW)))

# ============================================================== 2. Compiler parameters

# The active parameters of docs/05 and public/data/brain_params.json that the lowering
# reads. Dynamics-only parameters (dt, tau, reversal potentials) live in Dyn below.
type Params is Data:
  Params{minSyn: U32, neuromod: Bool, preInh: Bool, kcThreshold: F32, laminaBias: F32,
    inhGain: F32, wSyn: F32, sizeAlpha: F32, maxSizeScale: F32, boostCap: F32}

# ==================================================================== 3. Per-cell lowering

# The sign a cell's spikes carry into its targets. A graded sign from the per-synapse
# transmitter predictions (ntsign.bin) overrides the transmitter table; with neuromodulation
# on, octopaminergic cells act only through slow release, so their fast synapses leave the
# graph (modulatorySign in src/brainmodel.js).
def Compile.sign.graded(nt: NT, graded: Maybe<&2, F32>) -> F32:
  match graded:
    case None{}:
      NT.sign(nt)
    case Some{g}:
      g

def Compile.sign.oa(nt: NT, oa: Bool, graded: Maybe<&2, F32>) -> F32:
  match oa:
    case True{}:
      0.0
    case False{}:
      Compile.sign.graded(nt, graded)

def Compile.sign(neuromod: Bool, cell: Cell, graded: Maybe<&2, F32>) -> F32:
  match neuromod cell:
    case True{} Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}:
      Compile.sign.oa(nt, oa, graded)
    case False{} Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}:
      Compile.sign.graded(nt, graded)

# Kenyon cells need coincident input from several projection neurons: a raised threshold.
def Compile.thr(kcThreshold: F32, cell: Cell) -> F32:
  match cell:
    case Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}:
      match kenyon:
        case True{}:
          kcThreshold
        case False{}:
          0.0

# Lamina monopolar cells L1-L5 are graded neurons with a depolarised rest: a tonic bias.
def Compile.bias(laminaBias: F32, cell: Cell) -> F32:
  match cell:
    case Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}:
      match lamina:
        case True{}:
          laminaBias
        case False{}:
          0.0

# PSP scale by (volume / regional median)^-alpha, clamped (brainScales in src/brainmodel.js):
#   s = size > 0 ? clamp(size / ref, 1 / maxSizeScale, maxSizeScale) : 1
#   inScale = min(boostCap, s ^ -alpha)
def Compile.in_scale.s(sizeAlpha: F32, boostCap: F32, s: F32) -> F32:
  F32.min(boostCap, F32.pow(s, F32.neg(sizeAlpha)))

def Compile.in_scale(sizeAlpha: F32, +maxSizeScale: F32, boostCap: F32, +size: F32, ref: F32) -> F32:
  Compile.in_scale.s(sizeAlpha, boostCap,
    Bool.pick(F32, F32.is_gt(size, 0.0), F32.clamp(F32.div(size, ref), F32.div(1.0, maxSizeScale), maxSizeScale), 1.0))

# The multiplier every outgoing edge of a presynaptic cell carries: the inhibitory gain when
# the cell's sign is negative, times the type or per-neuron output gain (1 when none).
def Compile.pre_gain(inhGain: F32, sign: F32, outScale: F32) -> F32:
  F32.mul(Bool.pick(F32, F32.is_lt(sign, 0.0), inhGain, 1.0), outScale)

# Presynaptic gain control keeps the inhibitory edges onto sensory cells (preInh > 0 and a
# negative presynaptic sign); otherwise nothing onto a sensory cell is kept.
def Compile.keep_onto_sensory(preInh: Bool, sign: F32) -> Bool:
  Bool.and(preInh, F32.is_lt(sign, 0.0))

# ==================================================================== 4. Per-edge lowering

# A compiled edge: either cut, or kept with the count and the gain it will be multiplied by.
type Weight is Data:
  Cut{}
  Kept{count: U32, gain: F32}

def Weight.eval(w: Weight) -> F32:
  match w:
    case Cut{}:
      0.0
    case Kept{count, gain}:
      F32.mul(U32.to_f32(count), gain)

def Weight.is_cut(w: Weight) -> Bool:
  match w:
    case Cut{}:
      True{}
    case Kept{count, gain}:
      False{}

type CSyn is Data:
  CSyn{post: U32, w: Weight}

def CSyn.post(c: CSyn) -> U32:
  match c:
    case CSyn{post, w}:
      post

def CSyn.weight(c: CSyn) -> Weight:
  match c:
    case CSyn{post, w}:
      w

# A resolved synapse: the CSR entry beside its postsynaptic cell and the gain the compiler
# multiplies the count by if it keeps the edge (inScale[post] * preGain * edgeGain).
type RSyn is Data:
  RSyn{syn: Syn, cell: Cell, gain: F32}

def RSyn.post(r: RSyn) -> U32:
  match r:
    case RSyn{Syn{post, count}, cell, gain}:
      post

def RSyn.sensory(r: RSyn) -> Bool:
  match r:
    case RSyn{syn, cell, gain}:
      Cell.sensory(cell)

# The reconstruction-threshold gate: an edge below minSyn is cut.
def Compile.big(+post: U32, +count: U32, big: Bool, gain: F32) -> CSyn:
  match big:
    case False{}:
      CSyn{post, Cut{}}
    case True{}:
      CSyn{post, Kept{count, gain}}

# The sensory gate: an edge onto a sensory cell is cut, since the cell is Poisson-forced and
# the synapse could have no effect, unless presynaptic gain control needs it kept.
def Compile.gate(+post: U32, +count: U32, sensory: Bool, keep: Bool, big: Bool, gain: F32) -> CSyn:
  match sensory:
    case False{}:
      Compile.big(post, count, big, gain)
    case True{}:
      match keep:
        case True{}:
          Compile.big(post, count, big, gain)
        case False{}:
          CSyn{post, Cut{}}

# One edge. This is the function writeGraph runs once per CSR entry.
def Compile.syn(+minSyn: U32, +keep: Bool, r: RSyn) -> CSyn:
  match r:
    case RSyn{Syn{+post, +count}, Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}, gain}:
      Compile.gate(post, count, sensory, keep, U32.is_ge(count, minSyn), gain)

# One row: every outgoing edge of one presynaptic cell.
def Compile.row(row: List<&2, RSyn>, +minSyn: U32, +keep: Bool) -> List<&2, CSyn>:
  match row:
    case Nil{}:
      Nil{}
    case r <> t:
      Compile.syn(minSyn, keep, r) <> Compile.row(t, minSyn, keep)

# ------------------------------------------------------------- row-level observations
def Row.posts(row: List<&2, RSyn>) -> List<&2, U32>:
  match row:
    case Nil{}:
      Nil{}
    case r <> t:
      RSyn.post(r) <> Row.posts(t)

def CRow.posts(row: List<&2, CSyn>) -> List<&2, U32>:
  match row:
    case Nil{}:
      Nil{}
    case c <> t:
      CSyn.post(c) <> CRow.posts(t)

# Holds when every compiled edge whose target is sensory has been cut. `keep` is False here:
# the law is about the kernel without presynaptic gain control.
def Row.sensory_cut(row: List<&2, RSyn>, +minSyn: U32) -> Bool:
  match row:
    case Nil{}:
      True{}
    case +r <> t:
      Bool.and(Bool.or(Bool.not(RSyn.sensory(r)), Weight.is_cut(CSyn.weight(Compile.syn(minSyn, False{}, r)))),
        Row.sensory_cut(t, minSyn))

# ================================================================ 5. IR-level lowering

# Resolving a row against the cell table with list lookups. This is the reference
# implementation the laws talk about; malecns.bend resolves against arrays instead.
def Cells.at.fin(m: Maybe<&2, Cell>) -> Cell:
  match m:
    case None{}:
      Cell.unknown()
    case Some{c}:
      c

def Cells.at(cells: List<&2, Cell>, post: U32) -> Cell:
  Cells.at.fin(List.get(&2, Cell, cells, U32.to_nat(post)))

def Gains.at.fin(m: Maybe<&2, F32>) -> F32:
  match m:
    case None{}:
      1.0
    case Some{g}:
      g

def Gains.at(gains: List<&2, F32>, post: U32) -> F32:
  Gains.at.fin(List.get(&2, F32, gains, U32.to_nat(post)))

def Compile.resolve(row: List<&2, Syn>, +cells: List<&2, Cell>, +inScale: List<&2, F32>, +preGain: F32) -> List<&2, RSyn>:
  match row:
    case Nil{}:
      Nil{}
    case Syn{+post, count} <> t:
      RSyn{Syn{post, count}, Cells.at(cells, post), F32.mul(Gains.at(inScale, post), preGain)} <> Compile.resolve(t, cells, inScale, preGain)

# The whole graph: row j is resolved and compiled with the gain and gate of its
# presynaptic cell j. `signs` and `inScale` are the per-cell outputs of section 3.
def Compile.rows(rows: List<&2, List<&2, Syn>>, +cells: List<&2, Cell>, +signs: List<&2, F32>, +inScale: List<&2, F32>, +p: Params, +j: U32) -> List<&2, List<&2, CSyn>>:
  match rows:
    case Nil{}:
      Nil{}
    case r <> t:
      match p:
        case Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
          +s = Gains.at(signs, j)
          Compile.row(Compile.resolve(r, cells, inScale, Compile.pre_gain(inhGain, s, 1.0)), minSyn, Compile.keep_onto_sensory(preInh, s))
            <> Compile.rows(t, cells, signs, inScale, p, (j + 1 : U32))

# ==================================================================== 6. The kernel

# One neuron's state in the spiking kernel (src/wasm/lif.c): membrane potential, excitatory
# and inhibitory conductance, refractory timer, spike count.
type Neuron is Data:
  Neuron{v: F32, gE: F32, gI: F32, refr: F32, count: Nat}

def Neuron.count(n: Neuron) -> Nat:
  match n:
    case Neuron{v, gE, gI, refr, count}:
      count

def Neuron.v(n: Neuron) -> F32:
  match n:
    case Neuron{v, gE, gI, refr, count}:
      v

# Step constants: dt, rest, threshold, reset, refractory period, dt/tauM, exp(-dt/tauSyn),
# reversal potentials and the conductance calibrations cE = 1/(eExc - vRest), cI = 1/(vRest - eInh).
type Dyn is Data:
  Dyn{dt: F32, vRest: F32, vThresh: F32, vReset: F32, tRef: F32, kM: F32, dE: F32, eExc: F32, eInh: F32, cE: F32, cI: F32}

# Conductance-based membrane update (lif.c step 3, the `coba` branch), then synaptic decay.
def Kernel.integrate(d: Dyn, n: Neuron, bias: F32) -> Neuron:
  match d n:
    case Dyn{dt, vRest, vThresh, vReset, tRef, kM, +dE, eExc, eInh, cE, cI} Neuron{+v, +gE, +gI, refr, count}:
      dv = F32.mul(F32.add(F32.add(F32.sub(vRest, v), F32.mul(F32.mul(gE, F32.sub(eExc, v)), cE)), F32.add(F32.mul(F32.mul(gI, F32.sub(v, eInh)), cI), bias)), kM)
      Neuron{F32.add(v, dv), F32.mul(gE, dE), F32.mul(gI, dE), refr, count}

# Threshold crossing (lif.c step 4) with the refractory rule folded in: a neuron inside its
# refractory period is held at reset and its timer counts down; otherwise it fires when the
# membrane reaches the threshold plus its per-cell extra threshold.
def Kernel.fire.go(d: Dyn, n: Neuron, inRef: Bool, above: Bool) -> Neuron & Bool:
  match d n:
    case Dyn{dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI} Neuron{v, gE, gI, refr, count}:
      match inRef:
        case True{}:
          (Neuron{vReset, gE, gI, F32.sub(refr, dt), count}, False{})
        case False{}:
          match above:
            case True{}:
              (Neuron{vReset, gE, gI, tRef, 1n+count}, True{})
            case False{}:
              (Neuron{v, gE, gI, refr, count}, False{})

def Kernel.fire(+d: Dyn, n: Neuron, thr: F32) -> Neuron & Bool:
  match d n:
    case Dyn{dt, vRest, +vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI} Neuron{+v, gE, gI, +refr, count}:
      Kernel.fire.go(d, Neuron{v, gE, gI, refr, count}, F32.is_gt(refr, 0.0), F32.is_ge(v, F32.add(vThresh, thr)))

# The delay line (lif.c step 1): a ring of nslots spike lists. Each step delivers the front
# slot and enqueues the spikes fired this step at the back.
def Ring.cat(xs: List<&2, List<&2, U32>>, ys: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match xs:
    case Nil{}:
      ys
    case h <> t:
      h <> Ring.cat(t, ys)

def Ring.step(slots: List<&2, List<&2, U32>>, fired: List<&2, U32>) -> List<&2, U32> & List<&2, List<&2, U32>>:
  match slots:
    case Nil{}:
      (fired, Nil{})
    case h <> t:
      (h, Ring.cat(t, [fired]))

def Ring.rest(r: List<&2, U32> & List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  (delivered, slots) = r
  slots

def Ring.front(slots: List<&2, List<&2, U32>>) -> List<&2, U32>:
  match slots:
    case Nil{}:
      Nil{}
    case h <> t:
      h

# Run k silent steps (nothing fires) and read what the ring then delivers.
def Ring.drain(k: Nat, slots: List<&2, List<&2, U32>>) -> List<&2, U32>:
  match k:
    case 0n:
      Ring.front(slots)
    case 1n+p:
      Ring.drain(p, Ring.rest(Ring.step(slots, Nil{})))

# Delivering one presynaptic spike over its compiled row: the conductance increments it
# causes, one per kept edge, as (target, sign * weight) records. Cut edges cause nothing.
type Delta is Data:
  Delta{post: U32, dw: F32}

def Deliver.row(row: List<&2, CSyn>, +sign: F32) -> List<&2, Delta>:
  match row:
    case Nil{}:
      Nil{}
    case CSyn{post, w} <> t:
      match w:
        case Cut{}:
          Deliver.row(t, sign)
        case Kept{count, gain}:
          Delta{post, F32.mul(sign, Weight.eval(Kept{count, gain}))} <> Deliver.row(t, sign)

def Deliver.targets(xs: List<&2, Delta>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Delta{post, dw} <> t:
      post <> Deliver.targets(t)

# The kept targets of a compiled row, and the kept targets of a resolved row after compiling.
def CRow.kept_posts(row: List<&2, CSyn>) -> List<&2, U32>:
  match row:
    case Nil{}:
      Nil{}
    case CSyn{post, w} <> t:
      match w:
        case Cut{}:
          CRow.kept_posts(t)
        case Kept{count, gain}:
          post <> CRow.kept_posts(t)
