# Inputs for cordx8.bend: ext/x6's wirings with the tab file's per-edge column
# holding two bits that the runner's row-set groups scale:
#
#   bit 0  inhibitory premotor -> inhibitory premotor, same hemilineage
#          (19A -> 19A, 13A -> 13A, ...): doc 53's pre-registered axis
#   bit 1  inhibitory premotor -> a cell of its own leg's own half
#          (I_F -> I_F or E_E, I_E -> I_E or E_F, halves as in
#          scripts/cord_hysteresis.py): the inhibition doc 53 measured
#          cancelling each half's recurrent excitation
#
# Bit 0 carries only about a tenth of bit 1's weight, which is why bit 1 was
# added. The class column is x5's; the scrambles keep each cell's class and
# hemilineage, and their halves are reassigned from their own motor edges.
#
#   python3 scripts/prep_cord_x8.py --meta <meta.feather>
import os
import sys
import json
import shutil
import hashlib
import argparse
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import prep_cord_x4 as X4
import cord_hysteresis as H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meta", required=True)
    ap.add_argument("--x6", default="ext/x6")
    ap.add_argument("--out", default="ext/x8")
    a = ap.parse_args()
    base = X4.load("ext")
    meta = pd.read_feather(a.meta).reset_index(drop=True)
    hl = meta.iloc[base["origIdx"].astype(np.int64)]["hemilineage"].fillna("").astype(str).to_numpy()
    mm = meta.iloc[base["origIdx"].astype(np.int64)]
    cls = mm["cell_class"].fillna("").astype(str).to_numpy()
    nm = mm["neuromere"].fillna("").astype(str).to_numpy()
    fn = mm["cell_function_detailed"].fillna("").astype(str).to_numpy()
    legmn = cls == "leg_motor_neuron"
    pools = {}
    for leg in H.LEGS:
        sg_, sd = leg.split("_")
        s = 1 if sd == "left" else 2
        pools[leg] = [np.flatnonzero(legmn & (nm == sg_) & (base["side"] == s) & (fn == f)) for f in (H.FLEX, H.EXT)]
    _, hid = np.unique(hl, return_inverse=True)
    hid = np.where(hl == "", -1, hid)
    rep = {"spec": "cordx8 inputs: ext/x6 wirings, edge column bit 0 = inhibitory premotor loop within a hemilineage, bit 1 = inhibitory premotor onto its own half",
           "pools": json.load(open(f"{a.x6}/x6.json"))["pools"], "wirings": {}}
    for w in ("real", "deg", "side"):
        src, dst = f"{a.x6}/{w}", f"{a.out}/{w}"
        os.makedirs(dst, exist_ok=True)
        for f in ("cord_ir.bin", "cord_kernel.bin"):
            p = f"{dst}/{f}"
            if os.path.lexists(p):
                os.remove(p)
            os.symlink(f"../../x6/{w}/{f}", p)
        ir = open(f"{src}/cord_ir.bin", "rb").read()
        N, E = (int(x) for x in np.frombuffer(ir, dtype=np.uint32, count=2, offset=8))
        indptr = np.frombuffer(ir, dtype=np.uint32, count=N + 1, offset=32 + 4 * N).astype(np.int64)
        gaps = np.frombuffer(ir, dtype=np.uint32, count=E, offset=32 + 8 * N + 4).astype(np.int64)
        pre = np.repeat(np.arange(N), np.diff(indptr))
        first = np.zeros(E, dtype=bool)
        first[indptr[:-1][np.diff(indptr) > 0]] = True
        seg = np.cumsum(first) - 1
        cs = np.cumsum(gaps + 1)
        st = np.flatnonzero(first)
        post = cs - (cs[st] - gaps[st] - 1)[seg] - 1
        tb = bytearray(open(f"{src}/cord_tab.bin", "rb").read())
        klass = np.frombuffer(bytes(tb), dtype=np.uint32, count=N, offset=32 + 8 * N)
        loop = (klass[pre] == 1) & (klass[post] == 1)
        same = loop & (hid[pre] >= 0) & (hid[pre] == hid[post])
        lp, qp, sw, kl = H.wiring(src, N)
        leg, grp = H.halves(lp, qp, sw, kl, pools, N)
        half = np.full(N, -1)
        ok = grp >= 0
        half[ok] = np.array([H.HALF[H.GROUPS[g]] for g in grp[ok]])
        own = ((klass[pre] == 1) & (half[pre] >= 0) & (half[post] >= 0) & (leg[pre] == leg[post])
               & (half[pre] == half[post]) & (pre != post))
        flag = (same.astype(np.uint32) | (own.astype(np.uint32) << 1))
        off = 32 + 20 * N
        tb[off:off + 4 * E] = flag.tobytes()
        open(f"{dst}/cord_tab.bin", "wb").write(bytes(tb))
        rep["wirings"][w] = {"loopEdges": int(loop.sum()), "withinHemilineage": int(same.sum()),
                             "ownHalf": int(own.sum()), "both": int((same & own).sum()),
                             **{f: hashlib.sha256(open(f"{dst}/{f}", "rb").read()).hexdigest()
                                for f in ("cord_ir.bin", "cord_kernel.bin", "cord_tab.bin")}}
        print(f"{w}: {int(same.sum())} within-hemilineage of {int(loop.sum())} loop edges; "
              f"{int(own.sum())} own-half inhibitory edges; {int((same & own).sum())} both")
    json.dump(rep, open(f"{a.out}/x8.json", "w"), indent=1)


if __name__ == "__main__":
    main()
