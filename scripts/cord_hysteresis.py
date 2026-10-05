# Can the cord's wiring hold a half-centre's state? Doc 52 found that the
# antagonist switch flips every ~20 ms, too fast for any slow process to time,
# and asked two wiring questions before anything more is simulated:
#
#   1. Do the excitatory premotor cells that excite a flexor pool excite one
#      another more than they excite the extensor pool's?
#   2. Is 19A -> 13A inhibition stronger, per cell pair, than 19A -> 19A?
#
#   python3 scripts/cord_hysteresis.py --meta <banc_888_meta.feather>
#
# Every premotor cell (class 1 inhibitory, class 2 excitatory, from the tab's
# class column) is placed in one leg's flexor or extensor half by its live
# weight onto that leg's coxa-trochanter pools, in the wiring being measured.
# A half is what wins when it is active: excitatory cells that drive the
# flexors (E_F) together with inhibitory cells that silence the extensors
# (I_E) make the flexor half, and E_E with I_F the extensor half. A cell goes
# to the leg it weights most, and to a pool only if that pool gets at least
# twice the weight of its antagonist. Weights are the kernel's (w * sign).
#
# A half holds itself when each source group's signed input to its own half
# exceeds its signed input to the other half. Reported per target cell (the
# input a target receives, which is what the dynamics see) and per ordered
# cell pair (doc 52's question). Scrambles keep each cell's class and degrees,
# so their halves are reassigned from their own motor edges.
import os
import sys
import json
import argparse
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import prep_cord_x4 as X4

LEGS = ["T1_left", "T2_left", "T3_left", "T1_right", "T2_right", "T3_right"]
FLEX, EXT = "flex_coxa_trochanter_joint", "extend_coxa_trochanter_joint"
GROUPS = ["E_F", "E_E", "I_F", "I_E"]          # I_F inhibits the flexors
HALF = {"E_F": 0, "I_E": 0, "E_E": 1, "I_F": 1}  # 0 flexor half, 1 extensor half
PREF = 2.0


def wiring(wd, N):
    ir = open(f"{wd}/cord_ir.bin", "rb").read()
    E = int(np.frombuffer(ir, dtype=np.uint32, count=1, offset=12)[0])
    indptr = np.frombuffer(ir, dtype=np.uint32, count=N + 1, offset=32 + 4 * N).astype(np.int64)
    gaps = np.frombuffer(ir, dtype=np.uint32, count=E, offset=32 + 8 * N + 4).astype(np.int64)
    pre = np.repeat(np.arange(N), np.diff(indptr))
    first = np.zeros(E, dtype=bool)
    first[indptr[:-1][np.diff(indptr) > 0]] = True
    seg = np.cumsum(first) - 1
    cs = np.cumsum(gaps + 1)
    st = np.flatnonzero(first)
    post = cs - (cs[st] - gaps[st] - 1)[seg] - 1
    kb = open(f"{wd}/cord_kernel.bin", "rb").read()
    w = np.frombuffer(kb, dtype=np.float32, count=E, offset=128).astype(np.float64)
    sgn = np.frombuffer(kb, dtype=np.float32, count=N, offset=128 + 4 * E).astype(np.float64)
    tb = open(f"{wd}/cord_tab.bin", "rb").read()
    klass = np.frombuffer(tb, dtype=np.uint32, count=N, offset=32 + 8 * N)
    live = w > 0
    return pre[live], post[live], w[live] * sgn[pre[live]], klass


def halves(pre, post, sw, klass, pools, N):
    """Per cell: leg index and group index (-1 when unassigned)."""
    L = len(LEGS)
    onto = np.zeros((N, L, 2))
    poolOf = np.full(N, -1)
    for li, leg in enumerate(LEGS):
        for f in range(2):
            poolOf[pools[leg][f]] = 2 * li + f
    m = (poolOf[post] >= 0) & (klass[pre] > 0)
    np.add.at(onto, (pre[m], poolOf[post[m]] >> 1, poolOf[post[m]] & 1), np.abs(sw[m]))
    leg = onto.sum(2).argmax(1)
    fe = onto[np.arange(N), leg]                     # weight onto (flexor, extensor)
    grp = np.full(N, -1)
    flexPref, extPref = fe[:, 0] >= PREF * fe[:, 1], fe[:, 1] >= PREF * fe[:, 0]
    anyw = fe.sum(1) > 0
    exc, inh = klass == 2, klass == 1
    grp[anyw & exc & flexPref] = 0
    grp[anyw & exc & extPref] = 1
    grp[anyw & inh & flexPref] = 2
    grp[anyw & inh & extPref] = 3
    return leg, grp


