# The mechanism screen on the external cord IR (ext/): cordx.bend's ensemble, with the kernel
# extended by the dynamical degrees of freedom the gated kernel does not have.
#
#   python3 scripts/prep_cord_banc.py --meta <meta.feather> --edges <edges.feather> --out ext
#   bend cordx2.bend -o cordx2 && ./cordx2 && node scripts/cordx2_search.mjs
#
# This is a variant kernel, not the gated one: doc 46's bit-identity holds for kernel.bend
# alone. Each mechanism is a member axis bit, so the ensemble measures its marginal effect on
# the same readouts rather than comparing two monolithic models.
#
#   axis 0    commissural class            x1        x3
#   axis 1    hemilineage 13A gain         x0.5      x2
#   axis 2    hemilineage 13B gain         x0.5      x2
#   axis 3    inhibitory gain              x1        x0.6
#   axes 4-5  proprioceptive loop          open      shared 20 ms, split 20 ms, split 80 ms
#   axis 6    per-cell presynaptic delays  off       cable-length classes
#   axis 7    short-term depression        off       depU 0.2
#   axis 8    unilateral kick              off       +40 Hz on left proprioceptors, 200 ms
#
#   condition 0  baseline            3  ablate 19B
#             1  ablate 13A          4  cut the commissural class
#             2  ablate 13B          5  silence the descending command
#
# The kernel extensions, each exact at its off setting:
#
#   * delays: the four-slot ring becomes sixteen slots; a spike from a cell with delay class d
#     prepends into slot d - 1 of the shifted ring and so arrives d steps after it fired.
#     Uniform class 4 is the old four-step delay, written into a longer line.
#   * depression: res[i] is 1 until cell i fires, when it loses a depU fraction; it recovers
#     toward 1 at kRec per step. Delivery multiplies the signed weight by res[pre]. depU = 0
#     keeps res at 1 forever, an exact no-op.
#   * split feedback: pool spikes feed back to the proprioceptors of the same side only,
#     which is the only feedback shape that can push the sides out of phase.
#   * kick: a transient drive asymmetry, probing for an anti-phase basin the symmetric
#     configurations never fall into.
import Base
import ./cordio.bend as IOx
import ./kernel.bend as Kr
import ./perturb.bend as P

# ------------------------------------------------------------------ sizes
def Ens.steps() -> U32:
  2000

def Ens.members() -> U32:
  512

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

def Ens.kick_hz() -> F32:
  40.0

def Ens.kick_steps() -> U32:
  400

def Ens.dep_on() -> F32:
  0.2

def Ens.krec() -> F32:
  0.0025

def Ens.inh_lo() -> F32:
  0.6

def Ens.slots() -> U32:
  16

def Ens.out() -> String:
  "ext/cord2_search.bin"

def Src.kernel() -> String:
  "ext/cord_kernel.bin"

def Src.tab() -> String:
  "ext/cord_tab.bin"

def Src.ir() -> String:
  "ext/cord_ir.bin"

# the writers only use aligned sizes, so the descriptor padding is the identity on these
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

def Src.off_delay(+n: U32, +e: U32) -> U32:
  (32 + 20 * n + 4 * e : U32)

# ------------------------------------------------------------------ the axes
type Cfg is Data:
  Cfg{g13a: F32, g13b: F32, inhm: F32, fbmode: U32, het: Bool, dep: F32, kick: Bool,
    abl: U32, cmd: F32}

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
    Cfg.pick(Cfg.bit(m, 3n), 1.0, Ens.inh_lo()), U32.and(U32.shrn(m, 4n), 3),
    Cfg.bit(m, 6n), Bool.pick(F32, Cfg.bit(m, 7n), Ens.dep_on(), 0.0), Cfg.bit(m, 8n),
    Cfg.abl(c), Bool.pick(F32, U32.is_eq(c, 5), 0.0, Ens.command_hz())}

def Cfg.g13a(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, inhm, fbmode, het, dep, kick, abl, cmd}:
      g13a

def Cfg.g13b(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, inhm, fbmode, het, dep, kick, abl, cmd}:
      g13b

def Cfg.inhm(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, inhm, fbmode, het, dep, kick, abl, cmd}:
      inhm

def Cfg.fbmode(x: Cfg) -> U32:
  match x:
    case Cfg{g13a, g13b, inhm, fbmode, het, dep, kick, abl, cmd}:
      fbmode

def Cfg.het(x: Cfg) -> Bool:
  match x:
    case Cfg{g13a, g13b, inhm, fbmode, het, dep, kick, abl, cmd}:
      het

def Cfg.dep(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, inhm, fbmode, het, dep, kick, abl, cmd}:
      dep

def Cfg.kick(x: Cfg) -> Bool:
  match x:
    case Cfg{g13a, g13b, inhm, fbmode, het, dep, kick, abl, cmd}:
      kick

def Cfg.ablbit(x: Cfg) -> U32:
  match x:
    case Cfg{g13a, g13b, inhm, fbmode, het, dep, kick, abl, cmd}:
      abl

def Cfg.cmd(x: Cfg) -> F32:
  match x:
    case Cfg{g13a, g13b, inhm, fbmode, het, dep, kick, abl, cmd}:
      cmd

# fb mode 0 is open; 1 shares the pool total across both sides; 2 and 3 split the feedback by
# side at 20 and 80 ms. The open mode keeps a token history length of one.
def Cfg.closed(+x: Cfg) -> Bool:
  U32.is_ne(Cfg.fbmode(x), 0)

def Cfg.split(+x: Cfg) -> Bool:
  U32.is_ge(Cfg.fbmode(x), 2)

def Cfg.pdelay(+x: Cfg) -> U32:
  Bool.pick(U32, U32.is_eq(Cfg.fbmode(x), 3), 160,
    Bool.pick(U32, U32.is_eq(Cfg.fbmode(x), 0), 1, 40))

# the commissural row-set a run wants: the cut condition overrides the axis
def Cfg.comm(+m: U32, +c: U32) -> U32:
  Bool.pick(U32, U32.is_eq(c, 4), 2, Bool.pick(U32, Cfg.bit(m, 0n), 1, 0))

def Comm.factor(+g: U32) -> F32:
  Bool.pick(F32, U32.is_eq(g, 0), 1.0, Bool.pick(F32, U32.is_eq(g, 1), 3.0, 0.0))

