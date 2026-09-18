"""Operator detectors: the compressed layer as a pipeline output rather than as prose.

doc 29's generic layer produces statistics — reciprocity, motif counts, spectral footprints. A
statistic is not an operator. This module looks for three computational operators directly in the
wiring, on any dataset packed into the IR, and reports each one with the evidence that fired it:

    expansion       a small population fanning out onto a much larger one that samples it sparsely
    normalization   a single cell (or a pair) reading a whole population and inhibiting all of it
    ring            a recurrent population whose connectivity is circulant on a cyclic coordinate
                    the detector recovers itself, plus shifter groups that move activity around it

Nothing here is told where to look. The detectors take the graph, the cell counts and the signs, and
nothing else: no glomerulus names, no compartment tables, no "this is the mushroom body". That is the
test — on the fly, the operators they return should be the ones doc 28 describes by name, and on the
worm they should return whatever the worm has, including nothing.

    python3 scripts/algo_operators.py fly worm      # writes public/data/ir_operators.json

Groups. Types in a connectome release are often split finer than an operator is: the fly's Kenyon
cells arrive as fourteen subtypes, and an expansion detector run on subtypes sees fourteen small
expansions instead of one large one. Types are therefore merged into groups by connectivity profile
first (cosine similarity of type-level input and output vectors), which is a graph operation and not
an annotation. Merging is reported per group so a reader can see what was joined to what.
"""
import json, sys, time, collections
import numpy as np
import scipy.sparse as sp
sys.path.insert(0, 'scripts')
import connectome_ir as IR

T0 = time.time()
def log(*a): print(f'[{time.time()-T0:6.1f}s]', *a, flush=True)

STATS = {}                # how many candidates each detector examined, so a zero result is legible
LAYERS = {}               # expansion layers assembled by detect_expansion, reused as populations
MERGE_COS = 0.75          # type profiles this similar are one group
MERGE_MIN = 8             # only types with at least this many cells are merge candidates


# ---------------------------------------------------------------- groups
def build_groups(ir, W):
    """Merge types whose type-level input and output profiles point the same way."""
    N = ir['N']; types = ir['types']
    ut, tix = np.unique(types, return_inverse=True); T = len(ut)
    cnt = np.bincount(tix, minlength=T)
    P = sp.csr_matrix((np.ones(N), (tix, np.arange(N))), shape=(T, N))
    TW = (P @ W @ P.T).tocsr()
    # profile = concatenated out- and in-vectors over types, L2-normalised
    out = sp.csr_matrix(TW); inn = sp.csr_matrix(TW.T)
    prof = sp.hstack([out, inn]).tocsr().astype(np.float64)
    nrm = np.sqrt(prof.multiply(prof).sum(1).A.ravel()); nrm[nrm == 0] = 1
    prof = sp.diags(1 / nrm) @ prof
    cand = np.where(cnt >= MERGE_MIN)[0]
    S = (prof[cand] @ prof[cand].T).toarray(); np.fill_diagonal(S, 0)
    # single-linkage over the similarity threshold
    parent = list(range(len(cand)))
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for i, j in zip(*np.where(S >= MERGE_COS)):
        a, b = find(i), find(j)
        if a != b: parent[a] = b
    groups = collections.defaultdict(list)
    for i, t in enumerate(cand): groups[find(i)].append(t)
    gid = np.full(T, -1)
    members = []
    for g in groups.values():
        members.append(sorted(g, key=lambda t: -cnt[t]))
        for t in g: gid[t] = len(members) - 1
    for t in range(T):                      # types too small to merge stand alone
        if gid[t] < 0 and cnt[t] > 0:
            members.append([t]); gid[t] = len(members) - 1
    G = len(members)
    gix = gid[tix]                          # group index per cell
    gname = [('+'.join(str(ut[t]) for t in m[:3]) + (f'+{len(m)-3} more' if len(m) > 3 else '')) for m in members]
    gcnt = np.bincount(gix, minlength=G)
    Pg = sp.csr_matrix((np.ones(N), (gix, np.arange(N))), shape=(G, N))
    GW = (Pg @ W @ Pg.T).tocsr()
    gsign = np.bincount(gix, weights=ir['sign'], minlength=G) / np.maximum(gcnt, 1)
    order = np.argsort(gix, kind='stable')          # cells of a group, without rescanning N per group
    bounds = np.searchsorted(gix[order], np.arange(G + 1))
    cells_of = [order[bounds[i]:bounds[i + 1]] for i in range(G)]
    log(f'groups: {T} types -> {G} groups ({int((np.array([len(m) for m in members]) > 1).sum())} merged)')
    return dict(ut=ut, tix=tix, gix=gix, G=G, members=members, name=gname, cnt=gcnt, GW=GW, sign=gsign,
                Pg=Pg, cells=cells_of)


