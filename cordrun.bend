# The gate for the Bend cord kernel (docs/46-cord-ir.md).
#
#   node scripts/cord_kernel_ref.mjs && bend cordrun.bend -o cordrun && ./cordrun
#
# Reads public/data/cord_kernel.bin -- the constants, the compiled weights and signs, the
# drive, and the answer the shipped WebAssembly kernel gave -- runs kernel.bend's port over
# the cord's rows, and reports whether the two agree. Agreement is exact: the same spikes in
# the same cells at the same steps, not a statistical match.
import Base
import ./cordio.bend as IOx
import ./kernel.bend as Kr

def Ref.path() -> String:
  "public/data/cord_kernel.bin"

def Ref.steps() -> U32:
  1000

def Ref.n_driven() -> U32:
  1639

def Ref.off_consts() -> U32:
  64

def Ref.off_weights() -> U32:
  128

def Ref.off_sign() -> U32:
  6460856

def Ref.off_drive() -> U32:
  6548228

def Ref.off_alive() -> U32:
  6635600

def Ref.off_driven() -> U32:
  6722972

def Ref.off_fired() -> U32:
  6729528

def Ref.off_spikes() -> U32:
  6733528

def Ref.bytes() -> U32:
  6820900

# ------------------------------------------------------------------ constants
def At.f32(xs: List<&2, F32>, +i: Nat) -> F32:
  match xs:
    case Nil{}:
      0.0
    case h <> t:
      match i:
        case 0n:
          h
        case 1n+p:
          At.f32(t, p)

def Kc.of(+cs: List<&2, F32>) -> Kr.Kc:
  Kr.Kc{At.f32(cs, 0n), At.f32(cs, 1n), At.f32(cs, 2n), At.f32(cs, 3n), At.f32(cs, 4n), At.f32(cs, 5n),
    At.f32(cs, 7n), At.f32(cs, 8n), At.f32(cs, 10n), At.f32(cs, 11n), At.f32(cs, 12n), At.f32(cs, 13n),
    At.f32(cs, 14n), At.f32(cs, 15n)}

# ------------------------------------------------------------------ the rows
type Tk is Data:
  Tk{row: List<&2, Kr.Edge>, gaps: List<&2, U32>, ws: List<&2, F32>}

def Tk.row(t: Tk) -> List<&2, Kr.Edge>:
  match t:
    case Tk{row, gaps, ws}:
      row

def Tk.gaps(t: Tk) -> List<&2, U32>:
  match t:
    case Tk{row, gaps, ws}:
      gaps

def Tk.ws(t: Tk) -> List<&2, F32>:
  match t:
    case Tk{row, gaps, ws}:
      ws

# one row: gaps become absolute targets, paired with the compiled weight
def Rows.take(+n: Nat, +base: U32, gaps: List<&2, U32>, ws: List<&2, F32>, acc: List<&2, Kr.Edge>) -> Tk:
  match n:
    case 0n:
      Tk{List.reverse(&2, Kr.Edge, acc), gaps, ws}
    case 1n+p:
      match gaps:
        case Nil{}:
          Tk{List.reverse(&2, Kr.Edge, acc), Nil{}, ws}
        case g <> gt:
          match ws:
            case Nil{}:
              Tk{List.reverse(&2, Kr.Edge, acc), gt, Nil{}}
            case w <> wt:
              +post = (base + g : U32)
              Rows.take(p, (post + 1 : U32), gt, wt, Kr.Edge{post, w} <> acc)

def Rows.build(lens: List<&2, U32>, +k: U32, gaps: List<&2, U32>, ws: List<&2, F32>, a: Array<List<&2, Kr.Edge>>) -> Array<List<&2, Kr.Edge>>:
  match lens:
    case Nil{}:
      a
    case l <> lt:
      +tk = Rows.take(U32.to_nat(l), 0, gaps, ws, Nil{})
      Rows.build(lt, (k + 1 : U32), Tk.gaps(tk), Tk.ws(tk), Array.set(List<&2, Kr.Edge>, a, k, Tk.row(tk)))