# ------------------------------------------------------------------ shared tables
type Built is Type:
  Built{hl: Array<U32>, role: Array<U32>, proprio: Array<U32>, sign0: Array<F32>,
    cm: Array<U32>, sg: Array<F32>, bi: Array<F32>, dr: Array<F32>, al: Array<U32>}

type ROut is Type:
  ROut{rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, hl: Array<U32>, role: Array<U32>,
    proprio: Array<U32>, cmd: Array<U32>, chan: Array<U32>, dc: Array<U32>, bytes: List<&2, U32>}

def Gain.of(+hl: U32, +x: Cfg) -> F32:
  F32.mul(Bool.pick(F32, U32.is_ne(U32.and(hl, 1), 0), Cfg.g13a(x), 1.0),
    Bool.pick(F32, U32.is_ne(U32.and(hl, 2), 0), Cfg.g13b(x), 1.0))

# One pass over the cells: hemilineage gains and the inhibitory-gain axis act on the outgoing
# sign; the command cells and proprioceptors are driven; ablation silences through the flag.
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
      (role, o) = ro
      (proprio, +p) = rp
      (sign, +s) = rs
      (cmd, +cm) = rc
      +i2 = (i + 1 : U32)
      Cells.go(k, i2, x,
        Array.get(U32, hl, i2), Array.get(U32, role, i2), Array.get(U32, proprio, i2),
        Array.get(F32, sign, i2), Array.get(U32, cmd, i2),
        Array.set(F32, sg, i,
          F32.mul(F32.mul(s, Gain.of(h, x)), Bool.pick(F32, F32.is_lt(s, 0.0), Cfg.inhm(x), 1.0))),
        Array.set(F32, bi, i, 0.0),
        Array.set(F32, dr, i, Bool.pick(F32, U32.is_gt(cm, 0), Cfg.cmd(x),
          Bool.pick(F32, U32.is_gt(p, 0), Ens.proprio_hz(), 0.0))),
        Array.set(U32, al, i, Bool.pick(U32, U32.is_ne(U32.and(h, Cfg.ablbit(x)), 0), 0, 1)))

def Cells.build(hl: Array<U32>, role: Array<U32>, proprio: Array<U32>, sign: Array<F32>,
  cmd: Array<U32>, +n: U32, +x: Cfg) -> Built:
  Cells.go(U32.to_nat(n), 0, x, Array.get(U32, hl, 0), Array.get(U32, role, 0),
    Array.get(U32, proprio, 0), Array.get(F32, sign, 0), Array.get(U32, cmd, 0),
    [0.0 : F32^16n], [0.0 : F32^16n], [0.0 : F32^16n], [0 : U32^16n])

# ------------------------------------------------------------------ the channel tally
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

# left pools (channels 0-2), right pools (3-5)
def Tal.left(t: Tal) -> U32:
  match t:
    case Tal{+a, +b, +c, d, e, f, g, h}:
      (a + b + c : U32)

def Tal.right(t: Tal) -> U32:
  match t:
    case Tal{a, b, c, +d, +e, +f, g, h}:
      (d + e + f : U32)

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

def Chan.tal(fired: List<&2, U32>, t: Tal, r: Array<U32> & U32) -> Tal:
  match fired:
    case Nil{}:
      (q, l) = r
      t
    case i <> +ft:
      (q, l) = r
      Chan.tal(ft, Tal.bump(l, t), Array.get(U32, q, Kr.Head.u32(ft)))

# ------------------------------------------------------------------ the extended kernel
# kernel.bend's four phases with two additions: a resource term res per cell, and a sixteen-
# slot delay ring with per-cell delay classes. The read-only side gains the delay table.
type Lane2 is Type:
  Lane2{v: Array<F32>, gE: Array<F32>, gI: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
    bias: Array<F32>, thr: Array<F32>, drive: Array<F32>, spk: Array<U32>, alive: Array<U32>,
    res: Array<F32>, dc: Array<U32>}

type Run2 is Type:
  Run2{rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, st: Lane2,
    ring: Array<List<&2, U32>>, rng: U32, chk: U32}

type Spk is Type:
  Spk{r: Run2, fired: List<&2, U32>}

# 1. delivery: the arriving spikes scatter weight * sign * res[pre]
def Del2.row(row: List<&2, Kr.Edge>, +s: F32, +q: U32, +wv: F32, r: Array<F32> & F32) -> Array<F32>:
  match row:
    case Nil{}:
      (g, old) = r
      Array.set(F32, g, q, F32.add(old, F32.mul(wv, s)))
    case Kr.Edge{+q2, wv2} <> t:
      (g, old) = r
      Del2.row(t, s, q2, wv2, Array.get(F32, Array.set(F32, g, q, F32.add(old, F32.mul(wv, s))), q2))

def Del2.head(row: List<&2, Kr.Edge>, +s: F32, g: Array<F32>) -> Array<F32>:
  match row:
    case Nil{}:
      g
    case Kr.Edge{+q, wv} <> t:
      Del2.row(t, s, q, wv, Array.get(F32, g, q))

type Del3 is Type:
  Del3{sign: Array<F32>, res: Array<F32>, rows: Array<List<&2, Kr.Edge>>, g: Array<F32>}

def Del2.go(fired: List<&2, U32>, rs: Array<F32> & F32, re: Array<F32> & F32,
  rr: Array<List<&2, Kr.Edge>> & List<&2, Kr.Edge>, g: Array<F32>) -> Del3:
  match fired:
    case Nil{}:
      (sg, s) = rs
      (res, rp) = re
      (rw, row) = rr
      Del3{sg, res, rw, g}
    case pre <> +ft:
      (sg, +s) = rs
      (res, +rp) = re
      (rw, row) = rr
      +h = Kr.Head.u32(ft)
      Del2.go(ft, Array.get(F32, sg, h), Array.get(F32, res, h),
        Array.get(List<&2, Kr.Edge>, rw, h), Del2.head(row, F32.mul(s, rp), g))

# 2. driven cells: on a spike, res loses a depU fraction
type Drv is Type:
  Drv{v: Array<F32>, refr: Array<F32>, adapt: Array<F32>, drive: Array<F32>, spk: Array<U32>,
    res: Array<F32>, fired: List<&2, U32>, rng: U32}

