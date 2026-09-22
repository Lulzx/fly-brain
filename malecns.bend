# The male connectome through the formal compiler.
#
# Reads the packed MaleCNS v1.0 tables (docs/03-data-pipeline.md), checks that they are a
# well-formed IR instance (connectome.bend, IR.row_ok), lowers every cell and every edge
# with the same functions LAWS.bend constrains (Compile.sign, Compile.thr, Compile.bias,
# Compile.in_scale, Compile.syn, Compile.row), and prints what came out. The graph is
# streamed in blocks of 8192 presynaptic rows; inside a block the rows are compiled in
# parallel over a fork tree with the per-cell tables shared read-only across lanes.
#
#   bend malecns.bend -o malecns && ./malecns
#   node scripts/bend_malecns.mjs check      # the same numbers from the JavaScript build
import Base
import ./connectome.bend as C
import ./dataset.bend as D

# ------------------------------------------------------------------ parameters
# public/data/brain_params.json (calibrated, docs/07) plus BRAIN_DEFAULTS (src/brainmodel.js):
# minSyn 6, neuromod on, preInh 0, kcThreshold 7.319, laminaBias 2.86, inhGain 0.577,
# wSyn 0.562, sizeAlpha 0.572, maxSizeScale 20, boostCap 1. scripts/bend_malecns.mjs checks
# that these constants still match the file.
def Params.calibrated() -> C.Params:
  C.Params{6, True{}, False{}, 7.319, 2.86, 0.577, 0.562, 0.572, 20.0, 1.0}

def Params.minSyn(p: C.Params) -> U32:
  match p:
    case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
      minSyn

def Params.neuromod(p: C.Params) -> Bool:
  match p:
    case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
      neuromod

def Params.preInh(p: C.Params) -> Bool:
  match p:
    case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
      preInh

def Params.inhGain(p: C.Params) -> F32:
  match p:
    case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
      inhGain

def Params.sizeAlpha(p: C.Params) -> F32:
  match p:
    case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
      sizeAlpha

def Params.maxSizeScale(p: C.Params) -> F32:
  match p:
    case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
      maxSizeScale

def Params.boostCap(p: C.Params) -> F32:
  match p:
    case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
      boostCap

def Params.kcThreshold(p: C.Params) -> F32:
  match p:
    case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
      kcThreshold

def Params.laminaBias(p: C.Params) -> F32:
  match p:
    case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
      laminaBias

# ------------------------------------------------------------------ files
def Path.graph() -> String:
  "public/data/graph_w3.bin"

def Path.neurons() -> String:
  "public/data/neurons.bin"

def Path.flags() -> String:
  "public/data/cellflags.bin"

def Path.ntsign() -> String:
  "public/data/ntsign.bin"

def Path.size() -> String:
  "public/data/neuron_size.bin"

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

# ------------------------------------------------------------------ bytes to values
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

def U32s.into_array(xs: List<&2, U32>, +i: U32, a: Array<U32>) -> Array<U32>:
  match xs:
    case Nil{}:
      a
    case h <> t:
      U32s.into_array(t, (i + 1 : U32), Array.set(U32, a, i, h))

# ------------------------------------------------------------------ cells
# What the graph pass needs per cell: its attributes (for the sensory gate), its input
# scale (the gain every edge onto it carries) and its compiled sign (the gain and gate every
# edge out of it carries).
type Post is Data:
  Post{cell: C.Cell, scale: F32, sign: F32}

def Post.default() -> Post:
  Post{C.Cell.unknown(), 1.0, 0.0}

def Post.cell(p: Post) -> C.Cell:
  match p:
    case Post{cell, scale, sign}:
      cell

def Post.scale(p: Post) -> F32:
  match p:
    case Post{cell, scale, sign}:
      scale

def Post.sign(p: Post) -> F32:
  match p:
    case Post{cell, scale, sign}:
      sign

def Posts.into_array(xs: List<&2, Post>, +i: U32, a: Array<Post>) -> Array<Post>:
  match xs:
    case Nil{}:
      a
    case h <> t:
      Posts.into_array(t, (i + 1 : U32), Array.set(Post, a, i, h))

def Cells.of_bytes(flags: List<&2, U32>, nts: List<&2, U32>, sides: List<&2, U32>) -> List<&2, C.Cell>:
  match flags nts sides:
    case f <> ft n <> nt2 s <> st:
      D.Cell.of_bytes(f, n, s) <> Cells.of_bytes(ft, nt2, st)
    case _ _ _:
      Nil{}

def Cells.consistent(flags: List<&2, U32>, scs: List<&2, U32>, clss: List<&2, U32>, ok: Bool) -> Bool:
  match flags scs clss:
    case f <> ft s <> st c <> ct:
      Cells.consistent(ft, st, ct, Bool.and(ok, D.Cell.flags_consistent(f, s, c)))
    case _ _ _:
      ok

