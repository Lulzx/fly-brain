import mujoco, numpy as np, itertools, json, sys
sys.argv = ['x']; exec(open('scripts/gait_opt2.py').read().split("if __name__")[0])
XML2 = XML.replace('timestep="0.0001"', 'timestep="0.0002"').replace('noslip_iterations="3"', 'noslip_iterations="0"')
m = mujoco.MjModel.from_xml_string(XML2); d = mujoco.MjData(m); globals().update(m=m, d=d)
act = {}; rng = {}
for leg in LEGS:
    for sd in SIDES:
        for j in J + ['tarsus2']: a = m.actuator(f'{j}_{leg}_{sd}').id; act[(leg, sd, j)] = a; rng[(leg, sd, j)] = m.actuator_ctrlrange[a].copy()
        act[(leg, sd, 'adh')] = m.actuator(f'adhere_claw_{leg}_{sd}').id
th = m.body('thorax').id
x = np.array(json.load(open('body/gait/best_multi.json' if len(sys.argv) < 2 else sys.argv[1]))['x'])
P, duty, adhph = unpack(x)
def walk_ctrl(phase, blend=0.4, turn=0.0):
    for leg in LEGS:
        for sd in SIDES:
            phi = phase + PH[(leg, sd)]
            for j in J:
                off, a1, p1, a2, p2 = P[(leg, j)]; q = a1 * np.cos(phi + p1) + a2 * np.cos(2 * phi + p2)
                if j == 'coxa': q *= 1 + turn * (-1 if sd == 'left' else 1)
                lo, hi = rng[(leg, sd, j)]; d.ctrl[act[(leg, sd, j)]] = np.clip(blend * (off + q), lo, hi)
            d.ctrl[act[(leg, sd, 'adh')]] = 1.0 if ((phi + adhph) % (2 * np.pi)) < 2 * np.pi * duty else 0.0
def trial(prog, walk_ms, blend=1.0, turn=0.0):
    mujoco.mj_resetData(m, d); phase = 0.0; dtms = m.opt.timestep * 1000
    for s in range(int(walk_ms / dtms)): phase += 2 * np.pi * 9.5 * m.opt.timestep; walk_ctrl(phase, blend, turn); mujoco.mj_step(m, d)
    minup = 1; t0 = d.time; z0 = d.xpos[th][2]; maxz = z0
    for s in range(int(600 / dtms)):
        tms = (d.time - t0) * 1000 - prog.get('pre', 0)
        for leg in LEGS:
            for sd in SIDES:
                if tms < 0:
                    for j in J + ['tarsus2']: d.ctrl[act[(leg, sd, j)]] = 0
                    d.ctrl[act[(leg, sd, 'adh')]] = 0.8
                elif tms < prog['push']:
                    for j in J + ['tarsus2']: d.ctrl[act[(leg, sd, j)]] = 0
                    if leg == 'T2': d.ctrl[act[(leg, sd, 'femur')]] = rng[(leg, sd, 'femur')][1] * prog['f2']; d.ctrl[act[(leg, sd, 'tibia')]] = rng[(leg, sd, 'tibia')][1] * prog['t2']
                    if leg == 'T3': d.ctrl[act[(leg, sd, 'femur')]] = rng[(leg, sd, 'femur')][1] * prog['f3']
                    if leg == 'T1': d.ctrl[act[(leg, sd, 'femur')]] = rng[(leg, sd, 'femur')][1] * prog['f1']
                    d.ctrl[act[(leg, sd, 'adh')]] = 0
                else:
                    for j in J + ['tarsus2']: d.ctrl[act[(leg, sd, j)]] = 0
                    d.ctrl[act[(leg, sd, 'adh')]] = 0.0 if tms < prog['push'] + prog['fly'] else 0.8
        mujoco.mj_step(m, d); minup = min(minup, d.xmat[th].reshape(3, 3)[2, 2]); maxz = max(maxz, d.xpos[th][2])
    return minup, d.xmat[th].reshape(3, 3)[2, 2], maxz - z0
res = []
for pre, push, f2, t2, f3 in itertools.product([0, 30, 60], [20], [0.7, 1.0], [0.5, 1.0], [0.0, 0.4]):
    prog = dict(pre=pre, push=push, f2=f2, t2=t2, f3=f3, f1=0.5, fly=80); ok = 0; worst = 1; hs = []
    for w in [100, 137, 174, 211, 248, 285, 322, 359]:
        for turn in (0.0, 0.5, -0.5):
            mu, fu, h = trial(prog, w, 1.0, turn); ok += fu > 0.8; worst = min(worst, mu); hs.append(h)
    res.append((ok, float(np.min(hs)), worst, prog))
res.sort(key=lambda r: (r[0], r[1]), reverse=True)
for r in res[:6]: print(f'upright {r[0]}/24, min hop height {r[1]*10:.2f} mm, worst tilt up={r[2]:.2f}', r[3])
json.dump(res[0][3], open('body/gait/jump.json', 'w'))
