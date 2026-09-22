# Proofs of LAWS.bend. `bend PROOF.bend` prints "All terms check." when every law holds.
import Base
import ./connectome.bend as C
import ./dataset.bend as D
import ./LAWS.bend as L

# ================================================================= lemmas

# A Bool clash `False == True` proves anything: send True to Empty and False to Unit, and
# rewrite Unit{} across the equation.
def Bool.disc(b: Bool) -> Type:
  match b:
    case False{}:
      Unit
    case True{}:
      Empty

def Bool.false_true(e: {False{} == True{} : Bool}) -> Empty:
  %e : Bool.disc(_)
  Unit{}

def Empty.elim(-A: Type, x: Empty) -> A:
  match x:

# If a conjunction is true, so is its right conjunct.
def Bool.and_true_r(a: Bool, -b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {b == True{} : Bool}:
  match a:
    case True{}:
      e
    case False{}:
      Empty.elim({b == True{} : Bool}, Bool.false_true(e))

# If a conjunction is true, so is its left conjunct.
def Bool.and_true_l(a: Bool, -b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {a == True{} : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      Empty.elim({False{} == True{} : Bool}, Bool.false_true(e))

# Two true conjuncts make a true conjunction.
def Bool.and_intro(a: Bool, -b: Bool, ea: {a == True{} : Bool}, eb: {b == True{} : Bool}) -> {Bool.and(a, b) == True{} : Bool}:
  match a:
    case True{}:
      eb
    case False{}:
      Empty.elim({False{} == True{} : Bool}, Bool.false_true(ea))

# The inner check of a row, given a previous target, implies the row check.
def IR.row_ok.go_ok(row: List<&2, C.Syn>, +n: U32, +minW: U32, +prev: U32, e: {C.IR.row_ok.go(row, n, minW, prev) == True{} : Bool}) -> {C.IR.row_ok(row, n, minW) == True{} : Bool}:
  match row:
    case Nil{}:
      {==}
    case C.Syn{+post, +count} <> t:
      Bool.and_true_r(U32.is_lt(prev, post), Bool.and(U32.is_lt(post, n), Bool.and(U32.is_ge(count, minW), C.IR.row_ok.go(t, n, minW, post))), e)

# The reconstruction gate keeps the target whatever it decides.
def Compile.big_post(+post: U32, +count: U32, big: Bool, gain: F32) -> {C.CSyn.post(C.Compile.big(post, count, big, gain)) == post : U32}:
  match big:
    case False{}:
      {==}
    case True{}:
      {==}

# Ring.cat is associative.
def Ring.cat_assoc(xs: List<&2, List<&2, U32>>, +ys: List<&2, List<&2, U32>>, +zs: List<&2, List<&2, U32>>) -> {C.Ring.cat(C.Ring.cat(xs, ys), zs) == C.Ring.cat(xs, C.Ring.cat(ys, zs)) : List<&2, List<&2, U32>>}:
  match xs:
    case Nil{}:
      {==}
    case +h <> t:
      %Ring.cat_assoc(t, ys, zs) : {h <> C.Ring.cat(C.Ring.cat(t, ys), zs) == h <> _ : List<&2, List<&2, U32>>}
      {==}

# ================================================================= 1. Well-formed rows

def L.row_ok_nil(n, minW):
  {==}

def L.row_ok_tail(s, row, n, minW, e):
  match s:
    case C.Syn{+post, +count}:
      match row:
        case Nil{}:
          {==}
        case C.Syn{+p2, +c2} <> t2:
          IR.row_ok.go_ok(C.Syn{p2, c2} <> t2, n, minW, post,
            Bool.and_true_r(U32.is_ge(count, minW), C.IR.row_ok.go(C.Syn{p2, c2} <> t2, n, minW, post),
              Bool.and_true_r(U32.is_lt(post, n), Bool.and(U32.is_ge(count, minW), C.IR.row_ok.go(C.Syn{p2, c2} <> t2, n, minW, post)), e)))

def L.row_ok_bounded(row, n, minW, e):
  match row:
    case Nil{}:
      {==}
    case C.Syn{+post, +count} <> t:
      Bool.and_intro(U32.is_lt(post, n), C.IR.row_bounded(t, n),
        Bool.and_true_l(U32.is_lt(post, n), Bool.and(U32.is_ge(count, minW), C.IR.row_ok.go(t, n, minW, post)), e),
        L.row_ok_bounded(t, n, minW,
          IR.row_ok.go_ok(t, n, minW, post,
            Bool.and_true_r(U32.is_ge(count, minW), C.IR.row_ok.go(t, n, minW, post),
              Bool.and_true_r(U32.is_lt(post, n), Bool.and(U32.is_ge(count, minW), C.IR.row_ok.go(t, n, minW, post)), e)))))

# ================================================================= 2. One edge

def L.syn_onto_sensory_is_cut(minSyn, nt, side, region, motor, kenyon, lamina, oa, post, count, gain):
  {==}

def L.syn_below_min_is_cut(minSyn, keep, nt, side, region, sensory, motor, kenyon, lamina, oa, post, count, gain, e):
  match keep sensory:
    case True{} True{}:
      %Equal.sym(Bool, U32.is_ge(count, minSyn), False{}, e) : {C.Compile.big(post, count, _, gain) == C.CSyn{post, C.Cut{}} : C.CSyn}
      {==}
    case True{} False{}:
      %Equal.sym(Bool, U32.is_ge(count, minSyn), False{}, e) : {C.Compile.big(post, count, _, gain) == C.CSyn{post, C.Cut{}} : C.CSyn}
      {==}
    case False{} True{}:
      {==}
    case False{} False{}:
      %Equal.sym(Bool, U32.is_ge(count, minSyn), False{}, e) : {C.Compile.big(post, count, _, gain) == C.CSyn{post, C.Cut{}} : C.CSyn}
      {==}

def L.syn_kept(minSyn, keep, nt, side, region, motor, kenyon, lamina, oa, post, count, gain, e):
  %Equal.sym(Bool, U32.is_ge(count, minSyn), True{}, e) : {C.Compile.big(post, count, _, gain) == C.CSyn{post, C.Kept{count, gain}} : C.CSyn}
  {==}

def L.syn_kept_onto_sensory_under_preinh(minSyn, nt, side, region, motor, kenyon, lamina, oa, post, count, gain, e):
  %Equal.sym(Bool, U32.is_ge(count, minSyn), True{}, e) : {C.Compile.big(post, count, _, gain) == C.CSyn{post, C.Kept{count, gain}} : C.CSyn}
  {==}

def L.syn_preserves_post(minSyn, keep, nt, side, region, sensory, motor, kenyon, lamina, oa, post, count, gain):
  match keep sensory:
    case True{} True{}:
      Compile.big_post(post, count, U32.is_ge(count, minSyn), gain)
    case True{} False{}:
      Compile.big_post(post, count, U32.is_ge(count, minSyn), gain)
    case False{} True{}:
      {==}
    case False{} False{}:
      Compile.big_post(post, count, U32.is_ge(count, minSyn), gain)

# ================================================================= 3. One row

def L.row_length(row, minSyn, keep):
  match row:
    case Nil{}:
      {==}
    case r <> t:
      %L.row_length(t, minSyn, keep) : {1n+List.length(&2, C.CSyn, C.Compile.row(t, minSyn, keep)) == 1n+_ : Nat}
      {==}

def L.row_posts(row, minSyn, keep):
  match row:
    case Nil{}:
      {==}
    case r <> t:
      match r:
        case C.RSyn{C.Syn{+post, +count}, C.Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}, gain}:
          %L.row_posts(t, minSyn, keep) : {C.CSyn.post(C.Compile.syn(minSyn, keep, C.RSyn{C.Syn{post, count}, C.Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}, gain})) <> C.CRow.posts(C.Compile.row(t, minSyn, keep)) == post <> _ : List<&2, U32>}
          %L.syn_preserves_post(minSyn, keep, nt, side, region, sensory, motor, kenyon, lamina, oa, post, count, gain) : {C.CSyn.post(C.Compile.syn(minSyn, keep, C.RSyn{C.Syn{post, count}, C.Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}, gain})) <> C.CRow.posts(C.Compile.row(t, minSyn, keep)) == _ <> C.CRow.posts(C.Compile.row(t, minSyn, keep)) : List<&2, U32>}
          {==}

