# The LIF kernel, ported from src/wasm/lif.c to Bend arrays, one member per lane.
#
# Every arithmetic step is the shipped kernel's, in the shipped kernel's order, so the spike
# trains agree bit for bit (`cordrun.bend` is the gate). Three departures, each exact rather
# than approximate:
#
#   * `res`, the short-term depression resource, is dropped. The calibrated `depU` is 0, so
#     `res` is 1 for ever, `sign * res` is `sign` exactly, and `res += (1 - res) * kRec` is a
#     no-op. `cord_kernel_ref.mjs` refuses to write a reference with `depU != 0`.
#   * `trace` is dropped: `lif.c` maintains it and never reads it back.
#   * The zero-sign test is dropped. A zero sign delivers `w * 0` into `gI`, which is an exact
#     no-op, so skipping the test changes the time and not the arithmetic.
#
# Delivery splits the arriving spikes by the sign of the presynaptic cell and scatters the two
# groups separately. `gE` only ever receives from excitatory cells and `gI` only from
# inhibitory ones, so splitting leaves each accumulator's additions in their original order —
# which is what the float sum depends on.
import Base
import ./perturb.bend as P

# ------------------------------------------------------------------ constants
type Kc is Data:
  Kc{dt: F32, vRest: F32, vThresh: F32, vReset: F32, tRef: F32, adaptInc: F32,
    dE: F32, dA: F32, kM: F32, dtS: F32, eExc: F32, eInh: F32, cE: F32, cI: F32}

