"""Full-resolution flybody visual meshes (no decimation) for the fly.html anatomy viewer.
Same layout as prep_body.py's fly_visual.{json,bin}: each part in its body's frame, plus the rest-pose
body tree (pos/quat relative to parent) so the viewer can assemble the fly without MuJoCo.
Run: uv run --with mujoco --with numpy python scripts/prep_fly_hd.py"""
import mujoco, numpy as np, json
SRC = 'body/flybody-src/flybody/fruitfly/assets/fruitfly.xml'
m = mujoco.MjModel.from_xml_path(SRC)

def quat2mat(q):
    r = np.zeros(9); mujoco.mju_quat2Mat(r, q); return r.reshape(3, 3)
parts = []; bufs = []; off = 0; tris = 0
for gi in range(m.ngeom):
    if m.geom_type[gi] != mujoco.mjtGeom.mjGEOM_MESH: continue
    mid = m.geom_dataid[gi]
    va, vn = m.mesh_vertadr[mid], m.mesh_vertnum[mid]
    fa, fn = m.mesh_faceadr[mid], m.mesh_facenum[mid]
    V = m.mesh_vert[va:va + vn].astype(np.float64); F = m.mesh_face[fa:fa + fn].astype(np.int64)
    key = np.round(V / 1e-7).astype(np.int64)   # weld triangle soup so normals smooth
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    Vw = np.zeros((len(uniq), 3)); np.add.at(Vw, inv.ravel(), V); Vw /= np.bincount(inv.ravel())[:, None]
    F = inv.ravel()[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    V = (Vw @ quat2mat(m.geom_quat[gi]).T + m.geom_pos[gi]).astype(np.float32)
    tris += len(F)
    mat = m.geom_matid[gi]; rgba = (m.mat_rgba[mat] if mat >= 0 else m.geom_rgba[gi]).tolist()
    vb = V.tobytes(); ib = F.astype(np.uint32).tobytes()
    parts.append({'body': m.body(m.geom_bodyid[gi]).name, 'geom': m.geom(gi).name, 'mesh': m.mesh(mid).name,
                  'material': m.material(mat).name if mat >= 0 else '', 'rgba': rgba,
                  'vOff': off, 'vCount': len(V), 'iOff': off + len(vb), 'iCount': int(F.size)})
    bufs += [vb, ib]; off += len(vb) + len(ib)
d = mujoco.MjData(m)
def pose(qpos):
    d.qpos[:] = qpos; mujoco.mj_kinematics(m, d)
    return {m.body(i).name: [round(float(x), 7) for x in [*d.xpos[i], *d.xquat[i]]] for i in range(1, m.nbody)}
# 'spread' = mesh reference pose (wings up); 'rest' = every joint at its spring reference: wings folded over the abdomen
poses = {'spread': pose(m.qpos0), 'rest': pose(m.qpos_spring)}
open('public/body/fly_hd.bin', 'wb').write(b''.join(bufs))
parents = {m.body(i).name: m.body(int(m.body_parentid[i])).name for i in range(2, m.nbody)}
json.dump({'parts': parts, 'poses': poses, 'parents': parents}, open('public/body/fly_hd.json', 'w'))
print('parts', len(parts), 'triangles', tris, 'bytes', off)
