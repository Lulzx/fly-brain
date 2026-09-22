# Emit a cord IR for the public BANC (brain-and-nerve-cord) connectome in the
# binary form the Bend cord pipeline reads (docs/46-cord-ir.md), plus the
# kernel-input and ensemble tables `cordx.bend` consumes.
#
#   python3 scripts/prep_cord_banc.py --meta <meta.feather> --edges <edges.feather> --out ext
#
# The subgraph is the nerve cord plus the descending cells that carry commands
# into it: every cell whose region is the ventral nerve cord, plus every
# descending cell. Edges are the induced subgraph. Rows are delta-encoded,
# exactly as scripts/prep_cord_ir.mjs writes them, so the checked reader and
# the proven perturbation operations apply unchanged.
#
# The schema read is BANC's public annotation table: region, super_class,
# cell_class, cell_type, hemilineage, side, neuromere, nerve,
# body_part_sensory, neurotransmitter_verified / _predicted, volume_nm3. The
# edge list is the published simple edgelist (pre, post, count).
import json
import sys
import hashlib
import argparse
import numpy as np
import pandas as pd

# The kernel constants the ensemble runs under: the calibrated whole-CNS LIF
# parameters (public/data/brain_params.json over src/lif.js DEFAULTS).
KERNEL = dict(dt=0.5, vRest=-52.0, vThresh=-45.0, vReset=-52.0, tRef=3.682,
              adaptInc=0.072, depU=0.0, tauSyn=5.0, adaptTau=100.0, depTau=200.0,
              tauM=20.0, eExc=0.0, eInh=-69.079)
W_SYN = 0.562          # per-synapse weight scale, multiplied into the sign word
INH_GAIN = 0.577       # inhibitory weight multiplier
# reconstruction threshold: edges below it are cut. BANC's count distribution
# is sparser than MaleCNS's — at 6 it would drop 86% of edges and 38% of all
# synapses — so the default here is 3, which retains 78% of synaptic weight.
MIN_SYN = 3
SIZE_ALPHA = 0.572     # input scale = (volume / regional median)^-SIZE_ALPHA
MAX_SIZE_SCALE = 20.0  # clamp on the volume ratio
BOOST_CAP = 1.0        # smaller-than-median cells are not boosted

# neurotransmitter code order, matching connectome.bend's NT table:
# unknown, acetylcholine, gaba, glutamate, dopamine, serotonin, octopamine, histamine
NT_CODE = {"acetylcholine": 1, "gaba": 2, "glutamate": 3, "dopamine": 4,
           "serotonin": 5, "octopamine": 6, "histamine": 7}
# the fast-sign convention: excitatory acetylcholine, inhibitory gaba /
# glutamate / histamine, no fast sign for the monoamines
NT_SIGN = np.array([0, 1, -1, -1, 0, 0, 0, -1], dtype=np.float32)

LEG_ORDER = ["T1_left", "T2_left", "T3_left", "T1_right", "T2_right", "T3_right"]
HEMILINEAGES = ["13A", "13B", "19B"]          # bit 0, 1, 2 in the hl table
LEG_PARTS = ["front_leg", "middle_leg", "hind_leg"]
PROPRIO_CLASSES = ["chordotonal_organ_neuron", "hair_plate_neuron",
                   "campaniform_sensillum_neuron"]