# per-cell sign: the graded prediction, zeroed for octopaminergic cells under neuromodulation
def Signs.compile(cells: List<&2, C.Cell>, graded: List<&2, F32>, +neuromod: Bool) -> List<&2, F32>:
  match cells graded:
    case c <> ct g <> gt:
      C.Compile.sign(neuromod, c, Some{g}) <> Signs.compile(ct, gt, neuromod)
    case _ _:
      Nil{}

# ------------------------------------------------------------------ regional medians
type Buckets is Data:
  Buckets{o: List<&2, F32>, c: List<&2, F32>, v: List<&2, F32>}

def Buckets.o(b: Buckets) -> List<&2, F32>:
  match b:
    case Buckets{o, c, v}:
      o

def Buckets.c(b: Buckets) -> List<&2, F32>:
  match b:
    case Buckets{o, c, v}:
      c

def Buckets.v(b: Buckets) -> List<&2, F32>:
  match b:
    case Buckets{o, c, v}:
      v

def Buckets.add(b: Buckets, r: C.Region, x: F32) -> Buckets:
  match b r:
    case Buckets{o, c, v} C.Optic{}:
      Buckets{x <> o, c, v}
    case Buckets{o, c, v} C.Central{}:
      Buckets{o, x <> c, v}
    case Buckets{o, c, v} C.Cord{}:
      Buckets{o, c, x <> v}

# only cells with a measured volume take part in the median (regionSizeRef, src/ratenet.js)
def Buckets.put(b: Buckets, r: C.Region, +x: F32, measured: Bool) -> Buckets:
  match measured:
    case True{}:
      Buckets.add(b, r, x)
    case False{}:
      b

def Buckets.of(cells: List<&2, C.Cell>, sizes: List<&2, F32>, acc: Buckets) -> Buckets:
  match cells sizes:
    case c <> ct +s <> st:
      Buckets.of(ct, st, Buckets.put(acc, C.Cell.region(c), s, F32.is_gt(s, 0.0)))
    case _ _:
      acc

# Parallel merge sort on F32 lists. `d` bounds the recursion depth; with d above
# log2(length) every leaf holds at most one element, so the result is sorted.
type Halves is Data:
  Halves{a: List<&2, F32>, b: List<&2, F32>}

def Halves.a(h: Halves) -> List<&2, F32>:
  match h:
    case Halves{a, b}:
      a

def Halves.b(h: Halves) -> List<&2, F32>:
  match h:
    case Halves{a, b}:
      b

def Sort.split(xs: List<&2, F32>) -> Halves:
  match xs:
    case Nil{}:
      Halves{Nil{}, Nil{}}
    case x <> t:
      +h = Sort.split(t)
      Halves{x <> Halves.b(h), Halves.a(h)}

type Next is Data:
  Next{head: F32, xs: List<&2, F32>, ys: List<&2, F32>}

def Next.head(n: Next) -> F32:
  match n:
    case Next{head, xs, ys}:
      head

def Next.xs(n: Next) -> List<&2, F32>:
  match n:
    case Next{head, xs, ys}:
      xs

def Next.ys(n: Next) -> List<&2, F32>:
  match n:
    case Next{head, xs, ys}:
      ys

def Sort.pick(x: F32, xt: List<&2, F32>, y: F32, yt: List<&2, F32>, le: Bool) -> Next:
  match le:
    case True{}:
      Next{x, xt, y <> yt}
    case False{}:
      Next{y, x <> xt, yt}

def Sort.merge(fuel: Nat, xs: List<&2, F32>, ys: List<&2, F32>) -> List<&2, F32>:
  match fuel:
    case 0n:
      List.append(&2, F32, xs, ys)
    case 1n+p:
      match xs ys:
        case Nil{} _:
          ys
        case _ Nil{}:
          xs
        case +x <> xt +y <> yt:
          +nx = Sort.pick(x, xt, y, yt, F32.is_le(x, y))
          Next.head(nx) <> Sort.merge(p, Next.xs(nx), Next.ys(nx))

def Sort.merge.start(+a: List<&2, F32>, +b: List<&2, F32>) -> List<&2, F32>:
  Sort.merge(Nat.add(List.length(&2, F32, a), List.length(&2, F32, b)), a, b)

def Sort.msort(d: Nat, xs: List<&2, F32>) -> List<&2, F32>:
  match d:
    case 0n:
      xs
    case 1n++p:
      match xs:
        case Nil{}:
          Nil{}
        case x <> Nil{}:
          [x]
        case x <> (y <> t):
          +h = Sort.split(x <> (y <> t))
          a b = Sort.msort(p, Halves.a(h)) Sort.msort(p, Halves.b(h))
          Sort.merge.start(a, b)

def Median.at.fin(m: Maybe<&2, F32>) -> F32:
  match m:
    case None{}:
      1.0
    case Some{x}:
      x

# the upper median, b[b.length >> 1], and 1 for an empty bucket (regionSizeRef)
def Median.of(+xs: List<&2, F32>) -> F32:
  Median.at.fin(List.get(&2, F32, Sort.msort(24n, xs), Nat.div(List.length(&2, F32, xs), 2n)))

