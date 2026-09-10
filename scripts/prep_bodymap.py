"""Map connectome neurons onto the flybody body: motor neurons -> actuators (by annotated muscle),
sensory neurons -> body sensors (by annotated modality, receptor, nerve and side).
Output: public/data/bodymap.json (neuron indices refer to the order in neurons.bin)."""
import pyarrow.feather as f, numpy as np, pandas as pd, json
N = int(np.frombuffer(open('public/data/neurons.bin', 'rb').read(8), np.uint32)[0])
ids = np.frombuffer(open('public/data/neurons.bin', 'rb').read(8 + N * 8), np.int64, N, 8)
a = f.read_feather('data/raw/body-annotations-male-cns-v1.0-minconf-0.5.feather').set_index('bodyId').loc[ids].reset_index()
a['idx'] = np.arange(N)
side = a.somaSide.where(a.somaSide.isin(['L', 'R']), a.rootSide.where(a.rootSide.isin(['L', 'R'])))
a['sideLR'] = side.map({'L': 'left', 'R': 'right'})
LEG = {'fl': 'T1', 'ml': 'T2', 'hl': 'T3'}

# ---- motor: muscle name -> (joint actuator suffix, direction) ----
# direction +1 drives the flybody joint toward +angle; conventions measured in scripts (see PLAN.md):
# femur +: depression (trochanter extension) | tibia +: extension | coxa +: promotion | coxa_abduct +: adduction
# coxa_twist +: anterior rotation | femur_twist +: reduction (posterior rotation) | tarsus +: levation
LEG_MUSCLES = {
    'Tr extensor MN': [('femur', +1)], 'Sternotrochanter MN': [('femur', +1)], 'Tergotr. MN': [('femur', +1)],
    'Tr flexor MN': [('femur', -1)], 'Acc. tr flexor MN': [('femur', -1)],
    'Ti extensor MN': [('tibia', +1)], 'Ti flexor MN': [('tibia', -1)], 'Acc. ti flexor MN': [('tibia', -1)],
    'Tergopleural/Pleural promotor MN': [('coxa', +1)],
    'Pleural remotor/abductor MN': [('coxa', -1), ('coxa_abduct', -1)],
    'Sternal adductor MN': [('coxa_abduct', +1)],
    'Sternal anterior rotator MN': [('coxa_twist', +1)], 'Sternal posterior rotator MN': [('coxa_twist', -1)],
    'Fe reductor MN': [('femur_twist', +1)],
    'Ta levator MN': [('tarsus', +1)], 'Ta depressor MN': [('tarsus', -1)],
    'ltm MN': [('tarsus2', -1), ('adhere_claw', +1)], 'ltm1-tibia MN': [('tarsus2', -1), ('adhere_claw', +1)],
    'ltm2-femur MN': [('tarsus2', -1), ('adhere_claw', +1)],
}
muscles = []   # {name, actuator, dir, idx[]}
def add(name, act, d, idx):
    if len(idx): muscles.append({'name': name, 'actuator': act, 'dir': d, 'idx': [int(i) for i in idx]})
mn = a[a.superclass.isin(['vnc_motor', 'cb_motor'])]
unmapped = []
for (sub, typ, sd), g in mn.groupby(['subclass', 'type', 'sideLR']):
    if sub in LEG and typ in LEG_MUSCLES:
        for j, d in LEG_MUSCLES[typ]:
            act = f'adhere_claw_{LEG[sub]}_{sd}' if j == 'adhere_claw' else f'{j}_{LEG[sub]}_{sd}'
            add(f'{typ} {LEG[sub]} {sd}', act, d, g.idx)
    elif sub == 'pm':
        # proboscis motor neurons (Hampel/McKellar nomenclature): MN9 rostrum protractor, MN11/12 haustellum,
        # MN6-8 labellar spreading; MN1-5 retract. Signs verified in scripts/proboscis_test.py.
        if typ == 'MN9': add('MN9 rostrum protractor', 'rostrum', -1, g.idx)
        elif typ in ('MN11D', 'MN11V', 'MN12D'): add(f'{typ} haustellum extensor', 'haustellum', -1, g.idx)
        elif typ in ('MN6', 'MN7', 'MN8'): add(f'{typ} labellum', f'labrum_{sd}', +1, g.idx)
        elif typ in ('MN1', 'MN2Da', 'MN2Db', 'MN2V', 'MN3L', 'MN3M', 'MN4a', 'MN4b', 'MN5'):
            add(f'{typ} proboscis retractor', 'rostrum', +1, g.idx)
        else: unmapped.append((sub, typ, sd, len(g)))
    elif sub == 'am': add(f'{typ} antenna', f'antenna_{sd}', +1, g.idx)
    else: unmapped.append((sub, typ, sd, len(g)))
