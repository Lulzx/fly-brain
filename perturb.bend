# Perturbations as operations on the compiled graph and the per-member state.
#
# `src/exp/select.js` turns a selector string into a mask over the cells, and the arena backend
# applies three kinds of perturbation through it: ablation silences the selected cells, an edge
# rule multiplies a named class of synapses, and a drive puts a constant depolarising bias on a
# population. This module is those three operations, written so that what they must not do is
# a structural fact rather than a comment.
#
# A selector is modelled by the mask it resolves to. That is deliberate: which cells a string
# names is a question about annotation tables, checked by `select.js`'s own error when a
# selector matches nothing; what the perturbation then does to them is what these laws are
# about.
import Base

# ------------------------------------------------------------------ ablation
# The backend silences a cell by raising its threshold out of reach (`setThr(i, 1e6)`). The
# kernel carries the same thing as a flag, so that "this cell cannot spike" is a case of a
# match rather than a claim about floating-point comparison. `cordrun.bend` runs the two
# against each other and requires the same spikes.
def Ablate.cell(kill: Bool, alive: Bool) -> Bool:
  match kill:
    case True{}:
      False{}
    case False{}:
      alive

def Ablate.go(mask: List<&2, Bool>, alive: List<&2, Bool>) -> List<&2, Bool>:
  match mask:
    case Nil{}:
      alive
    case m <> mt:
      match alive:
        case Nil{}:
          Nil{}
        case a <> at:
          Ablate.cell(m, a) <> Ablate.go(mt, at)

# ------------------------------------------------------------------ the fire rule
# One cell's decision in the threshold sweep: it fires when it is alive, its membrane has
# reached its own threshold, and it is out of its refractory period.
type FCell is Data:
  FCell{idx: U32, alive: Bool, atThresh: Bool, free: Bool}

def Fire.rule(alive: Bool, atThresh: Bool, free: Bool) -> Bool:
  match alive:
    case False{}:
      False{}
    case True{}:
      Bool.and(atThresh, free)

def Fire.of(c: FCell) -> Bool:
  match c:
    case FCell{idx, alive, atThresh, free}:
      Fire.rule(alive, atThresh, free)

# the cells that fire, in order
def Fire.sweep(cells: List<&2, FCell>) -> List<&2, U32>:
  match cells:
    case Nil{}:
      Nil{}
    case FCell{+idx, alive, atThresh, free} <> t:
      +rest = Fire.sweep(t)
      Bool.pick(List<&2, U32>, Fire.rule(alive, atThresh, free), idx <> rest, rest)

# the same sweep with the silenced cells taken out of the input
def Fire.drop_dead(cells: List<&2, FCell>) -> List<&2, FCell>:
  match cells:
    case Nil{}:
      Nil{}
    case FCell{idx, +alive, atThresh, free} <> t:
      +rest = Fire.drop_dead(t)
      Bool.pick(List<&2, FCell>, alive, FCell{idx, alive, atThresh, free} <> rest, rest)

# ------------------------------------------------------------------ edge classes
# An edge carries the class it belongs to, resolved once when the graph is built, so scaling a
# class is a walk with no lookup and nothing to mis-address.
type PEdge is Data:
  PEdge{post: U32, w: F32, cls: Bool}

def PEdge.post(e: PEdge) -> U32:
  match e:
    case PEdge{post, w, cls}:
      post

def PEdge.w(e: PEdge) -> F32:
  match e:
    case PEdge{post, w, cls}:
      w

def Scale.edge(+f: F32, e: PEdge) -> PEdge:
  match e:
    case PEdge{post, w, cls}:
      match cls:
        case True{}:
          PEdge{post, F32.mul(w, f), True{}}
        case False{}:
          PEdge{post, w, False{}}

def Scale.row(+f: F32, row: List<&2, PEdge>) -> List<&2, PEdge>:
  match row:
    case Nil{}:
      Nil{}
    case e <> t:
      Scale.edge(f, e) <> Scale.row(f, t)

def Row.posts(row: List<&2, PEdge>) -> List<&2, U32>:
  match row:
    case Nil{}:
      Nil{}
    case e <> t:
      PEdge.post(e) <> Row.posts(t)

# the weights of the edges outside the class, in order: what a class scaling must not touch
def Row.outside(row: List<&2, PEdge>) -> List<&2, F32>:
  match row:
    case Nil{}:
      Nil{}
    case PEdge{post, w, cls} <> t:
      +rest = Row.outside(t)
      Bool.pick(List<&2, F32>, cls, rest, w <> rest)

# ------------------------------------------------------------------ drive
# `setBias(idx, mv)`: the selected cells get the bias, and the window's end sets it back to
# zero, which is the same operation at mv = 0.
def Drive.cell(sel: Bool, +mv: F32, b: F32) -> F32:
  match sel:
    case True{}:
      mv
    case False{}:
      b

def Drive.go(mask: List<&2, Bool>, bias: List<&2, F32>, +mv: F32) -> List<&2, F32>:
  match mask:
    case Nil{}:
      bias
    case m <> mt:
      match bias:
        case Nil{}:
          Nil{}
        case b <> bt:
          Drive.cell(m, mv, b) <> Drive.go(mt, bt, mv)

# the values at the cells the mask does not name, in order
def Mask.unselected(mask: List<&2, Bool>, xs: List<&2, F32>) -> List<&2, F32>:
  match mask:
    case Nil{}:
      xs
    case m <> mt:
      match xs:
        case Nil{}:
          Nil{}
        case x <> xt:
          +rest = Mask.unselected(mt, xt)
          Bool.pick(List<&2, F32>, m, rest, x <> rest)

def Mask.unselected_b(mask: List<&2, Bool>, xs: List<&2, Bool>) -> List<&2, Bool>:
  match mask:
    case Nil{}:
      xs
    case m <> mt:
      match xs:
        case Nil{}:
          Nil{}
        case x <> xt:
          +rest = Mask.unselected_b(mt, xt)
          Bool.pick(List<&2, Bool>, m, rest, x <> rest)