type Medians is Data:
  Medians{o: F32, c: F32, v: F32}

def Medians.of(bk: Buckets) -> Medians:
  match bk:
    case Buckets{o, c, v}:
      mo mc mv = Median.of(o) Median.of(c) Median.of(v)
      Medians{mo, mc, mv}

def Medians.ref(m: Medians, r: C.Region) -> F32:
  match m r:
    case Medians{o, c, v} C.Optic{}:
      o
    case Medians{o, c, v} C.Central{}:
      c
    case Medians{o, c, v} C.Cord{}:
      v

def Scale.of(cells: List<&2, C.Cell>, sizes: List<&2, F32>, +m: Medians, +p: C.Params) -> List<&2, F32>:
  match cells sizes:
    case c <> ct s <> st:
      C.Compile.in_scale(Params.sizeAlpha(p), Params.maxSizeScale(p), Params.boostCap(p), s, Medians.ref(m, C.Cell.region(c))) <> Scale.of(ct, st, m, p)
    case _ _:
      Nil{}

def Posts.of(cells: List<&2, C.Cell>, scales: List<&2, F32>, signs: List<&2, F32>) -> List<&2, Post>:
  match cells scales signs:
    case c <> ct s <> st g <> gt:
      Post{c, s, g} <> Posts.of(ct, st, gt)
    case _ _ _:
      Nil{}

# ------------------------------------------------------------------ per-cell summary
type CellStats is Data:
  CellStats{exc: U32, inh: U32, mod: U32, kc: U32, lam: U32, oa: U32, sens: U32, motor: U32, scaleOne: U32, sizeZero: U32}

def CellStats.zero() -> CellStats:
  CellStats{0, 0, 0, 0, 0, 0, 0, 0, 0, 0}

def CellStats.add(st: CellStats, c: C.Cell, +scale: F32, +sign: F32, size: F32) -> CellStats:
  match st c:
    case CellStats{exc, inh, mod, kc, lam, oa, sens, motor, scaleOne, sizeZero} C.Cell{nt, side, region, sensory, motor2, kenyon, lamina, oa2}:
      CellStats{(exc + Bool.to_u32(F32.is_gt(sign, 0.0)) : U32), (inh + Bool.to_u32(F32.is_lt(sign, 0.0)) : U32),
        (mod + Bool.to_u32(F32.is_eq(sign, 0.0)) : U32), (kc + Bool.to_u32(kenyon) : U32), (lam + Bool.to_u32(lamina) : U32),
        (oa + Bool.to_u32(oa2) : U32), (sens + Bool.to_u32(sensory) : U32), (motor + Bool.to_u32(motor2) : U32),
        (scaleOne + Bool.to_u32(F32.is_eq(scale, 1.0)) : U32), (sizeZero + Bool.to_u32(F32.is_le(size, 0.0)) : U32)}

def CellStats.of(cells: List<&2, C.Cell>, scales: List<&2, F32>, signs: List<&2, F32>, sizes: List<&2, F32>, acc: CellStats) -> CellStats:
  match cells scales signs sizes:
    case c <> ct s <> st g <> gt z <> zt:
      CellStats.of(ct, st, gt, zt, CellStats.add(acc, c, s, g, z))
    case _ _ _ _:
      acc

def CellStats.print(st: CellStats) -> IO(Unit):
  match st:
    case CellStats{exc, inh, mod, kc, lam, oa, sens, motor, scaleOne, sizeZero}:
      do IO<Unit>:
        IO.print("cells_exc " ++ U32.show(exc))
        IO.print("cells_inh " ++ U32.show(inh))
        IO.print("cells_mod " ++ U32.show(mod))
        IO.print("cells_kenyon " ++ U32.show(kc))
        IO.print("cells_lamina " ++ U32.show(lam))
        IO.print("cells_oa " ++ U32.show(oa))
        IO.print("cells_sensory " ++ U32.show(sens))
        IO.print("cells_motor " ++ U32.show(motor))
        IO.print("cells_scale_one " ++ U32.show(scaleOne))
        IO.print("cells_size_zero " ++ U32.show(sizeZero))

# ------------------------------------------------------------------ indptr
type IpCheck is Data:
  IpCheck{ok: Bool, last: U32}

def IpCheck.ok(c: IpCheck) -> Bool:
  match c:
    case IpCheck{ok, last}:
      ok

def IpCheck.last(c: IpCheck) -> U32:
  match c:
    case IpCheck{ok, last}:
      last

def Indptr.go(xs: List<&2, U32>, +prev: U32, ok: Bool) -> IpCheck:
  match xs:
    case Nil{}:
      IpCheck{ok, prev}
    case +h <> t:
      Indptr.go(t, h, Bool.and(ok, U32.is_le(prev, h)))

