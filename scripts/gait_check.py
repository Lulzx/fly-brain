import json, numpy as np, sys
sys.argv = ['x']; exec(open('scripts/gait_opt.py').read().split("if __name__")[0]); setup()
b = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'body/gait/best.json')); x = np.array(b['x'])
for label, kw in [('forward', {}), ('turn +0.4', {'turn': 0.4}), ('turn -0.4', {'turn': -0.4}), ('backward', {'direction': -1.0}), ('slow 6Hz', {'freq': 6.0})]:
    sc, tr = evaluate(x, T=2.0, record=True, **kw); tr = np.array(tr)
    if len(tr) < 5: print(label, 'FELL', sc); continue
    th_ = m.body('thorax').id; R = d.xmat[th_].reshape(3, 3); yaw = np.degrees(np.arctan2(R[1, 0], R[0, 0]))
    dist = np.hypot(*(tr[-1, 1:3] - tr[0, 1:3])); dur = tr[-1, 0] - tr[0, 0]
    print(f'{label:10s} score {sc:+.2f} | speed {dist/dur:.2f} cm/s | final xy {tr[-1,1]:+.2f},{tr[-1,2]:+.2f} yaw {yaw:+.0f} deg | z mean {tr[:,3].mean():+.3f} sd {tr[:,3].std():.4f} | feet on ground mean {tr[:,4].mean():.1f} min {tr[:,4].min():.0f}')
