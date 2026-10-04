# Inputs for cordx6.bend: ext/x5's wirings with the tab file's per-edge column
# (the commissural flag in earlier runners) set on every live edge from an
# inhibitory premotor cell onto another one — the 19A / 13A / 16B / 21A loop
# docs/51-cord-drive.md finds — so the runner's row-set factor scales exactly
# that loop. The class column is x5's.
#
#   python3 scripts/prep_cord_x5.py --meta <meta.feather>
#   python3 scripts/prep_cord_x6.py
import os
import json
import shutil
import hashlib
import argparse
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--x5", default="ext/x5")
    ap.add_argument("--out", default="ext/x6")
    a = ap.parse_args()
    rep = {"spec": "cordx6 inputs: ext/x5 wirings, edge column = inhibitory premotor -> inhibitory premotor",
           "pools": json.load(open(f"{a.x5}/x5.json"))["pools"], "wirings": {}}
    for w in ("real", "deg", "side"):
        src, dst = f"{a.x5}/{w}", f"{a.out}/{w}"
        os.makedirs(dst, exist_ok=True)
        for f in ("cord_ir.bin", "cord_kernel.bin"):
            shutil.copyfile(f"{src}/{f}", f"{dst}/{f}")
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
        flag = ((klass[pre] == 1) & (klass[post] == 1)).astype(np.uint32)
        off = 32 + 20 * N
        tb[off:off + 4 * E] = flag.tobytes()
        open(f"{dst}/cord_tab.bin", "wb").write(bytes(tb))
        rep["wirings"][w] = {"loopEdges": int(flag.sum()),
                             **{f: hashlib.sha256(open(f"{dst}/{f}", "rb").read()).hexdigest()
                                for f in ("cord_ir.bin", "cord_kernel.bin", "cord_tab.bin")}}
        print(f"{w}: {int(flag.sum())} inhibitory-premotor loop edges of {E}")
    json.dump(rep, open(f"{a.out}/x6.json", "w"), indent=1)


if __name__ == "__main__":
    main()