# indptr[0] == 0 and indptr is non-decreasing; `last` is indptr[N], which must equal E
def Indptr.check(xs: List<&2, U32>) -> IpCheck:
  match xs:
    case Nil{}:
      IpCheck{False{}, 0}
    case +h <> t:
      Indptr.go(t, h, U32.is_zero(h))

# ------------------------------------------------------------------ one block of rows
# A block is 8192 presynaptic rows, read as 64 chunks of 128 rows. The reads are sequential;
# everything after them (decoding the bytes, resolving targets, compiling, counting) runs in
# the parallel tree over the chunks, with the per-cell table forked read-only to every lane.
def Block.depth() -> Nat:
  6n

def Chunk.rows() -> U32:
  128

def Block.rows() -> U32:
  8192

# The row lengths of one chunk, read off indptr from the chunk's last row down to its
# first, so the list comes out in row order. Rows past N read indptr[N] twice: length 0.
type Lens is Data:
  Lens{e0: U32, e1: U32, lens: List<&2, U32>}

def Lens.e0(l: Lens) -> U32:
  match l:
    case Lens{e0, e1, lens}:
      e0

def Lens.e1(l: Lens) -> U32:
  match l:
    case Lens{e0, e1, lens}:
      e1

def Lens.lens(l: Lens) -> List<&2, U32>:
  match l:
    case Lens{e0, e1, lens}:
      lens

def Lens.build(fuel: Nat, +j: U32, +hi: U32, +e1: U32, res: Array<U32> & U32, acc: List<&2, U32>) -> Array<U32> & Lens:
  match fuel:
    case 0n:
      (ip, lo) = res
      (ip, Lens{hi, e1, acc})
    case 1n+p:
      (ip, +lo) = res
      Lens.build(p, (j - 1 : U32), lo, e1, Array.get(U32, ip, U32.min((j - 1 : U32), D.MaleCNS.n())), (hi - lo : U32) <> acc)

def Lens.start.go(+jEnd: U32, r: Array<U32> & U32) -> Array<U32> & Lens:
  (ip, +hi) = r
  Lens.build(U32.to_nat(Chunk.rows()), (jEnd - 1 : U32), hi, hi, Array.get(U32, ip, U32.min((jEnd - 1 : U32), D.MaleCNS.n())), Nil{})

def Lens.start(ip: Array<U32>, +j0: U32) -> Array<U32> & Lens:
  Lens.start.go((j0 + Chunk.rows() : U32), Array.get(U32, ip, U32.min((j0 + Chunk.rows() : U32), D.MaleCNS.n())))

# A chunk: its first row, its row lengths, and the raw index and count bytes of its rows.
type Chunk is Data:
  Chunk{j0: U32, lens: List<&2, U32>, idx: List<&2, U32>, wts: List<&2, U32>}

type Taken is Data:
  Taken{row: List<&2, C.Syn>, idx: List<&2, U32>, wts: List<&2, U32>}

def Taken.row(t: Taken) -> List<&2, C.Syn>:
  match t:
    case Taken{row, idx, wts}:
      row

def Taken.idx(t: Taken) -> List<&2, U32>:
  match t:
    case Taken{row, idx, wts}:
      idx

def Taken.wts(t: Taken) -> List<&2, U32>:
  match t:
    case Taken{row, idx, wts}:
      wts

# take `fuel` CSR entries off the two byte streams (4 index bytes and 2 count bytes each)
def Row.take(fuel: Nat, idx: List<&2, U32>, wts: List<&2, U32>, acc: List<&2, C.Syn>) -> Taken:
  match fuel:
    case 0n:
      Taken{List.reverse(&2, C.Syn, acc), idx, wts}
    case 1n+p:
      match idx:
        case Nil{}:
          Taken{List.reverse(&2, C.Syn, acc), Nil{}, wts}
        case b0 <> t0:
          match t0:
            case Nil{}:
              Taken{List.reverse(&2, C.Syn, acc), Nil{}, wts}
            case b1 <> t1:
              match t1:
                case Nil{}:
                  Taken{List.reverse(&2, C.Syn, acc), Nil{}, wts}
                case b2 <> t2:
                  match t2:
                    case Nil{}:
                      Taken{List.reverse(&2, C.Syn, acc), Nil{}, wts}
                    case b3 <> t3:
                      match wts:
                        case Nil{}:
                          Taken{List.reverse(&2, C.Syn, acc), t3, Nil{}}
                        case c0 <> u0:
                          match u0:
                            case Nil{}:
                              Taken{List.reverse(&2, C.Syn, acc), t3, Nil{}}
                            case c1 <> u1:
                              Row.take(p, t3, u1, C.Syn{D.LE.u32(b0, b1, b2, b3), D.LE.u16(c0, c1)} <> acc)

# ------------------------------------------------------------------ compiling a row
type Stats is Data:
  Stats{rows: U32, edges: U32, kept: U32, cutMin: U32, cutSens: U32, keptSyn: U32, selfLoops: U32, ok: Bool}