def Drv2.go(driven: List<&2, U32>, +K: Kr.Kc, +dep: F32, +i: U32, +rng: U32, +acc: List<&2, U32>,
  rv: Array<F32> & F32, rr: Array<F32> & F32, ra: Array<F32> & F32, rd: Array<F32> & F32,
  rs: Array<U32> & U32, qres: Array<F32> & F32) -> Drv:
  match driven:
    case Nil{}:
      (v, vi) = rv
      (refr, r) = rr
      (adapt, ad) = ra
      (drive, dr) = rd
      (spk, sc) = rs
      (res, rp) = qres
      Drv{v, refr, adapt, drive, spk, res, List.reverse(&2, U32, acc), rng}
    case pre <> +dt:
      (v, +vi) = rv
      (refr, +r) = rr
      (adapt, +ad) = ra
      (drive, dr) = rd
      (spk, +sc) = rs
      (res, +rp) = qres
      +isRef = F32.is_gt(r, 0.0)
      +rng2 = Kr.Xs.step(isRef, rng)
      +fire = Bool.and(Bool.not(isRef),
        F32.is_lt(F32.mul(U32.to_f32(U32.shrn(rng2, 8n)), 0.000000059604645), F32.mul(dr, Kr.Kc.dtS(K))))
      +h = Kr.Head.u32(dt)
      Drv2.go(dt, K, dep, h, rng2, Bool.pick(List<&2, U32>, fire, i <> acc, acc),
        Array.get(F32, Array.set(F32, v, i, Bool.pick(F32, fire, Kr.Kc.vReset(K), vi)), h),
        Array.get(F32, Array.set(F32, refr, i, Bool.pick(F32, fire, F32.add(Kr.Kc.tRef(K), Kr.Kc.dt(K)), r)), h),
        Array.get(F32, Array.set(F32, adapt, i, Bool.pick(F32, fire, F32.add(ad, Kr.Kc.adaptInc(K)), ad)), h),
        Array.get(F32, drive, h),
        Array.get(U32, Array.set(U32, spk, i, Bool.pick(U32, fire, (sc + 1 : U32), sc)), h),
        Array.get(F32, Array.set(F32, res, i, Bool.pick(F32, fire, F32.mul(rp, F32.sub(1.0, dep)), rp)), h))

# 3. the membrane, plus res recovering toward 1 at kRec per step
def Mem2.dv(+K: Kr.Kc, +vi: F32, +ge: F32, +gi: F32, +bi: F32) -> F32:
  +a1 = F32.sub(Kr.Kc.vRest(K), vi)
  +a2 = F32.mul(F32.mul(ge, F32.sub(Kr.Kc.eExc(K), vi)), Kr.Kc.cE(K))
  +a3 = F32.add(a1, a2)
  +a4 = F32.mul(F32.mul(gi, F32.sub(vi, Kr.Kc.eInh(K))), Kr.Kc.cI(K))
  F32.mul(F32.add(F32.add(a3, a4), bi), Kr.Kc.kM(K))

type Mem is Type:
  Mem{v: Array<F32>, gE: Array<F32>, gI: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
    bias: Array<F32>, res: Array<F32>}

def Mem2.go(+n: Nat, +K: Kr.Kc, +i: U32,
  rv: Array<F32> & F32, rge: Array<F32> & F32, rgi: Array<F32> & F32,
  rr: Array<F32> & F32, ra: Array<F32> & F32, rb: Array<F32> & F32,
  qres: Array<F32> & F32) -> Mem:
  match n:
    case 0n:
      (v, vi) = rv
      (gE, ge) = rge
      (gI, gi) = rgi
      (refr, r) = rr
      (adapt, ad) = ra
      (bias, bi) = rb
      (res, rp) = qres
      Mem{v, gE, gI, refr, adapt, bias, res}
    case 1n+p:
      (v, +vi) = rv
      (gE, +ge) = rge
      (gI, +gi) = rgi
      (refr, +r) = rr
      (adapt, +ad) = ra
      (bias, bi) = rb
      (res, +rp) = qres
      +isRef = F32.is_gt(r, 0.0)
      +i2 = (i + 1 : U32)
      Mem2.go(p, K, i2,
        Array.get(F32, Array.set(F32, v, i, Bool.pick(F32, isRef, Kr.Kc.vReset(K), F32.add(vi, Mem2.dv(K, vi, ge, gi, bi)))), i2),
        Array.get(F32, Array.set(F32, gE, i, F32.mul(ge, Kr.Kc.dE(K))), i2),
        Array.get(F32, Array.set(F32, gI, i, F32.mul(gi, Kr.Kc.dE(K))), i2),
        Array.get(F32, Array.set(F32, refr, i, Bool.pick(F32, isRef, F32.sub(r, Kr.Kc.dt(K)), r)), i2),
        Array.get(F32, Array.set(F32, adapt, i, F32.mul(ad, Kr.Kc.dA(K))), i2),
        Array.get(F32, bias, i2),
        Array.get(F32, Array.set(F32, res, i, F32.add(rp, F32.mul(F32.sub(1.0, rp), Ens.krec()))), i2))

# 4. threshold crossings, depleting res on a spike
type Thr is Type:
  Thr{v: Array<F32>, refr: Array<F32>, adapt: Array<F32>, thr: Array<F32>, spk: Array<U32>,
    alive: Array<U32>, res: Array<F32>, fired: List<&2, U32>}

def Thr2.go(+n: Nat, +K: Kr.Kc, +dep: F32, +i: U32, +acc: List<&2, U32>,
  rv: Array<F32> & F32, rr: Array<F32> & F32, ra: Array<F32> & F32, rt: Array<F32> & F32,
  rs: Array<U32> & U32, rl: Array<U32> & U32, qres: Array<F32> & F32) -> Thr:
  match n:
    case 0n:
      (v, vi) = rv
      (refr, r) = rr
      (adapt, ad) = ra
      (thr, th) = rt
      (spk, sc) = rs
      (alive, al) = rl
      (res, rp) = qres
      Thr{v, refr, adapt, thr, spk, alive, res, acc}
    case 1n+p:
      (v, +vi) = rv
      (refr, +r) = rr
      (adapt, +ad) = ra
      (thr, th) = rt
      (spk, +sc) = rs
      (alive, al) = rl
      (res, +rp) = qres
      +fire = P.Fire.rule(U32.is_gt(al, 0),
        F32.is_ge(vi, F32.add(F32.add(Kr.Kc.vThresh(K), ad), th)), F32.is_le(r, 0.0))
      +i2 = (i - 1 : U32)
      Thr2.go(p, K, dep, i2, Bool.pick(List<&2, U32>, fire, i <> acc, acc),
        Array.get(F32, Array.set(F32, v, i, Bool.pick(F32, fire, Kr.Kc.vReset(K), vi)), i2),
        Array.get(F32, Array.set(F32, refr, i, Bool.pick(F32, fire, Kr.Kc.tRef(K), r)), i2),
        Array.get(F32, Array.set(F32, adapt, i, Bool.pick(F32, fire, F32.add(ad, Kr.Kc.adaptInc(K)), ad)), i2),
        Array.get(F32, thr, i2),
        Array.get(U32, Array.set(U32, spk, i, Bool.pick(U32, fire, (sc + 1 : U32), sc)), i2),
        Array.get(U32, alive, i2),
        Array.get(F32, Array.set(F32, res, i, Bool.pick(F32, fire, F32.mul(rp, F32.sub(1.0, dep)), rp)), i2))