def L.row_sensory_cut(row, minSyn):
  match row:
    case Nil{}:
      {==}
    case +r <> t:
      match r:
        case C.RSyn{C.Syn{+post, +count}, C.Cell{nt, side, region, sensory, motor, kenyon, lamina, oa}, gain}:
          match sensory:
            case True{}:
              L.row_sensory_cut(t, minSyn)
            case False{}:
              L.row_sensory_cut(t, minSyn)

def L.deliver_reaches_kept(row, sign):
  match row:
    case Nil{}:
      {==}
    case C.CSyn{+post, w} <> t:
      match w:
        case C.Cut{}:
          L.deliver_reaches_kept(t, sign)
        case C.Kept{count, gain}:
          %L.deliver_reaches_kept(t, sign) : {post <> C.Deliver.targets(C.Deliver.row(t, sign)) == post <> _ : List<&2, U32>}
          {==}

# ================================================================= 4. The whole graph

def L.rows_length(rows, cells, signs, inScale, p, j):
  match rows:
    case Nil{}:
      {==}
    case r <> t:
      match p:
        case C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}:
          %L.rows_length(t, cells, signs, inScale, C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}, (j + 1 : U32)) : {1n+List.length(&2, List<&2, C.CSyn>, C.Compile.rows(t, cells, signs, inScale, C.Params{minSyn, neuromod, preInh, kcThreshold, laminaBias, inhGain, wSyn, sizeAlpha, maxSizeScale, boostCap}, (j + 1 : U32))) == 1n+_ : Nat}
          {==}

