# The cord ensemble on an externally packed cord IR (docs/46-cord-ir.md), in ext/.
#
#   python3 scripts/prep_cord_banc.py --meta <meta.feather> --edges <edges.feather> --out ext
#   bend cordx.bend -o cordx && ./cordx && node scripts/cordx_search.mjs
#
# cordx is cordens.bend generalised: the graph size comes from the file headers rather than
# constants, the tally is an eight-channel table (six leg motor pools plus the left and right
# halves of the cord population, which is what the bilateral phase statistics need), and the
# proprioceptive loop has an open setting as well as three delays.
#
#   axis 0    commissural class        x1        x3
#   axis 1    hemilineage 13A gain     x0.5      x2
#   axis 2    hemilineage 13B gain     x0.5      x2
#   axis 3    hemilineage 19B gain     x0.5      x2
#   axis 4    tonic drive on cord interneurons   0 mV      4 mV
#   axes 5-6  proprioceptive loop      open      closed at 5 ms, 20 ms, or 80 ms
#
#   condition 0  baseline            3  ablate 19B
#             1  ablate 13A          4  cut the commissural class
#             2  ablate 13B          5  silence the descending command
#
# The proprioceptive loop: each step's leg motor-pool spikes come back as drive on the leg
# proprioceptors `pdelay` steps later; in the open setting they keep only their basal rate.
# The output is the per-step count of each channel; scripts/cordx_search.mjs reads the six
# pools as a gait and the two population channels for the in-phase fraction at the peak.
import Base
import ./cordio.bend as IOx
import ./kernel.bend as Kr
import ./perturb.bend as P

# ------------------------------------------------------------------ sizes
def Ens.steps() -> U32:
  4000

def Ens.members() -> U32:
  128

def Ens.conds() -> U32:
  6

def Ens.batch() -> U32:
  16

def Ens.batch_depth() -> Nat:
  4n

def Ens.pgain() -> F32:
  0.6

def Ens.proprio_hz() -> F32:
  20.0

def Ens.command_hz() -> F32:
  100.0

def Ens.out() -> String:
  "ext/cord_search.bin"

def Src.kernel() -> String:
  "ext/cord_kernel.bin"

def Src.tab() -> String:
  "ext/cord_tab.bin"

def Src.ir() -> String:
  "ext/cord_ir.bin"

# sections start where the previous one ends; these writers only use aligned sizes, so the
# padding in the IR descriptor is the identity on the offsets we read
def Src.off_indptr(+n: U32) -> U32:
  (32 + 4 * n : U32)

def Src.off_gaps(+n: U32) -> U32:
  (32 + 8 * n + 4 : U32)

def Src.off_weights(+e: U32) -> U32:
  128

def Src.off_sign(+e: U32) -> U32:
  (128 + 4 * e : U32)

def Src.off_chan(+n: U32) -> U32:
  32

def Src.off_proprio(+n: U32) -> U32:
  (32 + 4 * n : U32)

def Src.off_hl(+n: U32) -> U32:
  (32 + 8 * n : U32)

def Src.off_role(+n: U32) -> U32:
  (32 + 12 * n : U32)

def Src.off_cmd(+n: U32) -> U32:
  (32 + 16 * n : U32)

def Src.off_comm(+n: U32) -> U32:
  (32 + 20 * n : U32)

# ------------------------------------------------------------------ the axes
type Cfg is Data:
  Cfg{g13a: F32, g13b: F32, g19b: F32, tonic: F32, pmode: U32, abl: U32, cmd: F32}

def Cfg.bit(+m: U32, +b: Nat) -> Bool:
  U32.is_ne(U32.and(U32.shrn(m, b), 1), 0)

def Cfg.pick(b: Bool, +lo: F32, +hi: F32) -> F32:
  Bool.pick(F32, b, hi, lo)

# the ablation mask bit for a condition: 1 = 13A, 2 = 13B, 4 = 19B, 0 = none
def Cfg.abl(+c: U32) -> U32:
  Bool.pick(U32, U32.is_eq(c, 1), 1,
    Bool.pick(U32, U32.is_eq(c, 2), 2, Bool.pick(U32, U32.is_eq(c, 3), 4, 0)))

