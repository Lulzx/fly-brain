# Checking the cord IR against the connectome it was taken from (docs/46-cord-ir.md).
#
#   bend cordcheck.bend -o cordcheck && ./cordcheck
#
# Three things are checked. The file's size and section offsets against the layout. Every cord
# row against the full connectome's row for the same cell, filtered to the members and
# relabelled — the induced-subgraph property, entry by entry, by index lookup. And the first
# rows against `cord.bend`'s `DSub.go`, the walk LAWS.bend proves is the induced subgraph, so
# the fast route above is tied to the proven one.
import Base
import ./dataset.bend as D
import ./cord.bend as K
import ./cordio.bend as IOx

# ------------------------------------------------------------------ one row's bookkeeping
type Step is Data:
  Step{gaps: List<&2, U32>, cnts: List<&2, U32>, base: U32, bad: U32, ents: U32}

def Step.gaps(s: Step) -> List<&2, U32>:
  match s:
    case Step{gaps, cnts, base, bad, ents}:
      gaps

def Step.cnts(s: Step) -> List<&2, U32>:
  match s:
    case Step{gaps, cnts, base, bad, ents}:
      cnts

def Step.base(s: Step) -> U32:
  match s:
    case Step{gaps, cnts, base, bad, ents}:
      base

def Step.bad(s: Step) -> U32:
  match s:
    case Step{gaps, cnts, base, bad, ents}:
      bad

def Step.ents(s: Step) -> U32:
  match s:
    case Step{gaps, cnts, base, bad, ents}:
      ents

# One entry of the full row. A target outside the member set contributes nothing; a target
# inside it must be the next cord entry, at the relabelled index and with the same count.
def Row.step(isMember: Bool, +want: U32, +w: U32, st: Step) -> Step:
  match isMember:
    case False{}:
      st
    case True{}:
      Step{gaps, cnts, base, bad, ents} = st
      match gaps:
        case Nil{}:
          Step{Nil{}, cnts, base, (bad + 1 : U32), ents}
        case g <> gt:
          match cnts:
            case Nil{}:
              Step{gt, Nil{}, base, (bad + 1 : U32), ents}
            case c <> ct:
              +post = (base + g : U32)
              Step{gt, ct, (post + 1 : U32),
                (bad + Bool.to_u32(Bool.not(Bool.and(U32.is_eq(post, want), U32.is_eq(c, w)))) : U32),
                (ents + 1 : U32)}

# `pend` holds the membership lookup of the entry being examined; the next entry's lookup is
# issued as the recursive call's argument, and the step's answer travels the same way.
def Row.cmp(idx: List<&2, U32>, wts: List<&2, U32>, +st: Step, pend: Array<U32> & U32) -> Array<U32> & Step:
  match idx:
    case Nil{}:
      (sub, s) = pend
      (sub, st)
    case t <> +it:
      match wts:
        case Nil{}:
          (sub, s) = pend
          (sub, st)
        case w <> wt:
          (sub, +s) = pend
          Row.cmp(it, wt, Row.step(U32.is_gt(s, 0), (s - 1 : U32), w, st), Array.get(U32, sub, IOx.Head.u32(it)))

# ------------------------------------------------------------------ the run's bookkeeping
type Acc is Data:
  Acc{orig: List<&2, U32>, lens: List<&2, U32>, gaps: List<&2, U32>, cnts: List<&2, U32>,
    rows: U32, ents: U32, bad: U32, lenBad: U32, spanBad: U32}

def Acc.gaps(a: Acc) -> List<&2, U32>:
  match a:
    case Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}:
      gaps

def Acc.cnts(a: Acc) -> List<&2, U32>:
  match a:
    case Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}:
      cnts

def Acc.orig(a: Acc) -> List<&2, U32>:
  match a:
    case Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}:
      orig

def Acc.lens(a: Acc) -> List<&2, U32>:
  match a:
    case Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}:
      lens