# ---------------------------------------------------------------- expansion
def detect_expansion(ir, W, g, min_layer=50, min_ratio=3.0, min_share=0.2, pool_jaccard=0.4):
    """A layer whose cells each sample a few cells of a common, much smaller input pool.

    Type pairs are the wrong unit for this. An expansion layer arrives from a release split into
    subtypes — the fly's Kenyon cells come as fifteen — and its input pool is split finer still, into
    one type per glomerulus. Run pairwise, the detector sees dozens of small expansions and no large
    one, which is what the first version of this function did.

    So the layer is assembled from the graph instead. Every group of 50 cells or more gets its
    presynaptic pool (cells with at least 3 synapses onto at least 2 of its members); groups whose
    pools agree are one layer, on the grounds that sharing an input pool is what makes two sets of
    cells the same stage of processing. The measurements are then made on the assembled layer: how
    much bigger it is than its pool, how much of the pool each cell samples, and whether two cells'
    samples overlap more than independent draws would give.
    """
    cnt = g['cnt']; out = []
    Wb = (W >= 3)
    WbT = Wb.T.tocsr(); WT = W.T.tocsr()
    sens = ir['sensory']
    # A sensory population is not an expansion layer whatever its wiring looks like: its drive is a
    # receptor, which is not in the graph, so the only pool the graph can offer is the feedback it
    # receives. Without this the fly's ORNs outrank every real expansion, on the strength of the
    # antennal lobe's local neurons.
    cands = [b for b in range(g['G']) if cnt[b] >= min_layer and sens[g['cells'][b]].mean() <= 0.5]
    pools = {}
    for b in cands:
        cells = g['cells'][b]
        hits = np.asarray(WbT[cells].sum(0)).ravel()
        fwd = np.asarray(WT[cells].sum(0)).ravel()            # weight each cell sends into the layer
        back = np.asarray(W[cells].sum(0)).ravel()            # weight the layer sends back to it
        # Peers and feedback are not input. Cells of one layer connect to each other, and a feedback
        # interneuron or a teaching population reads the layer as much as it writes to it; both are
        # excluded by requiring the traffic to be substantially one-way inward. Without this a Kenyon
        # cell subtype's pool is half Kenyon cells and the expansion ratio comes out at 1.07.
        keep = (hits >= 2) & (back <= 0.5 * np.maximum(fwd, 1))
        pools[b] = set(np.where(keep)[0].tolist()) - set(cells.tolist())
    # union-find over pool agreement
    parent = {b: b for b in cands}
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for i, a in enumerate(cands):
        for b in cands[i + 1:]:
            pa, pb = pools[a], pools[b]
            if not pa or not pb: continue
            u = len(pa | pb)
            if u and len(pa & pb) / u >= pool_jaccard:
                x, y = find(a), find(b)
                if x != y: parent[x] = y
    layers = collections.defaultdict(list)
    for b in cands: layers[find(b)].append(b)
    STATS['expansion_groups_examined'] = len(cands); STATS['expansion_layers_assembled'] = len(layers)
    for gs_ in layers.values():
        cells = np.concatenate([g['cells'][b] for b in gs_])
        pool = sorted(set().union(*[pools[b] for b in gs_]) - set(cells.tolist()))
        if len(pool) < 10 or len(cells) < min_layer: continue
        ratio = len(cells) / len(pool)
        if ratio < min_ratio: continue
        Sub = Wb[np.array(pool)][:, cells]                      # pool x layer
        fanin = np.asarray(Sub.sum(0)).ravel()
        if np.median(fanin) < 2: continue
        share = float(W[np.array(pool)][:, cells].sum() / max(np.asarray(W[:, cells].sum(0)).sum(), 1))
        if share < min_share: continue
        k = float(np.median(fanin)); pfrac = k / len(pool)
        B = Sub.T.astype(np.float64).tocsr()
        rng = np.random.default_rng(0)
        pick = rng.choice(len(cells), size=min(400, len(cells)), replace=False)
        Bs = B[pick]
        inter = (Bs @ Bs.T).toarray(); np.fill_diagonal(inter, 0)
        deg = np.asarray(Bs.sum(1)).ravel()
        uni = deg[:, None] + deg[None, :] - inter
        jac = float(np.mean(inter[uni > 0] / uni[uni > 0])) if (uni > 0).any() else 0.0
        jac_null = pfrac / (2 - pfrac) if pfrac < 1 else 1.0
        # which groups dominate the pool, for a reader checking what was assembled
        pool_g = collections.Counter(g['name'][g['gix'][i]] for i in pool)
        lname = ('+'.join(g['name'][b] for b in sorted(gs_, key=lambda b: -cnt[b])[:4]) +
                 (f'+{len(gs_)-4} more groups' if len(gs_) > 4 else ''))
        LAYERS[lname] = cells
        out.append(dict(layer='+'.join(g['name'][b] for b in sorted(gs_, key=lambda b: -cnt[b])[:4]) +
                        (f'+{len(gs_)-4} more groups' if len(gs_) > 4 else ''),
                        n_groups_merged=len(gs_), n_layer=int(len(cells)), n_pool=int(len(pool)),
                        expansion_ratio=round(float(ratio), 2),
                        pool_share_of_layer_input=round(share, 3),
                        fanin_median=round(k, 1),
                        fanin_p10_90=[round(float(v), 1) for v in np.percentile(fanin, [10, 90])],
                        pool_sampled_frac=round(pfrac, 4),
                        overlap_jaccard=round(jac, 4), overlap_jaccard_random=round(float(jac_null), 4),
                        overlap_over_random=round(jac / jac_null, 2) if jac_null > 0 else None,
                        pool_top_groups=pool_g.most_common(6),
                        score=round(float(ratio * share * (1 - pfrac)), 3)))
    out.sort(key=lambda o: -o['score'])
    log(f'expansion: {len(out)} candidates')
    return out


