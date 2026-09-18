"""Species-agnostic algorithmic-structure analysis on the canonical IR.

Runs the generic sections of the connectome compiler — flow depth, recurrence, sign
structure, bilateral wiring, motif census with degree/sign-preserving null model,
feed-forward loops, spectral footprint, hubs — on any dataset loaded through
connectome_ir. Reuses the motif/null machinery from algo_circuits.

    python3 scripts/algo_ir.py fly worm            # analyse both, write ir_generic.json
    python3 scripts/algo_ir.py worm
"""
import json, re, sys, time, collections
import numpy as np
import scipy.sparse as sp
from scipy.sparse import csgraph
sys.path.insert(0, 'scripts')
import connectome_ir as IR
import algo_circuits as C
C.log = lambda *a: print(f'[{time.time()-T0:6.1f}s]', *a, flush=True)

T0 = time.time()
def log(*a): print(f'[{time.time()-T0:6.1f}s]', *a, flush=True)


def analyse(ir):
    N = ir['N']; types = ir['types']; scn = ir['scn']; sign = ir['sign']; side = ir['side']
    W = IR.csr_of(ir); weights = ir['weights']
    pre = np.repeat(np.arange(N), np.diff(ir['indptr'])); post = ir['indices']
    isE = sign > 0.2; isI = sign < -0.2
    sensory, motor = ir['sensory'], ir['motor']
    R = dict(name=ir['name'], N=N, edges=int(W.nnz), synapses=int(weights.sum()), meta=ir['meta'])

    # ---- flow hierarchy -------------------------------------------------
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
    dx = x[post] - x[pre]
    fwd = weights[dx > 0.02].sum() / weights.sum(); back = weights[dx < -0.02].sum() / weights.sum()
    per_sc = {s: [round(float(np.median(x[scn == s])), 3), int((scn == s).sum())] for s in sorted(set(scn)) if (scn == s).sum() > 5}
    Ath = (W >= ir['meta'].get('hop_min_weight', 5)).astype(np.int8)
    dist = np.full(N, -1); dist[sensory] = 0; frontier = sensory.copy(); k = 0
    while frontier.any() and k < 30:
        k += 1; nxt = (Ath.T @ frontier.astype(np.int8)).astype(bool) & (dist < 0); dist[nxt] = k; frontier = nxt
    hops = collections.Counter(dist.tolist())
    R['flow'] = dict(forward_weight_frac=round(fwd, 3), feedback_weight_frac=round(back, 3), lateral_frac=round(1 - fwd - back, 3),
                     median_depth_by_superclass=per_sc,
                     hops_from_sensory=dict(sorted((int(k), v) for k, v in hops.items())),
                     n_sensory=int(sensory.sum()), n_output=int(motor.sum()))
    log('flow', fwd, back)

    # ---- recurrence ------------------------------------------------------
    ncc, lab = csgraph.connected_components(W, directed=True, connection='strong')
    sizes = np.bincount(lab); giant = sizes.argmax(); in_g = lab == giant
    both = W.multiply(W.T > 0)
    pr_, po_ = both.nonzero(); m_ = pr_ < po_
    kinds = collections.Counter()
    for a, b in zip(sign[pr_[m_]] > 0.2, sign[po_[m_]] > 0.2):
        kinds['E<->E' if a and b else 'I<->I' if not a and not b else 'E<->I'] += 1
    rec = dict(n_scc=int(ncc), giant_scc_frac=round(float(in_g.mean()), 3),
               reciprocal_edge_frac=round(both.nnz / W.nnz, 4), reciprocal_weight_frac=round(both.sum() / W.sum(), 4),
               two_cycles_by_sign=dict(kinds))
    if ir['gap_indptr'] is not None:
        G = IR.csr_of(ir, gap=True)
        Wu = ((W + W.T) > 0).astype(np.int8) + (G > 0).astype(np.int8)
        ncc2, lab2 = csgraph.connected_components(Wu, directed=True, connection='strong')
        rec['gap_junction_edges'] = int(G.nnz); rec['gap_weight_total'] = int(G.sum())
        rec['giant_component_chem_plus_gap'] = round(float(np.bincount(lab2).max() / N), 3)
        rec['chem_only_giant_weak_component'] = None  # SCC above is directed-chem; add weak comp:
        nw = csgraph.connected_components(W, directed=True, connection='weak')[1]
        rec['giant_weak_component_chem'] = round(float(np.bincount(nw).max() / N), 3)
    R['recurrence'] = rec
    log('recurrence', rec['giant_scc_frac'], rec['two_cycles_by_sign'])

    # ---- sign structure ---------------------------------------------------
    wsum = W.sum()
    ew = weights[isE[pre]].sum() / wsum; iw = weights[isI[pre]].sum() / wsum
    ind_I = np.asarray(Win[:, isI].sum(1)).ravel()
    per_sc_i = {s: round(float(ind_I[scn == s].sum() / max(ind[scn == s].sum(), 1)), 3) for s in sorted(set(scn)) if (scn == s).sum() > 5}
    fi = ind_I / np.maximum(ind, 1); q = np.percentile(fi[ind > 20], [10, 50, 90]) if (ind > 20).any() else [0, 0, 0]
    R['sign'] = dict(exc_weight_frac=round(float(ew), 3), inh_weight_frac=round(float(iw), 3),
                     unsigned_weight_frac=round(1 - float(ew) - float(iw), 3),
                     n_exc=int(isE.sum()), n_inh=int(isI.sum()), n_unknown_sign=int((~isE & ~isI).sum()),
                     inh_input_frac_by_superclass=per_sc_i,
                     inh_input_frac_neuron_p10_50_90=[round(float(v), 3) for v in q])
    log('sign', ew, iw)

    # ---- bilateral --------------------------------------------------------
    cross = ((side[pre] == 1) & (side[post] == 2)) | ((side[pre] == 2) & (side[post] == 1))
    known = (side[pre] > 0) & (side[post] > 0) & (side[pre] < 3) & (side[post] < 3)
    bil = dict(crossing_weight_frac=round(float(weights[cross].sum() / max(weights[known].sum(), 1)), 3),
               inh_frac_of_crossing=round(float(weights[cross & isI[pre]].sum() / max(weights[cross].sum(), 1)), 3),
               inh_frac_of_ipsilateral=round(float(weights[known & ~cross & isI[pre]].sum() / max(weights[known & ~cross].sum(), 1)), 3))
    R['bilateral'] = bil
    log('bilateral', bil['crossing_weight_frac'])

    # ---- type-level motif census + null model ------------------------------
    ut, tix = np.unique(types, return_inverse=True)
    T = len(ut)
    P = sp.csr_matrix((np.ones(N), (tix, np.arange(N))), shape=(T, N))
    TW = (P @ W @ P.T).tocsr()
    cnt = np.bincount(tix, minlength=T)
    tsign = np.bincount(tix, weights=sign, minlength=T) / cnt
    S_ = TW.tocoo(); per = S_.data / cnt[S_.col]
    # worm edges are sparse (median weight ~5): same thresholds as fly (>=3/target, >=20 total)
    keep = (per >= 3) & (S_.data >= 20) & (ut[S_.row] != '') & (ut[S_.col] != '')
    A = sp.csr_matrix((S_.data[keep], (S_.row[keep], S_.col[keep])), shape=(T, T)); Ab = (A > 0).astype(np.int8)
    tE = tsign > 0.2; tI = tsign < -0.2
    log(f'type graph: {T} types, {A.nnz} strong edges, signed types {tE.sum()}E {tI.sum()}I')
    At = A.T.tocsr(); rec_ = A.multiply(At > 0).tocoo(); m2 = rec_.row < rec_.col
    pairs = list(zip(rec_.row[m2], rec_.col[m2], rec_.data[m2], np.asarray(At[rec_.row[m2], rec_.col[m2]]).ravel()))
    cat = lambda a, b: 'E<->E' if tE[a] and tE[b] else 'I<->I' if tI[a] and tI[b] else 'E<->I' if (tE[a] and tI[b]) or (tI[a] and tE[b]) else 'mixed'
    recc = collections.Counter(cat(a, b) for a, b, *_ in pairs)
    def toplist(kind, k=12):
        L = [(str(ut[a]), str(ut[b]), int(w1), int(w2)) for a, b, w1, w2 in pairs if cat(a, b) == kind]
        return sorted(L, key=lambda p: -min(p[2], p[3]))[:k]
    AEb = (A[tE] > 0).astype(np.int8); AI = Ab[tI]
    M = (AEb[:, tI] @ AI).multiply(AEb); ffi_count = int(M.nnz); ffi_pairs = int(AEb.nnz)
    ffl, nullz = C.ffl_census(A, Ab, tE, tI, ffi_count, ffi_pairs)
    R['motifs'] = dict(n_types=T, n_type_cells={str(t): int(c) for t, c in zip(ut, cnt) if c > 6},
                       strong_type_edges=int(A.nnz), signed_type_fracs=dict(E=float(tE.mean()), I=float(tI.mean())),
                       reciprocal_type_pairs_by_sign=dict(recc),
                       recurrent_excitation_top=toplist('E<->E'), mutual_inhibition_top=toplist('I<->I'), feedback_inhibition_top=toplist('E<->I'),
                       feedforward_inhibition=dict(E_type_edges=ffi_pairs, with_parallel_inhibitory_path=ffi_count,
                                                   frac=round(ffi_count / max(ffi_pairs, 1), 3)),
                       feedforward_loops=ffl, null_model=nullz)
    log('motifs done')

    # ---- electrical motifs -------------------------------------------------
    # The census above is chemical, and the worm's gap junctions are neither signed nor directed, so
    # they cannot enter it as edges. What they can do is change the answers: an electrical contact makes
    # a pair mutually coupled whether or not the chemical graph says so, which is exactly the quantity
    # the reciprocity and mutual-inhibition counts are measuring. This section folds them in and reports
    # the difference rather than a second table.
    if ir['gap_indptr'] is not None:
        G = IR.csr_of(ir, gap=True)
        gr, gc = G.nonzero(); gm = gr < gc                       # undirected pairs, counted once
        chem_any = ((W + W.T) > 0)
        also_chem = np.asarray(chem_any[gr[gm], gc[gm]]).ravel() > 0
        # Sign categories keep "unknown" separate: most of the worm's electrical partners are muscle,
        # hypodermis and the excretory cells, which carry no neurotransmitter assignment at all, and
        # folding them into "inhibitory" would invent the result this section is checking.
        cell_kind = collections.Counter()
        for a, b in zip(gr[gm], gc[gm]):
            cell_kind['E-E' if isE[a] and isE[b] else 'I-I' if isI[a] and isI[b]
                       else 'E-I' if (isE[a] and isI[b]) or (isI[a] and isE[b]) else 'unsigned'] += 1
        # type level, with the chemical census's own thresholds so the two are comparable
        TG = (P @ G @ P.T).tocsr()
        Sg = TG.tocoo(); perg = Sg.data / cnt[Sg.col]
        keepg = (perg >= 3) & (Sg.data >= 20) & (ut[Sg.row] != '') & (ut[Sg.col] != '')
        Ag = sp.csr_matrix((Sg.data[keepg], (Sg.row[keepg], Sg.col[keepg])), shape=(T, T))
        Ag = ((Ag + Ag.T) > 0).astype(np.int8)                   # symmetric by construction; re-assert
        gtr, gtc = Ag.nonzero(); gtm = gtr < gtc
        chem_t = ((Ab + Ab.T) > 0)
        pure = ~(np.asarray(chem_t[gtr[gtm], gtc[gtm]]).ravel() > 0)
        recip_t = (Ab.multiply(Ab.T) > 0)                        # already-reciprocal chemical type pairs
        new_recip = ~(np.asarray(recip_t[gtr[gtm], gtc[gtm]]).ravel() > 0)
        gcat = collections.Counter(cat(a, b) for a, b in zip(gtr[gtm], gtc[gtm]))
        gtop = sorted(((str(ut[a]), str(ut[b]), int(TG[a, b])) for a, b in zip(gtr[gtm], gtc[gtm])),
                      key=lambda p: -p[2])[:12]
        rr, rc = recip_t.nonzero(); n_chem_recip = int((rr < rc).sum())   # pairs, diagonal excluded
        is_neuron = np.isin(scn, ['sensory', 'interneuron', 'motor_neuron', 'pharyngeal'])
        nn = is_neuron[gr[gm]] & is_neuron[gc[gm]]
        R['electrical'] = dict(
            cell_pairs=int(gm.sum()), gap_junctions=int(G.sum() / 2),
            cell_pairs_neuron_neuron=int(nn.sum()),
            cell_pairs_neuron_neuron_electrical_only=int((nn & ~also_chem).sum()),
            cell_pairs_also_chemical=int(also_chem.sum()),
            cell_pairs_electrical_only=int((~also_chem).sum()),
            cell_pairs_by_sign=dict(cell_kind),
            type_pairs=int(gtm.sum()), type_pairs_electrical_only=int(pure.sum()),
            type_pairs_by_sign=dict(gcat), type_pairs_top=gtop,
            reciprocal_type_pairs_chemical=n_chem_recip,
            reciprocal_type_pairs_added=int(new_recip.sum()),
            reciprocal_type_pairs_combined=n_chem_recip + int(new_recip.sum()),
            threshold='same as the chemical census: >=3 gap junctions per target cell and >=20 in total',
            mutual_inhibition_added=int(sum(1 for a, b in zip(gtr[gtm], gtc[gtm])
                                            if cat(a, b) == 'I<->I' and not (recip_t[a, b] > 0))),
            recurrent_excitation_added=int(sum(1 for a, b in zip(gtr[gtm], gtc[gtm])
                                               if cat(a, b) == 'E<->E' and not (recip_t[a, b] > 0))))
        log('electrical', R['electrical']['type_pairs'], 'type pairs,',
            R['electrical']['reciprocal_type_pairs_added'], 'new reciprocal')

    # ---- spectral ----------------------------------------------------------
    sw = weights * sign[pre]
    Sm = sp.csr_matrix((sw, post, ir['indptr']), shape=(N, N))
    spec = {}
    rng = np.random.default_rng(0); v = rng.standard_normal(N); v /= np.linalg.norm(v)
    for it in range(300):
        w_ = Sm @ v; nrm = np.linalg.norm(w_)
        if nrm == 0: break
        v = w_ / nrm
    spec['spectral_radius_power_iter'] = round(float(np.linalg.norm(Sm @ v)), 1)
    try:
        from scipy.sparse.linalg import eigs
        kk = min(40, N - 10); vals, vecs = eigs(Sm, k=kk, which='LM', ncv=min(N, 100), maxiter=4000)
        k0 = int(np.argmax(np.abs(vals))); vec = np.abs(vecs[:, k0]) ** 2
        spec['dominant_eigvec_participation'] = round(float(vec.sum() ** 2 / (vec ** 2).sum()), 1)
        c2 = collections.Counter()
        for i in np.argsort(-vec)[:min(200, N)]: c2[str(types[i])] += vec[i]
        spec['dominant_eigvec_types'] = [(t, round(float(w), 3)) for t, w in c2.most_common(10)]
        spec['n_eigs_positive_real'] = int((vals.real > 1e-6).sum())
    except Exception as e:
        spec['eigs_error'] = str(e)
    net = np.asarray(W.sum(1)).ravel() - np.asarray(W.sum(0)).ravel()
    spec['netflow_median_by_superclass'] = {s: round(float(np.median(net[scn == s])), 1) for s in sorted(set(scn)) if (scn == s).sum() > 5}
    bt = collections.Counter(); rt = collections.Counter()
    for i in np.argsort(-net)[:min(300, N)]: bt[str(types[i])] += 1
    for i in np.argsort(net)[:min(300, N)]: rt[str(types[i])] += 1
    spec['top_broadcaster_types'] = bt.most_common(12); spec['top_receiver_types'] = rt.most_common(12)
    R['spectral'] = spec
    log('spectral', spec['spectral_radius_power_iter'])

    # ---- hubs ----------------------------------------------------------------
    def tail(d):
        d = d[d >= 100]
        if len(d) < 5: return None
        s = np.sort(d)[::-1]
        return round(float(-np.polyfit(np.log(s), np.log(np.arange(1, len(s) + 1)), 1)[0]), 2)
    R['hubs'] = dict(top_in=[(str(types[i]), str(scn[i]), int(ind[i])) for i in np.argsort(-ind)[:15]],
                     top_out=[(str(types[i]), str(scn[i]), int(outd[i])) for i in np.argsort(-outd)[:15]],
                     in_degree_tail_exponent=tail(ind), out_degree_tail_exponent=tail(outd),
                     synapses_in_p50_90_99=[int(v) for v in np.percentile(ind, [50, 90, 99])],
                     synapses_out_p50_90_99=[int(v) for v in np.percentile(outd, [50, 90, 99])])
    log('hubs', R['hubs']['in_degree_tail_exponent'], R['hubs']['out_degree_tail_exponent'])
    return R


def main():
    want = set(sys.argv[1:]) or {'fly', 'worm'}
    p = 'public/data/ir_generic.json'
    out = json.load(open(p)) if len(sys.argv) > 1 and __import__('os').path.exists(p) else {}
    if 'fly' in want:
        ir = IR.load_fly(); out[ir['name']] = analyse(ir)
    if 'worm' in want:
        base = 'data/ir'
        ir = IR.load_worm(f'{base}/herm_chemical_corrected/edges.csv',
                          f'{base}/herm_gap_junction_corrected/edges.csv', f'{base}/nt_dump.csv')
        out[ir['name']] = analyse(ir)
    json.dump(out, open(p, 'w'), indent=1, default=lambda v: v.item() if hasattr(v, 'item') else str(v))
    log('wrote public/data/ir_generic.json')


if __name__ == '__main__':
    main()
