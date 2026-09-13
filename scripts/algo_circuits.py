"""Circuit-level structure extraction, called from algo_structures.py (shares its loaded arrays via G)."""
import re, collections
import numpy as np
import scipy.sparse as sp

def run(want, G, R, x):
    g = lambda k: G[k]
    global W, N, types, inst, scn, cln, ntn, sign, side, isE, isI, log, meta, pre, post, weights, dn, sensory
    W, N, types, inst, scn, cln, ntn, sign, side, isE, isI, log, meta = [g(k) for k in 'W N types inst scn cln ntn sign side isE isI log meta'.split()]
    pre, post, weights, dn, sensory = [g(k) for k in 'pre post weights dn sensory'.split()]
    tl = G['type_level']()
    if 'motif' in want: motifs(tl, R)
    if 'al' in want: antennal_lobe(tl, R)
    if 'mb' in want: mushroom_body(tl, R)
    if 'cx' in want: central_complex(tl, R)
    if 'ol' in want: optic_lobe(tl, R)
    if 'escape' in want: escape(tl, R)
    if 'dn' in want: descending(tl, R, x)
    if 'vnc' in want: vnc(tl, R)
    if 'hubs' in want: hubs(R)

def tids(t): return np.where(types == t)[0]
def rx(pat): return np.array([bool(re.match(pat, t)) for t in types])
def wsum(a, b): return float(W[a][:, b].sum())
def top_types(vec_by_type, k=10):
    o = np.argsort(-vec_by_type)[:k]; return [(str(t), int(v)) for t, v in zip(o, vec_by_type[o]) if v > 0]

