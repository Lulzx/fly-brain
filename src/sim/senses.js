// Sensory transduction: physical state of the body and world -> firing rates of identified sensory neurons.
// Every channel drives real connectome neurons (bodymap.json); transduction curves are simple, documented
// physiology approximations (saturating concentration responses, contrast-adapting photoreceptors).
export const ODORANTS = {
  // odor -> activated glomeruli (receptor neurons) with relative sensitivity
  vinegar: { DM1: 1.0, DM4: 0.8, VA2: 0.7, DP1m: 0.9, DM2: 0.5, VM2: 0.4, DL1: 0.3 },   // Or42b, Or59b, Or92a, Ir64a...
  banana: { DM1: 0.8, DM3: 0.7, VM2: 0.6, DM2: 0.5, VA2: 0.4 },
  co2: { V: 1.0 },                                                                      // Gr21a/Gr63a, aversive
  geosmin: { DA2: 1.0 },                                                                // Or56a, aversive
  pheromone: { DA1: 1.0, VA1v: 0.7, VA1d: 0.5 },                                        // cVA (Or67d), fly odours
};
export const ORN_SPONTANEOUS = 6;   // Hz, ORN baseline firing

export class Senses {
  constructor(bodymap, mj, model) {
    this.bm = bodymap; this.mj = mj; this.model = model;
    const S = {}; for (const s of bodymap.sensors) S[s.name] = s.idx; this.S = S;
    const T = (re) => bodymap.sensors.filter(s => re.test(s.name));
    // taste channels by tastant (Cell 2026 gustatory connectome identities)
    this.tasteTypes = {
      labellum: { sugar: ['LB3b', 'LB3c'], bitter: ['LB1a', 'LB1b', 'LB1c', 'LB1d'], water: ['LB3a'], salt: ['LB3d'] },
      leg: { sugar: ['LgLG3', 'LgLG4', 'LgAG2'], bitter: ['LgAG1'], pheromone: ['LgLG1a', 'LgLG1b', 'LgLG2', 'LgLG5', 'LgLG6', 'LgLG7', 'LgLG8'] },
      peg: { sugar: ['dorsal_tpGRN'], fatty: ['claw_tpGRN'] },
    };
    this.rates = new Map();   // neuron index -> rate (Hz) for this step
    // tactile bristles are rapidly adapting: burst at contact onset/offset (tau ~15 ms); only tarsal bristles
    // (a fixed ~25% subset of each leg's tactile neurons) touch the substrate
    this.tarsal = {}; this.touchPrev = {}; this.touchBurst = {};
    for (const s of bodymap.sensors) if (s.kind === 'contact') { const key = s.name.replace('tactile ', '').replace(' ', '_'); this.tarsal[key] = s.idx.filter((_, k) => k % 4 === 0); this.touchPrev[key] = 0; this.touchBurst[key] = 0; }
    this.photo = null;
  }
  /** called once the brain metadata is available: map taste types to neuron indices per location */
  bindTypes(typeOf, sideOf, nerveLegOf) {
    this.taste = { labellum: {}, peg: {}, legs: {} };
    const N = typeOf.length;
    for (const [tst, types] of Object.entries(this.tasteTypes.labellum)) this.taste.labellum[tst] = [...Array(N).keys()].filter(i => types.includes(typeOf[i]));
    for (const [tst, types] of Object.entries(this.tasteTypes.peg)) this.taste.peg[tst] = [...Array(N).keys()].filter(i => types.includes(typeOf[i]));
    for (const leg of ['T1', 'T2', 'T3']) for (const sd of ['left', 'right']) {
      const legIdx = new Set(this.S[`taste ${leg} ${sd}`] || []);
      this.taste.legs[`${leg}_${sd}`] = Object.fromEntries(Object.entries(this.tasteTypes.leg).map(([tst, types]) => [tst, [...legIdx].filter(i => types.includes(typeOf[i]))]));
    }
    this.orn = {}; // glomerulus -> {left: idx[], right: idx[]}
    for (const s of this.bm.sensors) if (s.kind === 'odor') { (this.orn[s.glomerulus] ||= {})[s.antenna] = s.idx; }
  }
  set(ix, hz) { for (const i of ix) { const r = this.rates.get(i) || 0; if (hz > r) this.rates.set(i, hz); } }
  static hill(c, k = 0.3, n = 1.5) { return c <= 0 ? 0 : Math.pow(c, n) / (Math.pow(c, n) + Math.pow(k, n)); }