def Cfg.of(+m: U32, +c: U32) -> Cfg:
  Cfg{Cfg.pick(Cfg.bit(m, 1n), 0.5, 2.0), Cfg.pick(Cfg.bit(m, 2n), 0.5, 2.0),
    Cfg.pick(Cfg.bit(m, 3n), 0.5, 2.0), Cfg.pick(Cfg.bit(m, 4n), 0.0, 4.0),
    U32.and(U32.shrn(m, 5n), 3), Cfg.abl(c),
    Bool.pick(F32, U32.is_eq(c, 5), 0.0, Ens.command_hz())}

def Cfg.g13a(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pmode, abl, cmd}:
      g13a

def Cfg.g13b(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pmode, abl, cmd}:
      g13b

def Cfg.g19b(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pmode, abl, cmd}:
      g19b

def Cfg.tonic(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pmode, abl, cmd}:
      tonic

def Cfg.pmode(x: Cfg) -> U32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pmode, abl, cmd}:
      pmode

def Cfg.ablbit(x: Cfg) -> U32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pmode, abl, cmd}:
      abl

def Cfg.cmd(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pmode, abl, cmd}:
      cmd

# the proprioceptive loop: mode 0 is open; the closed modes hold 5, 20, and 80 ms of delay in
# steps of 0.5 ms. The open mode keeps a token history length of one.
def Cfg.closed(+x: Cfg) -> Bool:
  U32.is_ne(Cfg.pmode(x), 0)

def Cfg.pdelay(+x: Cfg) -> U32:
  +p = Cfg.pmode(x)
  Bool.pick(U32, U32.is_eq(p, 1), 10,
    Bool.pick(U32, U32.is_eq(p, 2), 40, Bool.pick(U32, U32.is_eq(p, 3), 160, 1)))

# the commissural row-set a run wants: the cut condition overrides the axis
def Cfg.comm(+m: U32, +c: U32) -> U32:
  Bool.pick(U32, U32.is_eq(c, 4), 2, Bool.pick(U32, Cfg.bit(m, 0n), 1, 0))

def Comm.factor(+g: U32) -> F32:
  Bool.pick(F32, U32.is_eq(g, 0), 1.0, Bool.pick(F32, U32.is_eq(g, 1), 3.0, 0.0))

# ------------------------------------------------------------------ shared tables
# The read-only tables every lane needs, threaded one by one rather than in a record, because
# `Array.fork`'s answer has to arrive as a parameter for the lane below to take it apart.
type Built is Type:
  Built{hl: Array<U32>, role: Array<U32>, proprio: Array<U32>, sign0: Array<F32>,
    cm: Array<U32>, sg: Array<F32>, bi: Array<F32>, dr: Array<F32>, al: Array<U32>}

type ROut is Type:
  ROut{rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, hl: Array<U32>, role: Array<U32>,
    proprio: Array<U32>, cmd: Array<U32>, chan: Array<U32>, bytes: List<&2, U32>}

def Gain.of(+hl: U32, +x: Cfg) -> F32:
  F32.mul(F32.mul(Bool.pick(F32, U32.is_ne(U32.and(hl, 1), 0), Cfg.g13a(x), 1.0),
      Bool.pick(F32, U32.is_ne(U32.and(hl, 2), 0), Cfg.g13b(x), 1.0)),
    Bool.pick(F32, U32.is_ne(U32.and(hl, 4), 0), Cfg.g19b(x), 1.0))

# One pass over the cells. A hemilineage gain multiplies the cell's outgoing sign, which is
# where `outScale` acts in the shipped build; tonic drive is a bias on the cord's interneurons;
# the command cells and the proprioceptors are the only driven cells; and an ablation silences
# a hemilineage through the flag `perturb.bend` proves about.
def Cells.go(+n: Nat, +i: U32, +x: Cfg,
  rh: Array<U32> & U32, ro: Array<U32> & U32, rp: Array<U32> & U32, rs: Array<F32> & F32,
  rc: Array<U32> & U32,
  sg: Array<F32>, bi: Array<F32>, dr: Array<F32>, al: Array<U32>) -> Built:
  match n:
    case 0n:
      (hl, h) = rh
      (role, o) = ro
      (proprio, p) = rp
      (sign, s) = rs
      (cmd, cm) = rc
      Built{hl, role, proprio, sign, cmd, sg, bi, dr, al}
    case 1n+k:
      (hl, +h) = rh
      (role, +o) = ro
      (proprio, +p) = rp
      (sign, s) = rs
      (cmd, +cm) = rc
      +i2 = (i + 1 : U32)
      Cells.go(k, i2, x,
        Array.get(U32, hl, i2), Array.get(U32, role, i2), Array.get(U32, proprio, i2),
        Array.get(F32, sign, i2), Array.get(U32, cmd, i2),
        Array.set(F32, sg, i, F32.mul(s, Gain.of(h, x))),
        Array.set(F32, bi, i, Bool.pick(F32, U32.is_eq(o, 0), Cfg.tonic(x), 0.0)),
        Array.set(F32, dr, i, Bool.pick(F32, U32.is_gt(cm, 0), Cfg.cmd(x),
          Bool.pick(F32, U32.is_gt(p, 0), Ens.proprio_hz(), 0.0))),
        Array.set(U32, al, i, Bool.pick(U32, U32.is_ne(U32.and(h, Cfg.ablbit(x)), 0), 0, 1)))