# ---------------------------------------------------------------- normalization
def detect_normalization(ir, W, g, min_pop=150, min_cover=0.25, max_cells=4):
    """One cell (or a handful) that reads a whole population and inhibits all of it.

    Coverage both ways is the test. A hub that reads a population but projects elsewhere is a
    readout; a cell that reads it and feeds back onto most of it is a gain control, and if it is
    inhibitory it is divisive normalisation in the sense the models use.
    """
    N = ir['N']; gix = g['gix']; cnt = g['cnt']; sign = ir['sign']
    Wb = (W >= 3).astype(np.float64)
    WbT = Wb.T.tocsr()          # column slicing on a CSR is the expensive direction; transpose once
    out = []
    # Populations are the groups, plus any layer the expansion detector assembled. That matters for a
    # global feedback cell: the fly's APL covers every Kenyon cell, but the release splits them into
    # subtypes, so measured per subtype its coverage reads 0.6 instead of the 1.0 it actually has.
    pops = [(g['name'][b], g['cells'][b]) for b in range(g['G']) if cnt[b] >= min_pop]
    pops += [(f'{k} [layer]', v) for k, v in LAYERS.items() if len(v) >= min_pop]
    STATS['normalization_populations_examined'] = len(pops)
    STATS['normalization_small_cells_examined'] = sum(1 for a in range(g['G']) if 0 < cnt[a] <= max_cells)
    if not pops: return out
    small = [a for a in range(g['G']) if 0 < cnt[a] <= max_cells]
    # One pass per population instead of one per (cell, population) pair: for population P,
    # reads[j] is how many P cells contact cell j, writes[j] how many P cells cell j contacts.
    for bname, P in pops:
        reads = np.asarray(Wb[P].sum(0)).ravel() / len(P)
        writes = np.asarray(WbT[P].sum(0)).ravel() / len(P)
        hit = np.where((reads >= min_cover) & (writes >= min_cover))[0]
        if not len(hit): continue
        for a in small:
            cells = g['cells'][a]
            if g['name'][a] in bname: continue           # a population is not its own normaliser
            sel = np.intersect1d(cells, hit, assume_unique=False)
            if not len(sel): continue
            cin = float(reads[sel].max()); cout = float(writes[sel].max())
            s_ = float(np.mean(sign[cells]))
            out.append(dict(cell=g['name'][a], n_cells=int(cnt[a]), population=bname,
                            n_population=int(len(P)), reads_frac=round(cin, 3), writes_frac=round(cout, 3),
                            sign=round(s_, 2), kind='divisive (inhibitory)' if s_ < -0.2 else
                            'recurrent excitation' if s_ > 0.2 else 'unsigned',
                            synapses_in=int(W[P][:, cells].sum()), synapses_out=int(W[cells][:, P].sum()),
                            score=round(cin * cout * np.log10(max(len(P), 10)), 3)))
    out.sort(key=lambda o: -o['score'])
    log(f'normalization: {len(out)} candidates')
    return out