def Stats.zero() -> Stats:
  Stats{0, 0, 0, 0, 0, 0, 0, True{}}

def Stats.merge(a: Stats, b: Stats) -> Stats:
  match a b:
    case Stats{r1, e1, k1, m1, s1, y1, l1, o1} Stats{r2, e2, k2, m2, s2, y2, l2, o2}:
      Stats{(r1 + r2 : U32), (e1 + e2 : U32), (k1 + k2 : U32), (m1 + m2 : U32), (s1 + s2 : U32), (y1 + y2 : U32), (l1 + l2 : U32), Bool.and(o1, o2)}

def Stats.rows_of(s: Stats) -> U32:
  match s:
    case Stats{rows, edges, kept, cutMin, cutSens, keptSyn, selfLoops, ok}:
      rows

def Stats.print(s: Stats) -> IO(Unit):
  match s:
    case Stats{rows, edges, kept, cutMin, cutSens, keptSyn, selfLoops, ok}:
      do IO<Unit>:
        IO.print("rows " ++ U32.show(rows))
        IO.print("edges " ++ U32.show(edges))
        IO.print("rows_ok " ++ Bool.show(ok))
        IO.print("self_loops " ++ U32.show(selfLoops))
        IO.print("edges_kept " ++ U32.show(kept))
        IO.print("edges_cut_min " ++ U32.show(cutMin))
        IO.print("edges_cut_sensory " ++ U32.show(cutSens))
        IO.print("kept_synapses " ++ U32.show(keptSyn))

def RSyn.of(syn: C.Syn, p: Post, +preGain: F32) -> C.RSyn:
  match p:
    case Post{cell, scale, sign}:
      C.RSyn{syn, cell, F32.mul(scale, preGain)}

# Resolve a row against the cell table. `cur` is the entry whose lookup `res` holds; the
# next entry's lookup is issued as the recursive call's argument (the Array.map idiom).
def Leaf.resolve(row: List<&2, C.Syn>, +preGain: F32, cur: C.Syn, res: Array<Post> & Post, acc: List<&2, C.RSyn>) -> Array<Post> & List<&2, C.RSyn>:
  match row:
    case Nil{}:
      (a, p) = res
      (a, List.reverse(&2, C.RSyn, RSyn.of(cur, p, preGain) <> acc))
    case C.Syn{+post, count} <> t:
      (a, p) = res
      Leaf.resolve(t, preGain, C.Syn{post, count}, Array.get(Post, a, post), RSyn.of(cur, p, preGain) <> acc)

def Stats.cut(s: Stats, sensoryCut: Bool) -> Stats:
  match s sensoryCut:
    case Stats{rows, edges, kept, cutMin, cutSens, keptSyn, selfLoops, ok} True{}:
      Stats{rows, edges, kept, cutMin, (cutSens + 1 : U32), keptSyn, selfLoops, ok}
    case Stats{rows, edges, kept, cutMin, cutSens, keptSyn, selfLoops, ok} False{}:
      Stats{rows, edges, kept, (cutMin + 1 : U32), cutSens, keptSyn, selfLoops, ok}

def Stats.kept(s: Stats, count: U32) -> Stats:
  match s:
    case Stats{rows, edges, kept, cutMin, cutSens, keptSyn, selfLoops, ok}:
      Stats{rows, edges, (kept + 1 : U32), cutMin, cutSens, (keptSyn + count : U32), selfLoops, ok}

def Stats.edge(s: Stats, selfLoop: Bool) -> Stats:
  match s:
    case Stats{rows, edges, kept, cutMin, cutSens, keptSyn, selfLoops, ok}:
      Stats{rows, (edges + 1 : U32), kept, cutMin, cutSens, keptSyn, (selfLoops + Bool.to_u32(selfLoop) : U32), ok}

def Stats.row(s: Stats, rowOk: Bool) -> Stats:
  match s:
    case Stats{rows, edges, kept, cutMin, cutSens, keptSyn, selfLoops, ok}:
      Stats{(rows + 1 : U32), edges, kept, cutMin, cutSens, keptSyn, selfLoops, Bool.and(ok, rowOk)}

# the last block pads to 8192 rows; a leaf past N is not a row of the animal
def Stats.row_if(s: Stats, real: Bool) -> Stats:
  match real:
    case True{}:
      Stats.row(s, True{})
    case False{}:
      s

# walk a resolved row beside its compiled row, counting what the compiler decided
def Leaf.stats(rr: List<&2, C.RSyn>, cr: List<&2, C.CSyn>, +j: U32, +keep: Bool, acc: Stats) -> Stats:
  match rr cr:
    case C.RSyn{C.Syn{+post, +count}, cell, gain} <> rt C.CSyn{p2, w} <> ct:
      match w:
        case C.Cut{}:
          Leaf.stats(rt, ct, j, keep, Stats.cut(Stats.edge(acc, U32.is_eq(post, j)), Bool.and(C.Cell.sensory(cell), Bool.not(keep))))
        case C.Kept{c2, g2}:
          Leaf.stats(rt, ct, j, keep, Stats.kept(Stats.edge(acc, U32.is_eq(post, j)), count))
    case _ _:
      acc

