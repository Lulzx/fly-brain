import mujoco, numpy as np, itertools, json
xml = open('public/body/fly_physics.xml').read().replace('<worldbody>', '<worldbody>\n<geom name="floor" type="plane" size="30 30 .1" pos="0 0 0" friction="1" solref="0.0002 1"/>', 1).replace('timestep="0.0001"', 'timestep="0.0002"').replace('noslip_iterations="3"', 'noslip_iterations="0"')
m = mujoco.MjModel.from_xml_string(xml); d = mujoco.MjData(m); th = m.body('thorax').id
A = lambda n: m.actuator(n).id; R = lambda n: m.actuator_ctrlrange[A(n)]
LEGS = ['T1', 'T2', 'T3']; SIDES = ['left', 'right']
def flip(roll):
    mujoco.mj_resetData(m, d); q = np.zeros(4); mujoco.mju_axisAngle2Quat(q, np.array([1., 0, 0]), roll); d.qpos[2] = 0.12; d.qpos[3:7] = q
    for _ in range(1500): mujoco.mj_step(m, d)   # settle on its back
def run(prog):
    t0 = d.time
    for s in range(int(1.5 / m.opt.timestep)):
        t = d.time - t0; ph = 2 * np.pi * prog['f'] * t
        for i, leg in enumerate(LEGS):
            for sd in SIDES:
                side_amp = prog['aL'] if sd == 'left' else prog['aR']
                lph = ph + (0 if (leg, sd) in [('T1', 'left'), ('T2', 'right'), ('T3', 'left')] else np.pi)
                d.ctrl[A(f'coxa_{leg}_{sd}')] = np.clip(side_amp * np.sin(lph) * R(f'coxa_{leg}_{sd}')[1], *R(f'coxa_{leg}_{sd}'))
                d.ctrl[A(f'femur_{leg}_{sd}')] = np.clip(side_amp * (0.5 + 0.5 * np.sin(lph + prog['p'])) * R(f'femur_{leg}_{sd}')[1], *R(f'femur_{leg}_{sd}'))
                d.ctrl[A(f'tibia_{leg}_{sd}')] = np.clip(prog['tib'] * R(f'tibia_{leg}_{sd}')[1], *R(f'tibia_{leg}_{sd}'))
                d.ctrl[A(f'coxa_abduct_{leg}_{sd}')] = R(f'coxa_abduct_{leg}_{sd}')[0] * prog['abd'] * (1 if sd == 'left' else 0.2)
                d.ctrl[A(f'adhere_claw_{leg}_{sd}')] = 1.0 if np.sin(lph) > 0 else 0.0
        # unilateral wing push against the substrate (left wing), oscillating
        for ax, val in (('yaw', prog['wy']), ('roll', prog['wr']), ('pitch', prog['wp'])):
            d.ctrl[A(f'wing_{ax}_left')] = val * prog['ws'] * (0.5 + 0.5 * np.sin(2 * np.pi * prog['wf'] * t))
        mujoco.mj_step(m, d)
        if d.xmat[th].reshape(3, 3)[2, 2] > 0.8 and t > 0.05: break
    else: return None
    # program off: standing posture; must stay upright for 0.5 s
    tr = d.time
    for i in range(m.nu): d.ctrl[i] = 0.8 if m.actuator(i).name.startswith('adhere') else 0.0
    for s in range(int(0.5 / m.opt.timestep)): mujoco.mj_step(m, d)
    return (tr - t0) if d.xmat[th].reshape(3, 3)[2, 2] > 0.8 else None
res = []
for wy, wr, wp, wf, ws in itertools.product([1.0], [-1.0], [-1.0, 1.0], [2, 4], [0.3, 0.6, 1.0]):
    prog = dict(f=6, aL=1.0, aR=0.3, p=0, tib=0.5, abd=0.5, wy=wy, wr=wr, wp=wp, wf=wf, ws=ws); ts = []
    for roll in [np.pi, np.pi * 0.9, np.pi * 1.1, np.pi * 0.95, np.pi * 0.85, np.pi * 1.15]:
        flip(roll); up0 = d.xmat[th].reshape(3, 3)[2, 2]
        if up0 > -0.5: continue
        ts.append(run(prog))
    ok = sum(t is not None for t in ts); res.append((ok, np.mean([t for t in ts if t is not None]) if ok else 9, prog))
res.sort(key=lambda r: (-r[0], r[1]))
for r in res[:5]: print(f'righted {r[0]} of the truly-inverted starts, mean time {r[1]:.2f}s', r[2])
json.dump(res[0][2], open('body/gait/righting.json', 'w'))