# ---------------------------------------------------------------- ring
def _circ_embed(K):
    """Angles for the cells of a recurrent population, from the two leading Fourier-like modes.

    A circulant kernel has a doubly degenerate top nontrivial eigenvalue whose eigenvectors are a
    cosine and a sine of the ring coordinate, so atan2 of the pair recovers the coordinate up to
    rotation and reflection. Degeneracy and amplitude uniformity are returned as the evidence that
    the population really is circulant rather than merely clustered.
    """
    M = (K + K.T) / 2.0
    M = M - M.mean(1, keepdims=True) - M.mean(0, keepdims=True) + M.mean()
    val, vec = np.linalg.eigh(M)
    o = np.argsort(-np.abs(val))
    l1, l2, l3 = (abs(val[o[i]]) for i in range(3))
    v1, v2 = vec[:, o[0]], vec[:, o[1]]
    r = np.hypot(v1, v2)
    return (np.arctan2(v2, v1), float(l2 / l1) if l1 > 0 else 0.0,
            float(l3 / max(l2, 1e-12)), float(r.std() / max(r.mean(), 1e-12)))


def _cos_fit(d, w, harm=1):
    """Fit w ~ a + b cos(harm * d) over angular differences d; return b, R^2."""
    X = np.column_stack([np.ones_like(d), np.cos(harm * d), np.sin(harm * d)])
    beta, *_ = np.linalg.lstsq(X, w, rcond=None)
    pred = X @ beta
    ss = float(((w - w.mean()) ** 2).sum())
    r2 = 1 - float(((w - pred) ** 2).sum()) / ss if ss > 0 else 0.0
    return float(np.hypot(beta[1], beta[2])) * np.sign(beta[1]), r2