def Leaf.finish(+j: U32, +keep: Bool, +minSyn: U32, rowOk: Bool, rr: Array<Post> & List<&2, C.RSyn>) -> Stats & Array<Post>:
  (a1, rrow) = rr
  +rrow2 = rrow
  (Leaf.stats(rrow2, C.Compile.row(rrow2, minSyn, keep), j, keep, Stats.row(Stats.zero(), rowOk)), a1)

# one presynaptic row: its gate and gain from its own compiled sign, then resolve, compile, count
def Leaf.run1(+j: U32, row: List<&2, C.Syn>, p: C.Params, pre: Array<Post> & Post) -> Stats & Array<Post>:
  match row:
    case Nil{}:
      (a1, pp) = pre
      (Stats.row_if(Stats.zero(), U32.is_lt(j, D.MaleCNS.n())), a1)
    case C.Syn{+post, +count} <> t:
      match p:
        case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
          (a1, pp) = pre
          +s = Post.sign(pp)
          +t2 = t
          Leaf.finish(j, C.Compile.keep_onto_sensory(preInh, s), minSyn, C.IR.row_ok(C.Syn{post, count} <> t2, D.MaleCNS.n(), D.MaleCNS.min_weight()),
            Leaf.resolve(t2, C.Compile.pre_gain(inhGain, s, 1.0), C.Syn{post, count}, Array.get(Post, a1, post), Nil{}))

def Leaf.run(+j: U32, row: List<&2, C.Syn>, a: Array<Post>, p: C.Params) -> Stats & Array<Post>:
  Leaf.run1(j, row, p, Array.get(Post, a, j))

# ------------------------------------------------------------------ compiling a chunk
# The rows of a chunk in sequence. `prev` is the previous row's result, whose table the
# next row reads (the same idiom as Leaf.resolve).
def Chunk.loop(lens: List<&2, U32>, +j: U32, idx: List<&2, U32>, wts: List<&2, U32>, +p: C.Params, acc: Stats, prev: Stats & Array<Post>) -> Stats & Array<Post>:
  match lens:
    case Nil{}:
      (s, a) = prev
      (Stats.merge(acc, s), a)
    case len <> lt:
      (s, a) = prev
      +tk = Row.take(U32.to_nat(len), idx, wts, Nil{})
      Chunk.loop(lt, (j + 1 : U32), Taken.idx(tk), Taken.wts(tk), p, Stats.merge(acc, s), Leaf.run(j, Taken.row(tk), a, p))

def Chunk.fin(a2: Array<Post>, r: Stats & Array<Post>) -> Stats & Array<Post>:
  (s, a1) = r
  (s, Array.join(Post, a1, a2))

def Chunk.run(ch: Chunk, ab: Array<Post> & Array<Post>, +p: C.Params) -> Stats & Array<Post>:
  match ch:
    case Chunk{j0, lens, idx, wts}:
      (a1, a2) = ab
      Chunk.fin(a2, Chunk.loop(lens, j0, idx, wts, p, Stats.zero(), (Stats.zero(), a1)))

type CTree is Data:
  CEmpty{}
  CLeaf{ch: Chunk}
  CNode{l: CTree, r: CTree}

type Built is Data:
  Built{tree: CTree, rest: List<&2, Chunk>}

def Built.tree(b: Built) -> CTree:
  match b:
    case Built{tree, rest}:
      tree

def Built.rest(b: Built) -> List<&2, Chunk>:
  match b:
    case Built{tree, rest}:
      rest

# a balanced tree of depth d over the first 2^d chunks of the list
def CTree.of(d: Nat, chunks: List<&2, Chunk>) -> Built:
  match d:
    case 0n:
      match chunks:
        case Nil{}:
          Built{CEmpty{}, Nil{}}
        case ch <> t:
          Built{CLeaf{ch}, t}
    case 1n++p:
      +l = CTree.of(p, chunks)
      +r = CTree.of(p, Built.rest(l))
      Built{CNode{Built.tree(l), Built.tree(r)}, Built.rest(r)}

def Block.merge(r1: Stats & Array<Post>, r2: Stats & Array<Post>) -> Stats & Array<Post>:
  (s1, a1) = r1
  (s2, a2) = r2
  (Stats.merge(s1, s2), Array.join(Post, a1, a2))

# the parallel walk: each node forks the shared table for its two halves
def Block.compile(d: Nat, t: CTree, ab: Array<Post> & Array<Post>, +p: C.Params) -> Stats & Array<Post>:
  match d t:
    case 0n CLeaf{ch}:
      Chunk.run(ch, ab, p)
    case 1n++q CNode{l, r}:
      (a1, a2) = ab
      r1 r2 = Block.compile(q, l, Array.fork(Post, a1), p) Block.compile(q, r, Array.fork(Post, a2), p)
      Block.merge(r1, r2)
    case _ _:
      (a1, a2) = ab
      (Stats.zero(), Array.join(Post, a1, a2))

