"""Extract the algorithmic structures of the male-CNS connectome.

Reads the flat tables in public/data (graph_w3.bin, neurons.bin, meta.json, ntsign.bin) and measures the
computational motifs the wiring implements: feedforward depth and feedback, recurrence, sign structure,
bilateral wiring, and the canonical circuits (antennal lobe, mushroom body, central complex, optic lobe,
escape, descending funnel, motor pools). Writes data/algo_structures.json; the report is docs/28-algorithmic-structures.md.

    python3 scripts/algo_structures.py            # all sections
    python3 scripts/algo_structures.py cx mb      # only some sections
"""
import json, re, sys, time, collections
import numpy as np
import scipy.sparse as sp
from scipy.sparse import csgraph

T0 = time.time()
def log(*a): print(f'[{time.time()-T0:6.1f}s]', *a, flush=True)

# ---------------------------------------------------------------- load
meta = json.load(open('public/data/meta.json')); N = meta['N']
types = np.array(meta['types']); inst = np.array(meta['instances'])
nb = np.fromfile('public/data/neurons.bin', dtype=np.uint8); off = 8
off += N * 8 + N * 12 + N * 4 + N * 4
cls = np.frombuffer(nb[off:off + N * 2].tobytes(), dtype=np.uint16); off += N * 2
nt = nb[off:off + N].copy(); off += N
sc = nb[off:off + N].copy(); off += N
side = nb[off:off + N].copy()
scn = np.array(meta['superclasses'])[sc]; cln = np.array(meta['classes'])[cls]; ntn = np.array(meta['nts'])[nt]
gb = np.fromfile('public/data/graph_w3.bin', dtype=np.uint8)
E = int(np.frombuffer(gb[:8].tobytes(), dtype=np.uint32)[1]); o = 8
indptr = np.frombuffer(gb[o:o + (N + 1) * 4].tobytes(), dtype=np.uint32).astype(np.int64); o += (N + 1) * 4
indices = np.frombuffer(gb[o:o + E * 4].tobytes(), dtype=np.uint32).astype(np.int64); o += E * 4
weights = np.frombuffer(gb[o:o + E * 2].tobytes(), dtype=np.uint16).astype(np.float64)
sign = np.fromfile('public/data/ntsign.bin', dtype=np.float32).astype(np.float64)   # +1 exc ... -1 inh (graded when unknown)
pre = np.repeat(np.arange(N), np.diff(indptr)); post = indices
W = sp.csr_matrix((weights, indices, indptr), shape=(N, N))         # W[i,j] = synapses i -> j
log('loaded', N, 'neurons', E, 'connections, synapses', int(weights.sum()))

isE = sign > 0.2; isI = sign < -0.2
sensory = np.array(['sensory' in s for s in scn])
motor = np.array([bool(re.search('motor|efferent|endocrine', s)) for s in scn])
dn = scn == 'descending_neuron'; an = scn == 'ascending_neuron'
R = {}   # results

def type_ids(t): return np.where(types == t)[0]
def bytype_sum(mask_pre, mask_post):
    return W[mask_pre][:, mask_post].sum()

