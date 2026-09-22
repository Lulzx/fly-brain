# The cord IR: an induced subgraph of the connectome, in a representation that makes
# well-formedness structural.
#
# Doc 39 froze the VNC leg-premotor subgraph as a 14 MB JSON of CSR arrays. This module is the
# same object as a *checked* one. Two moves make that possible.
#
# 1. Rows are delta-encoded. A row is a list of `DSyn{gap, count}`: the first entry's target is
#    `gap` cells along, and each later entry's target is `gap + 1` cells past the previous one.
#    A gap list cannot express a descending target or a duplicate, so "the row is sorted and
#    duplicate-free" is not a property to check — it is a property of the representation. What
#    is left to bound is the row's *span*, the cell index one past its last target.
#
# 2. The subgraph is taken by walking a membership list, not by indexing. `DSub.go` walks the
#    cells in order beside the row; index arithmetic never appears, so every theorem below is a
#    structural induction rather than a fact about 32-bit comparison.
#
# The construction is the specification. `cordcheck.bend` runs it against the shipped cord rows
# on a sample, and checks every row against the full connectome by the fast index-lookup route.
import Base

# ------------------------------------------------------------------ Nat comparison
# Base's `Nat.is_le` goes through `Nat.cmp`, which matches both arguments, so `is_le(0n, b)`
# is stuck while b is a variable. These two match the argument that decides, so every bound
# below reduces under a variable.
def Nat.leb(a: Nat, b: Nat) -> Bool:
  match a:
    case 0n:
      True{}
    case 1n+p:
      match b:
        case 0n:
          False{}
        case 1n+q:
          Nat.leb(p, q)

def Nat.ltb(a: Nat, b: Nat) -> Bool:
  match b:
    case 0n:
      False{}
    case 1n+q:
      Nat.leb(a, q)

# ------------------------------------------------------------------ delta rows
type DSyn is Data:
  DSyn{gap: Nat, count: U32}

def DSyn.gap(s: DSyn) -> Nat:
  match s:
    case DSyn{gap, count}:
      gap

def DSyn.count(s: DSyn) -> U32:
  match s:
    case DSyn{gap, count}:
      count

# The span of a row: one past its last target, so a row whose span is at most n has every
# target inside n cells. Each entry consumes its gap plus the target cell itself.
def DRow.span(row: List<&2, DSyn>) -> Nat:
  match row:
    case Nil{}:
      0n
    case DSyn{g, c} <> t:
      Nat.add(1n+g, DRow.span(t))

# the head's gap, which is the number of cells to pass before its target
def DRow.head_gap(row: List<&2, DSyn>) -> Nat:
  match row:
    case Nil{}:
      0n
    case DSyn{g, c} <> t:
      g

# every count reaches the reconstruction threshold
def DRow.counts_ok(row: List<&2, DSyn>, +minW: U32) -> Bool:
  match row:
    case Nil{}:
      True{}
    case DSyn{g, +c} <> t:
      Bool.and(U32.is_ge(c, minW), DRow.counts_ok(t, minW))

# A row is well-formed for n cells at threshold minW when it fits inside n cells and every
# count reaches the threshold. Sortedness and distinctness need no clause.
def DRow.ok(+row: List<&2, DSyn>, +n: Nat, +minW: U32) -> Bool:
  Bool.and(Nat.leb(DRow.span(row), n), DRow.counts_ok(row, minW))

# the counts, in row order
def DRow.counts(row: List<&2, DSyn>) -> List<&2, U32>:
  match row:
    case Nil{}:
      Nil{}
    case DSyn{g, c} <> t:
      c <> DRow.counts(t)

# ------------------------------------------------------------------ targets
# `base` is the first cell index this row may still target.
def DRow.posts.go(row: List<&2, DSyn>, +base: Nat) -> List<&2, Nat>:
  match row:
    case Nil{}:
      Nil{}
    case DSyn{+g, c} <> t:
      Nat.add(base, g) <> DRow.posts.go(t, 1n+Nat.add(base, g))

def DRow.posts(row: List<&2, DSyn>) -> List<&2, Nat>:
  DRow.posts.go(row, 0n)

# strictly ascending, with every element above `prev`
def NAsc.go(xs: List<&2, Nat>, +prev: Nat) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case +x <> t:
      Bool.and(Nat.ltb(prev, x), NAsc.go(t, x))