def Cells.build(hl: Array<U32>, role: Array<U32>, proprio: Array<U32>, sign: Array<F32>,
  cmd: Array<U32>, +n: U32, +x: Cfg) -> Built:
  Cells.go(U32.to_nat(n), 0, x, Array.get(U32, hl, 0), Array.get(U32, role, 0),
    Array.get(U32, proprio, 0), Array.get(F32, sign, 0), Array.get(U32, cmd, 0),
    [0.0 : F32^16n], [0.0 : F32^16n], [0.0 : F32^16n], [0 : U32^16n])

# ------------------------------------------------------------------ the channel tally
# Eight channels: 0-5 are the leg motor pools in the IR's legOrder, 6 and 7 are the left and
# right halves of the cord population, 255 is uncounted. The loop's feedback reads only the
# pools -- a leg drives the sensors that report on it.
type Tal is Data:
  Tal{a: U32, b: U32, c: U32, d: U32, e: U32, f: U32, g: U32, h: U32}

def Tal.zero() -> Tal:
  Tal{0, 0, 0, 0, 0, 0, 0, 0}

def Tal.bump(+l: U32, t: Tal) -> Tal:
  match t:
    case Tal{a, b, c, d, e, f, g, h}:
      Tal{(a + Bool.to_u32(U32.is_eq(l, 0)) : U32), (b + Bool.to_u32(U32.is_eq(l, 1)) : U32),
        (c + Bool.to_u32(U32.is_eq(l, 2)) : U32), (d + Bool.to_u32(U32.is_eq(l, 3)) : U32),
        (e + Bool.to_u32(U32.is_eq(l, 4)) : U32), (f + Bool.to_u32(U32.is_eq(l, 5)) : U32),
        (g + Bool.to_u32(U32.is_eq(l, 6)) : U32), (h + Bool.to_u32(U32.is_eq(l, 7)) : U32)}

def Tal.total(t: Tal) -> U32:
  match t:
    case Tal{a, b, c, d, e, f, g, h}:
      (a + b + c + d + e + f : U32)

# little-endian uint16 per channel, prepended in reverse so one reversal puts the run in order
def Tal.bytes(t: Tal, acc: List<&2, U32>) -> List<&2, U32>:
  match t:
    case Tal{+a, +b, +c, +d, +e, +f, +g, +h}:
      U32.and(U32.shrn(h, 8n), 255) <> (U32.and(h, 255) <>
        (U32.and(U32.shrn(g, 8n), 255) <> (U32.and(g, 255) <>
          (U32.and(U32.shrn(f, 8n), 255) <> (U32.and(f, 255) <>
            (U32.and(U32.shrn(e, 8n), 255) <> (U32.and(e, 255) <>
              (U32.and(U32.shrn(d, 8n), 255) <> (U32.and(d, 255) <>
                (U32.and(U32.shrn(c, 8n), 255) <> (U32.and(c, 255) <>
                  (U32.and(U32.shrn(b, 8n), 255) <> (U32.and(b, 255) <>
                    (U32.and(U32.shrn(a, 8n), 255) <> (U32.and(a, 255) <> acc)))))))))))))))

# the tally consumes its handle on the table and drops it; the lane keeps the other half of
# the fork, which is what lets the whole run be one self-recursive def
def Chan.tal(fired: List<&2, U32>, t: Tal, r: Array<U32> & U32) -> Tal:
  match fired:
    case Nil{}:
      (q, l) = r
      t
    case i <> +ft:
      (q, l) = r
      Chan.tal(ft, Tal.bump(l, t), Array.get(U32, q, Kr.Head.u32(ft)))