# ------------------------------------------------------------------ reading a block
def Chunks.one.read(+j0: U32, ip: Array<U32>, +L: Lens) -> IO(Array<U32> & Chunk):
  +e0 = Lens.e0(L)
  +ne = (Lens.e1(L) - e0 : U32)
  do IO<Array<U32> & Chunk>:
    idx : List<&2, U32> <- Fx.slurp(Path.graph(), (D.MaleCNS.indices_off() + 4 * e0 : U32), (4 * ne : U32))
    wts : List<&2, U32> <- Fx.slurp(Path.graph(), (D.MaleCNS.weights_off() + 2 * e0 : U32), (2 * ne : U32))
    return (ip, Chunk{j0, Lens.lens(L), idx, wts})

def Chunks.one(+j0: U32, r: Array<U32> & Lens) -> IO(Array<U32> & Chunk):
  (ip, L) = r
  Chunks.one.read(j0, ip, L)

def Chunks.push(acc: List<&2, Chunk>, r: Array<U32> & Chunk) -> Array<U32> & List<&2, Chunk>:
  (ip, ch) = r
  (ip, ch <> acc)

def Chunks.read(fuel: Nat, +j0: U32, st: Array<U32> & List<&2, Chunk>) -> IO(Array<U32> & List<&2, Chunk>):
  match fuel:
    case 0n:
      IO.pure(Array<U32> & List<&2, Chunk>, st)
    case 1n+q:
      (ip, acc) = st
      do IO<Array<U32> & List<&2, Chunk>>:
        r : Array<U32> & Chunk <- Chunks.one(j0, Lens.start(ip, j0))
        Chunks.read(q, (j0 + Chunk.rows() : U32), Chunks.push(acc, r))

# ------------------------------------------------------------------ the block loop
type St is Type:
  St{ip: Array<U32>, posts: Array<Post>, acc: Stats}

def Blocks.fin(ip: Array<U32>, acc: Stats, r: Stats & Array<Post>) -> St:
  (s, posts) = r
  St{ip, posts, Stats.merge(acc, s)}

def Blocks.pure(+p: C.Params, posts: Array<Post>, acc: Stats, r: Array<U32> & List<&2, Chunk>) -> St:
  (ip, chunks) = r
  +built = CTree.of(Block.depth(), List.reverse(&2, Chunk, chunks))
  Blocks.fin(ip, acc, Block.compile(Block.depth(), Built.tree(built), Array.fork(Post, posts), p))

# force a block's result before the next timestamp: the stats print reads every field
def St.touch(st: St) -> IO(St):
  St{ip, posts, acc} = st
  +acc2 = acc
  IO.bind(Unit, St, IO.write(Bool.pick(String, U32.is_zero(Stats.rows_of(acc2)), "", "")), u => IO.pure(St, St{ip, posts, acc2}))

def Blocks.one(+b: U32, +p: C.Params, st: St) -> IO(St):
  St{ip, posts, acc} = st
  do IO<St>:
    t0 : Nat <- IO.now()
    r : Array<U32> & List<&2, Chunk> <- Chunks.read(U32.to_nat(U32.div(Block.rows(), Chunk.rows())), (b * Block.rows() : U32), (ip, Nil{}))
    +t1 : Nat <- IO.now()
    st2 : St = Blocks.pure(p, posts, acc, r)
    st3 : St <- St.touch(st2)
    t2 : Nat <- IO.now()
    IO.print("block " ++ U32.show(b) ++ " read_ms " ++ Nat.show(Nat.sub(t1, t0)) ++ " compile_ms " ++ Nat.show(Nat.sub(t2, t1)))
    return st3

def Blocks.run(fuel: Nat, +b: U32, +p: C.Params, st: St) -> IO(St):
  match fuel:
    case 0n:
      IO.pure(St, st)
    case 1n+q:
      do IO<St>:
        st2 : St <- Blocks.one(b, p, st)
        Blocks.run(q, (b + 1 : U32), p, st2)

def St.print(st: St) -> IO(Unit):
  St{ip, posts, acc} = st
  Stats.print(acc)

# ------------------------------------------------------------------ main
def Gains.at0.fin(m: Maybe<&2, U32>) -> U32:
  match m:
    case None{}:
      0
    case Some{x}:
      x

def Gains.at0(xs: List<&2, U32>) -> U32:
  Gains.at0.fin(List.get(&2, U32, xs, 0n))

def Gains.at1(xs: List<&2, U32>) -> U32:
  Gains.at0.fin(List.get(&2, U32, xs, 1n))

def Main.blocks(+t0: Nat, ip: Array<U32>, posts: Array<Post>) -> IO(Unit):
  do IO<Unit>:
    st : St <- Blocks.run(21n, 0, Params.calibrated(), St{ip, posts, Stats.zero()})
    St.print(st)
    t1 : Nat <- IO.now()
    IO.print("ms_total " ++ Nat.show(Nat.sub(t1, t0)))