# ---------------------------------------------------------------- 1. signal-flow hierarchy
def flow_hierarchy():
    """Harmonic 'depth' x: sensory pinned 0, motor+efferent pinned 1, every other neuron sits at the
    synapse-weighted mean of its neighbours' depths (half from inputs, half from outputs)."""
    x = np.full(N, 0.5); pin = sensory | motor; x[sensory] = 0; x[motor] = 1
    Win = W.T.tocsr(); ind = np.asarray(Win.sum(1)).ravel(); outd = np.asarray(W.sum(1)).ravel()
    free = ~pin
    for it in range(1000):
        up = Win @ x; down = W @ x
        num = np.where(ind > 0, up / np.maximum(ind, 1e-9), 0) * (ind > 0) + np.where(outd > 0, down / np.maximum(outd, 1e-9), 0) * (outd > 0)
        den = (ind > 0).astype(float) + (outd > 0)
        nx = np.where(den > 0, num / np.maximum(den, 1), 0.5)
        d = np.abs(nx[free] - x[free]).max(); x[free] = nx[free]
        if d < 1e-5: break
    # forward vs feedback synapse weight
    dx = x[post] - x[pre]
    fwd = weights[dx > 0.02].sum() / weights.sum(); back = weights[dx < -0.02].sum() / weights.sum()
    per_sc = {s: [round(float(np.median(x[scn == s])), 3), int((scn == s).sum())] for s in meta['superclasses'] if (scn == s).sum() > 50}
    per_cls = {c: round(float(np.median(x[cln == c])), 3) for c in meta['classes'] if c and (cln == c).sum() > 10}
    # BFS depth from sensory neurons over connections >= 5 synapses
    A5 = (W >= 5).astype(np.int8)
    dist = np.full(N, -1); dist[sensory] = 0; frontier = sensory.copy(); k = 0
    while frontier.any() and k < 30:
        k += 1; nxt = (A5.T @ frontier.astype(np.int8)).astype(bool) & (dist < 0); dist[nxt] = k; frontier = nxt
    hops = collections.Counter(dist.tolist())
    dn_hops = collections.Counter(dist[dn].tolist()); mn_hops = collections.Counter(dist[scn == 'vnc_motor'].tolist())
    R['flow'] = dict(iterations=it, forward_weight_frac=round(fwd, 3), feedback_weight_frac=round(back, 3), lateral_frac=round(1 - fwd - back, 3),
                     median_depth_by_superclass=per_sc, median_depth_by_class=per_cls,
                     hops_from_sensory=dict(sorted((int(k), v) for k, v in hops.items())),
                     dn_hops_from_sensory=dict(sorted((int(k), v) for k, v in dn_hops.items())),
                     motor_hops_from_sensory=dict(sorted((int(k), v) for k, v in mn_hops.items())))
    log('flow', R['flow']['forward_weight_frac'], R['flow']['feedback_weight_frac'], 'hops', R['flow']['hops_from_sensory'])
    return x

# ---------------------------------------------------------------- 2. recurrence
def recurrence():
    ncc, lab = csgraph.connected_components(W, directed=True, connection='strong')
    sizes = np.bincount(lab); giant = sizes.argmax()
    in_g = lab == giant
    per_sc = {s: round(float(in_g[scn == s].mean()), 3) for s in meta['superclasses'] if (scn == s).sum() > 50}
    # reciprocity
    Wt = W.T.tocsr(); both = W.multiply(Wt > 0)
    recip_w = both.sum() / W.sum(); recip_e = both.nnz / W.nnz
    # 2-cycles by sign class (neuron level)
    pr, po = both.nonzero(); m = pr < po
    pr, po = pr[m], po[m]
    kinds = collections.Counter()
    for a, b in zip(sign[pr] > 0.2, sign[po] > 0.2):
        kinds['E<->E' if a and b else 'I<->I' if not a and not b else 'E<->I'] += 1
    # all-pairs sign-neutral expectation: fraction of I among neurons with reciprocal partners
    # type-level reciprocal pairs, strongest
    R['recurrence'] = dict(n_scc=int(ncc), giant_scc_size=int(sizes[giant]), giant_scc_frac=round(float(in_g.mean()), 3),
                           giant_scc_frac_by_superclass=per_sc, reciprocal_edge_frac=round(recip_e, 4), reciprocal_weight_frac=round(recip_w, 4),
                           two_cycles_by_sign=dict(kinds), scc_size_hist=dict(collections.Counter(np.minimum(sizes, 10).tolist())))
    log('recurrence: giant SCC', sizes[giant], 'reciprocal weight', round(recip_w, 3), kinds)

# ---------------------------------------------------------------- 3. sign structure
def sign_structure():
    wsum = W.sum(); ew = weights[isE[pre]].sum() / wsum; iw = weights[isI[pre]].sum() / wsum
    nt_w = {n: round(float(weights[nt[pre] == i].sum() / wsum), 4) for i, n in enumerate(meta['nts'])}
    # inhibitory fraction of input per class / superclass
    Win = W.T.tocsr(); ind_all = np.asarray(Win.sum(1)).ravel(); ind_I = np.asarray(Win[:, isI].sum(1)).ravel()
    per_sc = {s: round(float(ind_I[scn == s].sum() / max(ind_all[scn == s].sum(), 1)), 3) for s in meta['superclasses'] if (scn == s).sum() > 50}
    per_cls = {c: round(float(ind_I[cln == c].sum() / max(ind_all[cln == c].sum(), 1)), 3) for c in meta['classes'] if c and (cln == c).sum() > 10}
    # per-neuron inhibitory input fraction distribution
    fi = ind_I / np.maximum(ind_all, 1); q = np.percentile(fi[ind_all > 50], [10, 50, 90])
    # neuromodulators: fan-out
    mod = {}
    for n in ['dopamine', 'octopamine', 'serotonin']:
        m = ntn == n; outd = np.asarray(W[m].sum(1)).ravel(); ntypes = [len(set(types[W[i].indices])) for i in np.where(m)[0]]
        mod[n] = dict(n=int(m.sum()), median_out_synapses=float(np.median(outd)), median_target_types=float(np.median(ntypes)), max_target_types=int(max(ntypes)))
    R['sign'] = dict(exc_weight_frac=round(ew, 3), inh_weight_frac=round(iw, 3), weight_by_nt=nt_w, inh_input_frac_by_superclass=per_sc,
                     inh_input_frac_by_class=per_cls, inh_input_frac_neuron_p10_50_90=[round(v, 3) for v in q], modulatory=mod)
    log('sign', ew, iw, 'inh input p50', q[1])

