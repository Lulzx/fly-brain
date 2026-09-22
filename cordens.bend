# The cord ensemble: many members and many perturbations, one per lane (docs/46-cord-ir.md).
#
#   node scripts/cord_kernel_ref.mjs && node scripts/cord_ens_tab.mjs
#   bend cordens.bend -o cordens && ./cordens
#
# Six binary axes over the gains the connectome does not fix, crossed with six named
# perturbations, run on the kernel `cordrun.bend` gates bit-identical. Every lane derives its
# own configuration from its index, so there is no config file to drift: the axes are in
# `Cfg.of` and nowhere else.
#
#   axis 0  commissural class        x1        x3
#   axis 1  hemilineage 13A gain     x0.5      x2
#   axis 2  hemilineage 13B gain     x0.5      x2
#   axis 3  hemilineage 19B gain     x0.5      x2
#   axis 4  tonic drive on cord interneurons   0 mV      4 mV
#   axis 5  proprioceptive loop delay          5 ms      20 ms
#
#   condition 0  baseline            3  ablate 19B
#             1  ablate 13A          4  cut the commissural class
#             2  ablate 13B          5  silence the descending command
#
# The proprioceptive loop is closed: each step's leg motor-pool spikes come back as drive on
# the 366 proprioceptors `pdelay` steps later, which is doc 36's second item as a dial rather
# than a constant. The output is the per-step spike count of each of the six leg pools, which
# `src/exp/pools.js` reads as a gait.
import Base
import ./cordio.bend as IOx
import ./kernel.bend as Kr
import ./perturb.bend as P

# ------------------------------------------------------------------ sizes
def Ens.steps() -> U32:
  1000

def Ens.members() -> U32:
  64

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
  60.0

def Ens.out() -> String:
  "public/data/cord_search.bin"

def Ref2.kernel() -> String:
  "public/data/cord_kernel.bin"

def Tab.path() -> String:
  "public/data/cord_ens_tab.bin"

def Tab.off_poolId() -> U32:
  32

def Tab.off_proprio() -> U32:
  87404

def Tab.off_hl() -> U32:
  174776

def Tab.off_role() -> U32:
  262148

def Tab.off_comm() -> U32:
  349520

# ------------------------------------------------------------------ the axes
type Cfg is Data:
  Cfg{g13a: F32, g13b: F32, g19b: F32, tonic: F32, pdelay: U32, abl: U32, cmd: F32}

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
    Bool.pick(U32, Cfg.bit(m, 5n), 40, 10), Cfg.abl(c),
    Bool.pick(F32, U32.is_eq(c, 5), 0.0, Ens.command_hz())}

def Cfg.g13a(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pdelay, abl, cmd}:
      g13a

def Cfg.g13b(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pdelay, abl, cmd}:
      g13b

def Cfg.g19b(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pdelay, abl, cmd}:
      g19b

def Cfg.tonic(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pdelay, abl, cmd}:
      tonic

def Cfg.pdelay(x: Cfg) -> U32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pdelay, abl, cmd}:
      pdelay

def Cfg.ablbit(x: Cfg) -> U32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pdelay, abl, cmd}:
      abl

def Cfg.cmd(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, g19b, tonic, pdelay, abl, cmd}:
      cmd

# the commissural row-set a run wants: the cut condition overrides the axis
def Cfg.comm(+m: U32, +c: U32) -> U32:
  Bool.pick(U32, U32.is_eq(c, 4), 2, Bool.pick(U32, Cfg.bit(m, 0n), 1, 0))

def Comm.factor(+g: U32) -> F32:
  Bool.pick(F32, U32.is_eq(g, 0), 1.0, Bool.pick(F32, U32.is_eq(g, 1), 3.0, 0.0))

# ------------------------------------------------------------------ shared tables
# The six read-only tables every lane needs. They are threaded one by one rather than in a
# record, because `Array.fork`'s answer has to arrive as a parameter for the lane below to
# take it apart.
type Built is Type:
  Built{hl: Array<U32>, role: Array<U32>, proprio: Array<U32>, sign0: Array<F32>,
    sg: Array<F32>, bi: Array<F32>, dr: Array<F32>, al: Array<U32>}

