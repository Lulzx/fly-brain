"""Split the flybody fruit fly into (1) a mesh-free physics MJCF with exact compiled inertials and
(2) decimated visual meshes expressed in each body's frame, for three.js rendering.
Physics is identical to flybody except visual meshes are removed (they had contype=0 and only
contributed mass/inertia, which we bake in explicitly)."""
import mujoco, numpy as np, json, sys, fast_simplification
SRC = 'body/flybody-src/flybody/fruitfly/assets/fruitfly.xml'
KEEP = float(sys.argv[1]) if len(sys.argv) > 1 else 0.06   # fraction of triangles kept

m0 = mujoco.MjModel.from_xml_path(SRC)
spec = mujoco.MjSpec.from_file(SRC)
spec.compiler.inertiafromgeom = mujoco.mjtInertiaFromGeom.mjINERTIAFROMGEOM_FALSE
spec.compiler.balanceinertia = True  # XML round-trip truncates tiny inertias
for b in spec.bodies:
    if b.name == 'world': continue
    i = m0.body(b.name).id
    b.explicitinertial = True
    b.mass = float(m0.body_mass[i]); b.ipos = m0.body_ipos[i].copy(); b.iquat = m0.body_iquat[i].copy(); b.inertia = m0.body_inertia[i].copy()
for g in list(spec.geoms):
    if g.type == mujoco.mjtGeom.mjGEOM_MESH: spec.delete(g)
for me in list(spec.meshes): spec.delete(me)
spec.meshdir = ''
m1 = spec.compile()
dm = np.abs(m1.body_mass - m0.body_mass).max()
print('physics model: ngeom', m1.ngeom, 'nbody', m1.nbody, 'mass err', dm, 'total mass', m1.body_subtreemass[1])
xml = spec.to_xml().replace('<compiler angle="radian"/>', '<compiler angle="radian" autolimits="true" inertiafromgeom="false" balanceinertia="true"/>', 1)
assert 'balanceinertia' in xml
import re
def fmt(a): return ' '.join(repr(float(x)) for x in a)
def fix_inertial(mt):
    name = mt.group(1); i = m0.body(name).id
    return (mt.group(0)[:mt.start(2) - mt.start(0)] +
            f'<inertial pos="{fmt(m0.body_ipos[i])}" quat="{fmt(m0.body_iquat[i])}" mass="{float(m0.body_mass[i])!r}" diaginertia="{fmt(m0.body_inertia[i])}"/>')
xml, nfix = re.subn(r'<body name="([^"]+)"[^>]*>\s*(<inertial [^>]*/>)', fix_inertial, xml)
print('inertials rewritten', nfix)
xml = xml.replace(' balanceinertia="true"', '')
m2 = mujoco.MjModel.from_xml_string(xml)
print('reloaded: nu', m2.nu, 'max mass err', np.abs(m2.body_mass - m0.body_mass).max(), 'max inertia rel err', float((np.abs(m2.body_inertia - m0.body_inertia) / (m0.body_inertia.max(1, keepdims=True) + 1e-30)).max()))
open('public/body/fly_physics.xml', 'w').write(xml)

# ---- visuals ----
def quat2mat(q):
    r = np.zeros(9); mujoco.mju_quat2Mat(r, q); return r.reshape(3, 3)
parts = []; bufs = []; off = 0; tri_in = tri_out = 0
for gi in range(m0.ngeom):
    if m0.geom_type[gi] != mujoco.mjtGeom.mjGEOM_MESH: continue
    mid = m0.geom_dataid[gi]
    va, vn = m0.mesh_vertadr[mid], m0.mesh_vertnum[mid]
    fa, fn = m0.mesh_faceadr[mid], m0.mesh_facenum[mid]
    V = m0.mesh_vert[va:va + vn].astype(np.float64); F = m0.mesh_face[fa:fa + fn].astype(np.int64)
    # compiled meshes are triangle soup (3 private vertices per face): weld before decimating
    key = np.round(V / 1e-6).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    Vw = np.zeros((len(uniq), 3)); np.add.at(Vw, inv.ravel(), V); Vw /= np.bincount(inv.ravel())[:, None]
    F = inv.ravel()[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]; V = Vw
    tri_in += len(F)
    red = 1 - KEEP if len(F) > 400 else 0
    if red > 0:
        V2, F2 = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_reduction=red)
    else: V2, F2 = V.astype(np.float32), F.astype(np.int32)
    tri_out += len(F2)
    R = quat2mat(m0.geom_quat[gi]); V2 = (V2 @ R.T + m0.geom_pos[gi]).astype(np.float32)
    mat = m0.geom_matid[gi]; rgba = (m0.mat_rgba[mat] if mat >= 0 else m0.geom_rgba[gi]).tolist()
    body = m0.body(m0.geom_bodyid[gi]).name
    vb = V2.tobytes(); ib = F2.astype(np.uint32).tobytes()
    parts.append({'body': body, 'geom': m0.geom(gi).name, 'mesh': m0.mesh(mid).name, 'rgba': rgba,
                  'vOff': off, 'vCount': len(V2), 'iOff': off + len(vb), 'iCount': int(F2.size)})
    bufs += [vb, ib]; off += len(vb) + len(ib)
open('public/body/fly_visual.bin', 'wb').write(b''.join(bufs))
json.dump({'parts': parts, 'materials': {m0.material(i).name: m0.mat_rgba[i].tolist() for i in range(m0.nmat)}},
          open('public/body/fly_visual.json', 'w'))
print('visual parts', len(parts), 'triangles', tri_in, '->', tri_out, 'bytes', off)
