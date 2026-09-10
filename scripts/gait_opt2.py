"""Multi-condition refinement of the stepping pattern generator, matching src/sim/motor.js exactly:
q_joint = blend * (off + a1 cos(phi+p1) + a2 cos(2phi+p2)); coxa oscillation scaled by steer = 1 + turn*(-1 left / +1 right)
(turn > 0 = left descending neurons more active = turn left). Conditions: straight forward, left/right turns,
slow walking (blend 0.5, 0.75x frequency) and backward walking (phase reversed). Starts from body/gait/best.json."""
import mujoco, numpy as np, json, sys, cma, multiprocessing as mp, time
XML = open('public/body/fly_physics.xml').read().replace('<worldbody>', '<worldbody>\n<geom name="floor" type="plane" size="30 30 .1" pos="0 0 -.132" friction="1" solref="0.0002 1"/>', 1)
J = ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus']; LEGS = ['T1', 'T2', 'T3']; SIDES = ['left', 'right']
PH = {('T1', 'left'): 0, ('T2', 'right'): 0, ('T3', 'left'): 0, ('T1', 'right'): np.pi, ('T2', 'left'): np.pi, ('T3', 'right'): np.pi}
FREQ = 10.0; m = d = None
def setup():
    global m, d, act, rng, th, LB, floor
    m = mujoco.MjModel.from_xml_string(XML); d = mujoco.MjData(m); act = {}; rng = {}
    for leg in LEGS:
        for sd in SIDES:
            for j in J: a = m.actuator(f'{j}_{leg}_{sd}').id; act[(leg, sd, j)] = a; rng[(leg, sd, j)] = m.actuator_ctrlrange[a].copy()
            act[(leg, sd, 'adh')] = m.actuator(f'adhere_claw_{leg}_{sd}').id
    th = m.body('thorax').id; floor = m.geom('floor').id
    LB = set(i for i in range(m.nbody) if any(k in m.body(i).name for k in ('claw', 'tarsus')))
def unpack(x):
    P = {}; k = 0
    for leg in LEGS:
        for j in J: P[(leg, j)] = x[k:k + 5]; k += 5
    return P, float(np.clip(x[k], 0.3, 0.8)), x[k + 1]
def run(x, T=1.2, blend=1.0, turn=0.0, direction=1.0, fscale=1.0):
    if m is None: setup()
    mujoco.mj_resetData(m, d); P, duty, adhph = unpack(x); phase = 0.0
    n = int(T / m.opt.timestep); zs = []; sup = 0; ns = 0; tilt = 0; bodyc = 0; yaws = []
    for s in range(n):
        if s % 10 == 0:
            phase += direction * 2 * np.pi * FREQ * (0.5 + 0.5 * fscale) * 0.001
            for leg in LEGS:
                for sd in SIDES:
                    phi = phase + PH[(leg, sd)]; steer = 1 + turn * (-1 if sd == 'left' else 1)
                    for j in J:
                        off, a1, p1, a2, p2 = P[(leg, j)]; q = a1 * np.cos(phi + p1) + a2 * np.cos(2 * phi + p2)
                        if j == 'coxa': q *= steer
                        lo, hi = rng[(leg, sd, j)]; d.ctrl[act[(leg, sd, j)]] = np.clip(blend * (off + q), lo, hi)
                    st = ((phi + adhph) % (2 * np.pi)) < 2 * np.pi * duty
                    d.ctrl[act[(leg, sd, 'adh')]] = 1.0 if st else 0.0
        mujoco.mj_step(m, d)
        if s % 50 == 0 and s > 1500:
            ns += 1; R = d.xmat[th].reshape(3, 3)
            if R[2, 2] < 0.5 or not np.isfinite(d.qpos).all(): return None
            tilt += max(0, 0.95 - R[2, 2]); zs.append(d.xpos[th][2]); yaws.append(np.arctan2(R[1, 0], R[0, 0]))
            feet = set()
            for c in range(d.ncon):
                con = d.contact[c]
                if con.geom1 == floor or con.geom2 == floor:
                    b = m.geom_bodyid[con.geom2 if con.geom1 == floor else con.geom1]
                    if b in LB: feet.add(m.body(b).name.split('_', 1)[1])
                    else: bodyc += 1
            sup += max(0, 3 - len(feet))
    yaw = np.unwrap(np.array(yaws)); R = d.xmat[th].reshape(3, 3)
    return dict(x=d.xpos[th][0], y=d.xpos[th][1], dyaw=float(yaw[-1] - yaw[0]), dur=(n - 1500) * m.opt.timestep,
                stab=2 * tilt / ns + 1.5 * sup / ns + 30 * float(np.std(zs)) + bodyc / ns)
def score(x):
    tot = 0
    f = run(x);  tot += -5 if f is None else min(f['x'], 3.0 * f['dur']) - 0.8 * abs(f['dyaw']) - f['stab']
    for sgn in (1, -1):
        t = run(x, turn=0.35 * sgn)
        tot += -3 if t is None else 0.5 * np.clip(sgn * t['dyaw'], -1, 1.2) - t['stab']        # ~ +70 deg/s yaw in commanded direction
    s = run(x, blend=0.5, fscale=0.5); tot += -3 if s is None else 0.5 * min(s['x'], 1.5 * s['dur']) - s['stab']
    b = run(x, direction=-1.0); tot += -3 if b is None else 0.5 * min(-b['x'], 1.5 * b['dur']) - b['stab']
    return float(tot)
XDATA = None; LAM = 0.0
def score_reg(x):
    s = score(x)
    if XDATA is not None: s -= LAM * float(np.sum((np.asarray(x[:-2]) - XDATA[:-2]) ** 2))   # stay near real-fly kinematics
    return s
if __name__ == '__main__':
    iters = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    src = sys.argv[2] if len(sys.argv) > 2 else 'body/gait/best.json'
    x0 = np.array(json.load(open(src))['x'])
    if 'data_gait' in src: XDATA = x0.copy(); LAM = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
    pool = mp.Pool(mp.cpu_count(), initializer=setup)
    print('start score', pool.apply(score, (x0,)), 'regularised', pool.apply(score_reg, (x0,)), flush=True)
    es = cma.CMAEvolutionStrategy(x0, 0.05, {'popsize': 24, 'seed': 5, 'verbose': -9}); best = (-1e9, None); t0 = time.time()
    for it in range(iters):
        X = es.ask(); F = pool.map(score_reg, X); es.tell(X, [-f for f in F]); i = int(np.argmax(F))
        if F[i] > best[0]: best = (F[i], X[i]); json.dump({'x': list(map(float, X[i])), 'score': float(F[i]), 'freq': FREQ, 'joints': J, 'legs': LEGS}, open('body/gait/best_data.json' if XDATA is not None else 'body/gait/best_multi.json', 'w'))
        print(f'iter {it} best {best[0]:.3f} gen-best {max(F):.3f} ({time.time()-t0:.0f}s)', flush=True)