type ROut is Type:
  ROut{rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, hl: Array<U32>, role: Array<U32>,
    proprio: Array<U32>, poolId: Array<U32>, bytes: List<&2, U32>}

def Gain.of(+hl: U32, +x: Cfg) -> F32:
  F32.mul(F32.mul(Bool.pick(F32, U32.is_ne(U32.and(hl, 1), 0), Cfg.g13a(x), 1.0),
      Bool.pick(F32, U32.is_ne(U32.and(hl, 2), 0), Cfg.g13b(x), 1.0)),
    Bool.pick(F32, U32.is_ne(U32.and(hl, 4), 0), Cfg.g19b(x), 1.0))

# One pass over the cells. A hemilineage gain multiplies the cell's outgoing sign, which is
# where `outScale` acts in the shipped build; tonic drive is a bias on the cord's interneurons;
# the command and the proprioceptors are the only driven cells; and an ablation silences a
# hemilineage through the flag `perturb.bend` proves about.
def Cells.go(+n: Nat, +i: U32, +x: Cfg,
  rh: Array<U32> & U32, ro: Array<U32> & U32, rp: Array<U32> & U32, rs: Array<F32> & F32,
  sg: Array<F32>, bi: Array<F32>, dr: Array<F32>, al: Array<U32>) -> Built:
  match n:
    case 0n:
      (hl, h) = rh
      (role, o) = ro
      (proprio, p) = rp
      (sign, s) = rs
      Built{hl, role, proprio, sign, sg, bi, dr, al}
    case 1n+k:
      (hl, +h) = rh
      (role, +o) = ro
      (proprio, +p) = rp
      (sign, s) = rs
      +i2 = (i + 1 : U32)
      Cells.go(k, i2, x,
        Array.get(U32, hl, i2), Array.get(U32, role, i2), Array.get(U32, proprio, i2), Array.get(F32, sign, i2),
        Array.set(F32, sg, i, F32.mul(s, Gain.of(h, x))),
        Array.set(F32, bi, i, Bool.pick(F32, U32.is_eq(o, 0), Cfg.tonic(x), 0.0)),
        Array.set(F32, dr, i, Bool.pick(F32, U32.is_eq(o, 2), Cfg.cmd(x),
          Bool.pick(F32, U32.is_gt(p, 0), Ens.proprio_hz(), 0.0))),
        Array.set(U32, al, i, Bool.pick(U32, U32.is_ne(U32.and(h, Cfg.ablbit(x)), 0), 0, 1)))

def Cells.build(hl: Array<U32>, role: Array<U32>, proprio: Array<U32>, sign: Array<F32>, +n: U32, +x: Cfg) -> Built:
  Cells.go(U32.to_nat(n), 0, x, Array.get(U32, hl, 0), Array.get(U32, role, 0),
    Array.get(U32, proprio, 0), Array.get(F32, sign, 0),
    [0.0 : F32^15n], [0.0 : F32^15n], [0.0 : F32^15n], [0 : U32^15n])

# ------------------------------------------------------------------ the pool tally
type Tal is Data:
  Tal{a: U32, b: U32, c: U32, d: U32, e: U32, f: U32}

def Tal.zero() -> Tal:
  Tal{0, 0, 0, 0, 0, 0}

def Tal.bump(+l: U32, t: Tal) -> Tal:
  match t:
    case Tal{a, b, c, d, e, f}:
      Tal{(a + Bool.to_u32(U32.is_eq(l, 0)) : U32), (b + Bool.to_u32(U32.is_eq(l, 1)) : U32),
        (c + Bool.to_u32(U32.is_eq(l, 2)) : U32), (d + Bool.to_u32(U32.is_eq(l, 3)) : U32),
        (e + Bool.to_u32(U32.is_eq(l, 4)) : U32), (f + Bool.to_u32(U32.is_eq(l, 5)) : U32)}