  /** Compute all sensory rates for the current state. `st` holds positions from the physics step. */
  update(st, env, dtMs) {
    this.rates.clear();
    const H = Senses.hill;
    // --- olfaction: concentration at each antenna from static plumes (+ wind advection) ---
    for (const sd of ['left', 'right']) {
      const p = st.antenna[sd];
      const act = {};
      for (const o of env.odors) {
        const dx = p[0] - o.x - env.wind[0] * 0.5, dy = p[1] - o.y - env.wind[1] * 0.5;
        const c = o.strength * Math.exp(-(dx * dx + dy * dy) / (2 * o.sigma * o.sigma));
        for (const [g, sens] of Object.entries(ODORANTS[o.odor] || {})) act[g] = Math.max(act[g] || 0, c * sens);
      }
      for (const [g, ixs] of Object.entries(this.orn)) {
        const ix = ixs[sd]; if (!ix) continue;
        this.set(ix, ORN_SPONTANEOUS + 150 * H(act[g] || 0, 0.25, 1.4));
      }
    }
    // --- taste: labellum and taste pegs (when proboscis touches the floor on food), tarsi ---
    const onPatch = (p, list) => { let best = null; for (const f of list) { const d = Math.hypot(p[0] - f.x, p[1] - f.y); if (d < f.r && (!best || f.sugar > best.sugar)) best = f; } return best; };
    const labTouch = st.labellumZ < 0.012;
    if (labTouch) {
      const f = onPatch(st.labellum, env.food), b = onPatch(st.labellum, env.bitterPatches);
      if (f && f.amount > 0) { this.set(this.taste.labellum.sugar, 180 * H(f.sugar * st.sugarGain, 0.2)); this.set(this.taste.labellum.water, 120 * H(f.water, 0.2)); if (st.proboscisOut) this.set(this.taste.peg.sugar, 150 * H(f.sugar, 0.2)); }
      if (b) this.set(this.taste.labellum.bitter, 180 * H(b.bitter * st.bitterGain, 0.2));
    }
    for (const leg of ['T1', 'T2', 'T3']) for (const sd of ['left', 'right']) {
      const key = `${leg}_${sd}`, touch = st.touch[key];
      const on = touch > 0 ? 1 : 0;
      if (on !== this.touchPrev[key]) this.touchBurst[key] = 1; this.touchPrev[key] = on;
      this.touchBurst[key] *= Math.exp(-dtMs / 15);
      if (this.touchBurst[key] > 0.05) this.set(this.tarsal[key] || [], 180 * this.touchBurst[key]);
      if (touch > 0) {
        const p = st.claw[key], f = onPatch(p, env.food), b = onPatch(p, env.bitterPatches);
        if (f && f.amount > 0) this.set(this.taste.legs[key].sugar, 150 * H(f.sugar * st.sugarGain, 0.2));
        if (b) this.set(this.taste.legs[key].bitter, 150 * H(b.bitter * st.bitterGain, 0.2));
        for (const other of st.otherFlies) if (Math.hypot(p[0] - other.x, p[1] - other.y) < 0.18) this.set(this.taste.legs[key].pheromone, 120);
      }
      // proprioception: population codes of joint angle (chordotonal: femur-tibia; hair plates: coxa), load (campaniform)
      const fe = st.joint[`tibia_${key}`], cx = st.joint[`coxa_${key}`], load = st.load[key];
      popCode(this, this.S[`chordotonal ${leg} ${sd}`], fe, -1.35, 1.3);
      popCode(this, this.S[`hair plate ${leg} ${sd}`], cx, -0.3, 1.7);
      if (load > 0) this.set(this.S[`campaniform ${leg} ${sd}`] || [], Math.min(200, 3000 * load));
    }
    // body bristles: contact of thorax/wings/abdomen with walls, obstacles or other flies
    for (const sd of ['left', 'right']) if (st.bodyContact[sd]) this.set(this.S[`wing/notum bristles ${sd}`] || [], 150);
    // halteres/gyro: angular velocity magnitude drives haltere campaniform populations (mostly relevant in flight)
    const w = Math.hypot(st.gyro[0], st.gyro[1], st.gyro[2]);
    for (const sd of ['left', 'right']) if (w > 2) this.set(this.S[`haltere ${sd}`] || [], Math.min(200, 10 * w));
    // antennal mechanosensation (JO): wind and self-motion air flow
    for (const sd of ['left', 'right']) { const air = Math.hypot(env.wind[0] - st.vel[0], env.wind[1] - st.vel[1]); if (air > 0.5) this.set(this.S[`JO wind/gravity ${sd}`] || [], Math.min(150, 20 * air)); }
    // temperature: hot floor patches heat the fly (thermosensory neurons of the arista)
    let heat = 0; for (const h of env.hazards) { const d = Math.hypot(st.pos[0] - h.x, st.pos[1] - h.y); heat = Math.max(heat, h.heat * Math.max(0, 1 - Math.max(0, d - h.r) / 0.4)); }
    st.heat = heat;
    if (heat > 0.05) for (const sd of ['left', 'right']) this.set(this.S[`thermosensory ${sd}`] || [], 200 * heat);
    return this.rates;
  }
}
function popCode(self, ix, q, lo, hi) {
  if (!ix || !ix.length || q === undefined) return;
  const n = ix.length, x = (q - lo) / (hi - lo), width = 0.25;
  for (let k = 0; k < n; k++) { const pref = (k + 0.5) / n; const r = 120 * Math.exp(-((x - pref) ** 2) / (2 * width * width)); if (r > 5) self.set([ix[k]], r); }
}