def Main.cells(+t0: Nat, hdr: List<&2, U32>, +tail: List<&2, U32>, +flags: List<&2, U32>, signb: List<&2, U32>, sizeb: List<&2, U32>, ipb: List<&2, U32>) -> IO(Unit):
  +n = D.MaleCNS.n()
  +nn = U32.to_nat(n)
  +hdrw = Bytes.u32s(hdr)
  +cls = Bytes.u16s(List.take(&2, U32, tail, U32.to_nat((2 * n : U32))))
  +rest = List.drop(&2, U32, tail, U32.to_nat((2 * n : U32)))
  +nts = List.take(&2, U32, rest, nn)
  +scs = List.take(&2, U32, List.drop(&2, U32, rest, nn), nn)
  +sides = List.drop(&2, U32, rest, U32.to_nat((2 * n : U32)))
  +cells = Cells.of_bytes(flags, nts, sides)
  +p = Params.calibrated()
  +graded = Bytes.f32s(signb)
  +sizes = Bytes.f32s(sizeb)
  +csigns = Signs.compile(cells, graded, Params.neuromod(p))
  +meds = Medians.of(Buckets.of(cells, sizes, Buckets{Nil{}, Nil{}, Nil{}}))
  +scales = Scale.of(cells, sizes, meds, p)
  +ipl = Bytes.u32s(ipb)
  +chk = Indptr.check(ipl)
  do IO<Unit>:
    IO.print("header_n " ++ U32.show(Gains.at0(hdrw)))
    IO.print("header_e " ++ U32.show(Gains.at1(hdrw)))
    IO.print("cells " ++ Nat.show(List.length(&2, C.Cell, cells)))
    IO.print("flags_consistent " ++ Bool.show(Cells.consistent(flags, scs, cls, True{})))
    IO.print("median_optic " ++ F32.show(Medians.ref(meds, C.Optic{})))
    IO.print("median_central " ++ F32.show(Medians.ref(meds, C.Central{})))
    IO.print("median_cord " ++ F32.show(Medians.ref(meds, C.Cord{})))
    CellStats.print(CellStats.of(cells, scales, csigns, sizes, CellStats.zero()))
    IO.print("indptr_ok " ++ Bool.show(IpCheck.ok(chk)))
    IO.print("indptr_last " ++ U32.show(IpCheck.last(chk)))
    t1 : Nat <- IO.now()
    IO.print("ms_cells " ++ Nat.show(Nat.sub(t1, t0)))
    Main.blocks(t0, U32s.into_array(ipl, 0, [0 : U32^18n]), Posts.into_array(Posts.of(cells, scales, csigns), 0, Array.new(Post, 18n, Post.default())))

def main() -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    IO.print("param_minSyn " ++ U32.show(Params.minSyn(Params.calibrated())))
    IO.print("param_neuromod " ++ Bool.show(Params.neuromod(Params.calibrated())))
    IO.print("param_preInh " ++ Bool.show(Params.preInh(Params.calibrated())))
    IO.print("param_kcThreshold " ++ F32.show(Params.kcThreshold(Params.calibrated())))
    IO.print("param_laminaBias " ++ F32.show(Params.laminaBias(Params.calibrated())))
    IO.print("param_inhGain " ++ F32.show(Params.inhGain(Params.calibrated())))
    IO.print("param_sizeAlpha " ++ F32.show(Params.sizeAlpha(Params.calibrated())))
    IO.print("f32_one " ++ F32.show(D.F32.from_bits(1065353216)))
    gsz : U32 <- Fx.size(Path.graph())
    nsz : U32 <- Fx.size(Path.neurons())
    IO.print("graph_bytes " ++ U32.show(gsz))
    IO.print("graph_bytes_expected " ++ U32.show(D.MaleCNS.graph_bytes()))
    IO.print("neurons_bytes " ++ U32.show(nsz))
    IO.print("neurons_bytes_expected " ++ U32.show(D.MaleCNS.neurons_bytes()))
    hdr : List<&2, U32> <- Fx.slurp(Path.graph(), 0, 8)
    tail : List<&2, U32> <- Fx.slurp(Path.neurons(), D.MaleCNS.class_off(), D.MaleCNS.tail_bytes())
    flags : List<&2, U32> <- Fx.slurp(Path.flags(), 0, D.MaleCNS.n())
    signb : List<&2, U32> <- Fx.slurp(Path.ntsign(), 0, D.MaleCNS.f32_table_bytes())
    sizeb : List<&2, U32> <- Fx.slurp(Path.size(), 0, D.MaleCNS.f32_table_bytes())
    ipb : List<&2, U32> <- Fx.slurp(Path.graph(), D.MaleCNS.indptr_off(), (4 * (D.MaleCNS.n() + 1) : U32))
    Main.cells(t0, hdr, tail, flags, signb, sizeb, ipb)
