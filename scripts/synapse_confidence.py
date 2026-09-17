"""Per-connection measurement uncertainty, estimated from bilateral replicates.

The graph this project runs is a thresholded measurement. prep_graph.py keeps connections of three or
more synapses; the calibrated model discards anything under six (docs/07-calibration.md). Both numbers
are choices made before any model is fitted, and the fit has no way to know that a 40-synapse
connection is better measured than a 3-synapse one. This script estimates the uncertainty instead of
assuming a cutoff, and it separates two questions that the single word "confidence" runs together:

    existence -- is there a connection here at all?
    weight    -- is the synapse count a trustworthy measure of how strong it is?

The estimator needs a replicate, and the animal supplies one. A fly is bilaterally symmetric, so for
a cell type with exactly one cell per side the connection a->b and its mirror a'->b' are two
reconstructions of the same piece of wiring: imaged in different tissue, segmented and proofread
independently. That is a test-retest design, and the standard statistics apply.

Existence is measured against a degree-preserving null -- the configuration model, where a pair with
out-degree k_out and in-degree k_in is connected with probability k_out k_in / E. Enrichment is the
observed mirror-present rate over that null.

Weight is measured as a reliability coefficient, from a latent-variable model fitted to the mirror
pairs. A connection has a true log-weight theta drawn from the population; each side reconstructs it
as y = theta + noise, with the noise scale free to depend on theta; and a side below the three-synapse
floor is censored rather than absent, since the graph simply does not contain it. Maximum likelihood
over that model gives

    lambda(c) = tau^2 / (tau^2 + sigma(theta)^2)

the fraction of the spread in a single side's log-weight that is real variation between connections
rather than measurement error -- a test-retest reliability -- and with it the posterior mean of theta,
which is the empirical-Bayes weight estimate. It leaves well-measured connections alone and pulls
poorly-measured ones toward the population mean. That array is what a fitting step should consume in
place of the raw counts. Connections whose mirror is also in the graph pool both observations, so two
connections with the same count are separated when one of them is bilaterally confirmed.

Modelling the censoring is not optional. Binning pairs by observed count and taking the within-pair
variance directly gives reliability 0.96 at three synapses and 0.76 at eight -- highest exactly where
the measurement is worst -- because at the floor only pairs whose mirror also cleared it survive.

Two caveats, both material. Left-right disagreement mixes reconstruction error with genuine asymmetry
and with ordinary developmental variability between the two sides of one animal, so the reliability
here is a lower bound on the reconstruction's own precision. And counts are discrete while the model
is continuous in log(1 + count), which matters most at the floor, where the gap between three and four
synapses is a large step in log space.

    python3 scripts/synapse_confidence.py [--out public/data]

Writes edge_reliability.u8, edge_w_shrunk.u16 (both in graph_w3.bin CSR order) and
edge_uncertainty.json.
"""
import json, sys
import numpy as np
import scipy.sparse as sp

sys.path.insert(0, 'scripts')
from connectome_ir import load_fly

FLOOR = 3          # graph_w3.bin keeps connections of >= 3 synapses
OUT = 'public/data'
if '--out' in sys.argv:
    OUT = sys.argv[sys.argv.index('--out') + 1]

BINS = [3, 4, 5, 6, 8, 10, 13, 17, 22, 30, 40, 60, 100, 10 ** 9]


def bin_of(c):
    return np.clip(np.searchsorted(BINS, c, side='right') - 1, 0, len(BINS) - 2)