# the delay ring: slot j of the shifted ring is old slot j + 1; a new spike from a cell with
# delay class d prepends into slot d - 1 and so arrives d steps after it fired. The last slot
# never holds pending spikes, so the shift leaves it empty.
def Ring.shift(+n: Nat, +j: U32, +D: U32,
  r: Array<List<&2, U32>> & List<&2, U32>, out: Array<List<&2, U32>>) -> Array<List<&2, U32>> & Array<List<&2, U32>>:
  match n:
    case 0n:
      (ring, rl) = r
      (ring, out)
    case 1n+p:
      (ring, rl) = r
      +j2 = (j + 1 : U32)
      +nx = Bool.pick(U32, U32.is_lt((j2 + 1 : U32), D), (j2 + 1 : U32), 0)
      Ring.shift(p, j2, D,
        Array.get(List<&2, U32>, ring, nx), Array.set(List<&2, U32>, out, j, rl))

def Ring.go(ring: Array<List<&2, U32>>) -> Array<List<&2, U32>> & Array<List<&2, U32>>:
  Ring.shift(U32.to_nat((Ens.slots() - 1 : U32)), 0, Ens.slots(),
    Array.get(List<&2, U32>, ring, 1), Array.new(List<&2, U32>, 4n, Nil{}))

def Bkt.push(i: U32, +idx: U32, r: Array<List<&2, U32>> & List<&2, U32>) -> Array<List<&2, U32>>:
  (ring, slot) = r
  Array.set(List<&2, U32>, ring, idx, i <> slot)

def Bkt.go(fired: List<&2, U32>, +het: Bool, rd: Array<U32> & U32,
  ring: Array<List<&2, U32>>) -> Array<U32> & Array<List<&2, U32>>:
  match fired:
    case Nil{}:
      (dc, d) = rd
      (dc, ring)
    case +i <> +ft:
      (dc, +d) = rd
      +idx = (Bool.pick(U32, het, d, 4) - 1 : U32)
      Bkt.go(ft, het, Array.get(U32, dc, Kr.Head.u32(ft)),
        Bkt.push(i, idx, Array.get(List<&2, U32>, ring, idx)))

# ------------------------------------------------------------------ the step
def Step2.fin(+het: Bool, rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>,
  v: Array<F32>, gE: Array<F32>, gI: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
  bias: Array<F32>, thr: Array<F32>, drive: Array<F32>, spk: Array<U32>, alive: Array<U32>,
  res: Array<F32>, +rng: U32, +chk: U32, +fired: List<&2, U32>,
  dr: Array<U32> & Array<List<&2, U32>>) -> Spk:
  (dc, ringC) = dr
  Spk{Run2{rows, sign, Lane2{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive, res, dc},
    ringC, rng, (chk * 1000003 + U32.from_nat(List.length(&2, U32, fired)) : U32)}, fired}

def Step2.rng(+het: Bool, rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, dc0: Array<U32>,
  v: Array<F32>, gE: Array<F32>, gI: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
  bias: Array<F32>, thr: Array<F32>, drive: Array<F32>, spk: Array<U32>, alive: Array<U32>,
  res: Array<F32>, +rng: U32, +chk: U32, +fired: List<&2, U32>,
  rr: Array<List<&2, U32>> & Array<List<&2, U32>>) -> Spk:
  (ringA, ringB) = rr
  Step2.fin(het, rows, sign, v, gE, gI, refr, adapt, bias, thr, drive, spk, alive, res,
    rng, chk, fired,
    Bkt.go(fired, het, Array.get(U32, dc0, Kr.Head.u32(fired)), ringB))

def Step2.d(+n: U32, +het: Bool, +dep: F32, rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>,
  dc0: Array<U32>, gE: Array<F32>, gI: Array<F32>, bias: Array<F32>, drive: Array<F32>,
  +rng: U32, +chk: U32, +firedA: List<&2, U32>, ring: Array<List<&2, U32>>, t: Thr) -> Spk:
  Thr{v2, refr, adapt, thr, spk, alive, res, firedB} = t
  Step2.rng(het, rows, sign, dc0, v2, gE, gI, refr, adapt, bias, thr, drive, spk, alive, res,
    rng, chk, List.append(&2, U32, firedA, firedB), Ring.go(ring))

def Step2.c(+n: U32, +het: Bool, +dep: F32, rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>,
  dc0: Array<U32>, +K: Kr.Kc, thr: Array<F32>, spk: Array<U32>, alive: Array<U32>,
  drive: Array<F32>, +rng: U32, +chk: U32, +firedA: List<&2, U32>,
  ring: Array<List<&2, U32>>, m: Mem) -> Spk:
  Mem{v, gE, gI, refr, adapt, bias, res2} = m
  +last = (n - 1 : U32)
  Step2.d(n, het, dep, rows, sign, dc0, gE, gI, bias, drive, rng, chk, firedA, ring,
    Thr2.go(U32.to_nat(n), K, dep, last, Nil{},
      Array.get(F32, v, last), Array.get(F32, refr, last), Array.get(F32, adapt, last),
      Array.get(F32, thr, last), Array.get(U32, spk, last), Array.get(U32, alive, last),
      Array.get(F32, res2, last)))