def Tal.total(t: Tal) -> U32:
  match t:
    case Tal{a, b, c, d, e, f}:
      (a + b + c + d + e + f : U32)

# little-endian uint16 per pool, prepended in reverse so one reversal puts the run in order
def Tal.bytes(t: Tal, acc: List<&2, U32>) -> List<&2, U32>:
  match t:
    case Tal{+a, +b, +c, +d, +e, +f}:
      U32.and(U32.shrn(f, 8n), 255) <> (U32.and(f, 255) <>
        (U32.and(U32.shrn(e, 8n), 255) <> (U32.and(e, 255) <>
          (U32.and(U32.shrn(d, 8n), 255) <> (U32.and(d, 255) <>
            (U32.and(U32.shrn(c, 8n), 255) <> (U32.and(c, 255) <>
              (U32.and(U32.shrn(b, 8n), 255) <> (U32.and(b, 255) <>
                (U32.and(U32.shrn(a, 8n), 255) <> (U32.and(a, 255) <> acc)))))))))))

# the tally consumes its handle on the table and drops it; the lane keeps the other half of
# the fork, which is what lets the whole run be one self-recursive def
def Pool.tal(fired: List<&2, U32>, t: Tal, r: Array<U32> & U32) -> Tal:
  match fired:
    case Nil{}:
      (q, l) = r
      t
    case i <> +ft:
      (q, l) = r
      Pool.tal(ft, Tal.bump(l, t), Array.get(U32, q, Kr.Head.u32(ft)))

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
# by pool, records them, feeds the delayed total back to the proprioceptors, and takes another
# step. The first turn reads the empty initial slot, so the run emits one more record than it
# takes steps and the reader drops the first.
def Run.go(+steps: Nat, +driven: List<&2, U32>, +proprio: List<&2, U32>, +K: Kr.Kc, +n: U32,
  +pdelay: U32, +hist: List<&2, U32>, +acc: List<&2, U32>,
  hl: Array<U32>, role: Array<U32>, prop: Array<U32>, sign0: Array<F32>,
  pq: Array<U32> & Array<U32>, r: Kr.Run) -> ROut:
  match steps:
    case 0n:
      (q1, q2) = pq
      Kr.Run{Kr.Net{rows, sign}, Kr.LSt{Kr.Lane{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive}, r0, r1, r2, r3, rng, chk}} = r
      ROut{rows, sign0, hl, role, prop, Array.join(U32, q1, q2), List.reverse(&2, U32, acc)}
    case 1n+p:
      (q1, q2) = pq
      Kr.Run{Kr.Net{rows, sign}, Kr.LSt{Kr.Lane{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive}, r0, r1, r2, +r3, rng, chk}} = r
      +t = Pool.tal(r3, Tal.zero(), Array.get(U32, q1, Kr.Head.u32(r3)))
      +fb = F32.add(Ens.proprio_hz(), F32.mul(Ens.pgain(), U32.to_f32(Hist.at(hist, (pdelay - 1 : U32)))))
      Run.go(p, driven, proprio, K, n, pdelay,
        List.take(&2, U32, Tal.total(t) <> hist, U32.to_nat(pdelay)), Tal.bytes(t, acc),
        hl, role, prop, sign0, Array.fork(U32, q2),
        Kr.Step.one(driven, K, n,
          Kr.Run{Kr.Net{rows, sign},
            Kr.LSt{Kr.Lane{v, gE, gI, refr, adapt, bias, thr, Fb.drive(proprio, fb, drive), spk, alive},
              r0, r1, r2, r3, rng, chk}}))