# ---------------------------------------------------------------- type-level motif census
def motifs(tl, R):
    ut, TW, cnt, tsign, tsc, tcls = tl['ut'], tl['TW'], tl['cnt'], tl['tsign'], tl['tsc'], tl['tcls']
    T = tl['T']
    # strength: synapses per postsynaptic neuron; an edge counts if >= 3 per target neuron and >= 20 total
    S = TW.tocoo(); per = S.data / cnt[S.col]
    keep = (per >= 3) & (S.data >= 20) & (ut[S.row] != '') & (ut[S.col] != '')
    A = sp.csr_matrix((S.data[keep], (S.row[keep], S.col[keep])), shape=(T, T)); Ab = (A > 0).astype(np.int8)
    tE = tsign > 0.2; tI = tsign < -0.2
    log(f'type graph: {T} types, {A.nnz} strong type->type edges')
    # fan-in / fan-out (number of strong partner types)
    fin = np.asarray(Ab.sum(0)).ravel(); fout = np.asarray(Ab.sum(1)).ravel()
    by_sc = {}
    for s in set(tsc):
        m = (tsc == s) & (cnt >= 2)
        if m.sum() > 5: by_sc[s] = dict(types=int(m.sum()), median_in_types=float(np.median(fin[m])), median_out_types=float(np.median(fout[m])))
    conv = [(str(ut[i]), int(fin[i]), str(tsc[i])) for i in np.argsort(-fin)[:15]]
    div = [(str(ut[i]), int(fout[i]), str(tsc[i])) for i in np.argsort(-fout)[:15]]
    # reciprocal type pairs by sign
    At = A.T.tocsr(); rec = A.multiply(At > 0).tocoo(); m = rec.row < rec.col
    pairs = list(zip(rec.row[m], rec.col[m], rec.data[m], np.asarray(At[rec.row[m], rec.col[m]]).ravel()))
    def cat(a, b): return 'E<->E' if tE[a] and tE[b] else 'I<->I' if tI[a] and tI[b] else 'E<->I' if (tE[a] and tI[b]) or (tI[a] and tE[b]) else 'mixed'
    recc = collections.Counter(cat(a, b) for a, b, *_ in pairs)
    ol = np.array([s.startswith('ol_') or s.startswith('visual') for s in tsc])
    def toplist(kind, k=12, central=False):
        L = [(str(ut[a]), str(ut[b]), int(w1), int(w2)) for a, b, w1, w2 in pairs if cat(a, b) == kind and not (central and (ol[a] or ol[b]))]
        return sorted(L, key=lambda p: -min(p[2], p[3]))[:k]
    # feedforward inhibition triads A(E)->B, A->I, I(I)->B ; count at type level via matrix products
    AE = A[tE]; AEb = (AE > 0).astype(np.int8); AI = Ab[tI]
    # for each (A,B): does A hit some I that hits B?  M = AEb[:, tI] @ AI  -> counts of I mediators
    M = (AEb[:, tI] @ AI).multiply(AEb)        # only where the direct E edge exists
    ffi_count = int(M.nnz); ffi_pairs = int(AEb.nnz)
    # strongest triads: enumerate over I types with limited fan
    Ei = np.where(tE)[0]; Ii = np.where(tI)[0]
    tri = []
    for ii in Ii:
        src = A[:, ii].tocoo(); srcE = [(a, w) for a, w in zip(src.row, src.data) if tE[a]]
        tgt = A[ii].tocoo(); tg = dict(zip(tgt.col, tgt.data))
        for a, w1 in srcE:
            row = A[a].tocoo()
            for b, w0 in zip(row.col, row.data):
                if b in tg and b != a: tri.append((min(w0, w1, tg[b]), str(ut[a]), str(ut[ii]), str(ut[b]), int(w0), int(w1), int(tg[b])))
    tri.sort(reverse=True); olt = set(ut[ol]); tri_c = [t for t in tri if not ({t[1], t[2], t[3]} & olt)]
    # disinhibition chains I1 -> I2 -> X (X excitatory or DN), count
    AIb = Ab[tI][:, tI]; dis = int(AIb.nnz)
    dis_top = []
    co = A[tI][:, tI].tocoo()
    for a, b, w in sorted(zip(co.row, co.col, co.data), key=lambda p: -p[2])[:400]:
        i1, i2 = Ii[a], Ii[b]
        outs = A[i2].tocoo(); best = max(((w2, c) for c, w2 in zip(outs.col, outs.data) if tE[c]), default=None)
        if best and a != b: dis_top.append((str(ut[i1]), str(ut[i2]), str(ut[best[1]]), int(w), int(best[0])))
    dis_top.sort(key=lambda p: -min(p[3], p[4])); dis_c = [d for d in dis_top if not ({d[0], d[1], d[2]} & olt)]
    # lateral inhibition / normalisation: inhibitory type whose main input population is also its main output population
    norm = []
    for ii in Ii:
        if cnt[ii] > 60: continue
        ins = TW[:, ii].tocoo(); outs = TW[ii].tocoo()
        if ins.data.sum() < 500 or outs.data.sum() < 500: continue
        grp = lambda j: tcls[j]
        gi = collections.Counter(); go = collections.Counter()
        for j, w in zip(ins.row, ins.data): gi[grp(j)] += w
        for j, w in zip(outs.col, outs.data): go[grp(j)] += w
        for p in gi:
            fi, fo = gi[p] / ins.data.sum(), go[p] / outs.data.sum()
            if fi > 0.3 and fo > 0.3 and p not in ('', 'unknown'): norm.append((str(ut[ii]), str(p), round(fi, 2), round(fo, 2), int(ins.data.sum()), int(cnt[ii])))
    norm.sort(key=lambda p: -p[4])
    R['motifs'] = dict(strong_type_edges=int(A.nnz), fan_by_superclass=by_sc, top_convergent_types=conv, top_divergent_types=div,
                       reciprocal_type_pairs_by_sign=dict(recc), recurrent_excitation_top=toplist('E<->E'), mutual_inhibition_top=toplist('I<->I'),
                       feedback_inhibition_top=toplist('E<->I'), recurrent_excitation_central=toplist('E<->E', central=True), mutual_inhibition_central=toplist('I<->I', central=True), feedback_inhibition_central=toplist('E<->I', central=True),
                       feedforward_inhibition=dict(E_type_edges=ffi_pairs, with_parallel_inhibitory_path=ffi_count, frac=round(ffi_count / ffi_pairs, 3),
                                                   top=[dict(A=a, I=i, B=b, A_B=w0, A_I=w1, I_B=w2) for _, a, i, b, w0, w1, w2 in tri[:15]], top_central=[dict(A=a, I=i, B=b, A_B=w0, A_I=w1, I_B=w2) for _, a, i, b, w0, w1, w2 in tri_c[:15]]),
                       disinhibition=dict(I_to_I_type_edges=dis, top=[dict(I1=a, I2=b, target=c, I1_I2=w, I2_target=w2) for a, b, c, w, w2 in dis_top[:15]], top_central=[dict(I1=a, I2=b, target=c, I1_I2=w, I2_target=w2) for a, b, c, w, w2 in dis_c[:15]]),
                       normalisation_candidates=[dict(type=t, population=p, in_frac=fi, out_frac=fo, in_syn=n, n=c) for t, p, fi, fo, n, c in norm[:30]])
    log('motifs: recip', dict(recc), 'FFI frac', R['motifs']['feedforward_inhibition']['frac'], 'norm cands', len(norm))