def detect_ring(ir, W, g, lo=8, hi=400, max_groups=2000):
    """A recurrent population whose effective kernel depends only on distance around a circle.

    Three things have to hold together, and each is reported so a partial hit is legible:
      1. the effective recurrent kernel (direct, plus disynaptic through inhibitory groups, signed)
         is circulant — a cosine of the recovered coordinate explains most of it;
      2. the coordinate itself is real — the top eigenvalue pair is degenerate and every cell has
         comparable amplitude, which is what separates a ring from two clusters;
      3. some other group reads the ring and writes back to it at a nonzero angular offset, in both
         directions across subpopulations. Without shifters a ring stores a heading; with them it
         can be moved, which is the operator rather than the memory.
    """
    GW = g['GW']; cnt = g['cnt']; gix = g['gix']; gs = g['sign']
    GWd = GW.tocsr(); GWt = GW.T.tocsr()
    inh_mask = (gs < -0.2) & (cnt <= hi)
    # Rank candidates by recurrence per cell — direct within-group weight plus weight through any
    # small inhibitory group that the candidate both drives and is driven by. Ranking by out-weight
    # instead puts every large broadcaster ahead of every ring, which is how the first pass missed
    # the one ring this dataset is known to contain.
    def recur_weight(b):
        tot = float(GW[b, b])
        row = GWd[b]; back = GWt[b]
        shared = np.intersect1d(row.indices, back.indices)
        for u in shared:
            if not inh_mask[u] or u == b: continue
            tot += min(float(GW[b, u]), float(GW[u, b]))
        return tot / max(cnt[b], 1)
    cands = [b for b in range(g['G']) if lo <= cnt[b] <= hi]
    cands.sort(key=lambda b: -recur_weight(b)); cands = cands[:max_groups]
    STATS['ring_groups_examined'] = len(cands)
    out = []
    for b in cands:
        ix = g['cells'][b]; n = len(ix)
        direct = W[ix][:, ix].toarray().astype(np.float64)
        sgn = 1.0 if gs[b] > -0.2 else -1.0
        loop = np.intersect1d(GWd[b].indices, GWt[b].indices)
        inh_loops = sorted([u for u in loop if u != b and inh_mask[u]
                            and GW[b, u] >= 200 and GW[u, b] >= 200],
                           key=lambda u: -min(float(GW[b, u]), float(GW[u, b])))[:6]
        if not inh_loops and direct.sum() < 200: continue
        # Each disynaptic inhibitory route is tested on its own, and the sum of all of them is
        # tested too. Summing only would hide the case this detector exists to find: one inhibitory
        # population supplying a circulant kernel while several others add unstructured inhibition.
        variants = []
        Ds = {}
        for u in inh_loops:
            ui = g['cells'][u]
            D = (W[ix][:, ui].toarray() @ W[ui][:, ix].toarray()) / max(len(ui), 1)
            if D.sum() <= 0: continue
            Ds[u] = D / max(D.max(), 1e-9) * max(direct.max(), 1.0)
            variants.append(([u], direct * sgn - Ds[u]))
        if len(Ds) > 1:
            variants.append((list(Ds), direct * sgn - sum(Ds.values()) / len(Ds)))
        if direct.sum() >= 200: variants.append(([], direct * sgn))
        best = None
        for via_ids, K in variants:
            K = K.copy(); np.fill_diagonal(K, 0.0)
            if not np.isfinite(K).all() or K.std() == 0: continue
            th, deg2, deg3, amp_cv = _circ_embed(K)
            d = th[None, :] - th[:, None]; m = ~np.eye(n, dtype=bool)
            b1, r2_1 = _cos_fit(d[m], K[m], 1)
            b2, r2_2 = _cos_fit(d[m], K[m], 2)
            harm = 1 if (r2_1 >= r2_2 and b1 > 0) else 2
            r2, amp = (r2_1, b1) if harm == 1 else (r2_2, b2)
            if amp <= 0: continue
            cand = dict(via=via_ids, th=th, deg2=deg2, deg3=deg3, amp_cv=amp_cv, harm=harm,
                        r2=r2, amp=amp, r2_1=r2_1, r2_2=r2_2)
            if best is None or cand['r2'] * cand['deg2'] > best['r2'] * best['deg2']: best = cand
        if best is None or best['r2'] < 0.25: continue
        th = best['th']
        via = [dict(group=g['name'][u], n=int(cnt[u]), synapses_in=int(GW[b, u]), synapses_out=int(GW[u, b]))
               for u in best['via']]
        # shifters: groups that read the ring and write back, at a nonzero angular offset
        shifters = []
        for u in loop:
            if u == b or cnt[u] < 4 or GW[b, u] < 200 or GW[u, b] < 200: continue
            ui = g['cells'][u]
            A_in = W[ix][:, ui].toarray(); A_out = W[ui][:, ix].toarray()
            offs = []
            for c in range(len(ui)):
                wi, wo = A_in[:, c], A_out[c]
                if wi.sum() < 20 or wo.sum() < 20: continue
                pi = np.arctan2((wi * np.sin(th)).sum(), (wi * np.cos(th)).sum())
                po = np.arctan2((wo * np.sin(th)).sum(), (wo * np.cos(th)).sum())
                offs.append(float(np.angle(np.exp(1j * (po - pi)))))
            if len(offs) < 4: continue
            offs = np.array(offs)
            pos, neg = offs[offs > 0.15], offs[offs < -0.15]
            shifters.append(dict(group=g['name'][u], n=int(cnt[u]), n_measured=len(offs),
                                 median_offset_rad=round(float(np.median(offs)), 3),
                                 n_positive=int(len(pos)), n_negative=int(len(neg)),
                                 median_positive=round(float(np.median(pos)), 3) if len(pos) else None,
                                 median_negative=round(float(np.median(neg)), 3) if len(neg) else None,
                                 bidirectional=bool(len(pos) >= 2 and len(neg) >= 2),
                                 synapses_from_ring=int(GW[b, u]), synapses_to_ring=int(GW[u, b])))
        shifters.sort(key=lambda s_: -(s_['synapses_to_ring']))
        bidir = any(s_['bidirectional'] for s_ in shifters)
        out.append(dict(group=g['name'][b], members=[str(g['ut'][t]) for t in g['members'][b]][:8],
                        n_cells=int(n), sign=round(float(gs[b]), 2),
                        kernel_via=[v['group'] for v in via] or ['direct'],
                        harmonic=best['harm'], kernel_cos_r2=round(best['r2'], 3),
                        kernel_amplitude=round(best['amp'], 2),
                        first_harmonic_r2=round(best['r2_1'], 3), second_harmonic_r2=round(best['r2_2'], 3),
                        eig_degeneracy=round(best['deg2'], 3), next_eig_ratio=round(best['deg3'], 3),
                        amplitude_cv=round(best['amp_cv'], 3),
                        inhibitory_loops=via, shifters=shifters[:6], has_bidirectional_shifter=bidir,
                        score=round(best['r2'] * best['deg2'] * (1.5 if bidir else 1.0), 3)))
    out.sort(key=lambda o: -o['score'])
    log(f'ring: {len(out)} candidates')
    return out