# ------------------------------------------------------------------ one lane
def Lane.start(+driven: List<&2, U32>, +proprio: List<&2, U32>, +K: Kr.Kc, +n: U32, +x: Cfg, +seed: U32,
  rows: Array<List<&2, Kr.Edge>>, poolId: Array<U32>, b: Built) -> ROut:
  Built{hl, role, prop, sign0, sg, bi, dr, al} = b
  Run.go(1n+U32.to_nat(Ens.steps()), driven, proprio, K, n, Cfg.pdelay(x), Nil{}, Nil{},
    hl, role, prop, sign0, Array.fork(U32, poolId),
    Kr.Run{Kr.Net{rows, sg},
      Kr.LSt{Kr.Lane{Fill.f32(U32.to_nat(n), 0, Kr.Kc.vRest(K), [0.0 : F32^15n]),
        [0.0 : F32^15n], [0.0 : F32^15n], [0.0 : F32^15n], [0.0 : F32^15n], bi,
        [0.0 : F32^15n], dr, [0 : U32^15n], al},
        Nil{}, Nil{}, Nil{}, Nil{}, seed, 0}})

def Lane.one(+driven: List<&2, U32>, +proprio: List<&2, U32>, +K: Kr.Kc, +n: U32, +m: U32, +c: U32,
  rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, hl: Array<U32>, role: Array<U32>,
  prop: Array<U32>, poolId: Array<U32>) -> ROut:
  Lane.start(driven, proprio, K, n, Cfg.of(m, c), (2654435761 + m * 7919 + c : U32), rows, poolId,
    Cells.build(hl, role, prop, sign, n, Cfg.of(m, c)))

# ------------------------------------------------------------------ a batch of lanes
def Batch.join(a: ROut, b: ROut) -> ROut:
  ROut{r1, s1, h1, o1, p1, q1, b1} = a
  ROut{r2, s2, h2, o2, p2, q2, b2} = b
  ROut{Array.join(List<&2, Kr.Edge>, r1, r2), Array.join(F32, s1, s2), Array.join(U32, h1, h2),
    Array.join(U32, o1, o2), Array.join(U32, p1, p2), Array.join(U32, q1, q2),
    List.append(&2, U32, b1, b2)}

def Batch.leaf(r2: Array<List<&2, Kr.Edge>>, s2: Array<F32>, h2: Array<U32>, o2: Array<U32>,
  p2: Array<U32>, q2: Array<U32>, a: ROut) -> ROut:
  ROut{r1, s1, h1, o1, p1, q1, bs} = a
  ROut{Array.join(List<&2, Kr.Edge>, r1, r2), Array.join(F32, s1, s2), Array.join(U32, h1, h2),
    Array.join(U32, o1, o2), Array.join(U32, p1, p2), Array.join(U32, q1, q2), bs}

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
  pq: Array<U32> & Array<U32>) -> ROut:
  match d:
    case 0n:
      (r1, r2) = pr
      (s1, s2) = ps
      (h1, h2) = ph
      (o1, o2) = po
      (p1, p2) = pp
      (q1, q2) = pq
      Batch.leaf(r2, s2, h2, o2, p2, q2,
        Lane.one(driven, proprio, K, n, Run.member(j0, grp), Run.cond(j0, grp), r1, s1, h1, o1, p1, q1))
    case 1n++e:
      (r1, r2) = pr
      (s1, s2) = ps
      (h1, h2) = ph
      (o1, o2) = po
      (p1, p2) = pp
      (q1, q2) = pq
      a b = Batch.go(e, driven, proprio, K, n, j0, grp, Array.fork(List<&2, Kr.Edge>, r1),
          Array.fork(F32, s1), Array.fork(U32, h1), Array.fork(U32, o1), Array.fork(U32, p1), Array.fork(U32, q1))
        Batch.go(e, driven, proprio, K, n, (j0 + U32.shln(1, e) : U32), grp,
          Array.fork(List<&2, Kr.Edge>, r2), Array.fork(F32, s2), Array.fork(U32, h2),
          Array.fork(U32, o2), Array.fork(U32, p2), Array.fork(U32, q2))
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