# ------------------------------------------------------------------ the proprioceptive loop
def Fb.go(cells: List<&2, U32>, +mv: F32, r: Array<F32> & F32) -> Array<F32>:
  match cells:
    case Nil{}:
      (d, v) = r
      d
    case i <> +ct:
      (d, v) = r
      Fb.go(ct, mv, Array.get(F32, Array.set(F32, d, i, mv), Kr.Head.u32(ct)))

def Fb.drive(+cells: List<&2, U32>, +mv: F32, d: Array<F32>) -> Array<F32>:
  Fb.go(cells, mv, Array.get(F32, d, Kr.Head.u32(cells)))

def Hist.at(h: List<&2, U32>, +k: U32) -> U32:
  Kr.Head.u32(List.drop(&2, U32, h, U32.to_nat(k)))

def Fill.f32(+n: Nat, +i: U32, +x: F32, a: Array<F32>) -> Array<F32>:
  match n:
    case 0n:
      a
    case 1n+p:
      Fill.f32(p, (i + 1 : U32), x, Array.set(F32, a, i, x))

# ------------------------------------------------------------------ one run
# Each turn reads the spikes the previous step left in the delay line's back slot, tallies them
# by channel, records them, feeds the delayed pool total back to the proprioceptors when the
# loop is closed, and takes another step. The first turn reads the empty initial slot, so the
# run emits one more record than it takes steps and the reader drops the first.
def Run.go(+steps: Nat, +driven: List<&2, U32>, +proprio: List<&2, U32>, +K: Kr.Kc, +n: U32,
  +closed: Bool, +pdelay: U32, +hist: List<&2, U32>, +acc: List<&2, U32>,
  hl: Array<U32>, role: Array<U32>, prop: Array<U32>, sign0: Array<F32>, cmd0: Array<U32>,
  pq: Array<U32> & Array<U32>, r: Kr.Run) -> ROut:
  match steps:
    case 0n:
      (q1, q2) = pq
      Kr.Run{Kr.Net{rows, sign}, Kr.LSt{Kr.Lane{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive}, r0, r1, r2, r3, rng, chk}} = r
      ROut{rows, sign0, hl, role, prop, cmd0, Array.join(U32, q1, q2), List.reverse(&2, U32, acc)}
    case 1n+p:
      (q1, q2) = pq
      Kr.Run{Kr.Net{rows, sign}, Kr.LSt{Kr.Lane{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive}, r0, r1, r2, +r3, rng, chk}} = r
      +t = Chan.tal(r3, Tal.zero(), Array.get(U32, q1, Kr.Head.u32(r3)))
      +fb = Bool.pick(F32, closed,
        F32.add(Ens.proprio_hz(), F32.mul(Ens.pgain(), U32.to_f32(Hist.at(hist, (pdelay - 1 : U32))))),
        Ens.proprio_hz())
      Run.go(p, driven, proprio, K, n, closed, pdelay,
        List.take(&2, U32, Tal.total(t) <> hist, U32.to_nat(pdelay)), Tal.bytes(t, acc),
        hl, role, prop, sign0, cmd0, Array.fork(U32, q2),
        Kr.Step.one(driven, K, n,
          Kr.Run{Kr.Net{rows, sign},
            Kr.LSt{Kr.Lane{v, gE, gI, refr, adapt, bias, thr, Fb.drive(proprio, fb, drive), spk, alive},
              r0, r1, r2, r3, rng, chk}}))

# ------------------------------------------------------------------ one lane
def Lane.start(+driven: List<&2, U32>, +proprio: List<&2, U32>, +K: Kr.Kc, +n: U32, +x: Cfg, +seed: U32,
  rows: Array<List<&2, Kr.Edge>>, chan: Array<U32>, b: Built) -> ROut:
  Built{hl, role, prop, sign0, cm, sg, bi, dr, al} = b
  Run.go(1n+U32.to_nat(Ens.steps()), driven, proprio, K, n, Cfg.closed(x), Cfg.pdelay(x), Nil{}, Nil{},
    hl, role, prop, sign0, cm, Array.fork(U32, chan),
    Kr.Run{Kr.Net{rows, sg},
      Kr.LSt{Kr.Lane{Fill.f32(U32.to_nat(n), 0, Kr.Kc.vRest(K), [0.0 : F32^16n]),
        [0.0 : F32^16n], [0.0 : F32^16n], [0.0 : F32^16n], [0.0 : F32^16n], bi,
        [0.0 : F32^16n], dr, [0 : U32^16n], al},
        Nil{}, Nil{}, Nil{}, Nil{}, seed, 0}})