def Acc.rows(a: Acc) -> U32:
  match a:
    case Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}:
      rows

def Acc.ents(a: Acc) -> U32:
  match a:
    case Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}:
      ents

def Acc.bad(a: Acc) -> U32:
  match a:
    case Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}:
      bad

def Acc.lenBad(a: Acc) -> U32:
  match a:
    case Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}:
      lenBad

def Acc.spanBad(a: Acc) -> U32:
  match a:
    case Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}:
      spanBad

type Out is Type:
  Out{sub: Array<U32>, ip: Array<U32>, acc: Acc}

# the cord row's span, read off its gaps: the index one past its last target
def Span.of(+n: Nat, gaps: List<&2, U32>, +acc: U32) -> U32:
  match n:
    case 0n:
      acc
    case 1n+p:
      match gaps:
        case Nil{}:
          acc
        case g <> gt:
          Span.of(p, gt, (acc + g + 1 : U32))

def Row.fold(ip: Array<U32>, +acc: Acc, +rowLen: U32, +spanBefore: U32, r: Array<U32> & Step) -> Out:
  (sub, +st) = r
  Out{sub, ip, Acc{Acc.orig(acc), Acc.lens(acc), Step.gaps(st), Step.cnts(st),
    (Acc.rows(acc) + 1 : U32), (Acc.ents(acc) + Step.ents(st) : U32), (Acc.bad(acc) + Step.bad(st) : U32),
    (Acc.lenBad(acc) + Bool.to_u32(Bool.not(U32.is_eq(Step.ents(st), rowLen))) : U32),
    (Acc.spanBad(acc) + Bool.to_u32(U32.is_gt(spanBefore, IOx.Cord.n())) : U32)}}

def Row.run(sub: Array<U32>, ip: Array<U32>, +acc: Acc, +rowLen: U32, +idx: List<&2, U32>, wts: List<&2, U32>) -> Out:
  +gaps = Acc.gaps(acc)
  Row.fold(ip, acc, rowLen, Span.of(U32.to_nat(rowLen), gaps, 0),
    Row.cmp(idx, wts, Step{gaps, Acc.cnts(acc), 0, 0, 0}, Array.get(U32, sub, IOx.Head.u32(idx))))

# read one full-connectome row and check the cord row against it
def Rows.read(sub: Array<U32>, ip: Array<U32>, +acc: Acc, +rowLen: U32, +a: U32, +b: U32) -> IO(Out):
  +ne = (b - a : U32)
  do IO<Out>:
    idx : List<&2, U32> <- IOx.Fx.slurp(IOx.Path.graph(), (D.MaleCNS.indices_off() + 4 * a : U32), (4 * ne : U32))
    wts : List<&2, U32> <- IOx.Fx.slurp(IOx.Path.graph(), (D.MaleCNS.weights_off() + 2 * a : U32), (2 * ne : U32))
    return Row.run(sub, ip, acc, rowLen, IOx.Bytes.u32s(idx), IOx.Bytes.u16s(wts))

def Rows.at(sub: Array<U32>, +acc: Acc, +rowLen: U32, +b: U32, r: Array<U32> & U32) -> IO(Out):
  (ip, a) = r
  Rows.read(sub, ip, acc, rowLen, a, b)

def Rows.span(sub: Array<U32>, +acc: Acc, +rowLen: U32, +o: U32, r: Array<U32> & U32) -> IO(Out):
  (ip, +b) = r
  Rows.at(sub, acc, rowLen, b, Array.get(U32, ip, o))

def Rows.one(sub: Array<U32>, ip: Array<U32>, +acc: Acc, +o: U32, +rowLen: U32) -> IO(Out):
  Rows.span(sub, acc, rowLen, o, Array.get(U32, ip, (o + 1 : U32)))

