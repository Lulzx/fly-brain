"""Canonical neural IR: every connectome loads into the same arrays.

The intermediate representation the generic analyses run on. A dataset is a dict:

    name      str, dataset label
    N         int
    names     (N,) str   unique cell name
    types     (N,) str   cell type / class (bilateral homologues share a type)
    scn       (N,) str   superclass (coarse functional class)
    cln       (N,) str   class (finer label; may equal types)
    side      (N,) i8    1 = left, 2 = right, 3 = midline/other, 0 = unknown
    sign      (N,) f8    +1 excitatory, -1 inhibitory, 0 unknown/modulatory (fractional ok)
    sensory   (N,) bool  pinned at depth 0 in the flow hierarchy
    motor     (N,) bool  pinned at depth 1 (motor neurons AND end organs)
    indptr,indices,weights          chemical graph, CSR, weights = synapse count
    gap_indptr,gap_indices,gap_weights  electrical graph, symmetric CSR (may be empty)
    meta      dict       provenance, conventions

Loaders: load_fly() (MaleCNS flat tables in public/data), load_worm() (Cook et al. 2019
adjacency CSVs from Netzschleuder + neurotransmitter table from the OpenWorm db dump).
save_ir / load_ir cache a dataset to a single .npz.
"""
import csv, json, os, re, sys
import numpy as np
import scipy.sparse as sp


def load_fly(data='public/data'):
    """MaleCNS as already packed for the browser sim (graph_w3.bin = connections >=3 syn)."""
    data = os.path.normpath(data)
    if '..' in data.split(os.sep):
        raise ValueError(f'invalid data path: {data!r}')
    meta = json.load(open(f'{data}/meta.json')); N = meta['N']
    types = np.array(meta['types']); inst = np.array(meta['instances'])
    nb = np.fromfile(f'{data}/neurons.bin', dtype=np.uint8); off = 8
    off += N * 8 + N * 12 + N * 4 + N * 4
    cls = np.frombuffer(nb[off:off + N * 2].tobytes(), dtype=np.uint16); off += N * 2
    nt = nb[off:off + N].copy(); off += N
    sc = nb[off:off + N].copy(); off += N
    side = nb[off:off + N].copy()
    scn = np.array(meta['superclasses'])[sc]; cln = np.array(meta['classes'])[cls]; ntn = np.array(meta['nts'])[nt]
    gb = np.fromfile(f'{data}/graph_w3.bin', dtype=np.uint8)
    E = int(np.frombuffer(gb[:8].tobytes(), dtype=np.uint32)[1]); o = 8
    indptr = np.frombuffer(gb[o:o + (N + 1) * 4].tobytes(), dtype=np.uint32).astype(np.int64); o += (N + 1) * 4
    indices = np.frombuffer(gb[o:o + E * 4].tobytes(), dtype=np.uint32).astype(np.int64); o += E * 4
    weights = np.frombuffer(gb[o:o + E * 2].tobytes(), dtype=np.uint16).astype(np.float64)
    sign = np.fromfile(f'{data}/ntsign.bin', dtype=np.float32).astype(np.float64)
    sensory = np.array(['sensory' in s for s in scn])
    motor = np.array([bool(re.search('motor|efferent|endocrine', s)) for s in scn])
    return dict(name='malecns', N=N, names=inst, types=types, scn=scn.astype(object), cln=cln.astype(object),
                ntn=ntn.astype(object), side=side.astype(np.int8), sign=sign,
                sensory=sensory, motor=motor, indptr=indptr, indices=indices, weights=weights,
                gap_indptr=None, gap_indices=None, gap_weights=None,
                meta=dict(source='MaleCNS v1.0 (this repo, >=3-synapse graph)', sign_convention='ntsign per neuron',
                          hop_min_weight=5))


