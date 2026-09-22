# Reading the packed tables: file effects, byte decoding, and the cord IR's layout.
# Shared by cordcheck.bend and cordrun.bend.
import Base
import ./dataset.bend as D

# ------------------------------------------------------------------ files
def Fx.close_with(-A: Type, f: File, x: A) -> IO(A):
  IO.bind(Unit, A, File.close(f), u => IO.pure(A, x))

def Fx.slurp.fin(r: File & Result<&1, &1, U32 & String, List<&2, U32>>) -> IO(List<&2, U32>):
  (f, res) = r
  match res:
    case Done{bs}:
      Fx.close_with(List<&2, U32>, f, bs)
    case Fail{(code, msg)}:
      IO.die(List<&2, U32>, code, msg)

def Fx.slurp.read(off: U32, len: U32, f: File) -> IO(List<&2, U32>):
  IO.bind(File & Result<&1, &1, U32 & String, List<&2, U32>>, List<&2, U32>, File.read_at(f, off, len), Fx.slurp.fin)

# read `len` bytes at `off` of the file at `path`
def Fx.slurp(path: String, off: U32, len: U32) -> IO(List<&2, U32>):
  IO.bind(File, List<&2, U32>, IO.try(File, File.open(path, "r")), f => Fx.slurp.read(off, len, f))

def Fx.size.fin(r: File & Result<&1, &1, U32 & String, U32>) -> IO(U32):
  (f, res) = r
  match res:
    case Done{n}:
      Fx.close_with(U32, f, n)
    case Fail{(code, msg)}:
      IO.die(U32, code, msg)

def Fx.size.of(f: File) -> IO(U32):
  IO.bind(File & Result<&1, &1, U32 & String, U32>, U32, File.size(f), Fx.size.fin)

def Fx.size(path: String) -> IO(U32):
  IO.bind(File, U32, IO.try(File, File.open(path, "r")), Fx.size.of)

# ------------------------------------------------------------------ byte decoding
def Bytes.u16s(bs: List<&2, U32>) -> List<&2, U32>:
  match bs:
    case b0 <> t0:
      match t0:
        case b1 <> t1:
          D.LE.u16(b0, b1) <> Bytes.u16s(t1)
        case Nil{}:
          Nil{}
    case Nil{}:
      Nil{}

def Bytes.u32s(bs: List<&2, U32>) -> List<&2, U32>:
  match bs:
    case b0 <> t0:
      match t0:
        case b1 <> t1:
          match t1:
            case b2 <> t2:
              match t2:
                case b3 <> t3:
                  D.LE.u32(b0, b1, b2, b3) <> Bytes.u32s(t3)
                case Nil{}:
                  Nil{}
            case Nil{}:
              Nil{}
        case Nil{}:
          Nil{}
    case Nil{}:
      Nil{}

def Bytes.f32s(bs: List<&2, U32>) -> List<&2, F32>:
  match bs:
    case b0 <> t0:
      match t0:
        case b1 <> t1:
          match t1:
            case b2 <> t2:
              match t2:
                case b3 <> t3:
                  D.F32.from_bits(D.LE.u32(b0, b1, b2, b3)) <> Bytes.f32s(t3)
                case Nil{}:
                  Nil{}
            case Nil{}:
              Nil{}
        case Nil{}:
          Nil{}
    case Nil{}:
      Nil{}

def Head.u32(xs: List<&2, U32>) -> U32:
  match xs:
    case Nil{}:
      0
    case h <> t:
      h

# pairwise differences of an offset list: the row lengths
def Lens.of(ip: List<&2, U32>) -> List<&2, U32>:
  match ip:
    case Nil{}:
      Nil{}
    case a <> t:
      match t:
        case Nil{}:
          Nil{}
        case +b <> t2:
          (b - a : U32) <> Lens.of(b <> t2)

def Path.graph() -> String:
  "public/data/graph_w3.bin"

# ------------------------------------------------------------------ list to array
def U32s.into(xs: List<&2, U32>, +i: U32, a: Array<U32>) -> Array<U32>:
  match xs:
    case Nil{}:
      a
    case h <> t:
      U32s.into(t, (i + 1 : U32), Array.set(U32, a, i, h))

def F32s.into(xs: List<&2, F32>, +i: U32, a: Array<F32>) -> Array<F32>:
  match xs:
    case Nil{}:
      a
    case h <> t:
      F32s.into(t, (i + 1 : U32), Array.set(F32, a, i, h))

# ------------------------------------------------------------------ the cord IR file
# public/data/cord_ir.bin, written by scripts/prep_cord_ir.mjs. The offsets are the ones the
# descriptor records; `cordcheck.bend` checks the file's size against them before reading.
def Cord.path() -> String:
  "public/data/cord_ir.bin"

def Cord.n() -> U32:
  21843

def Cord.e() -> U32:
  1615182

def Cord.n_full() -> U32:
  165122

def Cord.n_sets() -> U32:
  22

def Cord.n_set_idx() -> U32:
  9313

def Cord.off_origIdx() -> U32:
  32

def Cord.off_indptr() -> U32:
  87404

def Cord.off_gaps() -> U32:
  174780

def Cord.off_counts() -> U32:
  6635508

def Cord.off_edgeClass() -> U32:
  9865872

def Cord.off_role() -> U32:
  11481056

def Cord.off_nt() -> U32:
  11502900

def Cord.off_side() -> U32:
  11524744

def Cord.off_hl() -> U32:
  11546588

def Cord.off_sign() -> U32:
  11568432

def Cord.off_size() -> U32:
  11655804

def Cord.off_setPtr() -> U32:
  11743176

def Cord.off_setIdx() -> U32:
  11743268

def Cord.bytes() -> U32:
  11780520

# the layout accounts for the file: every section starts where the previous one ends, rounded up
def Cord.layout_ok() -> Bool:
  Bool.and(U32.is_eq(Cord.off_indptr(), (Cord.off_origIdx() + 4 * Cord.n() : U32)),
    Bool.and(U32.is_eq(Cord.off_gaps(), (Cord.off_indptr() + 4 * (Cord.n() + 1) : U32)),
      Bool.and(U32.is_eq(Cord.off_counts(), (Cord.off_gaps() + 4 * Cord.e() : U32)),
        Bool.and(U32.is_eq(Cord.off_edgeClass(), (Cord.off_counts() + 2 * Cord.e() : U32)),
          Bool.and(U32.is_eq(Cord.off_role(), (Cord.off_edgeClass() + Cord.e() + 2 : U32)),
            Bool.and(U32.is_eq(Cord.off_setIdx(), (Cord.off_setPtr() + 4 * (Cord.n_sets() + 1) : U32)),
              U32.is_eq(Cord.bytes(), (Cord.off_setIdx() + 4 * Cord.n_set_idx() : U32))))))))

# the sets, in the order scripts/prep_cord_ir.mjs writes them
def Cord.set_pool_first() -> U32:
  0

def Cord.set_hl_13a() -> U32:
  6

def Cord.set_hl_13b() -> U32:
  7

def Cord.set_hl_19b() -> U32:
  8

def Cord.set_dn_first() -> U32:
  9

def Cord.set_mdn() -> U32:
  17

def Cord.set_motor() -> U32:
  18

def Cord.set_descending() -> U32:
  19

def Cord.set_sensory() -> U32:
  20

def Cord.set_proprio() -> U32:
  21