def Rows.go(fuel: Nat, o: Out) -> IO(Out):
  match fuel:
    case 0n:
      IO.pure(Out, o)
    case 1n+p:
      Out{sub, ip, Acc{orig, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}} = o
      match orig:
        case Nil{}:
          IO.pure(Out, Out{sub, ip, Acc{Nil{}, lens, gaps, cnts, rows, ents, bad, lenBad, spanBad}})
        case oi <> ot:
          match lens:
            case Nil{}:
              IO.pure(Out, Out{sub, ip, Acc{ot, Nil{}, gaps, cnts, rows, ents, bad, lenBad, spanBad}})
            case l <> lt:
              do IO<Out>:
                o2 : Out <- Rows.one(sub, ip, Acc{ot, lt, gaps, cnts, rows, ents, bad, lenBad, spanBad}, oi, l)
                Rows.go(p, o2)

# ------------------------------------------------------------------ the proven construction
def DList.eq(a: List<&2, K.DSyn>, b: List<&2, K.DSyn>) -> Bool:
  match a:
    case Nil{}:
      match b:
        case Nil{}:
          True{}
        case h <> t:
          False{}
    case K.DSyn{g1, c1} <> t1:
      match b:
        case Nil{}:
          False{}
        case K.DSyn{g2, c2} <> t2:
          Bool.and(Bool.and(Nat.is_eq(g1, g2), U32.is_eq(c1, c2)), DList.eq(t1, t2))

# the full row as a delta row: the file stores targets, so the gaps are the differences
def Full.delta(idx: List<&2, U32>, wts: List<&2, U32>, +base: U32) -> List<&2, K.DSyn>:
  match idx:
    case Nil{}:
      Nil{}
    case +t <> it:
      match wts:
        case Nil{}:
          Nil{}
        case w <> wt:
          K.DSyn{U32.to_nat((t - base : U32)), w} <> Full.delta(it, wt, (t + 1 : U32))

def Cord.delta(+n: Nat, gaps: List<&2, U32>, cnts: List<&2, U32>) -> List<&2, K.DSyn>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      match gaps:
        case Nil{}:
          Nil{}
        case g <> gt:
          match cnts:
            case Nil{}:
              Nil{}
            case c <> ct:
              K.DSyn{U32.to_nat(g), c} <> Cord.delta(p, gt, ct)

# the membership list over the whole connectome, built downward so it comes out in cell order
def Keep.of(+n: Nat, pend: Array<U32> & U32, +i: U32, acc: List<&2, Bool>) -> Array<U32> & List<&2, Bool>:
  match n:
    case 0n:
      (sub, s) = pend
      (sub, acc)
    case 1n+p:
      (sub, +s) = pend
      +i2 = (i - 1 : U32)
      Keep.of(p, Array.get(U32, sub, i2), i2, U32.is_gt(s, 0) <> acc)

type SAcc is Data:
  SAcc{keep: List<&2, Bool>, orig: List<&2, U32>, lens: List<&2, U32>, gaps: List<&2, U32>,
    cnts: List<&2, U32>, ok: U32, n: U32}

def SAcc.keep(a: SAcc) -> List<&2, Bool>:
  match a:
    case SAcc{keep, orig, lens, gaps, cnts, ok, n}:
      keep

def SAcc.gaps(a: SAcc) -> List<&2, U32>:
  match a:
    case SAcc{keep, orig, lens, gaps, cnts, ok, n}:
      gaps

def SAcc.cnts(a: SAcc) -> List<&2, U32>:
  match a:
    case SAcc{keep, orig, lens, gaps, cnts, ok, n}:
      cnts

def SAcc.orig(a: SAcc) -> List<&2, U32>:
  match a:
    case SAcc{keep, orig, lens, gaps, cnts, ok, n}:
      orig

def SAcc.lens(a: SAcc) -> List<&2, U32>:
  match a:
    case SAcc{keep, orig, lens, gaps, cnts, ok, n}:
      lens

def SAcc.ok(a: SAcc) -> U32:
  match a:
    case SAcc{keep, orig, lens, gaps, cnts, ok, n}:
      ok