def NAsc(xs: List<&2, Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case +x <> t:
      NAsc.go(t, x)

# every target is inside the row's span
def NBelow(xs: List<&2, Nat>, +n: Nat) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case +x <> t:
      Bool.and(Nat.ltb(x, n), NBelow(t, n))

# ------------------------------------------------------------------ membership
# how many of the remaining cells are members
def DSub.kept(keep: List<&2, Bool>) -> Nat:
  match keep:
    case Nil{}:
      0n
    case k <> t:
      match k:
        case True{}:
          1n+DSub.kept(t)
        case False{}:
          DSub.kept(t)

# The induced row. `keep` is the membership of the cells from here on, `row` the entries still
# to place, `skip` the cells left to pass before the head entry's target, and `gap` the members
# passed since the last emitted entry.
#
# Three things happen per cell. A cell short of the target widens the gap if it is a member. A
# target cell that is a member emits the entry with its accumulated gap, and the gap restarts.
# A target cell that is not a member drops the entry and keeps the gap, so the next surviving
# entry measures across the hole. The count is never touched, and no entry is reordered.
def DSub.go(keep: List<&2, Bool>, row: List<&2, DSyn>, +skip: Nat, +gap: Nat) -> List<&2, DSyn>:
  match keep:
    case Nil{}:
      Nil{}
    case k <> kt:
      match k:
        case True{}:
          match row:
            case Nil{}:
              Nil{}
            case DSyn{g, +c} <> +rt:
              match skip:
                case 1n+s:
                  DSub.go(kt, DSyn{g, c} <> rt, s, 1n+gap)
                case 0n:
                  DSyn{gap, c} <> DSub.go(kt, rt, DRow.head_gap(rt), 0n)
        case False{}:
          match row:
            case Nil{}:
              Nil{}
            case DSyn{g, +c} <> +rt:
              match skip:
                case 1n+s:
                  DSub.go(kt, DSyn{g, c} <> rt, s, gap)
                case 0n:
                  DSub.go(kt, rt, DRow.head_gap(rt), gap)

# ------------------------------------------------------------------ the specification
# What the construction is supposed to produce, written without any gap bookkeeping: walk the
# cells, count the members seen so far, and at every surviving target emit that count. This is
# "filter to the members and relabel by rank" with nothing to get wrong; `DSub.go` is the same
# walk carrying differences instead, and `dsub_posts_are_ranks` says the two agree.
def DSub.spec(keep: List<&2, Bool>, row: List<&2, DSyn>, +skip: Nat, +rank: Nat) -> List<&2, Nat>:
  match keep:
    case Nil{}:
      Nil{}
    case k <> kt:
      match k:
        case True{}:
          match row:
            case Nil{}:
              Nil{}
            case DSyn{g, c} <> +rt:
              match skip:
                case 1n+s:
                  DSub.spec(kt, DSyn{g, c} <> rt, s, 1n+rank)
                case 0n:
                  rank <> DSub.spec(kt, rt, DRow.head_gap(rt), 1n+rank)
        case False{}:
          match row:
            case Nil{}:
              Nil{}
            case DSyn{g, c} <> +rt:
              match skip:
                case 1n+s:
                  DSub.spec(kt, DSyn{g, c} <> rt, s, rank)
                case 0n:
                  DSub.spec(kt, rt, DRow.head_gap(rt), rank)

# the counts of the surviving entries, in order
def DSub.spec_counts(keep: List<&2, Bool>, row: List<&2, DSyn>, +skip: Nat) -> List<&2, U32>:
  match keep:
    case Nil{}:
      Nil{}
    case k <> kt:
      match k:
        case True{}:
          match row:
            case Nil{}:
              Nil{}
            case DSyn{g, +c} <> +rt:
              match skip:
                case 1n+s:
                  DSub.spec_counts(kt, DSyn{g, c} <> rt, s)
                case 0n:
                  c <> DSub.spec_counts(kt, rt, DRow.head_gap(rt))
        case False{}:
          match row:
            case Nil{}:
              Nil{}
            case DSyn{g, c} <> +rt:
              match skip:
                case 1n+s:
                  DSub.spec_counts(kt, DSyn{g, c} <> rt, s)
                case 0n:
                  DSub.spec_counts(kt, rt, DRow.head_gap(rt))

# the induced row of a whole row, from cell zero
def DSub.row(keep: List<&2, Bool>, +row: List<&2, DSyn>) -> List<&2, DSyn>:
  DSub.go(keep, row, DRow.head_gap(row), 0n)

# ------------------------------------------------------------------ whole graph
# Rows are taken for member cells only, in order, so the subgraph's rows are indexed by the
# same relabeling its targets are.
def DSub.rows(+keep: List<&2, Bool>, members: List<&2, Bool>, rows: List<&2, List<&2, DSyn>>) -> List<&2, List<&2, DSyn>>:
  match members:
    case Nil{}:
      Nil{}
    case k <> mt:
      match k:
        case True{}:
          match rows:
            case Nil{}:
              Nil{}
            case r <> rt:
              DSub.row(keep, r) <> DSub.rows(keep, mt, rt)
        case False{}:
          match rows:
            case Nil{}:
              Nil{}
            case r <> rt:
              DSub.rows(keep, mt, rt)

# every row of a graph has counts at or above the threshold
def DSub.all_counts_ok(rows: List<&2, List<&2, DSyn>>, +minW: U32) -> Bool:
  match rows:
    case Nil{}:
      True{}
    case r <> t:
      Bool.and(DRow.counts_ok(r, minW), DSub.all_counts_ok(t, minW))

def DSub.rows_ok(rows: List<&2, List<&2, DSyn>>, +n: Nat, +minW: U32) -> Bool:
  match rows:
    case Nil{}:
      True{}
    case r <> t:
      Bool.and(DRow.ok(r, n, minW), DSub.rows_ok(t, n, minW))