# ---------------------------------------------------------------- antennal lobe
def antennal_lobe(tl, R):
    orn = rx(r'^ORN_'); pn = rx(r'^[A-Z]+\d*[a-z+]*_(l|ad|lv|il|ilv|v|l2)?PN$') | (cln == 'ALPN')
    glom_orn = {i: types[i][4:] for i in np.where(orn)[0]}
    glom_pn = {}
    for i in np.where(cln == 'ALPN')[0]:
        m = re.match(r'^([A-Z]+\d*[a-z]?\+?[a-z]?)_', types[i])
        if m: glom_pn[i] = m.group(1)
    gl = sorted(set(glom_orn.values()) & set(glom_pn.values()))
    gi = {g: k for k, g in enumerate(gl)}
    oi = np.array([i for i in glom_orn if glom_orn[i] in gi]); pi = np.array([i for i in glom_pn if glom_pn[i] in gi and 'uni' not in types[i] and '+' not in glom_pn[i]])
    Mo = sp.csr_matrix((np.ones(len(oi)), (np.array([gi[glom_orn[i]] for i in oi]), np.arange(len(oi)))), shape=(len(gl), len(oi)))
    Mp = sp.csr_matrix((np.ones(len(pi)), (np.array([gi[glom_pn[i]] for i in pi]), np.arange(len(pi)))), shape=(len(gl), len(pi)))
    GG = (Mo @ W[oi][:, pi] @ Mp.T).toarray()          # glomerulus (ORN) -> glomerulus (PN)
    diag = np.trace(GG) / GG.sum()
    n_orn = np.asarray(Mo.sum(1)).ravel(); n_pn = np.asarray(Mp.sum(1)).ravel()
    conv = n_orn / np.maximum(n_pn, 1)
    # per PN: number of ORN inputs and fraction from own glomerulus
    own = np.array([GG[gi[glom_pn[i]], gi[glom_pn[i]]] for i in pi])
    lns = np.where(cln == 'ALLN')[0]
    ln_sign = collections.Counter(ntn[lns].tolist())
    # LN breadth: number of glomeruli whose ORNs contact it (>=3 syn per ORN), and glomeruli of PNs it contacts
    Wo = (W[oi][:, lns] >= 3).astype(np.int8); breadth_in = np.asarray((Mo @ Wo > 0).sum(0)).ravel()
    Wp = (W[lns][:, pi] >= 3).astype(np.int8).T; breadth_out = np.asarray((Mp @ Wp > 0).sum(0)).ravel()
    tot = lambda a, b: int(W[a][:, b].sum())
    flows = {'ORN->PN': tot(oi, pi), 'ORN->LN': tot(oi, lns), 'LN->PN': tot(lns, pi), 'LN->ORN (presynaptic)': tot(lns, oi), 'LN->LN': tot(lns, lns), 'PN->LN': tot(pi, lns), 'PN->PN': tot(pi, pi), 'ORN->ORN': tot(oi, oi)}
    lnI = lns[isI[lns]]; lnE = lns[isE[lns]]
    flows['LN(inh)->PN'] = tot(lnI, pi); flows['LN(exc)->PN'] = tot(lnE, pi)
    # ORN fan-out: how many PNs does one ORN contact, and how many ORNs converge on one PN
    orn_fan = np.asarray((W[oi][:, pi] >= 3).sum(1)).ravel(); pn_fan = np.asarray((W[oi][:, pi] >= 3).sum(0)).ravel()
    R['antennal_lobe'] = dict(glomeruli=len(gl), n_orn=int(len(oi)), n_pn=int(len(pi)), n_ln=int(len(lns)),
                              orn_to_pn_same_glomerulus_frac=round(float(diag), 3), orn_per_glomerulus_median=float(np.median(n_orn)), pn_per_glomerulus_median=float(np.median(n_pn)),
                              convergence_ratio_median=round(float(np.median(conv)), 1), orn_per_pn_median=float(np.median(pn_fan)), pn_per_orn_median=float(np.median(orn_fan)),
                              ln_transmitters=dict(ln_sign), ln_input_glomeruli_p10_50_90=[int(v) for v in np.percentile(breadth_in[breadth_in > 0], [10, 50, 90])],
                              ln_output_glomeruli_p10_50_90=[int(v) for v in np.percentile(breadth_out[breadth_out > 0], [10, 50, 90])],
                              synapse_flows=flows, ln_to_orn_over_orn_to_pn=round(flows['LN->ORN (presynaptic)'] / flows['ORN->PN'], 3))
    log('AL: glomeruli', len(gl), 'labelled-line purity', round(diag, 3), 'LN breadth', np.median(breadth_in))