def Step2.b(+n: U32, +het: Bool, +dep: F32, rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>,
  dc0: Array<U32>, +K: Kr.Kc, gE: Array<F32>, gI: Array<F32>, bias: Array<F32>, thr: Array<F32>,
  alive: Array<U32>, +chk: U32, ring: Array<List<&2, U32>>, d: Drv) -> Spk:
  Drv{v, refr, adapt, drive, spk, res, firedA, rng} = d
  Step2.c(n, het, dep, rows, sign, dc0, K, thr, spk, alive, drive, rng, chk, firedA, ring,
    Mem2.go(U32.to_nat(n), K, 0,
      Array.get(F32, v, 0), Array.get(F32, gE, 0), Array.get(F32, gI, 0),
      Array.get(F32, refr, 0), Array.get(F32, adapt, 0), Array.get(F32, bias, 0),
      Array.get(F32, res, 0)))

def Step2.a(+driven: List<&2, U32>, +n: U32, +het: Bool, +dep: F32, +K: Kr.Kc,
  rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, dc0: Array<U32>,
  v: Array<F32>, refr: Array<F32>, adapt: Array<F32>, drive: Array<F32>, spk: Array<U32>,
  alive: Array<U32>, res: Array<F32>, gE: Array<F32>, gI: Array<F32>, bias: Array<F32>,
  thr: Array<F32>, +rng: U32, +chk: U32, ring: Array<List<&2, U32>>) -> Spk:
  +h = Kr.Head.u32(driven)
  Step2.b(n, het, dep, rows, sign, dc0, K, gE, gI, bias, thr, alive, chk, ring,
    Drv2.go(driven, K, dep, h, rng, Nil{},
      Array.get(F32, v, h), Array.get(F32, refr, h), Array.get(F32, adapt, h),
      Array.get(F32, drive, h), Array.get(U32, spk, h), Array.get(F32, res, h)))

def Step2.inh(+driven: List<&2, U32>, +n: U32, +het: Bool, +dep: F32, +K: Kr.Kc,
  dc0: Array<U32>, v: Array<F32>, refr: Array<F32>, adapt: Array<F32>, drive: Array<F32>,
  spk: Array<U32>, alive: Array<U32>, bias: Array<F32>, thr: Array<F32>, +rng: U32, +chk: U32,
  ring: Array<List<&2, U32>>, gE: Array<F32>, d: Del3) -> Spk:
  Del3{sign, res, rows, gI} = d
  Step2.a(driven, n, het, dep, K, rows, sign, dc0, v, refr, adapt, drive, spk, alive, res,
    gE, gI, bias, thr, rng, chk, ring)

def Step2.exc(+driven: List<&2, U32>, +n: U32, +het: Bool, +dep: F32, +K: Kr.Kc,
  dc0: Array<U32>, v: Array<F32>, refr: Array<F32>, adapt: Array<F32>, drive: Array<F32>,
  spk: Array<U32>, alive: Array<U32>, bias: Array<F32>, thr: Array<F32>, +rng: U32, +chk: U32,
  ring: Array<List<&2, U32>>, +inh: List<&2, U32>, gI: Array<F32>, d: Del3) -> Spk:
  Del3{sign, res, rows, gE} = d
  Step2.inh(driven, n, het, dep, K, dc0, v, refr, adapt, drive, spk, alive, bias, thr,
    rng, chk, ring, gE,
    Del2.go(inh, Array.get(F32, sign, Kr.Head.u32(inh)), Array.get(F32, res, Kr.Head.u32(inh)),
      Array.get(List<&2, Kr.Edge>, rows, Kr.Head.u32(inh)), gI))

def Step2.deliv(+driven: List<&2, U32>, +n: U32, +x: Cfg, +K: Kr.Kc,
  rows: Array<List<&2, Kr.Edge>>, v: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
  drive: Array<F32>, spk: Array<U32>, alive: Array<U32>, res: Array<F32>, bias: Array<F32>,
  thr: Array<F32>, dc0: Array<U32>, +rng: U32, +chk: U32,
  ring: Array<List<&2, U32>>, gE: Array<F32>, gI: Array<F32>,
  sp: Array<F32> & Kr.Split) -> Spk:
  (sign, Kr.Split{+exc, +inh}) = sp
  Step2.exc(driven, n, Cfg.het(x), Cfg.dep(x), K, dc0, v, refr, adapt, drive, spk, alive,
    bias, thr, rng, chk, ring, inh, gI,
    Del2.go(exc, Array.get(F32, sign, Kr.Head.u32(exc)), Array.get(F32, res, Kr.Head.u32(exc)),
      Array.get(List<&2, Kr.Edge>, rows, Kr.Head.u32(exc)), gE))

def Step2.head(+driven: List<&2, U32>, +n: U32, +x: Cfg, +K: Kr.Kc,
  rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, dc0: Array<U32>,
  v: Array<F32>, gE: Array<F32>, gI: Array<F32>, refr: Array<F32>, adapt: Array<F32>,
  bias: Array<F32>, thr: Array<F32>, drive: Array<F32>, spk: Array<U32>, alive: Array<U32>,
  res: Array<F32>, +rng: U32, +chk: U32,
  pr: Array<List<&2, U32>> & List<&2, U32>) -> Spk:
  (ring, +front) = pr
  Step2.deliv(driven, n, x, K, rows, v, refr, adapt, drive, spk, alive, res, bias, thr, dc0,
    rng, chk, ring, gE, gI, Kr.Sp.go(front, Nil{}, Nil{}, Array.get(F32, sign, Kr.Head.u32(front))))

def Step2.one(+driven: List<&2, U32>, +K: Kr.Kc, +n: U32, +x: Cfg, r: Run2) -> Spk:
  Run2{rows, sign, Lane2{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive, res, dc},
    ring, rng, chk} = r
  Step2.head(driven, n, x, K, rows, sign, dc, v, gE, gI, refr, adapt, bias, thr, drive, spk,
    alive, res, rng, chk, Array.get(List<&2, U32>, ring, 0))

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

# the kick counter, as a Nat so the checker sees it terminate
def Kk.live(+k: Nat) -> Bool:
  match k:
    case 0n:
      False{}
    case 1n+p:
      True{}

def Kk.next(+k: Nat) -> Nat:
  match k:
    case 0n:
      0n
    case 1n+p:
      p

def Fill.f32(+n: Nat, +i: U32, +x: F32, a: Array<F32>) -> Array<F32>:
  match n:
    case 0n:
      a
    case 1n+p:
      Fill.f32(p, (i + 1 : U32), x, Array.set(F32, a, i, x))

