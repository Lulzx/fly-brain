"""Data-driven step cycle from FlySuite real-fly walking trajectories (flybody joint angles).
For each trajectory: leg phase from the coxa (protraction/retraction) angle via the Hilbert transform; joint angles
averaged over phase bins; fitted with 2 harmonics -> same parameterisation as the stepping pattern generator.
Output: body/gait/data_gait.json (x vector like best.json, phases referenced to the tripod convention)."""
import h5py, numpy as np, json
from scipy.signal import hilbert, butter, filtfilt
f = h5py.File('body/flysuite/walking.hdf5', 'r')
names = [n.decode() if isinstance(n, bytes) else str(n) for n in f['id2name/qpos'][:]]
dt = float(f['timestep_seconds'][()]); print('timestep', dt, 'n qpos', len(names), names[7:12])
J = ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus']; LEGS = ['T1', 'T2', 'T3']; SIDES = ['left', 'right']
col = {n: i for i, n in enumerate(names)}
nb = 24; acc = {(l, s, j): [np.zeros(nb), np.zeros(nb)] for l in LEGS for s in SIDES for j in J}
rel_phase = {(l, s): [] for l in LEGS for s in SIDES}; freqs = []; speeds = []
b, a = butter(2, [4 * 2 * dt, 25 * 2 * dt], btype='band')
for key in f['trajectories']:
    q = f[f'trajectories/{key}/qpos'][:]; rq = f[f'trajectories/{key}/root_qvel'][:]
    if len(q) < 100: continue
    ph = {}
    for l in LEGS:
        for s in SIDES:
            x = q[:, col[f'coxa_{l}_{s}']]; xf = filtfilt(b, a, x - x.mean())
            ph[(l, s)] = np.unwrap(np.angle(hilbert(xf)))
    ref = ph[('T1', 'left')]; fr = np.median(np.diff(ref)) / (2 * np.pi * dt)
    if not (3 < fr < 25): continue
    freqs.append(fr); speeds.append(np.linalg.norm(rq[:, :2], axis=1).mean())
    for l in LEGS:
        for s in SIDES:
            rel_phase[(l, s)].append(np.angle(np.mean(np.exp(1j * (ph[(l, s)] - ref)))))
            bins = ((ph[(l, s)] % (2 * np.pi)) / (2 * np.pi) * nb).astype(int) % nb
            for j in J:
                v = q[:, col[f'{j}_{l}_{s}']]
                np.add.at(acc[(l, s, j)][0], bins, v); np.add.at(acc[(l, s, j)][1], bins, 1)
print(f'used {len(freqs)} trajectories, step frequency median {np.median(freqs):.1f} Hz, speed median {np.median(speeds):.2f} (cm/s?)')
for k, v in rel_phase.items(): print(k, 'phase rel. to L1 = %.0f deg' % np.degrees(np.angle(np.mean(np.exp(1j * np.array(v))))))
# 2-harmonic fit per leg-pair joint (average left and right, phases relative to each leg's own coxa phase)
phi = (np.arange(nb) + 0.5) / nb * 2 * np.pi; x = []
for l in LEGS:
    for j in J:
        ys = [acc[(l, s, j)][0] / np.maximum(1, acc[(l, s, j)][1]) for s in SIDES]; y = np.mean(ys, 0)
        c1 = np.mean(y * np.exp(-1j * phi)) * 2; c2 = np.mean(y * np.exp(-2j * phi)) * 2
        off = y.mean(); a1, p1 = abs(c1), np.angle(c1); a2, p2 = abs(c2), np.angle(c2)
        x += [off, a1, p1, a2, p2]
        print(f'{l} {j:12s} off {off:+.2f} amp1 {a1:.2f} amp2 {a2:.2f}')
x += [0.55, 0.0]   # duty and adhesion phase: refined by the optimiser
json.dump({'x': [float(v) for v in x], 'freq': float(np.median(freqs)), 'joints': J, 'legs': LEGS, 'source': 'FlySuite walking dataset (real flies)'}, open('body/gait/data_gait.json', 'w'))