# ---------------------------------------------------------------- mushroom body
def mushroom_body(tl, R):
    kc = cln == 'Kenyon_Cell'; pn = cln == 'ALPN'; apl = rx('^APL$'); mbon = cln == 'MBON'; dan = cln == 'DAN'
    ki = np.where(kc)[0]; pi = np.where(pn)[0]
    PK = W[pi][:, ki]; claws = np.asarray((PK >= 3).sum(0)).ravel()     # PN inputs per KC
    kc_per_pn = np.asarray((PK >= 3).sum(1)).ravel()
    # randomness of PN->KC sampling: correlation between PN-type pairs in which KCs they hit, vs shuffle
    put, pix = np.unique(types[pi], return_inverse=True)
    Pt = sp.csr_matrix((np.ones(len(pi)), (pix, np.arange(len(pi)))), shape=(len(put), len(pi)))
    B = ((Pt @ (PK >= 3)) > 0).toarray().astype(float)      # PN type x KC
    keep = B.sum(1) >= 20; B = B[keep]
    C = np.corrcoef(B); iu = np.triu_indices(len(B), 1); obs = np.abs(C[iu]).mean()
    rng = np.random.default_rng(0); sh = []
    for _ in range(5):
        Bs = np.array([rng.permutation(r) for r in B]); Cs = np.corrcoef(Bs); sh.append(np.abs(Cs[iu]).mean())
    # APL
    a = np.where(apl)[0]
    kc_to_apl = np.asarray((W[ki][:, a] >= 1).sum(1)).ravel() > 0; apl_to_kc = np.asarray((W[a][:, ki] >= 1).sum(0)).ravel() > 0
    # MBON readout
    mi = np.where(mbon)[0]; KM = W[ki][:, mi]; kc_per_mbon = np.asarray((KM >= 3).sum(0)).ravel(); mbon_per_kc = np.asarray((KM >= 3).sum(1)).ravel()
    # compartment matching of DAN -> MBON via names
    comp = lambda s: (re.search(r'\(([^)>]+)', s) or [None, None])[1]
    di = np.where(dan)[0]
    dm = W[di][:, mi].tocoo(); match = 0; tot = 0
    for r, c, w in zip(dm.row, dm.col, dm.data):
        cd, cm = comp(inst[di[r]]), comp(inst[mi[c]]); tot += w
        if cd and cm and (cd in cm or cm in cd): match += w
    sub = collections.Counter(types[ki].tolist())
    flows = {k: int(W[u][:, v].sum()) for k, (u, v) in {'PN->KC': (pi, ki), 'KC->KC': (ki, ki), 'KC->APL': (ki, a), 'APL->KC': (a, ki), 'KC->MBON': (ki, mi), 'KC->DAN': (ki, di), 'DAN->KC': (di, ki), 'DAN->MBON': (di, mi), 'MBON->DAN': (mi, di), 'MBON->MBON': (mi, mi), 'MBON->KC': (mi, ki), 'PN->APL': (pi, a), 'APL->PN': (a, pi)}.items()}
    # MBON convergence onto downstream: number of MBON types feeding the top MBON targets
    R['mushroom_body'] = dict(n_kc=int(kc.sum()), kc_subtypes=dict(sub), n_pn=int(pn.sum()), expansion_ratio=round(kc.sum() / pn.sum(), 1),
                              claws_per_kc_p10_50_90=[int(v) for v in np.percentile(claws[claws > 0], [10, 50, 90])], kc_without_pn_input=int((claws == 0).sum()),
                              kc_per_pn_median=float(np.median(kc_per_pn[kc_per_pn > 0])), pn_reaching_kc=int((kc_per_pn > 0).sum()), pn_type_pair_corr_observed=round(float(obs), 4), pn_type_pair_corr_shuffled=round(float(np.mean(sh)), 4),
                              apl_covers_kc_frac=round(float(apl_to_kc.mean()), 3), kc_drive_apl_frac=round(float(kc_to_apl.mean()), 3),
                              n_mbon=int(mbon.sum()), kc_per_mbon_median=float(np.median(kc_per_mbon)), kc_per_mbon_max=int(kc_per_mbon.max()), mbon_per_kc_median=float(np.median(mbon_per_kc)),
                              n_dan=int(dan.sum()), dan_mbon_same_compartment_frac=round(match / max(tot, 1), 3), synapse_flows=flows)
    log('MB: claws', R['mushroom_body']['claws_per_kc_p10_50_90'], 'corr obs/shuf', round(obs, 4), round(np.mean(sh), 4), 'KC/MBON', np.median(kc_per_mbon))

# ---------------------------------------------------------------- central complex
def pb_col(s):
    m = re.search(r'_([LR])(\d)', s); return (m.group(1), int(m.group(2))) if m else None
