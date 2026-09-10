import mujoco, numpy as np, itertools
xml = open('public/body/fly_physics.xml').read().replace('<worldbody>', '<worldbody>\n<geom name="floor" type="plane" size="30 30 .1" pos="0 0 -.132" friction="1" solref="0.0002 1"/>', 1).replace('timestep="0.0001"', 'timestep="0.0002"').replace('noslip_iterations="3"', 'noslip_iterations="0"')
m = mujoco.MjModel.from_xml_string(xml); d = mujoco.MjData(m); th = m.body('thorax').id
A = lambda n: m.actuator(n).id; R = lambda n: m.actuator_ctrlrange[A(n)]
def trial(dur_ms, femur_frac, tibia_frac, t3_frac, release_front):
    mujoco.mj_resetData(m, d)
    for i in range(m.nu):
        if m.actuator(i).name.startswith('adhere'): d.ctrl[i] = 0.8
    for _ in range(500): mujoco.mj_step(m, d)
    maxz = 0; t0 = d.time
    for s in range(int(0.6 / m.opt.timestep)):
        tms = (d.time - t0) * 1000
        for sd in ('left', 'right'):
            if tms < dur_ms:
                d.ctrl[A(f'femur_T2_{sd}')] = R(f'femur_T2_{sd}')[1] * femur_frac; d.ctrl[A(f'tibia_T2_{sd}')] = R(f'tibia_T2_{sd}')[1] * tibia_frac
                d.ctrl[A(f'femur_T3_{sd}')] = R(f'femur_T3_{sd}')[1] * t3_frac
                for leg in ('T1', 'T2', 'T3'): d.ctrl[A(f'adhere_claw_{leg}_{sd}')] = 0.0 if (leg == 'T2' or release_front or tms > dur_ms * 0.5) else 0.8
            else:
                for j in ('femur', 'tibia'): 
                    for leg in ('T2', 'T3'): d.ctrl[A(f'{j}_{leg}_{sd}')] = 0
                for leg in ('T1', 'T2', 'T3'): d.ctrl[A(f'adhere_claw_{leg}_{sd}')] = 0.8
        mujoco.mj_step(m, d); maxz = max(maxz, d.xpos[th][2])
    up = d.xmat[th].reshape(3, 3)[2, 2]
    return maxz, up, d.xpos[th].copy()
for dur, ff, tf, t3, rel in itertools.product([10, 20, 30], [0.6, 1.0], [0.5, 1.0], [0.0, 0.5], [True, False]):
    mz, up, p = trial(dur, ff, tf, t3, rel)
    if up > 0.8: print(f'dur {dur}ms femur {ff} tibia {tf} T3 {t3} release_front {rel}: max height {mz+0.132:.3f} cm, final up {up:.2f}, displacement {np.hypot(p[0],p[1]):.2f} cm')
