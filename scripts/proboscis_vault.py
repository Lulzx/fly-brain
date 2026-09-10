import mujoco, numpy as np, json, sys
sys.argv = ['x']; exec(open('scripts/gait_opt2.py').read().split("if __name__")[0])
g = json.load(open('public/body/gait.json')); P = {(leg, j): g['params'][leg][j] for leg in LEGS for j in J}
def trial(force, seed=0, T=3.0):
    xml = XML.replace('timestep="0.0001"', 'timestep="0.0002"').replace('noslip_iterations="3"', 'noslip_iterations="0"')
    xml = xml.replace('<general forcerange="-0.1 0.1" biastype="affine" gainprm="0.1" biasprm="0 -0.1"/>', f'<general forcerange="-{force} {force}" biastype="affine" gainprm="0.1" biasprm="0 -0.1"/>', 1)
    m = mujoco.MjModel.from_xml_string(xml); d = mujoco.MjData(m); th = m.body('thorax').id
    A = {m.actuator(i).name: i for i in range(m.nu)}; rs = np.random.RandomState(seed); phase = 0; turn = 0; tn = 0
    for s in range(int(T / m.opt.timestep)):
        tms = d.time * 1000
        if tms > tn: turn = rs.uniform(-0.6, 0.6); tn = tms + 150
        phase += 2 * np.pi * 8 * m.opt.timestep
        if s % 5 == 0:
            d.ctrl[A['rostrum']] = -1.24; d.ctrl[A['haustellum']] = -1.59
            for leg in LEGS:
                for sd in SIDES:
                    phi = phase + PH[(leg, sd)]; steer = 1 + turn * (-1 if sd == 'left' else 1)
                    for j in J:
                        off, a1, p1, a2, p2 = P[(leg, j)]; q = a1 * np.cos(phi + p1) + a2 * np.cos(2 * phi + p2)
                        if j == 'coxa': q *= steer
                        lo, hi = m.actuator_ctrlrange[A[f'{j}_{leg}_{sd}']]; d.ctrl[A[f'{j}_{leg}_{sd}']] = np.clip(0.8 * (off + q), lo, hi)
                    d.ctrl[A[f'adhere_claw_{leg}_{sd}']] = 1.0 if ((phi + g['adhPhase']) % (2 * np.pi)) < 2 * np.pi * g['duty'] else 0.0
        mujoco.mj_step(m, d)
        if d.xmat[th].reshape(3, 3)[2, 2] < 0.3: return d.time
    return None
for force in [0.1, 0.03, 0.01]:
    r = [trial(force, sd) for sd in range(6)]
    print(f'head/proboscis actuator force limit {force}: flipped {sum(x is not None for x in r)}/6 walking runs with proboscis extended')