def central_complex(tl, R):
    epg = tids('EPG'); pena = tids('PEN_a(PEN1)'); penb = tids('PEN_b(PEN2)'); d7 = tids('Delta7'); peg = tids('PEG')
    col = {i: pb_col(inst[i]) for i in np.concatenate([epg, pena, penb, peg])}
    # PB position on a line: L9..L1 R1..R9 -> 0..17 ; heading angle assumed period 8 (measured below)
    pos = lambda c: (9 - c[1]) if c[0] == 'L' else (8 + c[1])
    def group_matrix(src, dst, via=None, sgn=1):
        """mean synapses from src neurons to dst neurons, binned by PB-line offset (dst - src)."""
        M = W[src][:, dst] if via is None else W[src][:, via] @ W[via][:, dst]
        M = M.toarray(); out = collections.defaultdict(list)
        for a, i in enumerate(src):
            for b, j in enumerate(dst):
                if col[i] and col[j]: out[pos(col[j]) - pos(col[i])].append(M[a, b])
        return {int(k): round(float(np.mean(v)), 2) for k, v in sorted(out.items())}
    def side_prof(src, dst, via=None):
        """per (source side, target side): mean synapses vs glomerulus offset. Same side: k_dst - k_src; opposite: k_dst + k_src."""
        M = (W[src][:, dst] if via is None else W[src][:, via] @ W[via][:, dst]).toarray(); out = collections.defaultdict(list)
        for a, i in enumerate(src):
            for b, j in enumerate(dst):
                if col[i] and col[j]:
                    same = col[i][0] == col[j][0]; d = col[j][1] - col[i][1] if same else col[j][1] + col[i][1]
                    out[f'{col[i][0]}->{col[j][0]} {d:+d}' if same else f'{col[i][0]}->{col[j][0]} sum{d}'].append(M[a, b])
        return {k: round(float(np.mean(v)), 1) for k, v in sorted(out.items()) if np.mean(v) >= 1}
    sideprof = dict(PEN1_to_EPG=side_prof(pena, epg), PEN2_to_EPG=side_prof(penb, epg), EPG_to_PEN1=side_prof(epg, pena), EPG_to_D7_to_EPG=side_prof(epg, epg, via=d7), EPG_to_PEN1L_to_EPG=side_prof(epg, epg, via=pena[side[pena] == 1]), EPG_to_PEN1R_to_EPG=side_prof(epg, epg, via=pena[side[pena] == 2]), EPG_to_PEN2L_to_EPG=side_prof(epg, epg, via=penb[side[penb] == 1]), EPG_to_PEN2R_to_EPG=side_prof(epg, epg, via=penb[side[penb] == 2]), EPG_to_EPG=side_prof(epg, epg))
    prof = dict(EPG_to_PEN1=group_matrix(epg, pena), PEN1_to_EPG=group_matrix(pena, epg), EPG_to_PEN2=group_matrix(epg, penb), PEN2_to_EPG=group_matrix(penb, epg),
                EPG_to_D7_to_EPG=group_matrix(epg, epg, via=d7), EPG_to_PEG=group_matrix(epg, peg), PEG_to_EPG=group_matrix(peg, epg), EPG_to_EPG=group_matrix(epg, epg))
    # fold the offset profile mod 8 (two PB halves = two copies of the ring)
    def fold(p, period=8):
        acc = collections.defaultdict(list)
        for k, v in p.items(): acc[k % period].append(v)
        return {k: round(float(np.mean(v)), 2) for k, v in sorted(acc.items())}
    folded = {k: fold(v) for k, v in prof.items()}
    # ring-attractor signature: Delta7 inhibition minimum at offset 0 (same heading), PEN shift +-1
    d7f = folded['EPG_to_D7_to_EPG']; d7v = np.array([d7f[k] for k in range(8)])
    pen1 = folded['PEN1_to_EPG']; pen2 = folded['PEN2_to_EPG']
    d7_in = np.asarray((W[epg][:, d7] >= 3).sum(0)).ravel(); d7_out = np.asarray((W[d7][:, epg] >= 3).sum(1)).ravel()
    # FB columnar offsets: types tagged _C<n>
    fbcol = {}
    for i in range(N):
        m = re.search(r'_C(\d+)', inst[i])
        if m and cln[i] == 'CX': fbcol[i] = int(m.group(1))
    fi = np.array(sorted(fbcol)); ft = types[fi]; fc = np.array([fbcol[i] for i in fi])
    FF = W[fi][:, fi].tocoo(); pair_hist = collections.defaultdict(lambda: np.zeros(41))     # signed column offset -20..20
    short = lambda t: re.sub(r'[_(].*', '', t)[:6]
    for a, b, w in zip(FF.row, FF.col, FF.data): pair_hist[(short(ft[a]), short(ft[b]))][fc[b] - fc[a] + 20] += w
    offs = []
    for (a, b), h in pair_hist.items():
        if h.sum() < 400: continue
        k = int(h.argmax()) - 20; offs.append(dict(pre=a, post=b, synapses=int(h.sum()), peak_offset=k, peak_frac=round(float(h.max() / h.sum()), 2), abs_offset_mean=round(float((np.abs(np.arange(-20, 21)) * h).sum() / h.sum()), 2)))
    offs.sort(key=lambda o: -o['synapses'])
    same = sum(o['synapses'] for o in offs if o['peak_offset'] == 0); shifted = sum(o['synapses'] for o in offs if abs(o['peak_offset']) >= 3); other = sum(o['synapses'] for o in offs) - same - shifted
    # steering readout PFL3 -> DNa02, PFL2 -> DNa??, PFR
    pfl3 = tids('PFL3'); pfl2 = tids('PFL2'); dna02 = tids('DNa02')
    pfl_out = collections.Counter()
    for i in np.concatenate([pfl3, pfl2]):
        row = W[i].tocoo()
        for j, w in zip(row.col, row.data):
            if dn[j]: pfl_out[types[j]] += w
    # FB columnar cells: shift between the mean column of a neuron's column-tagged inputs and of its outputs
    shift = collections.defaultdict(list); fset = dict(zip(fi, fc))
    for i in fi:
        ins = W[:, i].tocoo(); outs = W[i].tocoo()
        ci = [(fset[j], w) for j, w in zip(ins.row, ins.data) if j in fset]; co = [(fset[j], w) for j, w in zip(outs.col, outs.data) if j in fset]
        if sum(w for _, w in ci) < 50 or sum(w for _, w in co) < 50: continue
        mi = sum(c * w for c, w in ci) / sum(w for _, w in ci); mo = sum(c * w for c, w in co) / sum(w for _, w in co)
        shift[re.sub(r'[_(].*', '', types[i])[:6]].append(mo - mi)
    fb_shift = {k: dict(n=len(v), median_shift=round(float(np.median(v)), 2), abs_shift_p50=round(float(np.median(np.abs(v))), 2)) for k, v in shift.items() if len(v) >= 8}
    R['central_complex'] = dict(n=dict(EPG=len(epg), PEN1=len(pena), PEN2=len(penb), Delta7=len(d7), PEG=len(peg)), side_resolved_profiles=sideprof, fb_in_out_column_shift=fb_shift,
                                offset_profiles_pb_line=prof, offset_profiles_mod8=folded,
                                delta7_inhibition_min_offset=int(d7v.argmin()), delta7_inhibition_min_over_mean=round(float(d7v.min() / d7v.mean()), 3),
                                pen1_peak_offset=int(max(pen1, key=pen1.get)), pen2_peak_offset=int(max(pen2, key=pen2.get)),
                                delta7_inputs_per_cell_median=float(np.median(d7_in)), delta7_epg_targets_per_cell_median=float(np.median(d7_out)),
                                fb_columnar_offsets=offs[:40], fb_offset_weight=dict(peak_same_column=int(same), peak_shift_ge3=int(shifted), peak_shift_1_2=int(other)),
                                pfl_to_dn=dict(pfl_out.most_common(8)))
    log('CX: D7 profile', d7f, 'PEN1', pen1, 'PEN2', pen2)

