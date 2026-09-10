import mujoco, numpy as np, sys
xml = open('public/body/fly_physics.xml').read()
floor = '<geom name="floor" type="plane" size="5 5 .1" pos="0 0 -.132" solref="0.0002 1" friction="1"/>'
xml = xml.replace('<worldbody>', '<worldbody>\n' + floor, 1)
m = mujoco.MjModel.from_xml_string(xml); d = mujoco.MjData(m)
adh = float(sys.argv[1]) if len(sys.argv) > 1 else 0
for i in range(m.nu):
    if m.actuator(i).name.startswith('adhere_claw'): d.ctrl[i] = adh
th = m.body('thorax').id
for t in range(5001):
    mujoco.mj_step(m, d)
    if t % 1000 == 0:
        R = d.xmat[th].reshape(3, 3)
        touch = [d.sensor(f'touch_claw_T{s}_{side}').data[0] for s in (1, 2, 3) for side in ('left', 'right')]
        print(f't={d.time:.3f}s thorax z={d.xpos[th][2]:.4f} up·z={R[2,2]:.3f} ncon={d.ncon} touch={np.round(touch,5)}')