def Lane.one(+driven: List<&2, U32>, +proprio: List<&2, U32>, +K: Kr.Kc, +n: U32, +m: U32, +c: U32,
  rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, hl: Array<U32>, role: Array<U32>,
  prop: Array<U32>, cmd: Array<U32>, chan: Array<U32>) -> ROut:
  Lane.start(driven, proprio, K, n, Cfg.of(m, c), (2654435761 + m * 7919 + c : U32), rows, chan,
    Cells.build(hl, role, prop, sign, cmd, n, Cfg.of(m, c)))

# ------------------------------------------------------------------ a batch of lanes
def Batch.join(a: ROut, b: ROut) -> ROut:
  ROut{r1, s1, h1, o1, p1, d1, q1, b1} = a
  ROut{r2, s2, h2, o2, p2, d2, q2, b2} = b
  ROut{Array.join(List<&2, Kr.Edge>, r1, r2), Array.join(F32, s1, s2), Array.join(U32, h1, h2),
    Array.join(U32, o1, o2), Array.join(U32, p1, p2), Array.join(U32, d1, d2), Array.join(U32, q1, q2),
    List.append(&2, U32, b1, b2)}

def Batch.leaf(r2: Array<List<&2, Kr.Edge>>, s2: Array<F32>, h2: Array<U32>, o2: Array<U32>,
  p2: Array<U32>, d2: Array<U32>, q2: Array<U32>, a: ROut) -> ROut:
  ROut{r1, s1, h1, o1, p1, d1, q1, bs} = a
  ROut{Array.join(List<&2, Kr.Edge>, r1, r2), Array.join(F32, s1, s2), Array.join(U32, h1, h2),
    Array.join(U32, o1, o2), Array.join(U32, p1, p2), Array.join(U32, d1, d2), Array.join(U32, q1, q2), bs}

# run index within a commissural group -> member and condition
#   group 2: every member at condition 4; groups 0 and 1: the members carrying that axis bit,
#   at conditions 0, 1, 2, 3 and 5
def Run.member(+j: U32, +grp: U32) -> U32:
  Bool.pick(U32, U32.is_eq(grp, 2), j, (2 * U32.div(j, 5) + U32.and(grp, 1) : U32))

def Run.cond(+j: U32, +grp: U32) -> U32:
  Bool.pick(U32, U32.is_eq(grp, 2), 4,
    Bool.pick(U32, U32.is_lt(U32.mod(j, 5), 4), U32.mod(j, 5), 5))

def Batch.go(+d: Nat, +driven: List<&2, U32>, +proprio: List<&2, U32>, +K: Kr.Kc, +n: U32,
  +j0: U32, +grp: U32,
  pr: Array<List<&2, Kr.Edge>> & Array<List<&2, Kr.Edge>>, ps: Array<F32> & Array<F32>,
  ph: Array<U32> & Array<U32>, po: Array<U32> & Array<U32>, pp: Array<U32> & Array<U32>,
  pdd: Array<U32> & Array<U32>, pq: Array<U32> & Array<U32>) -> ROut:
  match d:
    case 0n:
      (r1, r2) = pr
      (s1, s2) = ps
      (h1, h2) = ph
      (o1, o2) = po
      (p1, p2) = pp
      (dd1, dd2) = pdd
      (q1, q2) = pq
      Batch.leaf(r2, s2, h2, o2, p2, dd2, q2,
        Lane.one(driven, proprio, K, n, Run.member(j0, grp), Run.cond(j0, grp), r1, s1, h1, o1, p1, dd1, q1))
    case 1n++e:
      (r1, r2) = pr
      (s1, s2) = ps
      (h1, h2) = ph
      (o1, o2) = po
      (p1, p2) = pp
      (dd1, dd2) = pdd
      (q1, q2) = pq
      a b = Batch.go(e, driven, proprio, K, n, j0, grp, Array.fork(List<&2, Kr.Edge>, r1),
          Array.fork(F32, s1), Array.fork(U32, h1), Array.fork(U32, o1), Array.fork(U32, p1),
          Array.fork(U32, dd1), Array.fork(U32, q1))
        Batch.go(e, driven, proprio, K, n, (j0 + U32.shln(1, e) : U32), grp,
          Array.fork(List<&2, Kr.Edge>, r2), Array.fork(F32, s2), Array.fork(U32, h2),
          Array.fork(U32, o2), Array.fork(U32, p2), Array.fork(U32, dd2), Array.fork(U32, q2))
      Batch.join(a, b)

