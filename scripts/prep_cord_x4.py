# Inputs for cordx4.bend: the external cord IR (ext/) repacked three ways —
# the real wiring and two degree-preserving scrambles of it — each with a
# sixteen-channel tally that reads the coxa-trochanter antagonists per leg.
#
#   python3 scripts/prep_cord_banc.py --meta <meta.feather> --edges <edges.feather> --out ext
#   python3 scripts/prep_cord_x4.py --meta <meta.feather>
#
# Writes ext/x4/{real,deg,side}/cord_{ir,kernel,tab}.bin and ext/x4/x4.json.
#
# Only live edges are kept (weight > 0). A zero-weight edge delivers w * s = 0
# into a conductance, an exact no-op, so dropping them changes run time and not
# arithmetic; the real IR here gives the same spikes as ext/cord_*.bin.
#
# The scrambles reassign each live edge's postsynaptic cell by permutation
# within a stratum, so every cell keeps its live out-degree and live in-degree
# per stratum, and the synapse count stays with the edge. The weight is
# recomputed for the new target from the count, the target's input scale and
# the presynaptic inhibitory gain — the same formula prep_cord_banc.py uses.
#
#   deg    stratum = presynaptic sign class (exc / inh / no fast sign): each
#          cell keeps its number of excitatory and inhibitory inputs
#   side   stratum = sign class x presynaptic side x postsynaptic side: also
#          keeps each cell's ipsilateral / contralateral input counts
#
# Self-loops and duplicate (pre, post) pairs are resolved by swaps inside the
# stratum, which preserve both degree sequences.
#
# Channels: 0-5 coxa-trochanter flexor pool per leg, 6-11 coxa-trochanter
# extensor pool per leg (legOrder), 12/13 cord population left/right,
# 14/15 the remaining leg motor neurons left/right, 255 uncounted.
import os
import json
import hashlib
import argparse
import numpy as np
import pandas as pd

INH_GAIN = 0.577
LEG_ORDER = ["T1_left", "T2_left", "T3_left", "T1_right", "T2_right", "T3_right"]
FLEX, EXT = "flex_coxa_trochanter_joint", "extend_coxa_trochanter_joint"


def u32(b, off, n):
    return np.frombuffer(b, dtype=np.uint32, count=n, offset=off)


def f32(b, off, n):
    return np.frombuffer(b, dtype=np.float32, count=n, offset=off)


def load(src):
    ir = open(f"{src}/cord_ir.bin", "rb").read()
    kb = open(f"{src}/cord_kernel.bin", "rb").read()
    tb = open(f"{src}/cord_tab.bin", "rb").read()
    N, E = int(u32(ir, 8, 1)[0]), int(u32(ir, 12, 1)[0])
    lay = json.load(open(f"{src}/cord_ir.json"))["layout"]
    origIdx = u32(ir, lay["origIdx"]["off"], N)
    indptr = u32(ir, lay["indptr"]["off"], N + 1).astype(np.int64)
    gaps = u32(ir, lay["gaps"]["off"], E).astype(np.int64)
    counts = np.frombuffer(ir, dtype=np.uint16, count=E, offset=lay["counts"]["off"]).astype(np.int64)
    side = np.frombuffer(ir, dtype=np.uint8, count=N, offset=lay["side"]["off"])
    role = np.frombuffer(ir, dtype=np.uint8, count=N, offset=lay["role"]["off"])
    pre = np.repeat(np.arange(N), np.diff(indptr))
    # undo the gap encoding: a row's first entry is its target, later entries
    # are post - prev - 1
    first = np.zeros(E, dtype=bool)
    first[indptr[:-1][np.diff(indptr) > 0]] = True
    # so within a row post = running sum of (gap + 1), minus one
    seg = np.cumsum(first) - 1
    cs = np.cumsum(gaps + 1)
    starts = np.flatnonzero(first)
    post = cs - (cs[starts] - gaps[starts] - 1)[seg] - 1
    consts = kb[64:128]
    w = f32(kb, 128, E)
    sgn = f32(kb, 128 + 4 * E, N)
    tab = dict(proprio=u32(tb, 32 + 4 * N, N), hl=u32(tb, 32 + 8 * N, N),
               role=u32(tb, 32 + 12 * N, N), cmd=u32(tb, 32 + 16 * N, N),
               delay=u32(tb, 32 + 20 * N + 4 * E, N))
    return dict(N=N, E=E, origIdx=origIdx, pre=pre, post=post, counts=counts, side=side,
                role=role, w=w, sgn=sgn, consts=consts, kh=kb[:64], th=tb[:32], tab=tab)