def Kc.dt(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      dt

def Kc.vRest(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      vRest

def Kc.vThresh(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      vThresh

def Kc.vReset(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      vReset

def Kc.tRef(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      tRef

def Kc.adaptInc(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      adaptInc

def Kc.dE(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      dE

def Kc.dA(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      dA

def Kc.kM(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      kM

def Kc.dtS(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      dtS

def Kc.eExc(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      eExc

def Kc.eInh(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      eInh

def Kc.cE(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      cE

def Kc.cI(k: Kc) -> F32:
  match k:
    case Kc{dt, vRest, vThresh, vReset, tRef, adaptInc, dE, dA, kM, dtS, eExc, eInh, cE, cI}:
      cI

# ------------------------------------------------------------------ the graph
type Edge is Data:
  Edge{post: U32, w: F32}

type Lane is Type:
  Lane{v: Array<F32>, gE: Array<F32>, gI: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
    bias: Array<F32>, thr: Array<F32>, drive: Array<F32>, spk: Array<U32>, alive: Array<U32>}

# the shared, read-only side: one row per cell and one sign per cell
type Net is Type:
  Net{rows: Array<List<&2, Edge>>, sign: Array<F32>}

def Head.u32(xs: List<&2, U32>) -> U32:
  match xs:
    case Nil{}:
      0
    case h <> t:
      h

# ------------------------------------------------------------------ 1. delivery
# `lif.c`: gE[indices[j]] += W[j] * s, in row order, for every arriving spike in ring order.
def Del.row(row: List<&2, Edge>, +s: F32, +q: U32, +wv: F32, r: Array<F32> & F32) -> Array<F32>:
  match row:
    case Nil{}:
      (g, old) = r
      Array.set(F32, g, q, F32.add(old, F32.mul(wv, s)))
    case Edge{+q2, wv2} <> t:
      (g, old) = r
      Del.row(t, s, q2, wv2, Array.get(F32, Array.set(F32, g, q, F32.add(old, F32.mul(wv, s))), q2))

def Del.head(row: List<&2, Edge>, +s: F32, g: Array<F32>) -> Array<F32>:
  match row:
    case Nil{}:
      g
    case Edge{+q, wv} <> t:
      Del.row(t, s, q, wv, Array.get(F32, g, q))

type Del3 is Type:
  Del3{sign: Array<F32>, rows: Array<List<&2, Edge>>, g: Array<F32>}

def Del.go(fired: List<&2, U32>, rs: Array<F32> & F32, rr: Array<List<&2, Edge>> & List<&2, Edge>, g: Array<F32>) -> Del3:
  match fired:
    case Nil{}:
      (sg, s) = rs
      (rw, row) = rr
      Del3{sg, rw, g}
    case pre <> +ft:
      (sg, +s) = rs
      (rw, row) = rr
      +h = Head.u32(ft)
      Del.go(ft, Array.get(F32, sg, h), Array.get(List<&2, Edge>, rw, h), Del.head(row, s, g))

# split the arriving spikes by the sign of the cell that fired, keeping their order
type Split is Data:
  Split{exc: List<&2, U32>, inh: List<&2, U32>}

def Sp.go(fired: List<&2, U32>, +exc: List<&2, U32>, +inh: List<&2, U32>, r: Array<F32> & F32) -> Array<F32> & Split:
  match fired:
    case Nil{}:
      (sg, s) = r
      (sg, Split{List.reverse(&2, U32, exc), List.reverse(&2, U32, inh)})
    case +pre <> +ft:
      (sg, +s) = r
      Sp.go(ft, Bool.pick(List<&2, U32>, F32.is_gt(s, 0.0), pre <> exc, exc),
        Bool.pick(List<&2, U32>, F32.is_gt(s, 0.0), inh, pre <> inh),
        Array.get(F32, sg, Head.u32(ft)))

# ------------------------------------------------------------------ 2. driven cells
# `lif.c`: for each driven cell not in its refractory period, one draw of the xorshift stream
# decides a spike. The draw happens only when the cell is free, so the stream's order is part
# of the answer.
def Xs.next(+x: U32) -> U32:
  +a = (x .^. U32.shln(x, 13n) : U32)
  +b = (a .^. U32.shrn(a, 17n) : U32)
  (b .^. U32.shln(b, 5n) : U32)

def Xs.step(isRef: Bool, +x: U32) -> U32:
  match isRef:
    case True{}:
      x
    case False{}:
      Xs.next(x)

type Drv is Type:
  Drv{v: Array<F32>, refr: Array<F32>, adapt: Array<F32>, drive: Array<F32>, spk: Array<U32>,
    fired: List<&2, U32>, rng: U32}

def Drv.go(driven: List<&2, U32>, +K: Kc, +i: U32, +rng: U32, +acc: List<&2, U32>,
  rv: Array<F32> & F32, rr: Array<F32> & F32, ra: Array<F32> & F32, rd: Array<F32> & F32, rs: Array<U32> & U32) -> Drv:
  match driven:
    case Nil{}:
      (v, vi) = rv
      (refr, r) = rr
      (adapt, ad) = ra
      (drive, dr) = rd
      (spk, sc) = rs
      Drv{v, refr, adapt, drive, spk, List.reverse(&2, U32, acc), rng}
    case pre <> +dt:
      (v, +vi) = rv
      (refr, +r) = rr
      (adapt, +ad) = ra
      (drive, dr) = rd
      (spk, +sc) = rs
      +isRef = F32.is_gt(r, 0.0)
      +rng2 = Xs.step(isRef, rng)
      +fire = Bool.and(Bool.not(isRef),
        F32.is_lt(F32.mul(U32.to_f32(U32.shrn(rng2, 8n)), 0.000000059604645), F32.mul(dr, Kc.dtS(K))))
      +h = Head.u32(dt)
      Drv.go(dt, K, h, rng2, Bool.pick(List<&2, U32>, fire, i <> acc, acc),
        Array.get(F32, Array.set(F32, v, i, Bool.pick(F32, fire, Kc.vReset(K), vi)), h),
        Array.get(F32, Array.set(F32, refr, i, Bool.pick(F32, fire, F32.add(Kc.tRef(K), Kc.dt(K)), r)), h),
        Array.get(F32, Array.set(F32, adapt, i, Bool.pick(F32, fire, F32.add(ad, Kc.adaptInc(K)), ad)), h),
        Array.get(F32, drive, h),
        Array.get(U32, Array.set(U32, spk, i, Bool.pick(U32, fire, (sc + 1 : U32), sc)), h))

# ------------------------------------------------------------------ 3. the membrane
# dv = (vRest - vi + gE*(eExc - vi)*cE + gI*(vi - eInh)*cI + bias) * kM, associating to the
# left exactly as C does.
def Mem.dv(+K: Kc, +vi: F32, +ge: F32, +gi: F32, +bi: F32) -> F32:
  +a1 = F32.sub(Kc.vRest(K), vi)
  +a2 = F32.mul(F32.mul(ge, F32.sub(Kc.eExc(K), vi)), Kc.cE(K))
  +a3 = F32.add(a1, a2)
  +a4 = F32.mul(F32.mul(gi, F32.sub(vi, Kc.eInh(K))), Kc.cI(K))
  F32.mul(F32.add(F32.add(a3, a4), bi), Kc.kM(K))

type Mem is Type:
  Mem{v: Array<F32>, gE: Array<F32>, gI: Array<F32>, refr: Array<F32>, adapt: Array<F32>, bias: Array<F32>}

def Mem.go(+n: Nat, +K: Kc, +i: U32,
  rv: Array<F32> & F32, rge: Array<F32> & F32, rgi: Array<F32> & F32,
  rr: Array<F32> & F32, ra: Array<F32> & F32, rb: Array<F32> & F32) -> Mem:
  match n:
    case 0n:
      (v, vi) = rv
      (gE, ge) = rge
      (gI, gi) = rgi
      (refr, r) = rr
      (adapt, ad) = ra
      (bias, bi) = rb
      Mem{v, gE, gI, refr, adapt, bias}
    case 1n+p:
      (v, +vi) = rv
      (gE, +ge) = rge
      (gI, +gi) = rgi
      (refr, +r) = rr
      (adapt, ad) = ra
      (bias, bi) = rb
      +isRef = F32.is_gt(r, 0.0)
      +i2 = (i + 1 : U32)
      Mem.go(p, K, i2,
        Array.get(F32, Array.set(F32, v, i, Bool.pick(F32, isRef, Kc.vReset(K), F32.add(vi, Mem.dv(K, vi, ge, gi, bi)))), i2),
        Array.get(F32, Array.set(F32, gE, i, F32.mul(ge, Kc.dE(K))), i2),
        Array.get(F32, Array.set(F32, gI, i, F32.mul(gi, Kc.dE(K))), i2),
        Array.get(F32, Array.set(F32, refr, i, Bool.pick(F32, isRef, F32.sub(r, Kc.dt(K)), r)), i2),
        Array.get(F32, Array.set(F32, adapt, i, F32.mul(ad, Kc.dA(K))), i2),
        Array.get(F32, bias, i2))

# ------------------------------------------------------------------ 4. threshold crossings
# Walked from the last cell down, prepending, so the answer comes out in ascending order —
# the order `lif.c`'s forward loop appends them in.
type Thr is Type:
  Thr{v: Array<F32>, refr: Array<F32>, adapt: Array<F32>, thr: Array<F32>, spk: Array<U32>,
    alive: Array<U32>, fired: List<&2, U32>}

# The silencing flag is consulted through `perturb.bend`'s `Fire.rule`, the function
# `ablated_never_fires` is proven about. With every cell alive the rule is the kernel's
# original condition, which `alive_rule_is_original` says and the gate confirms.
def Thr.go(+n: Nat, +K: Kc, +i: U32, +acc: List<&2, U32>,
  rv: Array<F32> & F32, rr: Array<F32> & F32, ra: Array<F32> & F32, rt: Array<F32> & F32,
  rs: Array<U32> & U32, rl: Array<U32> & U32) -> Thr:
  match n:
    case 0n:
      (v, vi) = rv
      (refr, r) = rr
      (adapt, ad) = ra
      (thr, th) = rt
      (spk, sc) = rs
      (alive, al) = rl
      Thr{v, refr, adapt, thr, spk, alive, acc}
    case 1n+p:
      (v, +vi) = rv
      (refr, +r) = rr
      (adapt, +ad) = ra
      (thr, th) = rt
      (spk, +sc) = rs
      (alive, al) = rl
      +fire = P.Fire.rule(U32.is_gt(al, 0),
        F32.is_ge(vi, F32.add(F32.add(Kc.vThresh(K), ad), th)), F32.is_le(r, 0.0))
      +i2 = (i - 1 : U32)
      Thr.go(p, K, i2, Bool.pick(List<&2, U32>, fire, i <> acc, acc),
        Array.get(F32, Array.set(F32, v, i, Bool.pick(F32, fire, Kc.vReset(K), vi)), i2),
        Array.get(F32, Array.set(F32, refr, i, Bool.pick(F32, fire, Kc.tRef(K), r)), i2),
        Array.get(F32, Array.set(F32, adapt, i, Bool.pick(F32, fire, F32.add(ad, Kc.adaptInc(K)), ad)), i2),
        Array.get(F32, thr, i2),
        Array.get(U32, Array.set(U32, spk, i, Bool.pick(U32, fire, (sc + 1 : U32), sc)), i2),
        Array.get(U32, alive, i2))

# ------------------------------------------------------------------ the step
# The delay line is four slots: the front is delivered now and this step's spikes go to the
# back, so a spike arrives four steps later. `lif.c` keeps five slots and writes this step's
# spikes to the one just behind the read head, which is the same four-step delay -- rotating
# five slots here would deliver a step late, and did until the gate said so.
type LSt is Type:
  LSt{lane: Lane, r0: List<&2, U32>, r1: List<&2, U32>, r2: List<&2, U32>, r3: List<&2, U32>,
    rng: U32, chk: U32}

type Run is Type:
  Run{net: Net, st: LSt}

def Step.d(net: Net, gE: Array<F32>, gI: Array<F32>, bias: Array<F32>, drive: Array<F32>,
  r1: List<&2, U32>, r2: List<&2, U32>, r3: List<&2, U32>, +rng: U32,
  +chk: U32, +firedA: List<&2, U32>, t: Thr) -> Run:
  Thr{v2, refr, adapt, thr, spk, alive, firedB} = t
  +fired = List.append(&2, U32, firedA, firedB)
  Run{net, LSt{Lane{v2, gE, gI, refr, adapt, bias, thr, drive, spk, alive}, r1, r2, r3, fired,
    rng, (chk * 1000003 + U32.from_nat(List.length(&2, U32, fired)) : U32)}}

def Step.c(net: Net, +K: Kc, +n: U32, thr: Array<F32>, spk: Array<U32>, alive: Array<U32>, drive: Array<F32>,
  r1: List<&2, U32>, r2: List<&2, U32>, r3: List<&2, U32>, +rng: U32, +chk: U32,
  +firedA: List<&2, U32>, m: Mem) -> Run:
  Mem{v, gE, gI, refr, adapt, bias} = m
  +last = (n - 1 : U32)
  Step.d(net, gE, gI, bias, drive, r1, r2, r3, rng, chk, firedA,
    Thr.go(U32.to_nat(n), K, last, Nil{},
      Array.get(F32, v, last), Array.get(F32, refr, last), Array.get(F32, adapt, last),
      Array.get(F32, thr, last), Array.get(U32, spk, last), Array.get(U32, alive, last)))

def Step.b(net: Net, +K: Kc, +n: U32, gE: Array<F32>, gI: Array<F32>, bias: Array<F32>, thr: Array<F32>, alive: Array<U32>,
  r1: List<&2, U32>, r2: List<&2, U32>, r3: List<&2, U32>, +chk: U32, d: Drv) -> Run:
  Drv{v, refr, adapt, drive, spk, firedA, rng} = d
  Step.c(net, K, n, thr, spk, alive, drive, r1, r2, r3, rng, chk, firedA,
    Mem.go(U32.to_nat(n), K, 0,
      Array.get(F32, v, 0), Array.get(F32, gE, 0), Array.get(F32, gI, 0),
      Array.get(F32, refr, 0), Array.get(F32, adapt, 0), Array.get(F32, bias, 0)))

def Step.a(+driven: List<&2, U32>, +K: Kc, +n: U32, v: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
  drive: Array<F32>, spk: Array<U32>, alive: Array<U32>, gE: Array<F32>, gI: Array<F32>, bias: Array<F32>, thr: Array<F32>,
  r1: List<&2, U32>, r2: List<&2, U32>, r3: List<&2, U32>, +rng: U32, +chk: U32, net: Net) -> Run:
  +h = Head.u32(driven)
  Step.b(net, K, n, gE, gI, bias, thr, alive, r1, r2, r3, chk,
    Drv.go(driven, K, h, rng, Nil{},
      Array.get(F32, v, h), Array.get(F32, refr, h), Array.get(F32, adapt, h),
      Array.get(F32, drive, h), Array.get(U32, spk, h)))

# deliver the front slot, then run the four phases
def Step.inh(+driven: List<&2, U32>, +K: Kc, +n: U32, v: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
  drive: Array<F32>, spk: Array<U32>, alive: Array<U32>, bias: Array<F32>, thr: Array<F32>,
  r1: List<&2, U32>, r2: List<&2, U32>, r3: List<&2, U32>, +rng: U32, +chk: U32,
  gE: Array<F32>, d: Del3) -> Run:
  Del3{sign, rows, gI} = d
  Step.a(driven, K, n, v, refr, adapt, drive, spk, alive, gE, gI, bias, thr, r1, r2, r3, rng, chk, Net{rows, sign})


def Step.exc(+driven: List<&2, U32>, +K: Kc, +n: U32, v: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
  drive: Array<F32>, spk: Array<U32>, alive: Array<U32>, bias: Array<F32>, thr: Array<F32>,
  r1: List<&2, U32>, r2: List<&2, U32>, r3: List<&2, U32>, +rng: U32, +chk: U32,
  +inh: List<&2, U32>, gI: Array<F32>, d: Del3) -> Run:
  Del3{sign, rows, gE} = d
  +inh2 = inh
  Step.inh(driven, K, n, v, refr, adapt, drive, spk, alive, bias, thr, r1, r2, r3, rng, chk, gE,
    Del.go(inh2, Array.get(F32, sign, Head.u32(inh2)), Array.get(List<&2, Edge>, rows, Head.u32(inh2)), gI))


def Step.deliver(+driven: List<&2, U32>, +K: Kc, +n: U32, v: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
  drive: Array<F32>, spk: Array<U32>, alive: Array<U32>, bias: Array<F32>, thr: Array<F32>,
  r1: List<&2, U32>, r2: List<&2, U32>, r3: List<&2, U32>, +rng: U32, +chk: U32,
  rows: Array<List<&2, Edge>>, sp: Array<F32> & Split, gE: Array<F32>, gI: Array<F32>) -> Run:
  (sign, Split{+exc, +inh}) = sp
  Step.exc(driven, K, n, v, refr, adapt, drive, spk, alive, bias, thr, r1, r2, r3, rng, chk, inh, gI,
    Del.go(exc, Array.get(F32, sign, Head.u32(exc)), Array.get(List<&2, Edge>, rows, Head.u32(exc)), gE))


def Step.one(+driven: List<&2, U32>, +K: Kc, +n: U32, r: Run) -> Run:
  Run{Net{rows, sign}, LSt{Lane{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive}, +r0, r1, r2, r3, rng, chk}} = r
  Step.deliver(driven, K, n, v, refr, adapt, drive, spk, alive, bias, thr, r1, r2, r3, rng, chk, rows,
    Sp.go(r0, Nil{}, Nil{}, Array.get(F32, sign, Head.u32(r0))), gE, gI)

def Kernel.run(steps: Nat, +driven: List<&2, U32>, +K: Kc, +n: U32, r: Run) -> Run:
  match steps:
    case 0n:
      r
    case 1n+p:
      Kernel.run(p, driven, K, n, Step.one(driven, K, n, r))
