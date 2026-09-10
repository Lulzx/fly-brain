import json, numpy as np, sys
sys.argv = ['x']; exec(open('scripts/gait_opt2.py').read().split("if __name__")[0]); setup()
xd = np.array(json.load(open('body/gait/data_gait.json'))['x'])
def traj(x):  # joint angle trajectories over one cycle, per leg-pair & joint
    P, _, _ = unpack(x); ph = np.linspace(0, 2 * np.pi, 48, endpoint=False)
    return np.array([[off + a1 * np.cos(ph + p1) + a2 * np.cos(2 * ph + p2) for j in J for (off, a1, p1, a2, p2) in [P[(leg, j)]]] for leg in LEGS])
Td = traj(xd)
for name, f in [('synthetic (multi-condition)', 'body/gait/best_multi.json'), ('real-fly anchored', 'body/gait/best_data.json')]:
    x = np.array(json.load(open(f))['x']); rms = np.sqrt(np.mean((traj(x) - Td) ** 2))
    print(f'{name}: RMS joint-angle difference from real flies {np.degrees(rms):.1f} deg')
    for label, kw in [('forward', {}), ('turn left', {'turn': 0.35}), ('turn right', {'turn': -0.35}), ('slow', {'blend': 0.5, 'fscale': 0.5}), ('backward', {'direction': -1.0})]:
        r = run(x, T=1.5, **kw)
        print(f'   {label:11s}', 'FELL' if r is None else f"dx {r['x']:+.2f} dy {r['y']:+.2f} cm, yaw {np.degrees(r['dyaw']):+4.0f} deg, instability {r['stab']:.2f}")