# ------------------------------------------------------------------ building the rows
type Tk is Data:
  Tk{row: List<&2, Kr.Edge>, gaps: List<&2, U32>, ws: List<&2, F32>, cm: List<&2, U32>}

def Tk.row(t: Tk) -> List<&2, Kr.Edge>:
  match t:
    case Tk{row, gaps, ws, cm}:
      row

def Tk.gaps(t: Tk) -> List<&2, U32>:
  match t:
    case Tk{row, gaps, ws, cm}:
      gaps

def Tk.ws(t: Tk) -> List<&2, F32>:
  match t:
    case Tk{row, gaps, ws, cm}:
      ws

def Tk.cm(t: Tk) -> List<&2, U32>:
  match t:
    case Tk{row, gaps, ws, cm}:
      cm

# one row, with the commissural class multiplied by this group's factor
def Rows.take(+n: Nat, +base: U32, +f: F32, gaps: List<&2, U32>, ws: List<&2, F32>, cm: List<&2, U32>,
  acc: List<&2, Kr.Edge>) -> Tk:
  match n:
    case 0n:
      Tk{List.reverse(&2, Kr.Edge, acc), gaps, ws, cm}
    case 1n+p:
      match gaps:
        case Nil{}:
          Tk{List.reverse(&2, Kr.Edge, acc), Nil{}, ws, cm}
        case g <> gt:
          match ws:
            case Nil{}:
              Tk{List.reverse(&2, Kr.Edge, acc), gt, Nil{}, cm}
            case +w <> wt:
              match cm:
                case Nil{}:
                  Tk{List.reverse(&2, Kr.Edge, acc), gt, wt, Nil{}}
                case c <> ct:
                  +post = (base + g : U32)
                  Rows.take(p, (post + 1 : U32), f, gt, wt, ct,
                    Kr.Edge{post, Bool.pick(F32, U32.is_gt(c, 0), F32.mul(w, f), w)} <> acc)

def Rows.build(lens: List<&2, U32>, +f: F32, gaps: List<&2, U32>, ws: List<&2, F32>, cm: List<&2, U32>,
  +k: U32, a: Array<List<&2, Kr.Edge>>) -> Array<List<&2, Kr.Edge>>:
  match lens:
    case Nil{}:
      a
    case l <> lt:
      +tk = Rows.take(U32.to_nat(l), 0, f, gaps, ws, cm, Nil{})
      Rows.build(lt, f, Tk.gaps(tk), Tk.ws(tk), Tk.cm(tk), (k + 1 : U32),
        Array.set(List<&2, Kr.Edge>, a, k, Tk.row(tk)))

# ------------------------------------------------------------------ the driven sets
type Ids is Data:
  Ids{d: List<&2, U32>, p: List<&2, U32>}

def Ids.d(x: Ids) -> List<&2, U32>:
  match x:
    case Ids{d, p}:
      d

def Ids.p(x: Ids) -> List<&2, U32>:
  match x:
    case Ids{d, p}:
      p

def Ids.go(cmds: List<&2, U32>, props: List<&2, U32>, +i: U32, +accD: List<&2, U32>, +accP: List<&2, U32>) -> Ids:
  match cmds:
    case Nil{}:
      Ids{List.reverse(&2, U32, accD), List.reverse(&2, U32, accP)}
    case +c <> ct:
      match props:
        case Nil{}:
          Ids{List.reverse(&2, U32, accD), List.reverse(&2, U32, accP)}
        case +p <> pt:
          +i2 = (i + 1 : U32)
          Ids.go(ct, pt, i2,
            Bool.pick(List<&2, U32>, Bool.or(U32.is_gt(c, 0), U32.is_gt(p, 0)), i <> accD, accD),
            Bool.pick(List<&2, U32>, U32.is_gt(p, 0), i <> accP, accP))

