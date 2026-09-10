"""Optimise a tripod stepping pattern for the flybody fly (position-servo joints + claw adhesion).
Each leg joint follows q(phi) = off + a1*cos(phi + p1) + a2*cos(2*phi + p2), mirrored left/right.
Tripod: (L1,R2,L3) at phase 0, (R1,L2,R3) at phase pi. Stance = first half of cycle (adhesion on).
Objective: forward distance in 1.5 s, penalising tilt, falls and lateral drift."""
import mujoco, numpy as np, json, sys, cma, multiprocessing as mp, time
XML = open('public/body/fly_physics.xml').read().replace('<worldbody>', '<worldbody>\n<geom name="floor" type="plane" size="20 20 .1" pos="0 0 -.132" friction="1" solref="0.0002 1"/>', 1)
JOINTS = ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus']
LEGS = ['T1', 'T2', 'T3']; SIDES = ['left', 'right']
PHASE = {('T1', 'left'): 0, ('T2', 'right'): 0, ('T3', 'left'): 0, ('T1', 'right'): np.pi, ('T2', 'left'): np.pi, ('T3', 'right'): np.pi}
NP = len(LEGS) * len(JOINTS) * 5 + 2   # per leg pair & joint: off,a1,p1,a2,p2 ; + adhesion duty, adhesion phase
FREQ = 10.0; T = 1.6
m = d = None
def setup():
    global m, d, act, jr, th
    m = mujoco.MjModel.from_xml_string(XML); d = mujoco.MjData(m)
    act = {}; jr = {}
    for leg in LEGS:
        for sd in SIDES:
            for j in JOINTS:
                a = m.actuator(f'{j}_{leg}_{sd}').id; act[(leg, sd, j)] = a; jr[(leg, sd, j)] = m.actuator_ctrlrange[a].copy()
            act[(leg, sd, 'adh')] = m.actuator(f'adhere_claw_{leg}_{sd}').id
    th = m.body('thorax').id
def unpack(x):
    P = {}; k = 0
    for leg in LEGS:
        for j in JOINTS: P[(leg, j)] = x[k:k + 5]; k += 5
    return P, x[k], x[k + 1]
def ctrl_at(P, duty, adhph, phi_leg, leg, sd):
    out = {}
    for j in JOINTS:
        off, a1, p1, a2, p2 = P[(leg, j)]
        q = off + a1 * np.cos(phi_leg + p1) + a2 * np.cos(2 * phi_leg + p2)
        lo, hi = jr[(leg, sd, j)]; out[j] = float(np.clip(q, lo, hi))
    stance = ((phi_leg + adhph) % (2 * np.pi)) < 2 * np.pi * np.clip(duty, 0.3, 0.8)
    out['adh'] = 1.0 if stance else 0.0
    return out
LEGBODIES = None
def evaluate(x, freq=FREQ, T=T, turn=0.0, direction=1.0, record=False):
    global LEGBODIES
    if m is None: setup()
    if LEGBODIES is None:
        LEGBODIES = set(i for i in range(m.nbody) if any(k in m.body(i).name for k in ('claw', 'tarsus')))
    mujoco.mj_resetData(m, d)
    P, duty, adhph = unpack(x)
    nsteps = int(T / m.opt.timestep); ctrl_every = 10
    floor = m.geom('floor').id
    tilt_pen = 0; zs = []; support_pen = 0; body_contact = 0; nsamp = 0; traj = []
    for s in range(nsteps):
        if s % ctrl_every == 0:
            t = d.time; phi = direction * 2 * np.pi * freq * t
            for leg in LEGS:
                for sd in SIDES:
                    amp = 1 + turn * (1 if sd == 'left' else -1)
                    c = ctrl_at(P, duty, adhph, phi + PHASE[(leg, sd)], leg, sd)
                    if amp != 1:
                        off = P[(leg, 'coxa')][0]; c['coxa'] = off + amp * (c['coxa'] - off)
                    for j in JOINTS: d.ctrl[act[(leg, sd, j)]] = c[j]
                    d.ctrl[act[(leg, sd, 'adh')]] = c['adh']
        mujoco.mj_step(m, d)
        if s % 50 == 0 and s > 1000:   # score after 0.1 s settling
            nsamp += 1
            R = d.xmat[th].reshape(3, 3); up = R[2, 2]
            tilt_pen += max(0, 0.95 - up); zs.append(d.xpos[th][2])
            feet = set()
            for c in range(d.ncon):
                con = d.contact[c]
                if con.geom1 == floor or con.geom2 == floor:
                    b = m.geom_bodyid[con.geom2 if con.geom1 == floor else con.geom1]
                    if b in LEGBODIES: feet.add(m.body(b).name.split('_', 1)[1])   # e.g. T1_left
                    else: body_contact += 1
            support_pen += max(0, 3 - len(feet))
            if record: traj.append([d.time, *d.xpos[th], len(feet)])
            if up < 0.5 or not np.isfinite(d.qpos).all(): return (-5.0, traj) if record else -5.0
    fwd = d.xpos[th][0]; lat = abs(d.xpos[th][1])
    speed_cap = 3.0 * (T - 0.1)                           # cm: realistic top walking speed ~3 cm/s
    score = min(fwd, speed_cap) - 0.5 * lat - 2 * tilt_pen / nsamp - 1.5 * support_pen / nsamp \
            - 30 * float(np.std(zs)) - 0.02 * body_contact / nsamp * 50
    return (score, traj) if record else score
def x0():
    x = []
    for leg in LEGS:
        for j in JOINTS:
            amp = {'coxa': 0.25, 'femur': 0.2, 'tibia': 0.25, 'tarsus': 0.1}.get(j, 0.0)
            x += [0.0, amp, 0.0, 0.0, 0.0]
    return np.array(x + [0.5, 0.0])
if __name__ == '__main__':
    iters = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    es = cma.CMAEvolutionStrategy(x0(), 0.15, {'popsize': 32, 'seed': 3, 'verbose': -9})
    pool = mp.Pool(mp.cpu_count(), initializer=setup)
    best = (-1e9, None); t0 = time.time()
    for it in range(iters):
        X = es.ask(); F = pool.map(evaluate, X); es.tell(X, [-f for f in F])
        i = int(np.argmax(F))
        if F[i] > best[0]: best = (F[i], X[i]); json.dump({'x': list(map(float, X[i])), 'score': float(F[i]), 'freq': FREQ, 'joints': JOINTS, 'legs': LEGS}, open('body/gait/best.json', 'w'))
        print(f'iter {it} best {best[0]:.3f} gen-best {max(F):.3f} mean {np.mean(F):.3f} ({time.time()-t0:.0f}s)', flush=True)