# ------------------------------------------------------------------ one run
# Each turn steps the kernel, tallies the cells that fired by channel, records the counts,
# writes the delayed pool totals back onto the proprioceptors for the next step, and loops.
# The kick adds its extra drive on the left sensors while its counter lasts.
def Run.go(+steps: Nat, +driven: List<&2, U32>, +pL: List<&2, U32>, +pR: List<&2, U32>,
  +pO: List<&2, U32>, +K: Kr.Kc, +n: U32, +x: Cfg, +kickN: Nat,
  +histL: List<&2, U32>, +histR: List<&2, U32>, +acc: List<&2, U32>,
  hl: Array<U32>, role: Array<U32>, prop: Array<U32>, sign0: Array<F32>, cmd0: Array<U32>,
  pq: Array<U32> & Array<U32>, s: Spk) -> ROut:
  match steps:
    case 0n:
      (q1, q2) = pq
      Spk{Run2{rows, sign, Lane2{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive, res, dc},
        ring, rng, chk}, fired} = s
      ROut{rows, sign0, hl, role, prop, cmd0, Array.join(U32, q1, q2), dc,
        List.reverse(&2, U32, acc)}
    case 1n+p:
      (q1, q2) = pq
      Spk{Run2{rows, sign, Lane2{v, gE, gI, refr, adapt, bias, thr, drive, spk, alive, res, dc},
        ring, rng, chk}, +fired} = s
      +t = Chan.tal(fired, Tal.zero(), Array.get(U32, q1, Kr.Head.u32(fired)))
      +pd = Cfg.pdelay(x)
      +histL2 = List.take(&2, U32, Tal.left(t) <> histL, U32.to_nat(pd))
      +histR2 = List.take(&2, U32, Tal.right(t) <> histR, U32.to_nat(pd))
      +tot = U32.to_f32((Hist.at(histL2, (pd - 1 : U32)) + Hist.at(histR2, (pd - 1 : U32)) : U32))
      +fbShared = Bool.pick(F32, Cfg.closed(x),
        F32.add(Ens.proprio_hz(), F32.mul(Ens.pgain(), tot)), Ens.proprio_hz())
      +fbL = Bool.pick(F32, Cfg.split(x),
        F32.add(Ens.proprio_hz(), F32.mul(Ens.pgain(), U32.to_f32(Hist.at(histL2, (pd - 1 : U32))))),
        fbShared)
      +fbR = Bool.pick(F32, Cfg.split(x),
        F32.add(Ens.proprio_hz(), F32.mul(Ens.pgain(), U32.to_f32(Hist.at(histR2, (pd - 1 : U32))))),
        fbShared)
      +kickAdd = Bool.pick(F32, Bool.and(Cfg.kick(x), Kk.live(kickN)), Ens.kick_hz(), 0.0)
      Run.go(p, driven, pL, pR, pO, K, n, x, Kk.next(kickN), histL2, histR2,
        Tal.bytes(t, acc), hl, role, prop, sign0, cmd0, Array.fork(U32, q2),
        Step2.one(driven, K, n, x,
          Run2{rows, sign, Lane2{v, gE, gI, refr, adapt, bias, thr,
            Fb.drive(pO, Ens.proprio_hz(), Fb.drive(pR, fbR, Fb.drive(pL, F32.add(fbL, kickAdd), drive))),
            spk, alive, res, dc}, ring, rng, chk}))

# ------------------------------------------------------------------ one lane
def Lane.start(+driven: List<&2, U32>, +pL: List<&2, U32>, +pR: List<&2, U32>, +pO: List<&2, U32>,
  +K: Kr.Kc, +n: U32, +x: Cfg, +seed: U32,
  rows: Array<List<&2, Kr.Edge>>, chan: Array<U32>, dc: Array<U32>, b: Built) -> ROut:
  Built{hl, role, prop, sign0, cm, sg, bi, dr, al} = b
  Run.go((1n + U32.to_nat(Ens.steps()) : Nat), driven, pL, pR, pO, K, n, x,
    Bool.pick(Nat, Cfg.kick(x), U32.to_nat(Ens.kick_steps()), 0n), Nil{}, Nil{}, Nil{},
    hl, role, prop, sign0, cm, Array.fork(U32, chan),
    Spk{Run2{rows, sg, Lane2{Fill.f32(U32.to_nat(n), 0, Kr.Kc.vRest(K), [0.0 : F32^16n]),
      [0.0 : F32^16n], [0.0 : F32^16n], [0.0 : F32^16n], [0.0 : F32^16n], bi,
      [0.0 : F32^16n], dr, [0 : U32^16n], al, Fill.f32(U32.to_nat(n), 0, 1.0, [0.0 : F32^16n]), dc},
      Array.new(List<&2, U32>, 4n, Nil{}), seed, 0}, Nil{}})

def Lane.one(+driven: List<&2, U32>, +pL: List<&2, U32>, +pR: List<&2, U32>, +pO: List<&2, U32>,
  +K: Kr.Kc, +n: U32, +m: U32, +c: U32,
  rows: Array<List<&2, Kr.Edge>>, sign: Array<F32>, hl: Array<U32>, role: Array<U32>,
  prop: Array<U32>, cmd: Array<U32>, chan: Array<U32>, dc: Array<U32>) -> ROut:
  Lane.start(driven, pL, pR, pO, K, n, Cfg.of(m, c), (2654435761 + m * 7919 + c : U32), rows,
    chan, dc, Cells.build(hl, role, prop, sign, cmd, n, Cfg.of(m, c)))

# ------------------------------------------------------------------ a batch of lanes
def Batch.join(a: ROut, b: ROut) -> ROut:
  ROut{r1, s1, h1, o1, p1, d1, q1, c1, b1} = a
  ROut{r2, s2, h2, o2, p2, d2, q2, c2, b2} = b
  ROut{Array.join(List<&2, Kr.Edge>, r1, r2), Array.join(F32, s1, s2), Array.join(U32, h1, h2),
    Array.join(U32, o1, o2), Array.join(U32, p1, p2), Array.join(U32, d1, d2),
    Array.join(U32, q1, q2), Array.join(U32, c1, c2), List.append(&2, U32, b1, b2)}

def Batch.leaf(r2: Array<List<&2, Kr.Edge>>, s2: Array<F32>, h2: Array<U32>, o2: Array<U32>,
  p2: Array<U32>, d2: Array<U32>, q2: Array<U32>, c2: Array<U32>, a: ROut) -> ROut:
  ROut{r1, s1, h1, o1, p1, d1, q1, c1, bs} = a
  ROut{Array.join(List<&2, Kr.Edge>, r1, r2), Array.join(F32, s1, s2), Array.join(U32, h1, h2),
    Array.join(U32, o1, o2), Array.join(U32, p1, p2), Array.join(U32, d1, d2),
    Array.join(U32, q1, q2), Array.join(U32, c1, c2), bs}