def Ids.go(roles: List<&2, U32>, props: List<&2, U32>, +i: U32, +accD: List<&2, U32>, +accP: List<&2, U32>) -> Ids:
  match roles:
    case Nil{}:
      Ids{List.reverse(&2, U32, accD), List.reverse(&2, U32, accP)}
    case o <> ot:
      match props:
        case Nil{}:
          Ids{List.reverse(&2, U32, accD), List.reverse(&2, U32, accP)}
        case +p <> pt:
          +i2 = (i + 1 : U32)
          Ids.go(ot, pt, i2,
            Bool.pick(List<&2, U32>, Bool.or(U32.is_eq(o, 2), U32.is_gt(p, 0)), i <> accD, accD),
            Bool.pick(List<&2, U32>, U32.is_gt(p, 0), i <> accP, accP))

# ------------------------------------------------------------------ the batch and group loops
def Batches.go(nb: Nat, +j0: U32, +grp: U32, +driven: List<&2, U32>, +proprio: List<&2, U32>,
  +K: Kr.Kc, +n: U32, +acc: List<&2, U32>, r: ROut) -> IO(ROut):
  match nb:
    case 0n:
      ROut{rows, sign, hl, role, prop, poolId, bs} = r
      IO.pure(ROut, ROut{rows, sign, hl, role, prop, poolId, List.append(&2, U32, acc, bs)})
    case 1n+p:
      ROut{rows, sign, hl, role, prop, poolId, bs} = r
      do IO<ROut>:
        IO.print("run " ++ U32.show(j0) ++ " group " ++ U32.show(grp))
        Batches.go(p, (j0 + Ens.batch() : U32), grp, driven, proprio, K, n,
          List.append(&2, U32, acc, bs),
          Batch.go(Ens.batch_depth(), driven, proprio, K, n, j0, grp,
            Array.fork(List<&2, Kr.Edge>, rows), Array.fork(F32, sign), Array.fork(U32, hl),
            Array.fork(U32, role), Array.fork(U32, prop), Array.fork(U32, poolId)))

def Batches.count(+g: U32) -> Nat:
  U32.to_nat(Bool.pick(U32, U32.is_eq(g, 2), U32.div(Ens.members(), Ens.batch()),
    U32.div((U32.div(Ens.members(), 2) * 5 : U32), Ens.batch())))

def Groups.go(ng: Nat, +g: U32, +driven: List<&2, U32>, +proprio: List<&2, U32>, +K: Kr.Kc, +n: U32,
  +lens: List<&2, U32>, +gaps: List<&2, U32>, +ws: List<&2, F32>, +cm: List<&2, U32>,
  +acc: List<&2, U32>, r: ROut) -> IO(ROut):
  match ng:
    case 0n:
      ROut{rows, sign, hl, role, prop, poolId, bs} = r
      IO.pure(ROut, ROut{rows, sign, hl, role, prop, poolId, List.append(&2, U32, acc, bs)})
    case 1n+p:
      ROut{rows0, sign, hl, role, prop, poolId, bs} = r
      do IO<ROut>:
        IO.print("commissural group " ++ U32.show(g) ++ " factor " ++ F32.show(Comm.factor(g)))
        r2 : ROut <- Batches.go(Batches.count(g), 0, g, driven, proprio, K, n, Nil{},
          ROut{Rows.build(lens, Comm.factor(g), gaps, ws, cm, 0, Array.new(List<&2, Kr.Edge>, 15n, Nil{})),
            sign, hl, role, prop, poolId, Nil{}})
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

# magic 'SRCH', version, steps, members, conditions, pools, records per run, runs
def Hdr.of(body: List<&2, U32>) -> List<&2, U32>:
  Hdr.u32(1212372307, Hdr.u32(1, Hdr.u32(Ens.steps(), Hdr.u32(Ens.members(),
    Hdr.u32(Ens.conds(), Hdr.u32(6, Hdr.u32((Ens.steps() + 1 : U32),
      Hdr.u32((Ens.members() * Ens.conds() : U32), body))))))))

