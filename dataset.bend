# The male connectome as data: MaleCNS v1.0 in the packed tables the browser and the node
# scripts read (docs/03-data-pipeline.md, scripts/prep_graph.py, scripts/lib_node.mjs).
#
# This module is pure. It fixes the dataset's dimensions, the byte layout of every table
# the loader touches, and the decoding of one cell's attribute bytes into the IR's Cell.
# LAWS.bend pins the layout against the files' sizes; malecns.bend reads the files.
import Base
import ./connectome.bend as C

# ------------------------------------------------------------------- dimensions
# 165,122 traced neurons; 10,511,038 connections with 3 or more synapses (meta.json).
def MaleCNS.n() -> U32:
  165122

def MaleCNS.e() -> U32:
  10511038

def MaleCNS.min_weight() -> U32:
  3

# ------------------------------------------------------------------- graph_w3.bin
# uint32 N, uint32 E; uint32 indptr[N + 1]; uint32 indices[E]; uint16 weights[E].
def MaleCNS.indptr_off() -> U32:
  8

def MaleCNS.indices_off() -> U32:
  (MaleCNS.indptr_off() + 4 * (MaleCNS.n() + 1) : U32)

def MaleCNS.weights_off() -> U32:
  (MaleCNS.indices_off() + 4 * MaleCNS.e() : U32)

def MaleCNS.graph_bytes() -> U32:
  (MaleCNS.weights_off() + 2 * MaleCNS.e() : U32)

# ------------------------------------------------------------------- neurons.bin
# uint32 N, uint32 0; int64 bodyId[N]; float32 soma[3N]; uint32 indeg[N]; uint32 outdeg[N];
# uint16 class[N]; uint8 nt[N]; uint8 superclass[N]; uint8 side[N].
def MaleCNS.class_off() -> U32:
  (8 + 28 * MaleCNS.n() : U32)

def MaleCNS.tail_bytes() -> U32:
  (5 * MaleCNS.n() : U32)

def MaleCNS.neurons_bytes() -> U32:
  (MaleCNS.class_off() + MaleCNS.tail_bytes() : U32)

# ntsign.bin and neuron_size.bin: float32[N] each.
def MaleCNS.f32_table_bytes() -> U32:
  (4 * MaleCNS.n() : U32)

# ------------------------------------------------------------------- code tables
# meta.json "superclasses", by index:
#  0 ENS, 1 ascending_neuron, 2 cb_efferent, 3 cb_endocrine, 4 cb_intrinsic, 5 cb_motor,
#  6 cb_sensory, 7 cb_sensory_tbc, 8 descending_neuron, 9 efferent_ascending,
# 10 efferent_descending, 11 ol_intrinsic, 12 ol_sensory, 13 sensory_ascending,
# 14 sensory_ascending_tbc, 15 sensory_descending, 16 unknown, 17 visual_centrifugal,
# 18 visual_projection, 19 visual_projection_tbc, 20 vnc_efferent, 21 vnc_endocrine,
# 22 vnc_intrinsic, 23 vnc_motor, 24 vnc_sensory, 25 vnc_sensory_tbc, 26 vnc_tbc
# meta.json "classes": index 7 is Kenyon_Cell.

def U32.in(xs: List<&2, U32>, +code: U32) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case h <> t:
      Bool.or(U32.is_eq(h, code), U32.in(t, code))

# `sensory` in brainScales (src/brainmodel.js): the superclass name contains "sensory".
def Superclass.is_sensory(code: U32) -> Bool:
  U32.in([6, 7, 12, 13, 14, 15, 24, 25], code)

# REGION_OF (src/ratenet.js): ol_* and visual_* are the optic lobe; vnc_*, descending,
# ascending, sensory_ascending, sensory_descending and efferent_* are the cord; the rest is
# the central brain.
def Superclass.region(+code: U32) -> C.Region:
  Bool.pick(C.Region, U32.in([11, 12, 17, 18, 19], code), C.Optic{},
    Bool.pick(C.Region, U32.in([1, 8, 9, 10, 13, 14, 15, 20, 21, 22, 23, 24, 25, 26], code), C.Cord{}, C.Central{}))

def Class.kenyon_code() -> U32:
  7

# ------------------------------------------------------------------- cellflags.bin
# One byte per cell, written by scripts/bend_malecns.mjs from the same predicates the brain
# build uses: bit 0 sensory, bit 1 motor, bit 2 Kenyon cell, bit 3 lamina L1-L5,
# bit 4 octopaminergic (type OA-*), bits 5-6 region code.
def Flags.bit(+flags: U32, +bit: Nat) -> Bool:
  U32.is_ne(U32.and(U32.shrn(flags, bit), 1), 0)

def Flags.region(+flags: U32) -> C.Region:
  C.Region.of_code(U32.and(U32.shrn(flags, 5n), 3))

def Cell.of_bytes(+flags: U32, nt: U32, side: U32) -> C.Cell:
  C.Cell{C.NT.of_code(nt), C.Side.of_code(side), Flags.region(flags), Flags.bit(flags, 0n), Flags.bit(flags, 1n),
    Flags.bit(flags, 2n), Flags.bit(flags, 3n), Flags.bit(flags, 4n)}

# The flag bits that can be re-derived from the code tables must agree with them.
def Bool.same(a: Bool, b: Bool) -> Bool:
  Bool.not(Bool.xor(a, b))

def Cell.flags_consistent(+flags: U32, +sc: U32, cls: U32) -> Bool:
  Bool.and(Bool.same(Flags.bit(flags, 0n), Superclass.is_sensory(sc)),
    Bool.and(U32.is_eq(C.Region.code(Flags.region(flags)), C.Region.code(Superclass.region(sc))),
      Bool.same(Flags.bit(flags, 2n), U32.is_eq(cls, Class.kenyon_code()))))

# ------------------------------------------------------------------- little-endian words
def LE.u16(b0: U32, b1: U32) -> U32:
  (b0 .|. U32.shln(b1, 8n) : U32)

def LE.u32(b0: U32, b1: U32, b2: U32, b3: U32) -> U32:
  (b0 .|. U32.shln(b1, 8n) .|. U32.shln(b2, 16n) .|. U32.shln(b3, 24n) : U32)

# IEEE 754 binary32 from its bit pattern. Denormals flush to zero and the exponent 255 is
# not expected in these tables (volumes and graded signs are finite).
def F32.from_bits.mag(+ex: U32, man: U32) -> F32:
  Bool.pick(F32, U32.is_zero(ex), 0.0,
    F32.mul(U32.to_f32((man .|. 8388608 : U32)), F32.pow(2.0, F32.sub(U32.to_f32(ex), 150.0))))

def F32.from_bits(+bits: U32) -> F32:
  +mag = F32.from_bits.mag(U32.and(U32.shrn(bits, 23n), 255), U32.and(bits, 8388607))
  Bool.pick(F32, U32.is_zero(U32.shrn(bits, 31n)), mag, F32.neg(mag))