# run index within a commissural group -> member and condition
def Run.member(+j: U32, +grp: U32) -> U32:
  Bool.pick(U32, U32.is_eq(grp, 2), j, (2 * U32.div(j, 5) + U32.and(grp, 1) : U32))

def Run.cond(+j: U32, +grp: U32) -> U32:
  Bool.pick(U32, U32.is_eq(grp, 2), 4,
    Bool.pick(U32, U32.is_lt(U32.mod(j, 5), 4), U32.mod(j, 5), 5))

def Batch.go(+d: Nat, +driven: List<&2, U32>, +pL: List<&2, U32>, +pR: List<&2, U32>,
  +pO: List<&2, U32>, +K: Kr.Kc, +n: U32, +j0: U32, +grp: U32,
  pr: Array<List<&2, Kr.Edge>> & Array<List<&2, Kr.Edge>>, ps: Array<F32> & Array<F32>,
  ph: Array<U32> & Array<U32>, po: Array<U32> & Array<U32>, pp: Array<U32> & Array<U32>,
  pdd: Array<U32> & Array<U32>, pq: Array<U32> & Array<U32>, pdc: Array<U32> & Array<U32>) -> ROut:
  match d:
    case 0n:
      (r1, r2) = pr
      (s1, s2) = ps
      (h1, h2) = ph
      (o1, o2) = po
      (p1, p2) = pp
      (dd1, dd2) = pdd
      (q1, q2) = pq
      (dc1, dc2) = pdc
      Batch.leaf(r2, s2, h2, o2, p2, dd2, q2, dc2,
        Lane.one(driven, pL, pR, pO, K, n, Run.member(j0, grp), Run.cond(j0, grp),
          r1, s1, h1, o1, p1, dd1, q1, dc1))
    case 1n++e:
      (r1, r2) = pr
      (s1, s2) = ps
      (h1, h2) = ph
      (o1, o2) = po
      (p1, p2) = pp
      (dd1, dd2) = pdd
      (q1, q2) = pq
      (dc1, dc2) = pdc
      a b = Batch.go(e, driven, pL, pR, pO, K, n, j0, grp, Array.fork(List<&2, Kr.Edge>, r1),
          Array.fork(F32, s1), Array.fork(U32, h1), Array.fork(U32, o1), Array.fork(U32, p1),
          Array.fork(U32, dd1), Array.fork(U32, q1), Array.fork(U32, dc1))
        Batch.go(e, driven, pL, pR, pO, K, n, (j0 + U32.shln(1, e) : U32), grp,
          Array.fork(List<&2, Kr.Edge>, r2), Array.fork(F32, s2), Array.fork(U32, h2),
          Array.fork(U32, o2), Array.fork(U32, p2), Array.fork(U32, dd2), Array.fork(U32, q2),
          Array.fork(U32, dc2))
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

def Rows.take(+n: Nat, +base: U32, +f: F32, gaps: List<&2, U32>, ws: List<&2, F32>,
  cm: List<&2, U32>, acc: List<&2, Kr.Edge>) -> Tk:
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

def Rows.build(lens: List<&2, U32>, +f: F32, gaps: List<&2, U32>, ws: List<&2, F32>,
  cm: List<&2, U32>, +k: U32, a: Array<List<&2, Kr.Edge>>) -> Array<List<&2, Kr.Edge>>:
  match lens:
    case Nil{}:
      a
    case l <> lt:
      +tk = Rows.take(U32.to_nat(l), 0, f, gaps, ws, cm, Nil{})
      Rows.build(lt, f, Tk.gaps(tk), Tk.ws(tk), Tk.cm(tk), (k + 1 : U32),
        Array.set(List<&2, Kr.Edge>, a, k, Tk.row(tk)))

# ------------------------------------------------------------------ the driven sets
# proprio flags carry the side: 1 left, 2 right, 3 other
type Ids is Data:
  Ids{d: List<&2, U32>, pl: List<&2, U32>, pr: List<&2, U32>, po: List<&2, U32>}

def Ids.d(x: Ids) -> List<&2, U32>:
  match x:
    case Ids{d, pl, pr, po}:
      d

def Ids.pl(x: Ids) -> List<&2, U32>:
  match x:
    case Ids{d, pl, pr, po}:
      pl

def Ids.pr(x: Ids) -> List<&2, U32>:
  match x:
    case Ids{d, pl, pr, po}:
      pr

def Ids.po(x: Ids) -> List<&2, U32>:
  match x:
    case Ids{d, pl, pr, po}:
      po

def Ids.go(cmds: List<&2, U32>, props: List<&2, U32>, +i: U32,
  +accD: List<&2, U32>, +accL: List<&2, U32>, +accR: List<&2, U32>, +accO: List<&2, U32>) -> Ids:
  match cmds:
    case Nil{}:
      Ids{List.reverse(&2, U32, accD), List.reverse(&2, U32, accL),
        List.reverse(&2, U32, accR), List.reverse(&2, U32, accO)}
    case +c <> ct:
      match props:
        case Nil{}:
          Ids{List.reverse(&2, U32, accD), List.reverse(&2, U32, accL),
            List.reverse(&2, U32, accR), List.reverse(&2, U32, accO)}
        case +p <> pt:
          +i2 = (i + 1 : U32)
          Ids.go(ct, pt, i2,
            Bool.pick(List<&2, U32>, Bool.or(U32.is_gt(c, 0), U32.is_gt(p, 0)), i <> accD, accD),
            Bool.pick(List<&2, U32>, U32.is_eq(p, 1), i <> accL, accL),
            Bool.pick(List<&2, U32>, U32.is_eq(p, 2), i <> accR, accR),
            Bool.pick(List<&2, U32>, U32.is_eq(p, 3), i <> accO, accO))