if __name__ == '__main__':
    want = sys.argv[1:] or ['fly', 'worm']
    p = 'public/data/ir_operators.json'
    import os
    res = json.load(open(p)) if os.path.exists(p) else {}
    for which in want:
        if which == 'fly':
            ir = IR.load_fly()
        else:
            base = 'data/ir'
            ir = IR.load_worm(f'{base}/herm_chemical_corrected/edges.csv',
                              f'{base}/herm_gap_junction_corrected/edges.csv', f'{base}/nt_dump.csv')
        W = IR.csr_of(ir); log(f"{ir['name']}: {ir['N']} cells, {W.nnz} edges")
        g = build_groups(ir, W)
        # Thresholds scale with the dataset. A 454-cell animal has no population of 150 cells and
        # few types above 8, so running the fly's numbers on the worm would return three zeros that
        # say nothing about the worm. These are the smallest sizes at which each measurement still
        # means something: a layer needs enough cells to be a code, a normaliser needs a population
        # to normalise, and a ring needs enough positions to fit a cosine to.
        small = ir['N'] < 10000
        STATS.clear(); LAYERS.clear()
        R = dict(name=ir['name'], n_cells=int(ir['N']), n_groups=int(g['G']),
                 thresholds=dict(min_layer=20 if small else 50, min_pop=20 if small else 150,
                                 ring_min_cells=5 if small else 8),
                 expansion=detect_expansion(ir, W, g, min_layer=20 if small else 50),
                 normalization=detect_normalization(ir, W, g, min_pop=20 if small else 150),
                 ring=detect_ring(ir, W, g, lo=5 if small else 8,
                                  hi=100 if small else 400))
        R['candidates_examined'] = dict(STATS)
        res[ir['name']] = R
    json.dump(res, open(p, 'w'), indent=1, default=lambda v: v.item() if hasattr(v, 'item') else str(v))
    log(f'wrote {p}')