# ---------------------------------------------------------------- optic lobe
def optic_lobe(tl, R):
    ut, TW, cnt, ids = tl['ut'], tl['TW'], tl['cnt'], tl['ids']
    colu = [t for t in ut if cnt[tl['ut'] == t][0] >= 600 and t and 'KC' not in t]
    ci = {t: k for k, t in enumerate(ut)}
    # weight sharing: for strong columnar pairs, per-source-neuron total weight CV and partner count
    rows = []
    for a in colu:
        ia = ids[a]; Wa = W[ia]
        for b in colu:
            tot = TW[ci[a], ci[b]]
            if tot < 5000: continue
            ib = ids[b]; M = Wa[:, ib]; per = np.asarray(M.sum(1)).ravel(); npart = np.asarray((M > 0).sum(1)).ravel()
            act = per > 0
            rows.append(dict(pre=str(a), post=str(b), synapses=int(tot), src_frac_connected=round(float(act.mean()), 2), partners_per_src=round(float(np.median(npart[act])), 1),
                             weight_cv=round(float(per[act].std() / per[act].mean()), 2)))
    rows.sort(key=lambda r: -r['synapses'])
    # ON/OFF split at lamina -> medulla
    lam = ['L1', 'L2', 'L3', 'L4', 'L5']; med = ['Mi1', 'Tm3', 'Mi4', 'Mi9', 'Tm1', 'Tm2', 'Tm4', 'Tm9', 'C2', 'C3', 'T1']
    onoff = {l: {m: int(TW[ci[l], ci[m]]) for m in med} for l in lam}
    # T4/T5 input composition and their pooling by LPTCs
    t4 = {s: tids('T4' + s) for s in 'abcd'}; t5 = {s: tids('T5' + s) for s in 'abcd'}
    def comp(ix, k=8):
        c = collections.Counter()
        for i in ix:
            r = W[:, i].tocoo()
            for j, w in zip(r.row, r.data): c[types[j]] += w
        tot = sum(c.values()); return {t: round(v / tot, 3) for t, v in c.most_common(k)}
    t4comp = {s: comp(t4[s]) for s in 'abcd'}; t5comp = {s: comp(t5[s]) for s in 'abcd'}
    # cosine similarity of full input-type vectors between subtypes
    def vec(ix):
        c = collections.Counter()
        for i in ix:
            r = W[:, i].tocoo()
            for j, w in zip(r.row, r.data): c[types[j]] += w
        return c
    vs = {s: vec(t4[s]) for s in 'abcd'}; keys = sorted(set().union(*[v.keys() for v in vs.values()]))
    V = np.array([[vs[s].get(k, 0) for k in keys] for s in 'abcd']); V = V / np.linalg.norm(V, axis=1, keepdims=True)
    t4sim = np.round(V @ V.T, 3).tolist()
    lptc = [t for t in ut if re.match(r'^(VS|HS|H2|HSE|HSN|HSS|VSm|VST)', t)]
    pool = {}
    for t in lptc:
        ix = ids[t]; n = len(ix); d = {}
        for s in 'abcd':
            for nm, grp in (('T4', t4), ('T5', t5)):
                w = W[grp[s]][:, ix]; d[nm + s] = [int(w.sum()), round(float((w > 0).sum() / n), 1)]
        pool[t] = dict(n=int(n), inputs=d)
    # looming detectors: LC4/LPLC2 counts and inputs
    R['optic_lobe'] = dict(columnar_types=len(colu), weight_sharing=rows[:40], lamina_to_medulla=onoff, t4_input_composition=t4comp, t5_input_composition=t5comp,
                           t4_subtype_input_cosine=t4sim, lptc_pooling=pool)
    log('OL: columnar types', len(colu), 'T4 sim', t4sim[0])