# ---------------------------------------------------------------- C. elegans (Cook et al. 2019)
# Sign convention: ACh +1, GABA -1, Glu -1 (worm glutamate acts mostly on GluCl channels),
# monoamines 0 (modulatory). Neurons with no classical NT entry default to 0.
_NT_SIGN = {'acetylcholine': 1.0, 'gaba': -1.0, 'glutamate': -1.0,
            'serotonin': 0.0, 'dopamine': 0.0, 'octopamine': 0.0, 'tyramine': 0.0}
_WORM_MIDLINE = {'AQR', 'PQR', 'RIR', 'PVR'}          # names that end in L/R but are single midline cells


def _worm_side(name):
    if name in _WORM_MIDLINE: return 3
    if name.endswith('L'): return 1
    if name.endswith('R'): return 2
    return 3


def load_worm(chem_csv, gap_csv=None, nt_csv=None):
    """Cook et al. 2019 adult hermaphrodite (Netzschleuder CSV dumps).

    nodes.csv columns: index, node_type, node_subtype, name, _pos
    edges.csv columns: source, target, connectivity   (weight = synapse count)
    nt_csv: OpenWorm 'Modified celegans db dump.csv' (Entity,Relationship,Entity rows).
    """
    nr = list(csv.reader(open(chem_csv.replace('edges.csv', 'nodes.csv'))))
    nr = [r for r in nr if r and not r[0].startswith('#')]
    nr.sort(key=lambda r: int(r[0]))
    names = [r[3] for r in nr]
    ntype = [r[1] for r in nr]
    N = len(names); S = set(names)

    def typ(n):
        if n in _WORM_MIDLINE: return n
        if n[-1:] in 'LR' and n[:-1] + ('R' if n[-1] == 'L' else 'L') in S: n = n[:-1]
        return re.sub(r'\d+$', '', n)

    # superclass: the CSV's broad category; class: neuron letter-class, else the category
    scmap = {'SENSORY NEURONS': 'sensory', 'INTERNEURONS': 'interneuron', 'MOTOR NEURONS': 'motor_neuron',
             'BODYWALL MUSCLES': 'muscle', 'OTHER END ORGANS': 'end_organ', 'PHARYNX': 'pharyngeal',
             'SEX-SPECIFIC CELLS': 'sex_specific'}
    scn = np.array([scmap.get(t, t.lower()) for t in ntype], dtype=object)
    types = np.array([typ(n) for n in names], dtype=object)
    names = np.array(names)

    E = [r for r in csv.reader(open(chem_csv)) if r and not r[0].startswith('#')]
    src = np.array([int(r[0]) for r in E]); dst = np.array([int(r[1]) for r in E]); w = np.array([float(r[2]) for r in E])
    W = sp.csr_matrix((w, (src, dst)), shape=(N, N))

    Gi = Gi2 = Gw = None
    if gap_csv:
        Ge = [r for r in csv.reader(open(gap_csv)) if r and not r[0].startswith('#')]
        # gap-junction node table may index differently; remap by name
        gnr = [r for r in csv.reader(open(gap_csv.replace('edges.csv', 'nodes.csv'))) if r and not r[0].startswith('#')]
        gname = {int(r[0]): r[3] for r in gnr}
        remap = {k: int(np.where(names == v)[0][0]) for k, v in gname.items() if v in S}
        gs = np.array([remap[int(r[0])] for r in Ge if int(r[0]) in remap and int(r[1]) in remap])
        gd = np.array([remap[int(r[1])] for r in Ge if int(r[0]) in remap and int(r[1]) in remap])
        gw = np.array([float(r[2]) for r in Ge if int(r[0]) in remap and int(r[1]) in remap])
        G = sp.csr_matrix((gw, (gs, gd)), shape=(N, N))
        G = G + G.T - sp.diags(G.diagonal())            # symmetrise, keep diagonal once
        Gi, Gi2, Gw = G.indptr, G.indices, G.data

    sign = np.zeros(N)
    if nt_csv:
        rel = [r for r in csv.reader(open(nt_csv)) if r and not r[0].startswith('#')]
        ntm = {}
        for r in rel:
            if len(r) >= 3 and r[1].strip() == 'Neurotransmitter' and r[0] in S:
                s = _NT_SIGN.get(r[2].strip().lower())
                if s is not None: ntm[r[0]] = s if r[0] not in ntm else ntm[r[0]]  # first classical NT wins
        sign = np.array([ntm.get(n, 0.0) for n in names])

    sensory = scn == 'sensory'
    motor = np.isin(scn, ['muscle', 'end_organ'])   # pin the true outputs; motor neurons get measured depth
    return dict(name='celegans_herm', N=N, names=names, types=types, scn=scn, cln=types.copy(),
                ntn=np.array([''] * N, dtype=object), side=np.array([_worm_side(n) for n in names], np.int8),
                sign=sign, sensory=sensory, motor=motor,
                indptr=W.indptr, indices=W.indices, weights=W.data,
                gap_indptr=Gi, gap_indices=Gi2, gap_weights=Gw,
                meta=dict(source='Cook et al. 2019 hermaphrodite (corrected Jul 2020), Netzschleuder CSVs',
                          sign_convention='ACh=+1, GABA/Glu=-1, monoamines=0, unknown=0',
                          hop_min_weight=1, nt_coverage='179/302 neurons have a classical-NT assignment; pharyngeal cells mostly unassigned'))