# ------------------------------------------------------------------ setup
def Fill.f32(+n: Nat, +i: U32, +x: F32, a: Array<F32>) -> Array<F32>:
  match n:
    case 0n:
      a
    case 1n+p:
      Fill.f32(p, (i + 1 : U32), x, Array.set(F32, a, i, x))

def Driven.of(drive: List<&2, U32>) -> List<&2, U32>:
  drive

# ------------------------------------------------------------------ comparison
type Tally is Data:
  Tally{bad: U32, total: U32}

def Tally.bad(c: Tally) -> U32:
  match c:
    case Tally{bad, total}:
      bad

def Tally.total(c: Tally) -> U32:
  match c:
    case Tally{bad, total}:
      total

def Tally.go(ref: List<&2, U32>, +i: U32, +bad: U32, +total: U32, r: Array<U32> & U32) -> Array<U32> & Tally:
  match ref:
    case Nil{}:
      (a, v) = r
      (a, Tally{bad, total})
    case x <> t:
      (a, +v) = r
      +i2 = (i + 1 : U32)
      Tally.go(t, i2, (bad + Bool.to_u32(Bool.not(U32.is_eq(x, v))) : U32), (total + v : U32),
        Array.get(U32, a, i2))

def Chk.sum(xs: List<&2, U32>, +acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      Chk.sum(t, (acc + x : U32))

# the reference's own checksum over the per-step spike counts
def Chk.of(xs: List<&2, U32>, +acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      Chk.of(t, (acc * 1000003 + x : U32))

# ------------------------------------------------------------------ report
def Report.go(+chkRef: U32, +firedRef: U32, r: Array<U32> & Tally, +chkGot: U32, +t0: Nat) -> IO(Unit):
  (a, +c) = r
  do IO<Unit>:
    IO.print("spikes_ref " ++ U32.show(firedRef))
    IO.print("spikes_bend " ++ U32.show(Tally.total(c)))
    IO.print("neurons_mismatched " ++ U32.show(Tally.bad(c)))
    IO.print("step_checksum_ref " ++ U32.show(chkRef))
    IO.print("step_checksum_bend " ++ U32.show(chkGot))
    IO.print("bit_identical " ++ Bool.show(Bool.and(U32.is_zero(Tally.bad(c)),
      Bool.and(U32.is_eq(chkRef, chkGot), U32.is_eq(firedRef, Tally.total(c))))))
    t1 : Nat <- IO.now()
    IO.print("ms_total " ++ Nat.show(Nat.sub(t1, t0)))

def Report.of(+chkRef: U32, +firedRef: U32, +spikes: List<&2, U32>, +t0: Nat, r: Kr.Run) -> IO(Unit):
  Kr.Run{Kr.Net{rows, sign}, Kr.LSt{Kr.Lane{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive}, r0, r1, r2, r3, rng, chk}} = r
  Report.go(chkRef, firedRef, Tally.go(spikes, 0, 0, 0, Array.get(U32, spk, 0)), chk, t0)

def Main.run(+n: U32, +K: Kr.Kc, +driven: List<&2, U32>, +seed: U32, +chkRef: U32, +firedRef: U32,
  +spikes: List<&2, U32>, +t0: Nat, rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, drive: Array<F32>,
  alive: Array<U32>) -> IO(Unit):
  Report.of(chkRef, firedRef, spikes, t0,
    Kr.Kernel.run(U32.to_nat(Ref.steps()), driven, K, n,
      Kr.Run{Kr.Net{rows, sign},
        Kr.LSt{Kr.Lane{Fill.f32(U32.to_nat(n), 0, Kr.Kc.vRest(K), [0.0 : F32^15n]),
          [0.0 : F32^15n], [0.0 : F32^15n], [0.0 : F32^15n], [0.0 : F32^15n], [0.0 : F32^15n],
          [0.0 : F32^15n], drive, [0 : U32^15n], alive},
          Nil{}, Nil{}, Nil{}, Nil{}, seed, 0}}))

def main() -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    sz : U32 <- IOx.Fx.size(Ref.path())
    IO.print("ref_bytes " ++ U32.show(sz))
    IO.print("ref_bytes_expected " ++ U32.show(Ref.bytes()))
    hb : List<&2, U32> <- IOx.Fx.slurp(Ref.path(), 0, 64)
    csb : List<&2, U32> <- IOx.Fx.slurp(Ref.path(), Ref.off_consts(), 64)
    wb : List<&2, U32> <- IOx.Fx.slurp(Ref.path(), Ref.off_weights(), (4 * IOx.Cord.e() : U32))
    sgb : List<&2, U32> <- IOx.Fx.slurp(Ref.path(), Ref.off_sign(), (4 * IOx.Cord.n() : U32))
    drb : List<&2, U32> <- IOx.Fx.slurp(Ref.path(), Ref.off_drive(), (4 * IOx.Cord.n() : U32))
    alb : List<&2, U32> <- IOx.Fx.slurp(Ref.path(), Ref.off_alive(), (4 * IOx.Cord.n() : U32))
    dvb : List<&2, U32> <- IOx.Fx.slurp(Ref.path(), Ref.off_driven(), (4 * Ref.n_driven() : U32))
    fdb : List<&2, U32> <- IOx.Fx.slurp(Ref.path(), Ref.off_fired(), (4 * Ref.steps() : U32))
    spb : List<&2, U32> <- IOx.Fx.slurp(Ref.path(), Ref.off_spikes(), (4 * IOx.Cord.n() : U32))
    ipb : List<&2, U32> <- IOx.Fx.slurp(IOx.Cord.path(), IOx.Cord.off_indptr(), (4 * (IOx.Cord.n() + 1) : U32))
    gpb : List<&2, U32> <- IOx.Fx.slurp(IOx.Cord.path(), IOx.Cord.off_gaps(), (4 * IOx.Cord.e() : U32))
    +hdr : List<&2, U32> = IOx.Bytes.u32s(hb)
    +K : Kr.Kc = Kc.of(IOx.Bytes.f32s(csb))
    +fired : List<&2, U32> = IOx.Bytes.u32s(fdb)
    IO.print("ref_N " ++ U32.show(IOx.Head.u32(List.drop(&2, U32, hdr, 2n))))
    IO.print("ref_steps " ++ U32.show(IOx.Head.u32(List.drop(&2, U32, hdr, 4n))))
    IO.print("ref_cut_edges " ++ U32.show(IOx.Head.u32(List.drop(&2, U32, hdr, 8n))))
    IO.print("dt " ++ F32.show(Kr.Kc.dt(K)) ++ " vRest " ++ F32.show(Kr.Kc.vRest(K)) ++ " vThresh " ++ F32.show(Kr.Kc.vThresh(K)))
    Main.run(IOx.Cord.n(), K, IOx.Bytes.u32s(dvb), IOx.Head.u32(List.drop(&2, U32, hdr, 6n)),
      Chk.of(fired, 0), Chk.sum(fired, 0), IOx.Bytes.u32s(spb), t0,
      Rows.build(IOx.Lens.of(IOx.Bytes.u32s(ipb)), 0, IOx.Bytes.u32s(gpb), IOx.Bytes.f32s(wb), Array.new(List<&2, Kr.Edge>, 15n, Nil{})),
      IOx.F32s.into(IOx.Bytes.f32s(sgb), 0, [0.0 : F32^15n]),
      IOx.F32s.into(IOx.Bytes.f32s(drb), 0, [0.0 : F32^15n]),
      IOx.U32s.into(IOx.Bytes.u32s(alb), 0, [0 : U32^15n]))