# ------------------------------------------------------------------ the batch and group loops
def Batches.go(nb: Nat, +j0: U32, +grp: U32, +driven: List<&2, U32>, +proprio: List<&2, U32>,
  +K: Kr.Kc, +n: U32, +acc: List<&2, U32>, r: ROut) -> IO(ROut):
  match nb:
    case 0n:
      ROut{rows, sign, hl, role, prop, cmd, chan, bs} = r
      IO.pure(ROut, ROut{rows, sign, hl, role, prop, cmd, chan, List.append(&2, U32, acc, bs)})
    case 1n+p:
      ROut{rows, sign, hl, role, prop, cmd, chan, bs} = r
      do IO<ROut>:
        IO.print("run " ++ U32.show(j0) ++ " group " ++ U32.show(grp))
        Batches.go(p, (j0 + Ens.batch() : U32), grp, driven, proprio, K, n,
          List.append(&2, U32, acc, bs),
          Batch.go(Ens.batch_depth(), driven, proprio, K, n, j0, grp,
            Array.fork(List<&2, Kr.Edge>, rows), Array.fork(F32, sign), Array.fork(U32, hl),
            Array.fork(U32, role), Array.fork(U32, prop), Array.fork(U32, cmd), Array.fork(U32, chan)))

def Batches.count(+g: U32) -> Nat:
  U32.to_nat(Bool.pick(U32, U32.is_eq(g, 2), U32.div(Ens.members(), Ens.batch()),
    U32.div((U32.div(Ens.members(), 2) * 5 : U32), Ens.batch())))

def Groups.go(ng: Nat, +g: U32, +driven: List<&2, U32>, +proprio: List<&2, U32>, +K: Kr.Kc, +n: U32,
  +lens: List<&2, U32>, +gaps: List<&2, U32>, +ws: List<&2, F32>, +cm: List<&2, U32>,
  +acc: List<&2, U32>, r: ROut) -> IO(ROut):
  match ng:
    case 0n:
      ROut{rows, sign, hl, role, prop, cmd, chan, bs} = r
      IO.pure(ROut, ROut{rows, sign, hl, role, prop, cmd, chan, List.append(&2, U32, acc, bs)})
    case 1n+p:
      ROut{rows0, sign, hl, role, prop, cmd, chan, bs} = r
      do IO<ROut>:
        IO.print("commissural group " ++ U32.show(g) ++ " factor " ++ F32.show(Comm.factor(g)))
        r2 : ROut <- Batches.go(Batches.count(g), 0, g, driven, proprio, K, n, Nil{},
          ROut{Rows.build(lens, Comm.factor(g), gaps, ws, cm, 0, Array.new(List<&2, Kr.Edge>, 16n, Nil{})),
            sign, hl, role, prop, cmd, chan, Nil{}})
        Groups.go(p, (g + 1 : U32), driven, proprio, K, n, lens, gaps, ws, cm,
          List.append(&2, U32, acc, bs), r2)