ROLE = {"interneuron": 0, "motor": 1, "descending": 2, "sensory": 3}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meta", required=True)
    ap.add_argument("--edges", required=True)
    ap.add_argument("--out", default="ext")
    ap.add_argument("--command", default="DNg100",
                    help="comma-separated cell_type names driven as the command")
    ap.add_argument("--min-syn", type=int, default=MIN_SYN,
                    help="edges below this count are cut")
    a = ap.parse_args()

    meta = pd.read_feather(a.meta).reset_index(drop=True)
    edges = pd.read_feather(a.edges)
    Nfull = len(meta)

    # ------------------------------------------------------------ membership
    member = ((meta["region"] == "ventral_nerve_cord")
              | (meta["super_class"] == "descending")).to_numpy()
    origIdx = np.flatnonzero(member).astype(np.uint32)
    N = len(origIdx)
    rank = np.full(Nfull, -1, dtype=np.int64)
    rank[origIdx] = np.arange(N)
    m = meta.iloc[origIdx]

    idx = pd.Series(np.arange(Nfull), index=meta["banc_888_id"])
    pre = idx.reindex(edges["pre"].to_numpy()).to_numpy()
    post = idx.reindex(edges["post"].to_numpy()).to_numpy()
    good = ~np.isnan(pre) & ~np.isnan(post)
    pre = pre[good].astype(np.int64)
    post = post[good].astype(np.int64)
    cnt = edges["count"].to_numpy()[good].astype(np.int64)

    pre_m = rank[pre]
    post_m = rank[post]
    inside = (pre_m >= 0) & (post_m >= 0)
    pre_m, post_m, cnt = pre_m[inside], post_m[inside], cnt[inside]

    # induced CSR: sort each row's targets ascending, merge duplicate pairs
    order = np.lexsort((post_m, pre_m))
    pre_s, post_s, cnt_s = pre_m[order], post_m[order], cnt[order]
    same = (pre_s[1:] == pre_s[:-1]) & (post_s[1:] == post_s[:-1])
    if same.any():
        keep = np.ones(len(pre_s), dtype=bool)
        keep[1:] = ~same
        merged = np.zeros(int(keep.sum()), dtype=np.int64)
        np.add.at(merged, np.cumsum(keep) - 1, cnt_s)
        pre_s, post_s, cnt_s = pre_s[keep], post_s[keep], merged
    E = len(pre_s)
    indptr = np.zeros(N + 1, dtype=np.int64)
    np.add.at(indptr, pre_s + 1, 1)
    indptr = np.cumsum(indptr)

    # gap encoding, vectorised: a row's first entry stores its target, later
    # entries store post - prev_post - 1
    counts = np.minimum(cnt_s, 65535).astype(np.uint16)
    gaps = np.empty(E, dtype=np.uint32)
    row_start = np.ones(E, dtype=bool)
    row_start[1:] = pre_s[1:] != pre_s[:-1]
    gaps[row_start] = post_s[row_start]
    gaps[~row_start] = (post_s[~row_start] - post_s[:-1][~row_start[1:]] - 1).astype(np.uint32)
    max_gap = int(gaps.max()) if E else 0

    # ------------------------------------------------------------ per-cell tables
    sc = m["super_class"].fillna("").astype(str).to_numpy()
    cls = m["cell_class"].fillna("").astype(str).to_numpy()
    ctype = m["cell_type"].fillna("").astype(str).to_numpy()
    side_s = m["side"].fillna("").astype(str).to_numpy()
    nm = m["neuromere"].fillna("").astype(str).to_numpy()
    hl_s = m["hemilineage"].fillna("").astype(str).to_numpy()
    part = m["body_part_sensory"].fillna("").astype(str).to_numpy()
    vol = m["volume_nm3"].to_numpy(dtype=np.float64)

    role = np.zeros(N, dtype=np.uint8)
    role[sc == "motor"] = ROLE["motor"]
    role[sc == "descending"] = ROLE["descending"]
    role[np.isin(sc, ["sensory", "sensory_ascending", "sensory_descending"])] = ROLE["sensory"]

    side = np.full(N, 3, dtype=np.uint8)
    side[side_s == "left"] = 1
    side[side_s == "right"] = 2

    # transmitter: verified wins; a comma-joined verified string contributes
    # its first-listed transmitter
    ver = m["neurotransmitter_verified"].fillna("").astype(str).to_numpy()
    pred = m["neurotransmitter_predicted"].fillna("").astype(str).to_numpy()
    nt = np.zeros(N, dtype=np.uint8)
    for i in range(N):
        tok = (ver[i].split(",")[0] if ver[i] else pred[i]).strip()
        nt[i] = NT_CODE.get(tok, 0)
    sign = NT_SIGN[nt].astype(np.float32)

    hl = np.zeros(N, dtype=np.uint8)
    for b, h in enumerate(HEMILINEAGES):
        hl[hl_s == h] |= 1 << b

    # input scale: (volume / region median)^-alpha, clamped, no boost
    region = m["region"].fillna("").astype(str).to_numpy()
    med = {}
    for r in np.unique(region):
        v = meta.loc[meta["region"] == r, "volume_nm3"].to_numpy(dtype=np.float64)
        v = v[v > 0]
        med[r] = np.median(v) if len(v) else 1.0
    s = np.ones(N)
    has = vol > 0
    s[has] = np.clip(vol[has] / np.array([med[r] for r in region])[has],
                     1.0 / MAX_SIZE_SCALE, MAX_SIZE_SCALE)
    in_scale = np.minimum(BOOST_CAP, s ** (-SIZE_ALPHA)).astype(np.float32)

    # ------------------------------------------------------------ edge class + weights
    intrinsic = sc == "ventral_nerve_cord_intrinsic"
    edge_class = np.zeros(E, dtype=np.uint8)
    comm = (intrinsic[pre_s] & intrinsic[post_s] & (side[pre_s] <= 2)
            & (side[post_s] <= 2) & (side[pre_s] != side[post_s]))
    edge_class[comm] |= 1

    sensory_post = role[post_s] == ROLE["sensory"]
    inh_pre = sign[pre_s] < 0
    w = np.where((cnt_s >= a.min_syn) & ~sensory_post,
                 cnt_s * in_scale[post_s] * np.where(inh_pre, INH_GAIN, 1.0),
                 0.0).astype(np.float32)
    n_cut = int((w == 0).sum())

    # ------------------------------------------------------------ named sets
    sets = []
    pools = {l: [] for l in LEG_ORDER}
    for i in range(N):
        if cls[i] == "leg_motor_neuron" and nm[i] in ("T1", "T2", "T3") \
                and side_s[i] in ("left", "right"):
            pools[f"{nm[i]}_{side_s[i]}"].append(i)
    for l in LEG_ORDER:
        sets.append((f"pool:{l}", pools[l]))
    for b, h in enumerate(HEMILINEAGES):
        sets.append((f"hemilineage:{h}", list(np.flatnonzero(hl & (1 << b)))))
    commands = [t.strip() for t in a.command.split(",") if t.strip()]
    for t in commands:
        sets.append((f"dn:{t}", list(np.flatnonzero(ctype == t))))
    for name, r in (("role:motor", 1), ("role:descending", 2), ("role:sensory", 3)):
        sets.append((name, list(np.flatnonzero(role == r))))
    proprio = np.flatnonzero(np.isin(part, LEG_PARTS) & np.isin(cls, PROPRIO_CLASSES))
    sets.append(("sensory:proprioceptive", list(proprio)))
    empty = [n for n, s in sets if not len(s)]
    if empty:
        raise SystemExit(f"empty named sets: {empty}")

    # ------------------------------------------------------------ ensemble tables
    # chan: 0..5 leg motor pools, 6/7 cord population left/right, 255 uncounted
    chan = np.full(N, 255, dtype=np.uint32)
    # proprio: 0 none, 1 left, 2 right, 3 other -- the side code lets a run feed
    # each side's pool spikes back to that side's sensors
    proprio_t = np.zeros(N, dtype=np.uint32)
    proprio_t[proprio] = np.maximum(side[proprio], 1)
    # delay class: presynaptic delay in 0.5 ms steps, a cable-length proxy --
    # (volume / regional median)^(1/3), mean-matched to the kernel's nominal
    # four steps before clamping to the 16-slot ring
    DELAY_STEPS = 16
    d_raw = np.where(vol > 0, s ** (1.0 / 3.0), 1.0)
    d_raw *= 4.0 / d_raw.mean()
    delay = np.clip(np.rint(d_raw), 1, DELAY_STEPS).astype(np.uint32)
    for l_i, l in enumerate(LEG_ORDER):
        chan[np.asarray(pools[l], dtype=np.int64)] = l_i
    pop = (role != ROLE["motor"]) & (sc != "descending")
    chan[(chan == 255) & pop & (side == 1)] = 6
    chan[(chan == 255) & pop & (side == 2)] = 7
    cmd = np.zeros(N, dtype=np.uint32)
    for t in commands:
        cmd[ctype == t] = 1
    comm_u32 = (edge_class & 1).astype(np.uint32)

    # ------------------------------------------------------------ write
    import os
    os.makedirs(a.out, exist_ok=True)
    pad4 = lambda n: (n + 3) & ~3

    parts = [
        ("origIdx", origIdx), ("indptr", indptr.astype(np.uint32)),
        ("gaps", gaps), ("counts", counts), ("edgeClass", edge_class),
        ("role", role), ("nt", nt), ("side", side), ("hl", hl),
        ("sign", sign), ("size", vol.astype(np.float32)),
    ]
    set_ptr = np.zeros(len(sets) + 1, dtype=np.uint32)
    for i, (_, s_) in enumerate(sets):
        set_ptr[i + 1] = set_ptr[i] + len(s_)
    set_idx = np.concatenate([np.asarray(s_, dtype=np.uint32) for _, s_ in sets])
    parts += [("setPtr", set_ptr), ("setIdx", set_idx)]

    HDR = 32
    off, layout = HDR, {}
    for name, arr in parts:
        layout[name] = {"off": off, "bytes": arr.nbytes, "n": int(arr.size)}
        off = pad4(off + arr.nbytes)
    buf = np.zeros(off, dtype=np.uint8)
    hdr = np.frombuffer(buf, dtype=np.uint32)
    hdr[0] = 0x44524F43   # 'CORD'
    hdr[1] = 1
    hdr[2] = N
    hdr[3] = E
    hdr[4] = Nfull
    hdr[5] = len(sets)
    hdr[6] = len(LEG_ORDER)
    hdr[7] = max_gap
    for name, arr in parts:
        o = layout[name]["off"]
        buf[o:o + arr.nbytes] = np.frombuffer(arr.tobytes(), dtype=np.uint8)
    ir_path = f"{a.out}/cord_ir.bin"
    with open(ir_path, "wb") as f:
        f.write(buf.tobytes())

    # kernel input: 64B header, 16 f32 constants, weights, sign*wSyn
    K = KERNEL
    consts = np.array([K["dt"], K["vRest"], K["vThresh"], K["vReset"], K["tRef"],
                       K["adaptInc"], K["depU"], np.exp(-K["dt"] / K["tauSyn"]),
                       np.exp(-K["dt"] / K["adaptTau"]), K["dt"] / K["depTau"],
                       K["dt"] / K["tauM"], K["dt"] / 1000.0,
                       K["eExc"], K["eInh"],
                       1.0 / (K["eExc"] - K["vRest"]),
                       1.0 / (K["vRest"] - K["eInh"])], dtype=np.float32)
    kh = np.zeros(16, dtype=np.uint32)
    kh[0] = 0x4B44524F   # 'KDRO'
    kh[1] = 1
    kh[2] = N
    kh[3] = E
    kh[4] = 0            # steps (no reference run)
    kh[5] = 0            # driven count (the runner derives it)
    kh[6] = 1            # seed
    kh[7] = 4            # delay-line slots
    kh[8] = n_cut
    kbuf = kh.tobytes() + consts.tobytes() + w.tobytes() + (sign * np.float32(W_SYN)).tobytes()
    kernel_path = f"{a.out}/cord_kernel.bin"
    with open(kernel_path, "wb") as f:
        f.write(kbuf)

    # ensemble tab: chan, proprio, hl, role, cmd per cell; commissural per edge
    th = np.zeros(8, dtype=np.uint32)
    th[0] = 0x42415443   # 'CTAB'
    th[1] = 1
    th[2] = N
    th[3] = E
    th[4] = 8            # channels
    th[5] = int(cmd.sum())
    tbuf = th.tobytes() + chan.tobytes() + proprio_t.tobytes() \
        + hl.astype(np.uint32).tobytes() + role.astype(np.uint32).tobytes() \
        + cmd.tobytes() + comm_u32.tobytes() + delay.tobytes()
    tab_path = f"{a.out}/cord_tab.bin"
    with open(tab_path, "wb") as f:
        f.write(tbuf)

    desc = {
        "version": 1,
        "spec": "cord IR: nerve-cord region + all descending cells, rows delta-encoded",
        "counts": {"N": N, "E": E, "Nfull": int(Nfull),
                   "cutEdges": n_cut, "commissural": int(comm.sum()),
                   "maxGap": int(max_gap)},
        "kernel": {**KERNEL, "wSyn": W_SYN, "inhGain": INH_GAIN,
                   "minSyn": a.min_syn, "sizeAlpha": SIZE_ALPHA},
        "header": {"magic": "CORD", "bytes": HDR,
                   "fields": ["magic", "version", "N", "E", "Nfull", "nSets",
                              "nPools", "maxGap"]},
        "layout": layout, "legOrder": LEG_ORDER, "hemilineages": HEMILINEAGES,
        "commands": commands,
        "sets": [{"name": n_, "n": len(s_)} for n_, s_ in sets],
        "channels": {str(i): l for i, l in enumerate(LEG_ORDER)} | {"6": "cord_left", "7": "cord_right"},
        "delayClass": {"steps": int(DELAY_STEPS), "nominal": 4,
                       "rule": "round(4 * (volume / regional median)^(1/3) / mean), clamped 1..16",
                       "mean": float(delay.mean()), "hist": np.bincount(delay, minlength=DELAY_STEPS + 1).tolist()},
        "files": {p: hashlib.sha256(open(p, "rb").read()).hexdigest()
                  for p in (ir_path, kernel_path, tab_path)},
    }
    with open(f"{a.out}/cord_ir.json", "w") as f:
        json.dump(desc, f, indent=1)

    print(f"{ir_path}: N={N} E={E} ({n_cut} cut, {int(comm.sum())} commissural)")
    print(f"members by role: interneuron {(role == 0).sum()} motor {(role == 1).sum()} "
          f"descending {(role == 2).sum()} sensory {(role == 3).sum()}")
    for n_, s_ in sets:
        print(f"  {n_:<28} {len(s_)}")


if __name__ == "__main__":
    main()