# ------------------------------------------------------------------ the batch and group loops
def Batches.go(nb: Nat, +j0: U32, +grp: U32, +driven: List<&2, U32>, +pL: List<&2, U32>,
  +pR: List<&2, U32>, +pO: List<&2, U32>, +K: Kr.Kc, +n: U32, +acc: List<&2, U32>,
  r: ROut) -> IO(ROut):
  match nb:
    case 0n:
      ROut{rows, sign, hl, role, prop, cmd, chan, dc, bs} = r
      IO.pure(ROut, ROut{rows, sign, hl, role, prop, cmd, chan, dc, List.append(&2, U32, acc, bs)})
    case 1n+p:
      ROut{rows, sign, hl, role, prop, cmd, chan, dc, bs} = r
      do IO<ROut>:
        IO.print("run " ++ U32.show(j0) ++ " group " ++ U32.show(grp))
        Batches.go(p, (j0 + Ens.batch() : U32), grp, driven, pL, pR, pO, K, n,
          List.append(&2, U32, acc, bs),
          Batch.go(Ens.batch_depth(), driven, pL, pR, pO, K, n, j0, grp,
            Array.fork(List<&2, Kr.Edge>, rows), Array.fork(F32, sign), Array.fork(U32, hl),
            Array.fork(U32, role), Array.fork(U32, prop), Array.fork(U32, cmd),
            Array.fork(U32, chan), Array.fork(U32, dc)))

def Batches.count(+g: U32) -> Nat:
  U32.to_nat(Bool.pick(U32, U32.is_eq(g, 2), U32.div(Ens.members(), Ens.batch()),
    U32.div((U32.div(Ens.members(), 2) * 5 : U32), Ens.batch())))

def Groups.go(ng: Nat, +g: U32, +driven: List<&2, U32>, +pL: List<&2, U32>, +pR: List<&2, U32>,
  +pO: List<&2, U32>, +K: Kr.Kc, +n: U32,
  +lens: List<&2, U32>, +gaps: List<&2, U32>, +ws: List<&2, F32>, +cm: List<&2, U32>,
  +acc: List<&2, U32>, r: ROut) -> IO(ROut):
  match ng:
    case 0n:
      ROut{rows, sign, hl, role, prop, cmd, chan, dc, bs} = r
      IO.pure(ROut, ROut{rows, sign, hl, role, prop, cmd, chan, dc, List.append(&2, U32, acc, bs)})
    case 1n+p:
      ROut{rows0, sign, hl, role, prop, cmd, chan, dc, bs} = r
      do IO<ROut>:
        IO.print("commissural group " ++ U32.show(g) ++ " factor " ++ F32.show(Comm.factor(g)))
        r2 : ROut <- Batches.go(Batches.count(g), 0, g, driven, pL, pR, pO, K, n, Nil{},
          ROut{Rows.build(lens, Comm.factor(g), gaps, ws, cm, 0, Array.new(List<&2, Kr.Edge>, 16n, Nil{})),
            sign, hl, role, prop, cmd, chan, dc, Nil{}})
        Groups.go(p, (g + 1 : U32), driven, pL, pR, pO, K, n, lens, gaps, ws, cm,
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

# magic 'SUCH', version 3, steps, members, conditions, channels, records per run, runs
def Hdr.of(body: List<&2, U32>) -> List<&2, U32>:
  Hdr.u32(1212372307, Hdr.u32(3, Hdr.u32(Ens.steps(), Hdr.u32(Ens.members(),
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
  ROut{rows, sign, hl, role, prop, cmd, chan, dc, bs} = r
  +body = bs
  do IO<Unit>:
    IO.print("bytes " ++ Nat.show(List.length(&2, U32, body)))
    Fx.dump(Ens.out(), Hdr.of(body))
    t1 : Nat <- IO.now()
    IO.print("ms_total " ++ Nat.show(Nat.sub(t1, t0)))

def Main.go(+t0: Nat, +K: Kr.Kc, +n: U32, +ids: Ids, +lens: List<&2, U32>,
  +gaps: List<&2, U32>, +ws: List<&2, F32>, +cm: List<&2, U32>,
  sign: Array<F32>, hl: Array<U32>, role: Array<U32>, prop: Array<U32>, cmd: Array<U32>,
  chan: Array<U32>, dc: Array<U32>) -> IO(Unit):
  do IO<Unit>:
    IO.print("driven " ++ Nat.show(List.length(&2, U32, Ids.d(ids)))
      ++ " proprioceptors L" ++ Nat.show(List.length(&2, U32, Ids.pl(ids)))
      ++ " R" ++ Nat.show(List.length(&2, U32, Ids.pr(ids)))
      ++ " O" ++ Nat.show(List.length(&2, U32, Ids.po(ids))))
    r : ROut <- Groups.go(3n, 0, Ids.d(ids), Ids.pl(ids), Ids.pr(ids), Ids.po(ids), K, n,
      lens, gaps, ws, cm, Nil{},
      ROut{Array.new(List<&2, Kr.Edge>, 0n, Nil{}), sign, hl, role, prop, cmd, chan, dc, Nil{}})
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
    dcb : List<&2, U32> <- IOx.Fx.slurp(Src.tab(), Src.off_delay(n, e), (4 * n : U32))
    ipb : List<&2, U32> <- IOx.Fx.slurp(Src.ir(), Src.off_indptr(n), (4 * (n + 1) : U32))
    gpb : List<&2, U32> <- IOx.Fx.slurp(Src.ir(), Src.off_gaps(n), (4 * e : U32))
    +props : List<&2, U32> = IOx.Bytes.u32s(ppb)
    +cmds : List<&2, U32> = IOx.Bytes.u32s(cdb)
    Main.go(t0, Kc.of(IOx.Bytes.f32s(csb)), n,
      Ids.go(cmds, props, 0, Nil{}, Nil{}, Nil{}, Nil{}),
      IOx.Lens.of(IOx.Bytes.u32s(ipb)), IOx.Bytes.u32s(gpb), IOx.Bytes.f32s(wb), IOx.Bytes.u32s(cmb),
      IOx.F32s.into(IOx.Bytes.f32s(sgb), 0, [0.0 : F32^16n]),
      IOx.U32s.into(IOx.Bytes.u32s(hlb), 0, [0 : U32^16n]),
      IOx.U32s.into(IOx.Bytes.u32s(rlb), 0, [0 : U32^16n]),
      IOx.U32s.into(props, 0, [0 : U32^16n]),
      IOx.U32s.into(cmds, 0, [0 : U32^16n]),
      IOx.U32s.into(IOx.Bytes.u32s(chb), 0, [0 : U32^16n]),
      IOx.U32s.into(IOx.Bytes.u32s(dcb), 0, [0 : U32^16n]))