# ------------------------------------------------------------------ output
def Fx.dump.fin(f: File, r: Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  match r:
    case Done{u}:
      File.close(f)
    case Fail{(code, msg)}:
      IO.die(Unit, code, msg)

def Fx.dump.pair(r: File & Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  (f, res) = r
  Fx.dump.fin(f, res)

def Fx.dump.go(data: List<&2, U32>, f: File) -> IO(Unit):
  IO.bind(File & Result<&1, &1, U32 & String, Unit>, Unit, File.write_bytes(f, data), Fx.dump.pair)

def Fx.dump(path: String, data: List<&2, U32>) -> IO(Unit):
  IO.bind(File, Unit, IO.try(File, File.open(path, "w")), f => Fx.dump.go(data, f))

def Hdr.u32(+x: U32, acc: List<&2, U32>) -> List<&2, U32>:
  U32.and(x, 255) <> (U32.and(U32.shrn(x, 8n), 255) <>
    (U32.and(U32.shrn(x, 16n), 255) <> (U32.and(U32.shrn(x, 24n), 255) <> acc)))

# magic 'SUCH', version 2, steps, members, conditions, channels, records per run, runs
def Hdr.of(body: List<&2, U32>) -> List<&2, U32>:
  Hdr.u32(1212372307, Hdr.u32(2, Hdr.u32(Ens.steps(), Hdr.u32(Ens.members(),
    Hdr.u32(Ens.conds(), Hdr.u32(8, Hdr.u32((Ens.steps() + 1 : U32),
      Hdr.u32((Ens.members() * Ens.conds() : U32), body))))))))

# ------------------------------------------------------------------ main
def At.u32(xs: List<&2, U32>, +i: Nat) -> U32:
  match xs:
    case Nil{}:
      0
    case h <> t:
      match i:
        case 0n:
          h
        case 1n+p:
          At.u32(t, p)

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

def Out.write(+t0: Nat, r: ROut) -> IO(Unit):
  ROut{rows, sign, hl, role, prop, cmd, chan, bs} = r
  +body = bs
  do IO<Unit>:
    IO.print("bytes " ++ Nat.show(List.length(&2, U32, body)))
    Fx.dump(Ens.out(), Hdr.of(body))
    t1 : Nat <- IO.now()
    IO.print("ms_total " ++ Nat.show(Nat.sub(t1, t0)))

def Main.go(+t0: Nat, +K: Kr.Kc, +n: U32, +ids: Ids, +lens: List<&2, U32>, +gaps: List<&2, U32>,
  +ws: List<&2, F32>, +cm: List<&2, U32>, sign: Array<F32>, hl: Array<U32>, role: Array<U32>,
  prop: Array<U32>, cmd: Array<U32>, chan: Array<U32>) -> IO(Unit):
  do IO<Unit>:
    IO.print("driven " ++ Nat.show(List.length(&2, U32, Ids.d(ids))) ++ " proprioceptors " ++ Nat.show(List.length(&2, U32, Ids.p(ids))))
    r : ROut <- Groups.go(3n, 0, Ids.d(ids), Ids.p(ids), K, n, lens, gaps, ws, cm, Nil{},
      ROut{Array.new(List<&2, Kr.Edge>, 0n, Nil{}), sign, hl, role, prop, cmd, chan, Nil{}})
    Out.write(t0, r)

def main() -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    IO.print("members " ++ U32.show(Ens.members()) ++ " conditions " ++ U32.show(Ens.conds()) ++ " steps " ++ U32.show(Ens.steps()))
    irh : List<&2, U32> <- IOx.Fx.slurp(Src.ir(), 0, 32)
    +hdr : List<&2, U32> = IOx.Bytes.u32s(irh)
    +n : U32 = At.u32(hdr, 2n)
    +e : U32 = At.u32(hdr, 3n)
    IO.print("cells " ++ U32.show(n) ++ " edges " ++ U32.show(e))
    csb : List<&2, U32> <- IOx.Fx.slurp(Src.kernel(), 64, 64)
    wb : List<&2, U32> <- IOx.Fx.slurp(Src.kernel(), Src.off_weights(e), (4 * e : U32))
    sgb : List<&2, U32> <- IOx.Fx.slurp(Src.kernel(), Src.off_sign(e), (4 * n : U32))
    chb : List<&2, U32> <- IOx.Fx.slurp(Src.tab(), Src.off_chan(n), (4 * n : U32))
    ppb : List<&2, U32> <- IOx.Fx.slurp(Src.tab(), Src.off_proprio(n), (4 * n : U32))
    hlb : List<&2, U32> <- IOx.Fx.slurp(Src.tab(), Src.off_hl(n), (4 * n : U32))
    rlb : List<&2, U32> <- IOx.Fx.slurp(Src.tab(), Src.off_role(n), (4 * n : U32))
    cdb : List<&2, U32> <- IOx.Fx.slurp(Src.tab(), Src.off_cmd(n), (4 * n : U32))
    cmb : List<&2, U32> <- IOx.Fx.slurp(Src.tab(), Src.off_comm(n), (4 * e : U32))
    ipb : List<&2, U32> <- IOx.Fx.slurp(Src.ir(), Src.off_indptr(n), (4 * (n + 1) : U32))
    gpb : List<&2, U32> <- IOx.Fx.slurp(Src.ir(), Src.off_gaps(n), (4 * e : U32))
    +props : List<&2, U32> = IOx.Bytes.u32s(ppb)
    +cmds : List<&2, U32> = IOx.Bytes.u32s(cdb)
    Main.go(t0, Kc.of(IOx.Bytes.f32s(csb)), n, Ids.go(cmds, props, 0, Nil{}, Nil{}),
      IOx.Lens.of(IOx.Bytes.u32s(ipb)), IOx.Bytes.u32s(gpb), IOx.Bytes.f32s(wb), IOx.Bytes.u32s(cmb),
      IOx.F32s.into(IOx.Bytes.f32s(sgb), 0, [0.0 : F32^16n]),
      IOx.U32s.into(IOx.Bytes.u32s(hlb), 0, [0 : U32^16n]),
      IOx.U32s.into(IOx.Bytes.u32s(rlb), 0, [0 : U32^16n]),
      IOx.U32s.into(props, 0, [0 : U32^16n]),
      IOx.U32s.into(cmds, 0, [0 : U32^16n]),
      IOx.U32s.into(IOx.Bytes.u32s(chb), 0, [0 : U32^16n]))
