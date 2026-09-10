"""Stress-test the stepping pattern generator under brain-like fluctuating commands (as in motor.js)."""
import mujoco, numpy as np, json, sys
sys.argv = ['x']; exec(open('scripts/gait_opt2.py').read().split("if __name__")[0])
XML2 = XML.replace('timestep="0.0001"', 'timestep="0.0002"').replace('noslip_iterations="3"', 'noslip_iterations="0"')
m = mujoco.MjModel.from_xml_string(XML2); d = mujoco.MjData(m)
act = {}; rng = {}
for leg in LEGS:
    for sd in SIDES:
        for j in J: a = m.actuator(f'{j}_{leg}_{sd}').id; act[(leg, sd, j)] = a; rng[(leg, sd, j)] = m.actuator_ctrlrange[a].copy()
        act[(leg, sd, 'adh')] = m.actuator(f'adhere_claw_{leg}_{sd}').id
th = m.body('thorax').id; g = json.load(open('public/body/gait.json'))
P = {(leg, j): g['params'][leg][j] for leg in LEGS for j in J}
def trial(seed, turn_max, amp_tau, hold=(20, 200)):
    rs = np.random.RandomState(seed); mujoco.mj_resetData(m, d); phase = 0.0; amp_f = 0.0; t_next = 0; v = 0; turn = 0; flips = 0; minup = 1
    for s in range(int(6.0 / m.opt.timestep)):
        tms = d.time * 1000
        if tms >= t_next: v = rs.choice([0, 0.1, 0.3, 0.6, 1.0, -0.4]); turn = rs.uniform(-0.6, 0.6); t_next = tms + rs.uniform(*hold)
        tc = np.clip(turn, -turn_max, turn_max)
        amp_t = min(1, abs(v) * 1.5); amp_f += (m.opt.timestep * 1000 / amp_tau) * (amp_t - amp_f) if amp_tau > 0 else (amp_t - amp_f)
        freq = g['freq'] * (0.5 + 0.5 * min(1, abs(v)))
        if amp_f > 0.05: phase += np.sign(v) * 2 * np.pi * freq * m.opt.timestep
        if s % 5 == 0:
            for leg in LEGS:
                for sd in SIDES:
                    phi = phase + PH[(leg, sd)]; steer = 1 + tc * (-1 if sd == 'left' else 1)
                    for j in J:
                        off, a1, p1, a2, p2 = P[(leg, j)]; q = a1 * np.cos(phi + p1) + a2 * np.cos(2 * phi + p2)
                        if j == 'coxa': q *= steer
                        lo, hi = rng[(leg, sd, j)]; d.ctrl[act[(leg, sd, j)]] = np.clip(amp_f * (off + q), lo, hi)
                    st = ((phi + g['adhPhase']) % (2 * np.pi)) < 2 * np.pi * g['duty']
                    d.ctrl[act[(leg, sd, 'adh')]] = (1.0 if st else 0.0) if amp_f > 0.05 else 0.8
        mujoco.mj_step(m, d); up = d.xmat[th].reshape(3, 3)[2, 2]; minup = min(minup, up)
        if up < 0: flips += 1; break
    return flips, minup
for turn_max, amp_tau in [(0.6, 0), (0.35, 0), (0.6, 100), (0.35, 100), (0.35, 200)]:
    res = [trial(sd, turn_max, amp_tau) for sd in range(8)]
    print(f'turn clamp {turn_max}, amplitude smoothing {amp_tau} ms: flipped in {sum(r[0] for r in res)}/8 runs of 6 s, worst uprightness {min(r[1] for r in res):.2f}')