def scramble(pre, post, strat, rng):
    post = post.copy()
    for s in np.unique(strat):
        ix = np.flatnonzero(strat == s)
        post[ix] = post[ix[rng.permutation(len(ix))]]
    N = int(max(pre.max(), post.max())) + 1
    key = pre * N + post
    for rnd in range(200):
        _, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
        bad = np.flatnonzero((cnt[inv] > 1) | (pre == post))
        # keep one copy of each duplicate pair; move the rest
        dup = cnt[inv] > 1
        if dup.any():
            o = np.flatnonzero(dup)
            _, firsts = np.unique(key[o], return_index=True)
            keep = np.zeros(len(pre), dtype=bool)
            keep[o[firsts]] = True
            bad = np.flatnonzero(((cnt[inv] > 1) & ~keep) | (pre == post))
        if not len(bad):
            return post, rnd
        live = set(key.tolist())
        for i in bad:
            ix = np.flatnonzero(strat == strat[i])
            for _ in range(64):
                j = int(ix[rng.integers(len(ix))])
                a, b = pre[i] * N + post[j], pre[j] * N + post[i]
                if pre[i] != post[j] and pre[j] != post[i] and a not in live and b not in live:
                    live.discard(int(key[i])); live.discard(int(key[j]))
                    post[i], post[j] = post[j], post[i]
                    key[i], key[j] = a, b
                    live.add(int(a)); live.add(int(b))
                    break
    raise SystemExit("scramble did not resolve collisions")


