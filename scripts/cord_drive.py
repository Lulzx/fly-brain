# Where a motor pool's drive comes from: cordx5c.bend's per-cell spike counts
# pushed through the wiring, so each coxa-trochanter pool's input splits into
# the rate-weighted excitation and inhibition each source group delivers.
#
#   bend cordx5c.bend -o cordx5c
#   python3 scripts/cord_drive.py --meta <meta.feather> [--run] [--wiring real]
#
# The tallies are first checked against cordx5.bend's runs of the same members
# (same seeds, same arithmetic, so they must match byte for byte). Drive into
# pool p from source group g is sum over live edges (i -> j in p, i in g) of
# w_ij * sign_i * spikes_i / T, per cell of p: the conductance one second of the
# run's mean activity delivers, in the kernel's own units. Groups: hemilineage
# for cord interneurons, super_class otherwise.
import os
import sys
import json
import argparse
import subprocess
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import prep_cord_x4 as X4

MEMBERS = [0, 3, 32, 64, 96, 39, 67, 99]
LEGS = ["T1_left", "T2_left", "T3_left", "T1_right", "T2_right", "T3_right"]
FLEX, EXT = "flex_coxa_trochanter_joint", "extend_coxa_trochanter_joint"
RB5, AI5, TONIC = [0, 15, 30, 60], [0.072, 1, 3, 6], [0, 2, 4, 6]


def axes(m):
    return {"rebound": RB5[m & 3], "adapt": AI5[(m >> 2) & 3], "graded": (m >> 4) & 1,
            "tonic": TONIC[(m >> 5) & 3]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meta", required=True)
    ap.add_argument("--wiring", default="real")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--out", default="ext/x5")
    a = ap.parse_args()
    wd = f"{a.out}/{a.wiring}"
    if a.run:
        cur = f"{a.out}/cur"
        if os.path.islink(cur):
            os.remove(cur)
        os.symlink(a.wiring, cur)
        subprocess.run(["./cordx5c"], check=True)

    raw = open(f"{wd}/x5_cells.bin", "rb").read()
    hdr = np.frombuffer(raw, dtype=np.uint32, count=8)
    assert hdr[0] == 0x48435553 and hdr[1] == 5, "not a cordx5c output"
    steps, members, conds, ch, recs, runs = (int(x) for x in hdr[2:8])
    N = X4.load("ext")["N"]
    per_tal, per_cnt = recs * ch * 2, N * 2
    body = raw[32:]
    assert len(body) == runs * (per_tal + per_cnt)

    # identity: each run's tally against cordx5's run of the same member and condition
    full = open(f"{wd}/x5_search.bin", "rb").read()[32:]
    same = []
    for j in range(runs):
        m, c = MEMBERS[j >> 1], j & 1
        mine = body[j * (per_tal + per_cnt): j * (per_tal + per_cnt) + per_tal]
        ref = full[(2 * m + c) * per_tal: (2 * m + c + 1) * per_tal]
        same.append(mine == ref)
    print(f"tallies against cordx5: {sum(same)}/{runs} byte-identical")

    # the wiring this run used
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

    meta = pd.read_feather(a.meta).reset_index(drop=True)
    mm = meta.iloc[X4.load("ext")["origIdx"].astype(np.int64)]
    sc = mm["super_class"].fillna("").astype(str).to_numpy()
    hl = mm["hemilineage"].fillna("").astype(str).to_numpy()
    cls = mm["cell_class"].fillna("").astype(str).to_numpy()
    nm = mm["neuromere"].fillna("").astype(str).to_numpy()
    fn = mm["cell_function_detailed"].fillna("").astype(str).to_numpy()
    side = X4.load("ext")["side"]
    group = np.where(sc == "ventral_nerve_cord_intrinsic", np.char.add("IN ", hl.astype(str)), sc)
    groups, gidx = np.unique(group, return_inverse=True)
    legmn = cls == "leg_motor_neuron"
    pools = {}
    for li, leg in enumerate(LEGS):
        sg_, sd = leg.split("_")
        s = 1 if sd == "left" else 2
        for f, tag in ((FLEX, "flex"), (EXT, "ext")):
            pools[f"{leg} {tag}"] = np.flatnonzero(legmn & (nm == sg_) & (side == s) & (fn == f))
    poolOf = np.full(N, -1)
    names = list(pools)
    for k, nme in enumerate(names):
        poolOf[pools[nme]] = k

    T = steps * 0.5 / 1000.0
    out = {"wiring": a.wiring, "identity": f"{sum(same)}/{runs}", "runs": []}
    into = poolOf[post] >= 0
    for j in range(runs):
        m, c = MEMBERS[j >> 1], j & 1
        off = j * (per_tal + per_cnt) + per_tal
        cnt = np.frombuffer(body, dtype=np.uint16, count=N, offset=off).astype(np.float64)
        rate = cnt / T
        contrib = w[into] * sgn[pre[into]] * rate[pre[into]]
        P = poolOf[post[into]]
        G = gidx[pre[into]]
        tab = np.zeros((len(names), len(groups)))
        np.add.at(tab, (P, G), contrib)
        sizes = np.array([len(pools[n]) for n in names])
        tab /= sizes[:, None]
        rows = []
        for k, nme in enumerate(names):
            r = tab[k]
            order = np.argsort(r)
            rows.append({"pool": nme, "hz": float(rate[pools[nme]].mean()),
                         "exc": float(r[r > 0].sum()), "inh": float(r[r < 0].sum()),
                         "topInh": [(groups[g], round(float(r[g]), 1)) for g in order[:4] if r[g] < 0],
                         "topExc": [(groups[g], round(float(r[g]), 1)) for g in order[::-1][:4] if r[g] > 0]})
        out["runs"].append({"member": m, "axes": axes(m), "condition": ["baseline", "no_command"][c], "pools": rows})
    json.dump(out, open(f"{wd}/x5_drive.json", "w"), indent=1)

    # the summary: every pool under baseline, averaged over the eight members
    print(f"\n{a.wiring} wiring, baseline, mean over members {MEMBERS}: drive per pool cell (kernel units / s)")
    print(f"{'pool':<15}{'Hz/cell':>8}{'exc':>9}{'inh':>9}{'net':>9}   strongest inhibition")
    base = [r for r in out["runs"] if r["condition"] == "baseline"]
    for k, nme in enumerate(names):
        hz = np.mean([r["pools"][k]["hz"] for r in base])
        ex = np.mean([r["pools"][k]["exc"] for r in base])
        ih = np.mean([r["pools"][k]["inh"] for r in base])
        agg = {}
        for r in base:
            for g, v in r["pools"][k]["topInh"]:
                agg[g] = agg.get(g, 0) + v / len(base)
        top = ", ".join(f"{g} {v:.0f}" for g, v in sorted(agg.items(), key=lambda x: x[1])[:3])
        print(f"{nme:<15}{hz:8.2f}{ex:9.0f}{ih:9.0f}{ex + ih:9.0f}   {top}")


if __name__ == "__main__":
    main()