def main():
    d = load_fly()
    N, types, side = d['N'], d['types'], d['side']
    indptr, indices, weights = d['indptr'], d['indices'], d['weights'].astype(np.int64)
    E = len(indices)
    print(f'{N} neurons, {E} connections, floor {FLOOR} synapses')

    # ---- mirror map: cell types with exactly one left and one right cell ----------------------
    order = np.argsort(types, kind='stable')
    mirror = np.full(N, -1, dtype=np.int64)
    _, start = np.unique(types[order], return_index=True)
    bounds = list(start) + [N]
    n_types_paired = 0
    for a, b in zip(bounds[:-1], bounds[1:]):
        grp = order[a:b]
        L, R = grp[side[grp] == 1], grp[side[grp] == 2]
        if len(L) == 1 and len(R) == 1:
            mirror[L[0]], mirror[R[0]] = R[0], L[0]
            n_types_paired += 1
    paired = mirror >= 0
    print(f'{n_types_paired} cell types with exactly one cell per side -> {paired.sum()} cells with an '
          f'unambiguous mirror ({100 * paired.sum() / N:.1f}% of the CNS)')

    # ---- mirror-pair counts ------------------------------------------------------------------
    M = sp.csr_matrix((weights, indices, indptr), shape=(N, N))
    src = np.repeat(np.arange(N, dtype=np.int64), np.diff(indptr))
    ok = paired[src] & paired[indices]
    edge_of_pair = np.flatnonzero(ok)
    msrc, mdst = mirror[src[ok]], mirror[indices[ok]]
    mirror_w = np.asarray(M[msrc, mdst]).ravel().astype(np.int64)     # 0 if the mirror edge is absent
    c_obs = weights[ok]
    seen = mirror_w >= FLOOR
    print(f'{ok.sum()} connections have a mirror defined; {seen.sum()} have their mirror present in the '
          f'graph ({100 * seen.mean():.1f}%)')

    # deduplicate: a fully observed pair appears once as (e, e') and once as (e', e)
    key = np.minimum(msrc, src[ok]) * N + np.minimum(mdst, indices[ok])
    _, first = np.unique(key, return_index=True)
    x, ymir, pair_seen = c_obs[first], mirror_w[first], seen[first]
    print(f'{len(x)} distinct mirror pairs, {pair_seen.sum()} with both sides above the floor')

    # ---- existence axis: reproduction against a degree-preserving null ------------------------
    outdeg = np.diff(indptr).astype(float)
    indeg = np.bincount(indices, minlength=N).astype(float)
    p_null = np.minimum(1.0, outdeg[msrc] * indeg[mdst] / float(E))

    # ---- weight axis: censored latent-variable fit ---------------------------------------------
    # Binning pairs by observed count and taking within-pair variance does not work here: at the
    # floor, only pairs whose mirror also cleared the floor survive, so the concordant ones are
    # selected and reliability comes out highest exactly where the measurement is worst. The fix is
    # to model the censoring rather than to bin around it.
    #
    #   theta_e ~ N(mu, tau^2)                     true log-weight of the connection
    #   y_i     ~ N(theta_e, sigma(theta)^2)       one side's reconstruction of it, i = L, R
    #   log sigma(theta) = alpha + beta * theta    noise allowed to depend on connection strength
    #   y observed only when count >= FLOOR        otherwise the pair member is absent from the graph
    #
    # fitted by maximum likelihood with Gauss-Hermite quadrature over theta, conditioned on at least
    # one side being observed, since pairs with neither side above the floor are never in the sample.
    from scipy.optimize import minimize
    from numpy.polynomial.hermite_e import hermegauss
    from scipy.stats import norm

    L_CENS = float(np.log1p(FLOOR - 0.5))
    yx = np.log1p(x.astype(float))
    ym = np.where(pair_seen, np.log1p(np.maximum(ymir, 1).astype(float)), np.nan)

    rng = np.random.default_rng(0)
    sub = rng.permutation(len(yx))[:120000]
    fx_, fy_, fseen_ = yx[sub], ym[sub], pair_seen[sub]

    nodes, wts = hermegauss(41)
    wts = wts / wts.sum()

    def nll(theta_par):
        mu, ltau, alpha, beta = theta_par
        tau = np.exp(ltau)
        th = mu + tau * nodes                                   # (Q,) quadrature grid over theta
        sig = np.exp(alpha + beta * th)
        lognorm_ = -np.log(sig) - 0.5 * np.log(2 * np.pi)
        cens = norm.logcdf((L_CENS - th) / sig)                 # log P(this side below the floor)

        def obs(yv):                                            # (n, Q)
            z = (yv[:, None] - th[None, :]) / sig[None, :]
            return lognorm_[None, :] - 0.5 * z * z

        lp = obs(fx_) + np.where(fseen_[:, None], obs(np.nan_to_num(fy_)), cens[None, :])
        ll = np.log(np.maximum(1e-300, (np.exp(lp - lp.max(axis=1, keepdims=True)) * wts).sum(axis=1))) \
            + lp.max(axis=1)
        z_both = np.log(max(1e-300, float((np.exp(2 * cens) * wts).sum())))   # both censored: unobservable
        return -float((ll - np.log1p(-np.exp(z_both))).sum())

    init = np.array([float(np.nanmean(yx)), np.log(max(0.3, float(np.nanstd(yx)))), np.log(0.5), 0.0])
    fit = minimize(nll, init, method='Nelder-Mead', options=dict(maxiter=4000, xatol=1e-5, fatol=1e-4))
    mu_t, ltau, alpha, beta = fit.x
    tau = float(np.exp(ltau))
    print(f'\nlatent log-weight model: mu {mu_t:.3f}  tau {tau:.3f}  '
          f'log sigma = {alpha:.3f} + {beta:.3f} * theta   (nll {fit.fun:.1f}, {"converged" if fit.success else "MAXITER"})')
    print(f'  measurement sd at count 3: {np.exp(alpha + beta * np.log1p(3)):.3f} log units, '
          f'at count 30: {np.exp(alpha + beta * np.log1p(30)):.3f}, '
          f'at count 100: {np.exp(alpha + beta * np.log1p(100)):.3f}')

    # posterior over theta for a single observed side, on the grid of possible counts
    cmax = int(weights.max())
    cvals = np.arange(cmax + 1, dtype=float)
    yc = np.log1p(cvals)
    th = mu_t + tau * nodes
    sig = np.exp(alpha + beta * th)
    zc = (yc[:, None] - th[None, :]) / sig[None, :]
    lpc = -np.log(sig)[None, :] - 0.5 * zc * zc
    post = np.exp(lpc - lpc.max(axis=1, keepdims=True)) * wts
    post /= post.sum(axis=1, keepdims=True)
    theta_hat = post @ th                                     # E[theta | one observation]
    theta_var = post @ (th ** 2) - theta_hat ** 2
    # reliability: fraction of the variance in a single observation that is real spread between
    # connections rather than measurement error, evaluated at the posterior mean strength
    sig_hat = np.exp(alpha + beta * theta_hat)
    lam_by_count = tau ** 2 / (tau ** 2 + sig_hat ** 2)

    # ---- per-bin table ------------------------------------------------------------------------
    curve = []
    for k in range(len(BINS) - 1):
        lo, hi = BINS[k], BINS[k + 1]
        m = (c_obs >= lo) & (c_obs < hi)
        if m.sum() < 30:
            continue
        cc = int(np.median(c_obs[m]))
        curve.append(dict(lo=lo, hi=None if hi > 10 ** 8 else hi, n=int(m.sum()),
                          reproduced=round(float(seen[m].mean()), 4),
                          chance=round(float(p_null[m].mean()), 5),
                          enrichment=round(float(seen[m].mean() / max(1e-9, p_null[m].mean())), 1),
                          medianMirror=float(np.median(mirror_w[m])),
                          medianCount=cc,
                          reliability=round(float(lam_by_count[cc]), 4),
                          shrunkWeight=round(float(np.expm1(theta_hat[cc])), 2)))
    print('\n synapses    n        exists: mirror   chance   enrichment | weight: reliability   EB weight')
    for c in curve:
        lab = f'{c["lo"]}-{c["hi"] - 1}' if c['hi'] else f'{c["lo"]}+'
        print(f'  {lab:<10} {c["n"]:<8} {c["reproduced"] * 100:>9.1f}%{c["chance"] * 100:>9.2f}%'
              f'{c["enrichment"]:>11.0f}x |{c["reliability"]:>14.2f}{c["shrunkWeight"]:>12.1f}')

    # ---- per-edge products ---------------------------------------------------------------------
    # Reliability and the empirical-Bayes weight follow from the fitted model. Where a connection has
    # a mirror in the graph, both observations are pooled, which is the only genuinely per-edge part:
    # two connections with the same count get different estimates when one is bilaterally confirmed.
    lam = lam_by_count[weights]
    w_hat = np.expm1(theta_hat[weights])

    both_obs = np.zeros(E, dtype=bool)
    both_obs[edge_of_pair[seen]] = True
    if both_obs.any():
        ya = np.log1p(weights[both_obs].astype(float))
        yb = np.log1p(mirror_w[seen].astype(float))
        z1 = (ya[:, None] - th[None, :]) / sig[None, :]
        z2 = (yb[:, None] - th[None, :]) / sig[None, :]
        lp2 = -2 * np.log(sig)[None, :] - 0.5 * (z1 * z1 + z2 * z2)
        po = np.exp(lp2 - lp2.max(axis=1, keepdims=True)) * wts
        po /= po.sum(axis=1, keepdims=True)
        th2 = po @ th
        w_hat[both_obs] = np.expm1(th2)
        lam[both_obs] = tau ** 2 / (tau ** 2 + np.exp(alpha + beta * th2) ** 2 / 2)   # two replicates

    w_u16 = np.clip(np.round(w_hat), 0, 65535).astype(np.uint16)
    np.clip(np.round(lam * 255), 0, 255).astype(np.uint8).tofile(f'{OUT}/edge_reliability.u8')
    w_u16.tofile(f'{OUT}/edge_w_shrunk.u16')

    shifted = int((w_u16 != np.clip(weights, 0, 65535)).sum())
    print(f'\nshrinkage moved {shifted} of {E} connection weights ({100 * shifted / E:.1f}%); '
          f'total synapses {weights.sum() / 1e6:.1f}M -> {w_hat.sum() / 1e6:.1f}M')
    print('\n count    n           reliability   EB weight   (bilaterally confirmed: weight)')
    for t in (3, 6, 12, 30, 100):
        m = weights == t
        if not m.any():
            continue
        mc = m & both_obs
        extra = f'{np.median(w_hat[mc]):.1f} (n={mc.sum()})' if mc.any() else '-'
        print(f'  {t:<7}  {m.sum():<10}  {lam[m][0]:>9.2f}   {np.expm1(theta_hat[t]):>9.1f}   {extra}')

    thresholds = {}
    for t in (1, 3, 5, 6, 8, 10, 12):
        keep = weights >= t
        thresholds[str(t)] = dict(edges=int(keep.sum()), fracEdges=round(float(keep.mean()), 4),
                                  meanReliability=round(float(lam[keep].mean()), 4),
                                  synapseMassKept=round(float(weights[keep].sum() / weights.sum()), 4))

    meta = dict(
        _source='scripts/synapse_confidence.py',
        method='bilateral test-retest: existence against a configuration-model null, weight as a '
               'reliability coefficient on log(1+count), with empirical-Bayes shrinkage',
        floor=FLOOR, edges=int(E),
        format=dict(reliability='uint8 per edge, lambda = byte / 255, graph_w3.bin CSR order',
                    shrunkWeight='uint16 per edge, empirical-Bayes weight, same order'),
        calibration=dict(typesWithOneCellPerSide=int(n_types_paired), cellsWithMirror=int(paired.sum()),
                         edgesWithMirrorDefined=int(ok.sum()), edgesWithMirrorPresent=int(seen.sum()),
                         distinctPairs=int(len(x)), pairsBothObserved=int(pair_seen.sum()),
                         fractionOfGraphCalibrated=round(float(ok.sum() / E), 4)),
        latentModel=dict(mu=round(float(mu_t), 5), tau=round(float(tau), 5),
                         logSigmaIntercept=round(float(alpha), 5), logSigmaSlope=round(float(beta), 5),
                         censorAtLogCount=round(L_CENS, 5), pairsFitted=int(len(fx_)),
                         negLogLik=round(float(fit.fun), 2), converged=bool(fit.success),
                         sdAtCount3=round(float(np.exp(alpha + beta * np.log1p(3))), 4),
                         sdAtCount30=round(float(np.exp(alpha + beta * np.log1p(30))), 4)),
        reliabilityByCount={str(c): round(float(lam_by_count[c]), 4)
                            for c in [3, 4, 5, 6, 8, 10, 15, 20, 30, 50, 100] if c <= cmax},
        shrunkWeightByCount={str(c): round(float(np.expm1(theta_hat[c])), 2)
                             for c in [3, 4, 5, 6, 8, 10, 15, 20, 30, 50, 100] if c <= cmax},
        curve=curve, thresholds=thresholds,
        summary=dict(meanReliability=round(float(lam.mean()), 4),
                     synapsesRaw=int(weights.sum()), synapsesShrunk=int(round(float(w_hat.sum()))),
                     weightsChanged=shifted),
    )
    json.dump(meta, open(f'{OUT}/edge_uncertainty.json', 'w'), indent=1)
    print(f'\nwrote {OUT}/edge_reliability.u8, {OUT}/edge_w_shrunk.u16, {OUT}/edge_uncertainty.json')


if __name__ == '__main__':
    main()