# ================================================================= 5. Per-cell physiology

def L.sign_oa_silenced(nt, side, region, sensory, motor, kenyon, lamina, graded):
  {==}

def L.sign_graded(neuromod, nt, side, region, sensory, motor, kenyon, lamina, g):
  match neuromod:
    case True{}:
      {==}
    case False{}:
      {==}

def L.sign_table(nt, side, region, sensory, motor, kenyon, lamina, oa):
  {==}

def L.kenyon_threshold(kc, nt, side, region, sensory, motor, lamina, oa):
  {==}

def L.other_threshold(kc, nt, side, region, sensory, motor, lamina, oa):
  {==}

def L.lamina_bias(lb, nt, side, region, sensory, motor, kenyon, oa):
  {==}

def L.other_bias(lb, nt, side, region, sensory, motor, kenyon, oa):
  {==}

def L.weight_of_cut():
  {==}

def L.weight_of_kept(count, gain):
  {==}

# ================================================================= 6. The kernel

def L.refractory_never_fires(dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI, v, gE, gI, refr, count, thr, e):
  %Equal.sym(Bool, F32.is_gt(refr, 0.0), True{}, e) : {C.Kernel.fire.go(C.Dyn{dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI}, C.Neuron{v, gE, gI, refr, count}, _, F32.is_ge(v, F32.add(vThresh, thr))) == (C.Neuron{vReset, gE, gI, F32.sub(refr, dt), count}, False{}) : C.Neuron & Bool}
  {==}

def L.fires_at_threshold(dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI, v, gE, gI, refr, count, thr, e1, e2):
  %Equal.sym(Bool, F32.is_gt(refr, 0.0), False{}, e1) : {C.Kernel.fire.go(C.Dyn{dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI}, C.Neuron{v, gE, gI, refr, count}, _, F32.is_ge(v, F32.add(vThresh, thr))) == (C.Neuron{vReset, gE, gI, tRef, 1n+count}, True{}) : C.Neuron & Bool}
  %Equal.sym(Bool, F32.is_ge(v, F32.add(vThresh, thr)), True{}, e2) : {C.Kernel.fire.go(C.Dyn{dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI}, C.Neuron{v, gE, gI, refr, count}, False{}, _) == (C.Neuron{vReset, gE, gI, tRef, 1n+count}, True{}) : C.Neuron & Bool}
  {==}

def L.silent_below_threshold(dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI, v, gE, gI, refr, count, thr, e1, e2):
  %Equal.sym(Bool, F32.is_gt(refr, 0.0), False{}, e1) : {C.Kernel.fire.go(C.Dyn{dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI}, C.Neuron{v, gE, gI, refr, count}, _, F32.is_ge(v, F32.add(vThresh, thr))) == (C.Neuron{v, gE, gI, refr, count}, False{}) : C.Neuron & Bool}
  %Equal.sym(Bool, F32.is_ge(v, F32.add(vThresh, thr)), False{}, e2) : {C.Kernel.fire.go(C.Dyn{dt, vRest, vThresh, vReset, tRef, kM, dE, eExc, eInh, cE, cI}, C.Neuron{v, gE, gI, refr, count}, False{}, _) == (C.Neuron{v, gE, gI, refr, count}, False{}) : C.Neuron & Bool}
  {==}

def L.ring_fifo(pre, s, post):
  match pre:
    case Nil{}:
      {==}
    case h <> t:
      %Equal.sym(List<&2, List<&2, U32>>, C.Ring.cat(C.Ring.cat(t, s <> post), [Nil{}]), C.Ring.cat(t, C.Ring.cat(s <> post, [Nil{}])), Ring.cat_assoc(t, s <> post, [Nil{}])) : {C.Ring.drain(List.length(&2, List<&2, U32>, t), _) == s : List<&2, U32>}
      L.ring_fifo(t, s, C.Ring.cat(post, [Nil{}]))

# ================================================================= 7. The male connectome

def L.graph_layout():
  {==}

def L.neurons_layout():
  {==}

def L.region_of_vnc_motor():
  {==}

def L.region_of_ol_intrinsic():
  {==}

def L.region_of_cb_intrinsic():
  {==}

def L.cb_sensory_is_sensory():
  {==}

def L.cb_intrinsic_is_not_sensory():
  {==}

def L.cell_of_bytes_sensory(flags, nt, side):
  {==}