# ------------------------------------------------------------------ main
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
  ROut{rows, sign, hl, role, prop, poolId, bs} = r
  +body = bs
  do IO<Unit>:
    IO.print("bytes " ++ Nat.show(List.length(&2, U32, body)))
    Fx.dump(Ens.out(), Hdr.of(body))
    t1 : Nat <- IO.now()
    IO.print("ms_total " ++ Nat.show(Nat.sub(t1, t0)))

def Main.go(+t0: Nat, +K: Kr.Kc, +ids: Ids, +lens: List<&2, U32>, +gaps: List<&2, U32>,
  +ws: List<&2, F32>, +cm: List<&2, U32>, sign: Array<F32>, hl: Array<U32>, role: Array<U32>,
  prop: Array<U32>, poolId: Array<U32>) -> IO(Unit):
  do IO<Unit>:
    IO.print("driven " ++ Nat.show(List.length(&2, U32, Ids.d(ids))) ++ " proprioceptors " ++ Nat.show(List.length(&2, U32, Ids.p(ids))))
    r : ROut <- Groups.go(3n, 0, Ids.d(ids), Ids.p(ids), K, IOx.Cord.n(), lens, gaps, ws, cm, Nil{},
      ROut{Array.new(List<&2, Kr.Edge>, 0n, Nil{}), sign, hl, role, prop, poolId, Nil{}})
    Out.write(t0, r)

def main() -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    IO.print("members " ++ U32.show(Ens.members()) ++ " conditions " ++ U32.show(Ens.conds()) ++ " steps " ++ U32.show(Ens.steps()))
    csb : List<&2, U32> <- IOx.Fx.slurp(Ref2.kernel(), 64, 64)
    wb : List<&2, U32> <- IOx.Fx.slurp(Ref2.kernel(), 128, (4 * IOx.Cord.e() : U32))
    sgb : List<&2, U32> <- IOx.Fx.slurp(Ref2.kernel(), 6460856, (4 * IOx.Cord.n() : U32))
    pib : List<&2, U32> <- IOx.Fx.slurp(Tab.path(), Tab.off_poolId(), (4 * IOx.Cord.n() : U32))
    ppb : List<&2, U32> <- IOx.Fx.slurp(Tab.path(), Tab.off_proprio(), (4 * IOx.Cord.n() : U32))
    hlb : List<&2, U32> <- IOx.Fx.slurp(Tab.path(), Tab.off_hl(), (4 * IOx.Cord.n() : U32))
    rlb : List<&2, U32> <- IOx.Fx.slurp(Tab.path(), Tab.off_role(), (4 * IOx.Cord.n() : U32))
    cmb : List<&2, U32> <- IOx.Fx.slurp(Tab.path(), Tab.off_comm(), (4 * IOx.Cord.e() : U32))
    ipb : List<&2, U32> <- IOx.Fx.slurp(IOx.Cord.path(), IOx.Cord.off_indptr(), (4 * (IOx.Cord.n() + 1) : U32))
    gpb : List<&2, U32> <- IOx.Fx.slurp(IOx.Cord.path(), IOx.Cord.off_gaps(), (4 * IOx.Cord.e() : U32))
    +roles : List<&2, U32> = IOx.Bytes.u32s(rlb)
    +props : List<&2, U32> = IOx.Bytes.u32s(ppb)
    Main.go(t0, Kc.of(IOx.Bytes.f32s(csb)), Ids.go(roles, props, 0, Nil{}, Nil{}),
      IOx.Lens.of(IOx.Bytes.u32s(ipb)), IOx.Bytes.u32s(gpb), IOx.Bytes.f32s(wb), IOx.Bytes.u32s(cmb),
      IOx.F32s.into(IOx.Bytes.f32s(sgb), 0, [0.0 : F32^15n]),
      IOx.U32s.into(IOx.Bytes.u32s(hlb), 0, [0 : U32^15n]),
      IOx.U32s.into(roles, 0, [0 : U32^15n]),
      IOx.U32s.into(props, 0, [0 : U32^15n]),
      IOx.U32s.into(IOx.Bytes.u32s(pib), 0, [0 : U32^15n]))
