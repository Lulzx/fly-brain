"""Map male-CNS optic-lobe neurons to flyvis model nodes (same cell type, same retinotopic column).
Retinotopic direction of every columnar neuron is propagated through the connectome from photoreceptors
(whose viewing directions come from their lamina entry points, see prep_bodymap.py)."""
import numpy as np, json, pyarrow.feather as f
N = int(np.frombuffer(open('public/data/neurons.bin', 'rb').read(8), np.uint32)[0])
ids = np.frombuffer(open('public/data/neurons.bin', 'rb').read(8 + N * 8), np.int64, N, 8)
meta = json.load(open('public/data/meta.json')); types = np.array(meta['types'])
a = f.read_feather('data/raw/body-annotations-male-cns-v1.0-minconf-0.5.feather').set_index('bodyId').loc[ids].reset_index()
side = a.somaSide.where(a.somaSide.isin(['L', 'R']), a.rootSide.where(a.rootSide.isin(['L', 'R']))).to_numpy()
g = open('public/data/graph_w3.bin', 'rb').read(); E = int(np.frombuffer(g, np.uint32, 2)[1])
indptr = np.frombuffer(g, np.uint32, N + 1, 8).astype(np.int64); indices = np.frombuffer(g, np.uint32, E, 8 + (N + 1) * 4).astype(np.int64)
weights = np.frombuffer(g, np.uint16, E, 8 + (N + 1) * 4 + E * 4).astype(np.float64)
pre = np.repeat(np.arange(N), np.diff(indptr))
bm = json.load(open('public/data/bodymap.json')); fv = json.load(open('public/vision/flyvis.json'))
FV_TYPES = [t for t in fv['types'] if not t.startswith('R')]
alias = {'CT1(Lo1)': 'CT1', 'CT1(M10)': 'CT1'}
direction = np.full((N, 3), np.nan)
for e in bm['eyes']:
    az = np.radians(e['az']); el = np.radians(e['el'])
    direction[e['idx']] = np.c_[np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)]
known0 = ~np.isnan(direction[:, 0])
cand = np.isin(types, [alias.get(t, t) for t in FV_TYPES]) | known0
m = cand[pre] & cand[indices] & (weights >= 3) & (side[pre] == side[indices])
P, Q, W = pre[m], indices[m], weights[m]
for it in range(8):
    kn = ~np.isnan(direction[:, 0])
    acc = np.zeros((N, 3)); wsum = np.zeros(N)
    for src, dst in ((P, Q), (Q, P)):          # both directions: inputs and outputs carry retinotopy
        s = kn[src] & ~known0[dst]
        np.add.at(acc, dst[s], direction[src[s]] * W[s, None]); np.add.at(wsum, dst[s], W[s])
    upd = (wsum > 0) & ~known0
    nd = acc[upd] / np.linalg.norm(acc[upd], axis=1, keepdims=True)
    direction[upd] = nd
    print(f'pass {it}: neurons with direction {int((~np.isnan(direction[:, 0])).sum())}')
# flyvis lattice <-> visual field (image +col = anterior, image up = dorsal; calibrated from T4a/T4b/T4c tuning)
TH_C, K_TH, EL_C, K_EL = 77.5, 5.83, 5.0, 4.3
def lattice_to_dir(u, v, lat):   # lat = +1 left eye, -1 right eye
    col = v; row = u + v / 2.0; th = TH_C - K_TH * col; el = EL_C - K_EL * row
    return np.radians(th) * lat, np.radians(el)
fu, fvv = np.array(json.load(open('data/flyvis_ref.json'))['hex_u']), np.array(json.load(open('data/flyvis_ref.json'))['hex_v'])
b = open('public/vision/flyvis.bin', 'rb').read(); NF = fv['N']
tid = np.frombuffer(b, np.uint8, NF, 0); U = np.frombuffer(b, np.int16, NF, NF); V = np.frombuffer(b, np.int16, NF, NF * 3)
node_of = {(fv['types'][t], int(uu), int(vv)): k for k, (t, uu, vv) in enumerate(zip(tid, U, V))}
out = {'lattice': {'thetaC': TH_C, 'kTheta': K_TH, 'elC': EL_C, 'kEl': K_EL, 'note': 'az = +/-(thetaC - kTheta*v) (left +), el = elC - kEl*(u + v/2)'}, 'hex_u': fu.tolist(), 'hex_v': fvv.tolist(), 'eyes': {}}
for sd, lat in (('L', 1), ('R', -1)):
    az, el = lattice_to_dir(fu, fvv, lat)
    pairs = []; per_type = {}
    for t in FV_TYPES:
        mt = alias.get(t, t)
        ix = np.where((types == mt) & (side == sd) & ~np.isnan(direction[:, 0]))[0]
        if len(ix) < 100: continue      # skip non-columnar / sparse types (e.g. CT1 is one giant neuron)
        d = direction[ix]; th = np.degrees(np.arctan2(d[:, 1] * lat, d[:, 0])); elv = np.degrees(np.arcsin(np.clip(d[:, 2], -1, 1)))
        # propagation averages partner directions, which shrinks edge columns inward: rescale each type to the eye's field
        def rescale(x, lo, hi): p0, p1 = np.percentile(x, 1), np.percentile(x, 99); return lo + (np.clip(x, p0, p1) - p0) / max(1e-6, p1 - p0) * (hi - lo)
        th = rescale(th, TH_C - 15 * K_TH, TH_C + 15 * K_TH); elv = rescale(elv, EL_C - 15 * K_EL, EL_C + 15 * K_EL)
        col = (TH_C - th) / K_TH; row = (EL_C - elv) / K_EL
        vv = np.clip(np.round(col), -15, 15).astype(int); uu = np.round(row - vv / 2.0).astype(int)
        uu = np.clip(uu, np.maximum(-15, -15 - vv), np.minimum(15, 15 - vv))
        nodes = [node_of.get((t, int(a_), int(b_)), -1) for a_, b_ in zip(uu, vv)]
        ok = [(int(i), int(n)) for i, n in zip(ix, nodes) if n >= 0]
        pairs += ok; per_type[t] = len(ok)
    out['eyes'][sd] = {'pairs': pairs, 'dirs': np.c_[np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)].round(5).tolist(), 'perType': per_type}
    print(sd, 'mapped neurons', len(pairs), 'types', len(per_type), {k: per_type[k] for k in list(per_type)[:8]})
json.dump(out, open('public/vision/flyvis_map.json', 'w'))