// --- compound eye: one ray per photoreceptor, luminance -> contrast-adapting rates ---
export class CompoundEye {
  constructor(mj, model, data, bodymap, headBodyId, thoraxBodyId) {
    this.mj = mj; this.model = model; this.data = data; this.head = headBodyId;
    const eyes = bodymap.eyes; this.idx = []; this.kind = []; const dirs = [];
    for (const e of eyes) e.idx.forEach((i, k) => {
      const az = e.az[k] * Math.PI / 180, el = e.el[k] * Math.PI / 180;
      dirs.push([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]);   // thorax frame: x fwd, y left, z up
      this.idx.push(i); this.kind.push(e.kind[k]); });
    this.n = dirs.length;
    // express directions in the head frame at rest so head movements rotate gaze
    mj.mj_forward(model, data);
    const Rh = data.xmat.slice(headBodyId * 9, headBodyId * 9 + 9), Rt = data.xmat.slice(thoraxBodyId * 9, thoraxBodyId * 9 + 9);
    this.dHead = new Float64Array(this.n * 3);
    for (let r = 0; r < this.n; r++) { const [x, y, z] = dirs[r];
      const w = [Rt[0] * x + Rt[1] * y + Rt[2] * z, Rt[3] * x + Rt[4] * y + Rt[5] * z, Rt[6] * x + Rt[7] * y + Rt[8] * z];  // thorax->world
      for (let c = 0; c < 3; c++) this.dHead[r * 3 + c] = Rh[c] * w[0] + Rh[3 + c] * w[1] + Rh[6 + c] * w[2]; }             // world->head
    this.vec = new Array(this.n * 3).fill(0);
    this.gid = new mj.IntBuffer(this.n); this.dist = new mj.DoubleBuffer(this.n); this.normal = new mj.DoubleBuffer(this.n * 3);
    this.adapt = new Float32Array(this.n).fill(-1);   // log-luminance adaptation state
    this.lum = new Float32Array(this.n);
    this.groups = [1, 0, 0, 0, 1, 0];                 // arena (group 0) + other flies' collision shapes (4)
  }
  /** returns luminance per photoreceptor; sets rates into `senses` */
  update(senses, env, dtMs, geomAlbedo) {
    const { mj, model, data, n, dHead, vec } = this; const h = this.head;
    const R = data.xmat.slice(h * 9, h * 9 + 9), o = [data.xpos[h * 3], data.xpos[h * 3 + 1], data.xpos[h * 3 + 2]];
    for (let r = 0; r < n; r++) { const x = dHead[r * 3], y = dHead[r * 3 + 1], z = dHead[r * 3 + 2];
      vec[r * 3] = R[0] * x + R[1] * y + R[2] * z; vec[r * 3 + 1] = R[3] * x + R[4] * y + R[5] * z; vec[r * 3 + 2] = R[6] * x + R[7] * y + R[8] * z; }
    mj.mj_multiRay(model, data, o, vec, this.groups, true, h, this.gid, this.dist, this.normal, n, 50);
    const gid = this.gid.GetView(), dist = this.dist.GetView(), sun = env.light.sun, sn = Math.hypot(...sun);
    const k = Math.min(1, dtMs / 300);   // photoreceptor light adaptation (~300 ms)
    for (let r = 0; r < n; r++) {
      const dz = vec[r * 3 + 2]; let L;
      if (gid[r] < 0) L = env.light.sky * (0.35 + 0.65 * Math.max(0, dz));                     // sky: brighter overhead
      else { const px = o[0] + vec[r * 3] * dist[r], py = o[1] + vec[r * 3 + 1] * dist[r], pz = o[2] + vec[r * 3 + 2] * dist[r];
        const alb = geomAlbedo(gid[r], px, py, pz); L = env.light.sky * alb * (0.35 + 0.65 * Math.max(0, -(vec[r * 3] * sun[0] + vec[r * 3 + 1] * sun[1] + vec[r * 3 + 2] * sun[2]) / sn * 0 + 1)); }
      const ll = Math.log(1e-3 + L); if (this.adapt[r] < -0.5 && this.adapt[r] === -1) this.adapt[r] = ll;
      this.adapt[r] += k * (ll - this.adapt[r]);
      this.lum[r] = L;
      const rate = Math.max(0, Math.min(250, 40 + 90 * (ll - this.adapt[r])));
      if (rate > 1) senses.set([this.idx[r]], rate);
    }
    return this.lum;
  }
}