def save_ir(ir, path):
    np.savez_compressed(path, **{k: v for k, v in ir.items() if k != 'meta'},
                        meta_json=np.array([json.dumps(ir['meta'])]))


def load_ir(path):
    z = np.load(path, allow_pickle=False)
    ir = {k: z[k] for k in z.files if k != 'meta_json'}
    ir['meta'] = json.loads(z['meta_json'][0])
    for k in ('names', 'types', 'scn', 'cln', 'ntn'):
        if k in ir: ir[k] = ir[k].astype(object)
    return ir


def csr_of(ir, gap=False):
    if gap and ir['gap_indptr'] is not None:
        return sp.csr_matrix((ir['gap_weights'], ir['gap_indices'], ir['gap_indptr']), shape=(ir['N'], ir['N']))
    return sp.csr_matrix((ir['weights'], ir['indices'], ir['indptr']), shape=(ir['N'], ir['N']))


if __name__ == '__main__':
    # fetch + build the worm IR (data cached under data/ir/)
    import os
    os.makedirs('data/ir', exist_ok=True)
    base = 'data/ir'
    dl = lambda u, p: os.system(f'curl -sL "{u}" -o {p}') if not os.path.exists(p) else None
    for kind in ('chemical_corrected', 'gap_junction_corrected'):
        z = f'{base}/herm_{kind}.zip'; dl(f'https://networks.skewed.de/net/celegans_2019/files/hermaphrodite_{kind}.csv.zip', z)
        os.system(f'unzip -o -q {z} -d {base}/herm_{kind}')
    dl('https://raw.githubusercontent.com/openworm/ConnectomeToolbox/main/cect/data/Modified%20celegans%20db%20dump.csv', f'{base}/nt_dump.csv')
    ir = load_worm(f'{base}/herm_chemical_corrected/edges.csv', f'{base}/herm_gap_junction_corrected/edges.csv', f'{base}/nt_dump.csv')
    W = csr_of(ir)
    from collections import Counter
    print(f"worm: {ir['N']} cells, {W.nnz} chem edges, {int(ir['weights'].sum())} synapses")
    print('superclasses:', Counter(ir['scn']))
    print('signs:', Counter(ir['sign'].tolist()))
    print('types:', len(set(ir['types'])))
    if ir['gap_indptr'] is not None:
        G = csr_of(ir, gap=True); print('gap edges:', G.nnz, 'gap junctions:', int(G.sum()))