# ---------------------------------------------------------------- escape
def escape(tl, R):
    gf = tids('DNp01'); ttm = tids('TTMn'); psi = tids('PSI')
    ins = collections.Counter(); ins_n = collections.Counter()
    for i in gf:
        r = W[:, i].tocoo()
        for j, w in zip(r.row, r.data): ins[types[j]] += w; ins_n[types[j]] += 1
    outs = collections.Counter()
    for i in gf:
        r = W[i].tocoo()
        for j, w in zip(r.col, r.data): outs[types[j]] += w
    tot = sum(ins.values())
    # shortest path (>=5 synapses) photoreceptor -> GF
    A5 = (W >= 5).astype(np.int8); dist = np.full(N, -1); src = rx(r'^R1-R6$|^R7|^R8'); dist[src] = 0; fr = src.copy(); k = 0
    while fr.any() and dist[gf].max() < 0 and k < 12:
        k += 1; nxt = (A5.T @ fr.astype(np.int8)).astype(bool) & (dist < 0); dist[nxt] = k; fr = nxt
    R['escape'] = dict(gf_inputs_top=[(t, int(w), round(w / tot, 3), int(ins_n[t])) for t, w in ins.most_common(12)], gf_total_input=int(tot), gf_outputs_top=outs.most_common(10),
                       photoreceptor_to_gf_hops=int(dist[gf].max()), n_lc4=len(tids('LC4')), n_lplc2=len(tids('LPLC2')),
                       lc4_per_gf=[int((W[tids('LC4')][:, i] > 0).sum()) for i in gf], lplc2_per_gf=[int((W[tids('LPLC2')][:, i] > 0).sum()) for i in gf])
    log('escape: GF inputs', R['escape']['gf_inputs_top'][:5], 'hops', dist[gf])

# ---------------------------------------------------------------- descending funnel
def descending(tl, R, x):
    di = np.where(dn)[0]; ai = np.where(scn == 'ascending_neuron')[0]
    brain = np.where(np.array([s.startswith('cb_') or s.startswith('ol_') or s.startswith('visual') for s in scn]))[0]
    brain_out = W[brain].sum(); to_dn = W[brain][:, di].sum()
    ind = np.asarray(W[:, di].sum(0)).ravel(); ntypes_in = [len(set(types[W[:, i].tocoo().row])) for i in di]
    dd = W[di][:, di]; recip = dd.multiply(dd.T > 0).nnz
    # DN targets in VNC: fraction direct to motor neurons
    mn = scn == 'vnc_motor'; dn_out = W[di].sum(); dn_mn = W[di][:, mn].sum(); dn_vnc = W[di][:, np.array([s.startswith('vnc') for s in scn])].sum()
    an_dn = W[ai][:, di].sum(); dn_an = W[di][:, ai].sum()
    # loops: VNC -> AN -> brain -> DN -> VNC
    top = sorted(zip(ind, di), reverse=True)[:12]
    R['descending'] = dict(n_dn=len(di), n_an=len(ai), brain_output_to_dn_frac=round(float(to_dn / brain_out), 4), dn_in_synapses_p10_50_90=[int(v) for v in np.percentile(ind, [10, 50, 90])],
                           dn_input_types_p10_50_90=[int(v) for v in np.percentile(ntypes_in, [10, 50, 90])], dn_dn_reciprocal_connections=int(recip), dn_dn_connections=int(dd.nnz),
                           dn_output_to_mn_frac=round(float(dn_mn / dn_out), 3), dn_output_to_vnc_frac=round(float(dn_vnc / dn_out), 3), an_to_dn_synapses=int(an_dn), dn_to_an_synapses=int(dn_an),
                           top_dn_by_input=[(str(types[i]), int(w)) for w, i in top], dn_median_depth=round(float(np.median(x[di])), 3) if x is not None else None)
    log('DN funnel: brain->DN frac', R['descending']['brain_output_to_dn_frac'], 'DN in p50', R['descending']['dn_in_synapses_p10_50_90'])

