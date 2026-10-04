# Inputs for cordx5.bend: ext/x4's three wirings with a premotor class per cell
# written into the tab file's hemilineage column, which cordx4 and cordx5 do
# not otherwise read.
#
#   python3 scripts/prep_cord_x4.py --meta <meta.feather>
#   python3 scripts/prep_cord_x5.py --meta <meta.feather>
#
# Class 1: an inhibitory cord interneuron (super_class ventral_nerve_cord_intrinsic,
# negative fast sign) with a live edge onto a leg motor neuron in the REAL wiring.
# Class 2: the same, excitatory. Class 0: every other cell. The class is a
# property of the cell, so the scrambles carry the real wiring's classes: a
# scrambled class-1 cell keeps its sign and degrees but not its motor targets.
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meta", required=True)
    ap.add_argument("--src", default="ext")
    ap.add_argument("--x4", default="ext/x4")
    ap.add_argument("--out", default="ext/x5")
    a = ap.parse_args()
    d = X4.load(a.src)
    N = d["N"]
    meta = pd.read_feather(a.meta).reset_index(drop=True)
    m = meta.iloc[d["origIdx"].astype(np.int64)]
    sc = m["super_class"].fillna("").astype(str).to_numpy()
    cls = m["cell_class"].fillna("").astype(str).to_numpy()
    live = d["w"] > 0
    pre, post = d["pre"][live], d["post"][live]
    premotor = np.zeros(N, dtype=bool)
    premotor[pre[cls[post] == "leg_motor_neuron"]] = True
    intrinsic = premotor & (sc == "ventral_nerve_cord_intrinsic")
    sgn = d["sgn"]
    klass = np.zeros(N, dtype=np.uint32)
    klass[intrinsic & (sgn < 0)] = 1
    klass[intrinsic & (sgn > 0)] = 2
    x4 = json.load(open(f"{a.x4}/x4.json"))
    report = {"spec": "cordx5 inputs: ext/x4 wirings with the premotor class in the tab hl column",
              "classes": {"1": int((klass == 1).sum()), "2": int((klass == 2).sum()), "0": int((klass == 0).sum())},
              "pools": x4["pools"], "wirings": {}}
    for w in ("real", "deg", "side"):
        os.makedirs(f"{a.out}/{w}", exist_ok=True)
        for f in ("cord_ir.bin", "cord_kernel.bin"):
            shutil.copyfile(f"{a.x4}/{w}/{f}", f"{a.out}/{w}/{f}")
        tb = bytearray(open(f"{a.x4}/{w}/cord_tab.bin", "rb").read())
        off = 32 + 8 * N
        tb[off:off + 4 * N] = klass.tobytes()
        open(f"{a.out}/{w}/cord_tab.bin", "wb").write(bytes(tb))
        report["wirings"][w] = {f: hashlib.sha256(open(f"{a.out}/{w}/{f}", "rb").read()).hexdigest()
                                for f in ("cord_ir.bin", "cord_kernel.bin", "cord_tab.bin")}
    json.dump(report, open(f"{a.out}/x5.json", "w"), indent=1)
    print(f"classes: inhibitory premotor {report['classes']['1']}, excitatory premotor {report['classes']['2']}")


if __name__ == "__main__":
    main()
