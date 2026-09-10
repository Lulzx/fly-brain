import json, sys, numpy as np
src = sys.argv[1] if len(sys.argv) > 1 else 'body/gait/best.json'
b = json.load(open(src)); x = b['x']; J = b['joints']; L = b['legs']; k = 0; params = {}
for leg in L:
    params[leg] = {}
    for j in J: params[leg][j] = x[k:k + 5]; k += 5
out = {'freq': b['freq'], 'joints': J, 'params': params, 'duty': float(np.clip(x[k], 0.3, 0.8)), 'adhPhase': x[k + 1], 'score': b['score'], 'source': src}
json.dump(out, open('public/body/gait.json', 'w'), indent=1); print('exported', src, 'score', b['score'])