# ---------------------------------------------------------------- motor pools / VNC
def vnc(tl, R):
    mn = np.where(scn == 'vnc_motor')[0]; vi = np.where(scn == 'vnc_intrinsic')[0]; di = np.where(dn)[0]
    Win = W[:, mn]; ind = np.asarray(Win.sum(0)).ravel(); npre = np.asarray((Win >= 3).sum(0)).ravel()
    inhf = np.asarray(Win[isI].sum(0)).ravel() / np.maximum(ind, 1)
    src = {'DN': float(W[di][:, mn].sum()), 'VNC intrinsic': float(W[vi][:, mn].sum()), 'VNC sensory': float(W[scn == 'vnc_sensory'][:, mn].sum()), 'MN': float(W[mn][:, mn].sum())}
    tot = sum(src.values()); src = {k: round(v / tot, 3) for k, v in src.items()}
    # MN pools: motor neurons of the same type on the same side share premotor input (Jaccard of presynaptic sets)
    ut = collections.defaultdict(list)
    for i in mn: ut[(types[i], side[i])].append(i)
    jac = []
    for k, ix in ut.items():
        if len(ix) < 2: continue
        sets = [set(W[:, i].tocoo().row[W[:, i].tocoo().data >= 3]) for i in ix]
        for a in range(len(sets)):
            for b in range(a + 1, len(sets)): jac.append(len(sets[a] & sets[b]) / max(len(sets[a] | sets[b]), 1))
    # random MN pairs
    rng = np.random.default_rng(0); rj = []
    for _ in range(300):
        a, b = rng.choice(mn, 2, replace=False); sa = set(W[:, a].tocoo().row); sb = set(W[:, b].tocoo().row); rj.append(len(sa & sb) / max(len(sa | sb), 1))
    # mutual inhibition inside the VNC: inhibitory intrinsic types reciprocally connected (candidate half-centres)
    TW, tix, ids, tsign, tsc = tl['TW'], tl['tix'], tl['ids'], tl['tsign'], tl['tsc']
    vt = np.where((tsc == 'vnc_intrinsic') & (tsign < -0.2))[0]
    sub = TW[vt][:, vt]; rec = sub.multiply(sub.T > 0).tocoo(); pairs = []
    for a, b, w in zip(rec.row, rec.col, rec.data):
        if a < b: pairs.append((str(tl['ut'][vt[a]]), str(tl['ut'][vt[b]]), int(w), int(sub[b, a])))
    pairs.sort(key=lambda p: -min(p[2], p[3]))
    # commissural inhibition in the VNC
    v = np.array([s.startswith('vnc') for s in scn]); m = v[pre] & v[post] & (side[pre] > 0) & (side[post] > 0) & (side[pre] < 3) & (side[post] < 3)
    cross = m & (side[pre] != side[post])
    R['vnc'] = dict(n_mn=len(mn), mn_input_synapses_p10_50_90=[int(q) for q in np.percentile(ind, [10, 50, 90])], premotor_neurons_per_mn_p10_50_90=[int(q) for q in np.percentile(npre, [10, 50, 90])],
                    mn_inhibitory_input_frac_median=round(float(np.median(inhf[ind > 50])), 3), mn_input_sources=src,
                    pool_premotor_jaccard_median=round(float(np.median(jac)), 3), random_mn_pair_jaccard_median=round(float(np.median(rj)), 3),
                    vnc_crossing_weight_frac=round(float(weights[cross].sum() / weights[m].sum()), 3), vnc_crossing_inh_frac=round(float(weights[cross & isI[pre]].sum() / weights[cross].sum()), 3),
                    mutual_inhibition_vnc_top=[dict(a=a, b=b, a_b=w1, b_a=w2) for a, b, w1, w2 in pairs[:15]])
    log('VNC: MN sources', src, 'pool jaccard', R['vnc']['pool_premotor_jaccard_median'], 'vs random', R['vnc']['random_mn_pair_jaccard_median'])

# ---------------------------------------------------------------- hubs and degree tail
def hubs(R):
    ind = np.asarray(W.sum(0)).ravel(); outd = np.asarray(W.sum(1)).ravel()
    top_in = [(str(types[i]), str(scn[i]), int(ind[i])) for i in np.argsort(-ind)[:15]]; top_out = [(str(types[i]), str(scn[i]), int(outd[i])) for i in np.argsort(-outd)[:15]]
    def tail(d):
        d = d[d >= 100]; s = np.sort(d)[::-1]; k = np.log(s); c = np.log(np.arange(1, len(s) + 1))
        return round(float(-np.polyfit(k, c, 1)[0]), 2)
    R['hubs'] = dict(top_in=top_in, top_out=top_out, in_degree_tail_exponent=tail(ind), out_degree_tail_exponent=tail(outd),
                     synapses_in_p50_90_99=[int(v) for v in np.percentile(ind, [50, 90, 99])], synapses_out_p50_90_99=[int(v) for v in np.percentile(outd, [50, 90, 99])])
    log('hubs', top_in[:3], top_out[:3])
