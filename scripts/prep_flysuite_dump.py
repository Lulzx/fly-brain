#!/usr/bin/env python3
"""Dump FlySuite walking trajectories to flat binary for the S2 premotor fit.

Per trajectory: qpos (all 102 DOF, needed to pose the flybody for mj_inverse), root_qpos,
root_qvel, and root2site (the six claw positions, needed for contact flags). Emits
public/data/flysuite_frames.bin (Float32 little-endian) + flysuite_frames.json (layout meta).

  python3 scripts/prep_flysuite_dump.py
"""
import h5py, numpy as np, json, os

f = h5py.File('body/flysuite/walking.hdf5', 'r')
names = [n.decode() if isinstance(n, bytes) else str(n) for n in f['id2name/qpos'][:]]
sites = [n.decode() if isinstance(n, bytes) else str(n) for n in f['id2name/sites'][:]]
dt = float(f['timestep_seconds'][()])

trajs = []
blob = []
for key in sorted(f['trajectories']):
    g = f[f'trajectories/{key}']
    q = np.asarray(g['qpos'][:], np.float32)
    qv = np.asarray(g['qvel'][:], np.float32)
    rp = np.asarray(g['root_qpos'][:], np.float32)
    rv = np.asarray(g['root_qvel'][:], np.float32)
    st = np.asarray(g['root2site'][:], np.float32)
    T = q.shape[0]
    if T < 50:
        continue
    trajs.append({'key': key, 'T': T})
    blob += [q, qv, rp, rv, st]

data = np.concatenate([b.ravel() for b in blob])
os.makedirs('public/data', exist_ok=True)
data.tofile('public/data/flysuite_frames.bin')
json.dump({
    'version': 1, 'dt': dt, 'qposNames': names, 'sites': sites,
    'nq': 102, 'nroot': 7, 'nrootvel': 6, 'nsites': 6,
    'trajectories': trajs,
    'layout': 'per trajectory: qpos T*102, qvel T*102, root_qpos T*7, root_qvel T*6, root2site T*18, concatenated',
    'source': 'FlySuite walking dataset (body/flysuite/walking.hdf5)',
}, open('public/data/flysuite_frames.json', 'w'), indent=1)
print(f'{len(trajs)} trajectories, {data.size} floats -> public/data/flysuite_frames.bin')