# wing: asynchronous power muscles set wingbeat drive; steering muscles modulate per-side amplitude/fold
wing = {'power': [int(i) for i in mn[mn.type.str.match(r'^(DLMn|DVMn)', na=False)].idx]}
for sd in ('left', 'right'):
    w = mn[(mn.subclass == 'wm') & (mn.sideLR == sd)]
    wing[f'ampUp_{sd}'] = [int(i) for i in w[w.type.isin(['b1 MN', 'b3 MN', 'iii3 MN'])].idx]   # basalar/iii: stroke amplitude up
    wing[f'ampDown_{sd}'] = [int(i) for i in w[w.type.isin(['i1 MN', 'i2 MN', 'b2 MN', 'iii1 MN'])].idx]
    wing[f'unfold_{sd}'] = [int(i) for i in w[w.type.isin(['tp1 MN', 'tp2 MN', 'tpn MN', 'ps1 MN', 'ps2 MN', 'hg1 MN', 'hg2 MN', 'hg3 MN', 'hg4 MN'])].idx]
jump = [int(i) for i in mn[mn.type == 'TTMn'].idx]
feeding = [int(i) for i in mn[mn.type.isin(['CEM', 'MNx01', 'MNx02', 'MNx03', 'MNx04', 'MNx05', 'MN10', 'MN11V', 'MN13'])].idx]

# ---- sensory channels ----
sens = []
def sadd(name, kind, idx, **kw):
    idx = [int(i) for i in idx]
    if idx: sens.append({'name': name, 'kind': kind, 'idx': idx, **kw})
S = a[a.superclass.fillna('').str.contains('sensory')]
nerve_leg = {'ProLN': 'T1', 'MesoLN': 'T2', 'MetaLN': 'T3'}
for sd in ('left', 'right'):
    s = S[S.sideLR == sd]
    for nerve, leg in nerve_leg.items():
        L = s[s.entryNerve == nerve]
        sadd(f'tactile {leg} {sd}', 'contact', L[L['class'] == 'mechanosensory_tactile'].idx, site=f'claw_{leg}_{sd}')
        sadd(f'taste {leg} {sd}', 'tarsal_taste', L[L['class'] == 'gustatory'].idx, site=f'claw_{leg}_{sd}')
        P = L[L['class'] == 'mechanosensory_proprioceptive']
        sub = P.subclass.fillna('')
        sadd(f'chordotonal {leg} {sd}', 'joint_angle', P[sub.str.contains('chordotonal')].idx, joint=f'tibia_{leg}_{sd}')
        sadd(f'hair plate {leg} {sd}', 'joint_angle', P[sub.str.contains('hair plate')].idx, joint=f'coxa_{leg}_{sd}')
        sadd(f'campaniform {leg} {sd}', 'load', P[sub.str.contains('campaniform')].idx, sensor=f'force_tarsus_{leg}_{sd}')
    sadd(f'labellar taste {sd}', 'labellar_taste', s[(s['class'] == 'gustatory') & s.subclass.fillna('').str.contains('labellar|taste peg')].idx)
    sadd(f'pharyngeal taste {sd}', 'pharyngeal_taste', s[(s['class'] == 'gustatory') & s.subclass.fillna('').str.contains('pharyngeal')].idx)
    sadd(f'wing/notum bristles {sd}', 'body_contact', s[(s['class'] == 'mechanosensory_tactile') & s.entryNerve.isin(['ADMN', 'PDMN', 'DMetaN'])].idx)
    sadd(f'haltere {sd}', 'gyro', s[s['class'].isin(['mechanosensory_proprioceptive']) & (s.entryNerve == 'DMetaN')].idx)
    jo = s[s.type.fillna('').str.startswith('JO-')]
    sadd(f'JO wind/gravity {sd}', 'antenna_wind', jo[jo.subclass.fillna('').str.contains('wind_gravity')].idx)
    sadd(f'JO auditory {sd}', 'sound', jo[jo.subclass.fillna('') == 'auditory'].idx)
    sadd(f'thermosensory {sd}', 'temperature', s[s['class'] == 'thermosensory'].idx)
    sadd(f'hygrosensory {sd}', 'humidity', s[s['class'] == 'hygrosensory'].idx)