def SAcc.n(a: SAcc) -> U32:
  match a:
    case SAcc{keep, orig, lens, gaps, cnts, ok, n}:
      n

type SOut is Type:
  SOut{ip: Array<U32>, acc: SAcc}

def Spec.fold(ip: Array<U32>, +acc: SAcc, +rowLen: Nat, agree: Bool) -> SOut:
  SOut{ip, SAcc{SAcc.keep(acc), SAcc.orig(acc), SAcc.lens(acc),
    List.drop(&2, U32, SAcc.gaps(acc), rowLen), List.drop(&2, U32, SAcc.cnts(acc), rowLen),
    (SAcc.ok(acc) + Bool.to_u32(agree) : U32), (SAcc.n(acc) + 1 : U32)}}

def Spec.read(ip: Array<U32>, +acc: SAcc, +rowLen: U32, +a: U32, +b: U32) -> IO(SOut):
  +ne = (b - a : U32)
  +keep = SAcc.keep(acc)
  +gaps = SAcc.gaps(acc)
  +cnts = SAcc.cnts(acc)
  do IO<SOut>:
    idx : List<&2, U32> <- IOx.Fx.slurp(IOx.Path.graph(), (D.MaleCNS.indices_off() + 4 * a : U32), (4 * ne : U32))
    wts : List<&2, U32> <- IOx.Fx.slurp(IOx.Path.graph(), (D.MaleCNS.weights_off() + 2 * a : U32), (2 * ne : U32))
    return Spec.fold(ip, acc, U32.to_nat(rowLen),
      DList.eq(K.DSub.row(keep, Full.delta(IOx.Bytes.u32s(idx), IOx.Bytes.u16s(wts), 0)),
        Cord.delta(U32.to_nat(rowLen), gaps, cnts)))

def Spec.at(+acc: SAcc, +rowLen: U32, +b: U32, r: Array<U32> & U32) -> IO(SOut):
  (ip, a) = r
  Spec.read(ip, acc, rowLen, a, b)

def Spec.span(+acc: SAcc, +rowLen: U32, +o: U32, r: Array<U32> & U32) -> IO(SOut):
  (ip, +b) = r
  Spec.at(acc, rowLen, b, Array.get(U32, ip, o))

def Spec.one(ip: Array<U32>, +acc: SAcc, +o: U32, +rowLen: U32) -> IO(SOut):
  Spec.span(acc, rowLen, o, Array.get(U32, ip, (o + 1 : U32)))

def Spec.go(fuel: Nat, s: SOut) -> IO(SOut):
  match fuel:
    case 0n:
      IO.pure(SOut, s)
    case 1n+p:
      SOut{ip, SAcc{keep, orig, lens, gaps, cnts, ok, n}} = s
      match orig:
        case Nil{}:
          IO.pure(SOut, SOut{ip, SAcc{keep, Nil{}, lens, gaps, cnts, ok, n}})
        case oi <> ot:
          match lens:
            case Nil{}:
              IO.pure(SOut, SOut{ip, SAcc{keep, ot, Nil{}, gaps, cnts, ok, n}})
            case l <> lt:
              do IO<SOut>:
                s2 : SOut <- Spec.one(ip, SAcc{keep, ot, lt, gaps, cnts, ok, n}, oi, l)
                Spec.go(p, s2)

# ------------------------------------------------------------------ main
def Sub.fill(orig: List<&2, U32>, +k: U32, a: Array<U32>) -> Array<U32>:
  match orig:
    case Nil{}:
      a
    case o <> t:
      Sub.fill(t, (k + 1 : U32), Array.set(U32, a, o, (k + 1 : U32)))

