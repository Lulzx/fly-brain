// Vision front end: per eye, 721 rays (flyvis columns) -> luminance -> flyvis optic-lobe model (Lappalainen et al.
// 2024) at 50 Hz -> drives the matching male-CNS optic-lobe neurons (same type, same column). Male-CNS
// photoreceptors are driven by the luminance of their nearest column with light adaptation.
export class FlyVisionFV {
  constructor(mj, model, data, bodymap, fvmap, eyes, headBodyId, thoraxBodyId, gain = 60) {
    this.mj = mj; this.model = model; this.data = data; this.head = headBodyId; this.eyes = eyes; this.gain = gain; this.map = fvmap;
    this.sides = ['L', 'R'];
    mj.mj_forward(model, data);
    const Rh = data.xmat.slice(headBodyId * 9, headBodyId * 9 + 9), Rt = data.xmat.slice(thoraxBodyId * 9, thoraxBodyId * 9 + 9);
    const toHead = ([x, y, z]) => { const w = [Rt[0] * x + Rt[1] * y + Rt[2] * z, Rt[3] * x + Rt[4] * y + Rt[5] * z, Rt[6] * x + Rt[7] * y + Rt[8] * z];
      return [0, 1, 2].map(c => Rh[c] * w[0] + Rh[3 + c] * w[1] + Rh[6 + c] * w[2]); };
    this.nCol = fvmap.eyes.L.dirs.length; this.n = 2 * this.nCol;
    this.dHead = new Float64Array(this.n * 3); let r = 0;
    for (const sd of this.sides) for (const d of fvmap.eyes[sd].dirs) { const h = toHead(d); this.dHead.set(h, r * 3); r++; }
    this.vec = new Array(this.n * 3).fill(0);
    this.gid = new mj.IntBuffer(this.n); this.dist = new mj.DoubleBuffer(this.n); this.normal = new mj.DoubleBuffer(this.n * 3);
    this.lum = new Float32Array(this.n); this.groups = [1, 0, 0, 0, 1, 0];
    this.pairs = this.sides.map(sd => { const p = fvmap.eyes[sd].pairs; return { neuron: Int32Array.from(p, x => x[0]), node: Int32Array.from(p, x => x[1]) }; });
    // photoreceptors -> nearest column of their eye
    this.photo = []; this.photoCol = [];
    const dirsAll = this.sides.map(sd => fvmap.eyes[sd].dirs);
    for (const e of bodymap.eyes) { const s = e.side === 'left' ? 0 : 1; const D = dirsAll[s];
      e.idx.forEach((i, k) => { const az = e.az[k] * Math.PI / 180, el = e.el[k] * Math.PI / 180; const v = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
        let best = 0, bd = -2; for (let c = 0; c < D.length; c++) { const dd = D[c][0] * v[0] + D[c][1] * v[1] + D[c][2] * v[2]; if (dd > bd) { bd = dd; best = c; } }
        this.photo.push(i); this.photoCol.push(s * this.nCol + best); }); }
    this.adapt = new Float32Array(this.photo.length).fill(NaN);
    this.lumEye = [new Float32Array(this.nCol), new Float32Array(this.nCol)];
    // resting activity of every model node under a uniform grey field: neurons are driven by deviations from rest
    const grey = new Float32Array(this.nCol).fill(0.5);
    for (const e of eyes) { e.reset(); e.setInput(grey); for (let k = 0; k < 150; k++) e.step(); }
    this.vRest = eyes[0].v.slice(0);
    this.settled = false;
  }
  /** let the optic-lobe state settle to the current scene (avoids an onset transient) */
  settle(env, albedo, steps = 50) { this.sample(env, albedo); for (let s = 0; s < 2; s++) { this.eyes[s].setInput(this.lumEye[s]); for (let k = 0; k < steps; k++) this.eyes[s].step(); } this.settled = true; }
  sample(env, albedo) {
    const { mj, model, data, n, dHead, vec } = this; const h = this.head;
    const R = data.xmat.slice(h * 9, h * 9 + 9), o = [data.xpos[h * 3], data.xpos[h * 3 + 1], data.xpos[h * 3 + 2]];
    for (let r = 0; r < n; r++) { const x = dHead[r * 3], y = dHead[r * 3 + 1], z = dHead[r * 3 + 2];
      vec[r * 3] = R[0] * x + R[1] * y + R[2] * z; vec[r * 3 + 1] = R[3] * x + R[4] * y + R[5] * z; vec[r * 3 + 2] = R[6] * x + R[7] * y + R[8] * z; }
    mj.mj_multiRay(model, data, o, vec, this.groups, true, h, this.gid, this.dist, this.normal, n, 50);
    const gid = this.gid.GetView(), dist = this.dist.GetView();
    for (let r = 0; r < n; r++) {
      let L; if (gid[r] < 0) L = env.light.sky * (0.35 + 0.65 * Math.max(0, vec[r * 3 + 2]));
      else L = env.light.sky * albedo(gid[r], o[0] + vec[r * 3] * dist[r], o[1] + vec[r * 3 + 1] * dist[r], o[2] + vec[r * 3 + 2] * dist[r]);
      this.lum[r] = Math.min(1, L);
    }
    this.lumEye[0].set(this.lum.subarray(0, this.nCol)); this.lumEye[1].set(this.lum.subarray(this.nCol));
  }
  /** advance the optic-lobe models by 20 ms and emit rates via set(ixArray, hz) */
  update(set, env, albedo, dtMs) {
    if (!this.settled) this.settle(env, albedo);
    this.sample(env, albedo);
    for (let s = 0; s < 2; s++) { this.eyes[s].setInput(this.lumEye[s]); this.eyes[s].step(); }
    const g = this.gain;
    for (let s = 0; s < 2; s++) { const v = this.eyes[s].v, P = this.pairs[s]; const one = [0];
      const vr = this.vRest;
      for (let k = 0; k < P.neuron.length; k++) { const n = P.node[k]; const a = v[n] - vr[n]; if (a > 0.02) { one[0] = P.neuron[k]; set(one, Math.min(200, g * a)); } } }
    const ka = Math.min(1, dtMs / 300), one = [0];
    for (let k = 0; k < this.photo.length; k++) { const ll = Math.log(1e-3 + this.lum[this.photoCol[k]]); if (Number.isNaN(this.adapt[k])) this.adapt[k] = ll;
      this.adapt[k] += ka * (ll - this.adapt[k]); const rate = Math.max(0, Math.min(250, 40 + 90 * (ll - this.adapt[k]))); if (rate > 1) { one[0] = this.photo[k]; set(one, rate); } }
  }
}