def blocks(pre, post, sw, leg, grp):
    """4x4 signed weight among the groups, within each leg, summed over legs:
    total, per target cell, per ordered pair."""
    tot = np.zeros((4, 4))
    nPairs = np.zeros((4, 4))
    nTgt = np.zeros(4)
    m = (grp[pre] >= 0) & (grp[post] >= 0) & (leg[pre] == leg[post]) & (pre != post)
    np.add.at(tot, (grp[pre[m]], grp[post[m]]), sw[m])
    for li in range(len(LEGS)):
        n = np.array([np.sum((leg == li) & (grp == g)) for g in range(4)], dtype=float)
        nTgt += n
        nPairs += np.outer(n, n) - np.diag(n)
    return tot, tot / np.maximum(nTgt, 1)[None, :], tot / np.maximum(nPairs, 1), nTgt


def hold(perTgt):
    """Per source group: signed input to its own half minus to the other half,
    per target cell (mean over the half's two groups). Positive holds a winner."""
    out = {}
    for s, g in enumerate(GROUPS):
        own = [t for t, h in enumerate(GROUPS) if HALF[h] == HALF[g]]
        oth = [t for t, h in enumerate(GROUPS) if HALF[h] != HALF[g]]
        out[g] = float(perTgt[s, own].mean() - perTgt[s, oth].mean())
    return out