def Report.rows(o: Out) -> IO(Unit):
  Out{sub, ip, acc} = o
  +a = acc
  do IO<Unit>:
    IO.print("rows_checked " ++ U32.show(Acc.rows(a)))
    IO.print("entries_checked " ++ U32.show(Acc.ents(a)))
    IO.print("entry_mismatches " ++ U32.show(Acc.bad(a)))
    IO.print("row_length_mismatches " ++ U32.show(Acc.lenBad(a)))
    IO.print("rows_over_span " ++ U32.show(Acc.spanBad(a)))

def Report.spec(s: SOut, sub: Array<U32>, +acc: Acc, +t0: Nat) -> IO(Unit):
  SOut{ip, sacc} = s
  +sa = sacc
  do IO<Unit>:
    IO.print("spec_rows " ++ U32.show(SAcc.n(sa)))
    IO.print("spec_agree " ++ U32.show(SAcc.ok(sa)))
    +t1 : Nat <- IO.now()
    IO.print("ms_spec " ++ Nat.show(Nat.sub(t1, t0)))
    o : Out <- Rows.go(U32.to_nat(IOx.Cord.n()), Out{sub, ip, acc})
    Report.rows(o)
    t2 : Nat <- IO.now()
    IO.print("ms_total " ++ Nat.show(Nat.sub(t2, t0)))

def Main.spec(kp: Array<U32> & List<&2, Bool>, ip: Array<U32>, +acc: Acc, +t0: Nat) -> IO(Unit):
  (sub, keep) = kp
  do IO<Unit>:
    s : SOut <- Spec.go(32n, SOut{ip, SAcc{keep, Acc.orig(acc), Acc.lens(acc), Acc.gaps(acc), Acc.cnts(acc), 0, 0}})
    Report.spec(s, sub, acc, t0)

def Main.go(+t0: Nat, sub: Array<U32>, ip: Array<U32>, +acc: Acc) -> IO(Unit):
  Main.spec(Keep.of(U32.to_nat(IOx.Cord.n_full()), Array.get(U32, sub, (IOx.Cord.n_full() - 1 : U32)),
    (IOx.Cord.n_full() - 1 : U32), Nil{}), ip, acc, t0)

def main() -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    sz : U32 <- IOx.Fx.size(IOx.Cord.path())
    IO.print("cord_bytes " ++ U32.show(sz))
    IO.print("cord_bytes_expected " ++ U32.show(IOx.Cord.bytes()))
    IO.print("layout_ok " ++ Bool.show(IOx.Cord.layout_ok()))
    ob : List<&2, U32> <- IOx.Fx.slurp(IOx.Cord.path(), IOx.Cord.off_origIdx(), (4 * IOx.Cord.n() : U32))
    ipb : List<&2, U32> <- IOx.Fx.slurp(IOx.Cord.path(), IOx.Cord.off_indptr(), (4 * (IOx.Cord.n() + 1) : U32))
    gb : List<&2, U32> <- IOx.Fx.slurp(IOx.Cord.path(), IOx.Cord.off_gaps(), (4 * IOx.Cord.e() : U32))
    cb : List<&2, U32> <- IOx.Fx.slurp(IOx.Cord.path(), IOx.Cord.off_counts(), (2 * IOx.Cord.e() : U32))
    fib : List<&2, U32> <- IOx.Fx.slurp(IOx.Path.graph(), D.MaleCNS.indptr_off(), (4 * (D.MaleCNS.n() + 1) : U32))
    +orig : List<&2, U32> = IOx.Bytes.u32s(ob)
    +lens : List<&2, U32> = IOx.Lens.of(IOx.Bytes.u32s(ipb))
    IO.print("cord_rows " ++ Nat.show(List.length(&2, U32, orig)))
    Main.go(t0, Sub.fill(orig, 0, [0 : U32^18n]), IOx.U32s.into(IOx.Bytes.u32s(fib), 0, [0 : U32^18n]),
      Acc{orig, lens, IOx.Bytes.u32s(gb), IOx.Bytes.u16s(cb), 0, 0, 0, 0, 0})