# olfactory receptor neurons per glomerulus; ORNs project bilaterally, so unknown side -> both antennae
orn = S[S['class'] == 'olfactory']
for typ, g in orn.groupby('type'):
    for sd in ('left', 'right'):
        gi = g[(g.sideLR == sd) | g.sideLR.isna()]
        sadd(f'{typ} {sd}', 'odor', gi.idx, glomerulus=typ.replace('ORN_', ''), antenna=sd)

out = {'muscles': muscles, 'wing': wing, 'jump': jump, 'feeding': feeding, 'sensors': sens,
       'unmappedMotor': [{'subclass': u[0], 'type': u[1], 'side': u[2], 'n': u[3]} for u in unmapped]}
json.dump(out, open('public/data/bodymap.json', 'w'))
print('muscle groups', len(muscles), 'motor neurons mapped', sum(len(m['idx']) for m in muscles), '| unmapped types', len(unmapped))
print('sensor channels', len(sens), 'sensory neurons mapped', len({i for s in sens for i in s['idx']}))
print('wing', {k: len(v) for k, v in wing.items()}, 'jump', len(jump), 'feeding', len(feeding))
print('unmapped subclasses', pd.Series([u[0] for u in unmapped]).value_counts().to_dict())

# ---- photoreceptor viewing directions ----
# Each photoreceptor axon enters the optic lobe at the lamina; its most lateral skeleton point marks the
# ommatidium's position in the retinotopic sheet. Fitting a sphere per eye to these points, the outward
# direction from the sphere centre approximates the ommatidial optical axis. EM axes: +x = fly's left,
# -y = dorsal, -z = anterior (verified from optic lobe/VNC positions).
import struct, os
def read_sk(b):
    p = f'data/skeletons/{b}'
    if not os.path.exists(p): return None
    x = open(p, 'rb').read(); nv, ne = struct.unpack('<II', x[:8])
    return np.frombuffer(x, np.float32, nv * 3, 8).reshape(-1, 3) if nv else None
def fit_sphere(P):
    A = np.c_[2 * P, np.ones(len(P))]; bb = (P ** 2).sum(1)
    c, *_ = np.linalg.lstsq(A, bb, rcond=None); return c[:3], np.sqrt(c[3] + (c[:3] ** 2).sum())
PR = a[a.type.fillna('').str.match(r'^R[1-8]')]
eyes = []
for sd, lat in (('left', +1), ('right', -1)):
    rows, pts = [], []
    for i, b in zip(PR[PR.sideLR == sd].idx, PR[PR.sideLR == sd].bodyId):
        v = read_sk(b)
        if v is None: continue
        pts.append(v[np.argmax(v[:, 0] * lat)]); rows.append(int(i))
    P = np.array(pts, np.float64)
    c, rad = fit_sphere(P)
    for it in range(3):  # robust refit
        res = np.abs(np.linalg.norm(P - c, axis=1) - rad); keep = res < 3 * np.median(res) + 1
        c, rad = fit_sphere(P[keep])
    d = P - c; d /= np.linalg.norm(d, axis=1, keepdims=True)
    # to fly body frame: x forward, y left, z up
    fwd, left, up = -d[:, 2], d[:, 0], -d[:, 1]
    az = np.degrees(np.arctan2(left, fwd)); el = np.degrees(np.arcsin(np.clip(up, -1, 1)))
    typ = a.type.to_numpy()[rows]
    # the lamina is flatter than the retina and the brain is slightly yawed in the EM volume: keep the
    # retinotopic ordering but rescale each eye onto the measured Drosophila field of view
    # (azimuth ~ -10 (frontal overlap) .. 165 deg posterior, elevation ~ -60 .. +70 deg)
    def remap(x, lo, hi):
        p0, p1 = np.percentile(x, 2), np.percentile(x, 98); return lo + (np.clip(x, p0, p1) - p0) / (p1 - p0) * (hi - lo)
    az = remap(np.abs(az), -10, 165) * lat; el = remap(el, -60, 70)
    eyes.append({'side': sd, 'idx': rows, 'az': np.round(az, 2).tolist(), 'el': np.round(el, 2).tolist(),
                 'kind': ['R1-6' if t == 'R1-R6' else ('R7' if t.startswith('R7') else 'R8') for t in typ]})
    print(f'eye {sd}: {len(rows)} photoreceptors, sphere r={rad/1000:.0f}um, azimuth {np.percentile(az,2):.0f}..{np.percentile(az,98):.0f} deg, elevation {np.percentile(el,2):.0f}..{np.percentile(el,98):.0f} deg')
out['eyes'] = eyes
json.dump(out, open('public/data/bodymap.json', 'w'))