def write(out, d, pre, post, w, comm, chan):
    os.makedirs(out, exist_ok=True)
    N = d["N"]
    order = np.lexsort((post, pre))
    pre, post, w, comm = pre[order], post[order], w[order], comm[order]
    E = len(pre)
    indptr = np.zeros(N + 1, dtype=np.int64)
    np.add.at(indptr, pre + 1, 1)
    indptr = np.cumsum(indptr)
    gaps = np.empty(E, dtype=np.uint32)
    rs = np.ones(E, dtype=bool)
    rs[1:] = pre[1:] != pre[:-1]
    gaps[rs] = post[rs]
    d_ = post[1:] - post[:-1] - 1
    if (d_[~rs[1:]] < 0).any():
        raise SystemExit("duplicate edge after sort")
    gaps[~rs] = d_[~rs[1:]]
    # the IR prefix cordx4.bend reads: header, origIdx, indptr, gaps
    hdr = np.zeros(8, dtype=np.uint32)
    hdr[:4] = [0x44524F43, 1, N, E]
    hdr[7] = gaps.max() if E else 0
    with open(f"{out}/cord_ir.bin", "wb") as f:
        f.write(hdr.tobytes() + d["origIdx"].tobytes() + indptr.astype(np.uint32).tobytes()
                + gaps.tobytes())
    kh = np.frombuffer(d["kh"], dtype=np.uint32).copy()
    kh[3] = E
    kh[8] = 0
    with open(f"{out}/cord_kernel.bin", "wb") as f:
        f.write(kh.tobytes() + d["consts"] + w.astype(np.float32).tobytes() + d["sgn"].tobytes())
    th = np.frombuffer(d["th"], dtype=np.uint32).copy()
    th[3] = E
    th[4] = 16
    t = d["tab"]
    with open(f"{out}/cord_tab.bin", "wb") as f:
        f.write(th.tobytes() + chan.astype(np.uint32).tobytes() + t["proprio"].tobytes()
                + t["hl"].tobytes() + t["role"].tobytes() + t["cmd"].tobytes()
                + comm.astype(np.uint32).tobytes() + t["delay"].tobytes())
    return {p: hashlib.sha256(open(f"{out}/{p}", "rb").read()).hexdigest()
            for p in ("cord_ir.bin", "cord_kernel.bin", "cord_tab.bin")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meta", required=True)
    ap.add_argument("--src", default="ext")
    ap.add_argument("--out", default="ext/x4")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    d = load(a.src)
    N = d["N"]
    meta = pd.read_feather(a.meta).reset_index(drop=True)
    m = meta.iloc[d["origIdx"].astype(np.int64)]
    sc = m["super_class"].fillna("").astype(str).to_numpy()
    cls = m["cell_class"].fillna("").astype(str).to_numpy()
    fn = m["cell_function_detailed"].fillna("").astype(str).to_numpy()
    nm = m["neuromere"].fillna("").astype(str).to_numpy()
    sd = m["side"].fillna("").astype(str).to_numpy()
    side = d["side"]
    # the IR's side table is authoritative; the meta snapshot only names functions, and
    # must agree with the IR on nearly every cell to be the right table
    agree = float((np.where(sd == "left", 1, np.where(sd == "right", 2, 3)) == side).mean())
    if agree < 0.995:
        raise SystemExit(f"meta agrees with the IR's side table on only {agree:.1%} of cells")
    sd = np.where(side == 1, "left", np.where(side == 2, "right", ""))

    # ---------------------------------------------------------------- channels
    chan = np.full(N, 255, dtype=np.uint32)
    legmn = (cls == "leg_motor_neuron") & np.isin(nm, ["T1", "T2", "T3"]) & np.isin(sd, ["left", "right"])
    pools = {}
    for li, leg in enumerate(LEG_ORDER):
        seg, s = leg.split("_")
        at = legmn & (nm == seg) & (sd == s)
        fl, ex = np.flatnonzero(at & (fn == FLEX)), np.flatnonzero(at & (fn == EXT))
        chan[fl], chan[ex] = li, 6 + li
        pools[leg] = {"flex": len(fl), "ext": len(ex)}
    role = d["role"]
    pop = (role != 1) & (sc != "descending")
    chan[(chan == 255) & pop & (side == 1)] = 12
    chan[(chan == 255) & pop & (side == 2)] = 13
    chan[(chan == 255) & legmn & (sd == "left")] = 14
    chan[(chan == 255) & legmn & (sd == "right")] = 15

    # ---------------------------------------------------------------- live edges
    live = d["w"] > 0
    pre, post, cnt, w = d["pre"][live], d["post"][live], d["counts"][live], d["w"][live]
    sgn = d["sgn"]
    inh = sgn[pre] < 0
    fac = np.where(inh, INH_GAIN, 1.0)
    # the target's input scale, read back from any live edge into it
    scale = np.zeros(N, dtype=np.float64)
    scale[post] = w / (cnt * fac)
    intrinsic = sc == "ventral_nerve_cord_intrinsic"

    def comm_of(p, q):
        return (intrinsic[p] & intrinsic[q] & (side[p] <= 2) & (side[q] <= 2) & (side[p] != side[q]))

    def weight(p, q):
        return (cnt * scale[q] * fac).astype(np.float32)

    sclass = np.where(sgn[pre] > 0, 0, np.where(sgn[pre] < 0, 1, 2))
    strata = {"deg": sclass, "side": sclass * 16 + side[pre].astype(np.int64) * 4 + side[post]}
    rng = np.random.default_rng(a.seed)
    report = {"spec": "cordx4 inputs: real wiring and degree-preserving scrambles, CT antagonist channels",
              "N": N, "Elive": int(live.sum()), "Ecut": int((~live).sum()), "seed": a.seed, "metaSideAgreement": agree,
              "pools": pools, "channels": {"0-5": "CT flexor per leg", "6-11": "CT extensor per leg",
                                           "12/13": "cord population L/R", "14/15": "other leg MNs L/R"},
              "wirings": {}}
    report["wirings"]["real"] = {"files": write(f"{a.out}/real", d, pre, post, w, comm_of(pre, post), chan)}
    for name, st in strata.items():
        p2, rounds = scramble(pre, post, st, rng)
        indeg = lambda q: np.bincount(q * 3 + sclass, minlength=3 * N)
        assert (indeg(p2) == indeg(post)).all(), "in-degree per sign class changed"
        same = float((p2 == post).mean())
        report["wirings"][name] = {"fixRounds": rounds, "unchangedTargets": round(same, 4),
                                   "commissural": int(comm_of(pre, p2).sum()),
                                   "files": write(f"{a.out}/{name}", d, pre, p2, weight(pre, p2),
                                                  comm_of(pre, p2), chan)}
        print(f"{name}: {rounds} fix rounds, {same:.3%} targets unchanged")
    report["wirings"]["real"]["commissural"] = int(comm_of(pre, post).sum())
    json.dump(report, open(f"{a.out}/x4.json", "w"), indent=1)
    print(f"N={N} live edges {live.sum()} (dropped {(~live).sum()} zero-weight)")
    for leg, p in pools.items():
        print(f"  {leg:<9} CT flexor {p['flex']:>2}  extensor {p['ext']:>2}")


if __name__ == "__main__":
    main()