def rated(path, pre, post, sw, leg, grp, N):
    """With doc 51's recorded spike counts (cordx5c, real wiring): the input a
    half's cell receives from its own half, from the other half, and from
    everything else, in the run's mean activity (kernel units / s)."""
    raw = open(path, "rb").read()
    hdr = np.frombuffer(raw, dtype=np.uint32, count=8)
    assert hdr[0] == 0x48435553 and hdr[1] == 5, "not a cordx5c output"
    steps, members, conds, ch, recs, runs = (int(x) for x in hdr[2:8])
    per_tal = recs * ch * 2
    T = steps * 0.5 / 1000.0
    half = np.full(N, -1)
    ok = grp >= 0
    half[ok] = np.array([HALF[GROUPS[g]] for g in grp[ok]])
    tgt = half[post] >= 0
    same = tgt & (half[pre] >= 0) & (leg[pre] == leg[post]) & (half[pre] == half[post]) & (pre != post)
    other = tgt & (half[pre] >= 0) & (leg[pre] == leg[post]) & (half[pre] != half[post])
    rest = tgt & ~same & ~other
    nT = ok.sum()
    out = []
    print("\nrate-weighted input per half cell (real wiring, doc 51's runs): own half, other half, rest (exc / inh)")
    for j in range(runs):
        off = 32 + j * (per_tal + 2 * N) + per_tal
        rate = np.frombuffer(raw, dtype=np.uint16, count=N, offset=off).astype(np.float64) / T
        c = sw * rate[pre]
        r = {"member": [0, 3, 32, 64, 96, 39, 67, 99][j >> 1], "condition": ["baseline", "no_command"][j & 1],
             "own": float(c[same].sum() / nT), "other": float(c[other].sum() / nT),
             "ownExc": float(c[same & (c > 0)].sum() / nT), "ownInh": float(c[same & (c < 0)].sum() / nT),
             "otherExc": float(c[other & (c > 0)].sum() / nT), "otherInh": float(c[other & (c < 0)].sum() / nT),
             "restExc": float(c[rest & (c > 0)].sum() / nT), "restInh": float(c[rest & (c < 0)].sum() / nT),
             "hz": {g: float(rate[grp == k].mean()) for k, g in enumerate(GROUPS)}}
        r["holdFrac"] = (r["own"] - r["other"]) / (abs(r["own"]) + abs(r["other"]) + r["restExc"] - r["restInh"])
        out.append(r)
        print(f"  m{r['member']:>3} {r['condition']:<10} own {r['own']:+8.1f}  other {r['other']:+8.1f}  "
              f"rest {r['restExc']:+8.1f} / {r['restInh']:+8.1f}  hold {100 * r['holdFrac']:5.1f}%  "
              + " ".join(f"{g} {v:4.1f}Hz" for g, v in r["hz"].items()))
        print(f"       own = {r['ownExc']:+.1f} exc {r['ownInh']:+.1f} inh;  other = {r['otherExc']:+.1f} exc {r['otherInh']:+.1f} inh")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meta", required=True)
    ap.add_argument("--x", default="ext/x6")
    ap.add_argument("--out", default="ext/x6/hysteresis.json")
    ap.add_argument("--cells", default="ext/x5/real/x5_cells.bin")
    a = ap.parse_args()
    base = X4.load("ext")
    N = base["N"]
    meta = pd.read_feather(a.meta).reset_index(drop=True)
    mm = meta.iloc[base["origIdx"].astype(np.int64)]
    cls = mm["cell_class"].fillna("").astype(str).to_numpy()
    nm = mm["neuromere"].fillna("").astype(str).to_numpy()
    fn = mm["cell_function_detailed"].fillna("").astype(str).to_numpy()
    hl = mm["hemilineage"].fillna("").astype(str).to_numpy()
    side = base["side"]
    legmn = cls == "leg_motor_neuron"
    pools = {}
    for leg in LEGS:
        sg_, sd = leg.split("_")
        s = 1 if sd == "left" else 2
        pools[leg] = [np.flatnonzero(legmn & (nm == sg_) & (side == s) & (fn == f)) for f in (FLEX, EXT)]

    rep = {"spec": "doc 53: wiring-only hysteresis test of the inhibitory premotor half-centre",
           "pref": PREF, "wirings": {}}
    for wname in ("real", "deg", "side"):
        pre, post, sw, klass = wiring(f"{a.x}/{wname}", N)
        leg, grp = halves(pre, post, sw, klass, pools, N)
        tot, perTgt, perPair, n = blocks(pre, post, sw, leg, grp)
        h = hold(perTgt)
        # difference mode: does activity in one half raise its own half and
        # lower the other's? Net per target cell, summed over each half's sources.
        own = sum(perTgt[s, t] for s in range(4) for t in range(4) if HALF[GROUPS[s]] == HALF[GROUPS[t]]) / 2
        cross = sum(perTgt[s, t] for s in range(4) for t in range(4) if HALF[GROUPS[s]] != HALF[GROUPS[t]]) / 2
        # doc 52's hemilineage question, per ordered pair, same segment and side
        seg_side = np.char.add(nm.astype(str), side.astype(str))
        hlq = {}
        for A in ("19A", "13A"):
            for B in ("19A", "13A"):
                ia = (klass == 1) & (hl == A)
                ib = (klass == 1) & (hl == B)
                mk = ia[pre] & ib[post] & (seg_side[pre] == seg_side[post]) & (pre != post)
                pairs = 0
                for ss in np.unique(seg_side[ia | ib]):
                    na, nb = np.sum(ia & (seg_side == ss)), np.sum(ib & (seg_side == ss))
                    pairs += na * nb - (np.sum(ia & ib & (seg_side == ss)))
                hlq[f"{A}->{B}"] = {"perPair": float(sw[mk].sum() / max(pairs, 1)),
                                    "connectedFrac": float(len(np.unique(np.stack([pre[mk], post[mk]]), axis=1)[0]) / max(pairs, 1))}
        rep["wirings"][wname] = {"n": dict(zip(GROUPS, n.astype(int).tolist())),
                                 "perTarget": perTgt.round(3).tolist(), "perPair": perPair.round(5).tolist(),
                                 "hold": h, "ownHalf": float(own), "otherHalf": float(cross),
                                 "differenceMode": float(own - cross), "hemilineage": hlq}
        print(f"\n== {wname}: cells " + ", ".join(f"{g} {int(c)}" for g, c in zip(GROUPS, n)))
        print("signed weight per target cell (row source -> column target), within leg")
        print("        " + "".join(f"{g:>9}" for g in GROUPS))
        for s, g in enumerate(GROUPS):
            print(f"{g:<8}" + "".join(f"{perTgt[s, t]:9.2f}" for t in range(4)))
        print("hold (own half - other half, per target cell): " +
              ", ".join(f"{g} {v:+.2f}" for g, v in h.items()))
        print(f"difference mode: own {own:+.2f}, other {cross:+.2f}, own - other {own - cross:+.2f}")
        print("19A/13A per ordered pair, same hemisegment: " +
              ", ".join(f"{k} {v['perPair']:+.4f} ({100 * v['connectedFrac']:.1f}% connected)" for k, v in hlq.items()))
        if wname == "real" and os.path.exists(a.cells):
            rep["wirings"][wname]["rates"] = rated(a.cells, pre, post, sw, leg, grp, N)
    json.dump(rep, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