# ---------------------------------------------------------------- 4. bilateral wiring
def bilateral():
    L, Rr = side == 1, side == 2
    cross = ((side[pre] == 1) & (side[post] == 2)) | ((side[pre] == 2) & (side[post] == 1))
    known = (side[pre] > 0) & (side[post] > 0) & (side[pre] < 3) & (side[post] < 3)
    frac = weights[cross].sum() / weights[known].sum()
    per_sc = {s: round(float(weights[cross & (scn[pre] == s)].sum() / max(weights[known & (scn[pre] == s)].sum(), 1)), 3) for s in meta['superclasses'] if (scn == s).sum() > 50}
    inh_cross = weights[cross & isI[pre]].sum() / weights[cross].sum(); inh_ipsi = weights[known & ~cross & isI[pre]].sum() / weights[known & ~cross].sum()
    # type-level L<->R homologue reciprocal inhibition (mutual inhibition between hemispheres)
    tl = type_level()
    pairs = []
    for t, ids in tl['ids'].items():
        li, ri = ids[side[ids] == 1], ids[side[ids] == 2]
        if len(li) == 0 or len(ri) == 0: continue
        a = W[li][:, ri].sum(); b = W[ri][:, li].sum()
        if min(a, b) >= 30 and sign[ids].mean() < -0.2: pairs.append((t, int(a), int(b), len(li), len(ri)))
    pairs.sort(key=lambda p: -min(p[1], p[2]))
    R['bilateral'] = dict(crossing_weight_frac=round(frac, 3), crossing_frac_by_superclass=per_sc, inh_frac_of_crossing=round(inh_cross, 3), inh_frac_of_ipsilateral=round(inh_ipsi, 3),
                          mutual_inhibition_LR_homologues=[dict(type=t, L_to_R=a, R_to_L=b, nL=l, nR=r) for t, a, b, l, r in pairs[:25]])
    log('bilateral crossing', round(frac, 3), 'inh of crossing', round(inh_cross, 3), 'mutual-inhib pairs', len(pairs))

# ---------------------------------------------------------------- type-level graph
_TL = None
def type_level():
    global _TL
    if _TL: return _TL
    ut, tix = np.unique(types, return_inverse=True)
    T = len(ut); P = sp.csr_matrix((np.ones(N), (tix, np.arange(N))), shape=(T, N))
    TW = (P @ W @ P.T).tocsr()                       # synapses type -> type
    cnt = np.bincount(tix, minlength=T)
    tsign = np.bincount(tix, weights=sign, minlength=T) / cnt
    ids = {t: np.where(tix == i)[0] for i, t in enumerate(ut)}
    _TL = dict(ut=ut, tix=tix, T=T, TW=TW, cnt=cnt, tsign=tsign, ids=ids, tsc=np.array([scn[ids[t]][0] for t in ut]), tcls=np.array([cln[ids[t]][0] for t in ut]))
    return _TL

if __name__ == '__main__':
    want = set(sys.argv[1:]) or {'flow', 'rec', 'sign', 'bil', 'motif', 'al', 'mb', 'cx', 'ol', 'escape', 'dn', 'vnc', 'hubs'}
    x = None
    if 'flow' in want: x = flow_hierarchy()
    if 'rec' in want: recurrence()
    if 'sign' in want: sign_structure()
    if 'bil' in want: bilateral()
    sys.path.insert(0, "scripts"); import algo_circuits as C
    C.run(want, globals(), R, x)
    json.dump(R, open('data/algo_structures.json', 'w'), indent=1, default=lambda v: v.item() if hasattr(v, 'item') else str(v))
    log('wrote data/algo_structures.json')
