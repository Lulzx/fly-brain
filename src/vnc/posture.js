// Posture metrics for the premotor fit's stand assay (spec S2.6/S2.8).
//
// The stand criterion is geometric, not kinematic: the body must hold its center of mass over the
// polygon the planted claws make, with at least three claws down and less than half a millimetre
// of vertical bounce, sustained for two seconds. Everything below is pure function of recorded
// body state -- positions, claw contacts, thorax z -- so the same functions score a live run, a
// replayed trajectory, or a fit-time rollout.
//
//   supportPolygon(claws)   convex hull of the planted claw positions (xy, thorax frame)
//   pointInPolygon(p, poly) ray-cast containment
//   standScore(frames)      fraction of scored frames satisfying all three criteria, where a frame
//                         is {pos:[x,y,z], claw:{leg:[x,y,z]}, ...} as FlyAgent.state() returns

/** Convex hull (Andrew monotone chain) of the planted claws' xy positions, in the order walked.
 *  claws: [[x,y,z] or null, ...] -- null when the claw is off the ground. Returns [[x,y],...] or
 *  null when fewer than 3 claws are planted. */
export function supportPolygon(claws) {
  const pts = [];
  for (const c of claws) if (c) pts.push([c[0], c[1]]);
  if (pts.length < 3) return null;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
    hi.push(p);
  }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

/** Ray-cast point-in-polygon. poly: [[x,y],...]. */
export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The per-frame stand decision. frame: {pos, claw}; planted if claw z < contactZ (the claw's
 *  z under the thorax drops below ~0.06 body units at contact in this model).
 *  Returns {contact, inside, bounce} -- bounce filled by standScore (needs the window). */
export function frameStand(frame, { contactZ = 0.06 } = {}) {
  const claws = [];
  let contact = 0;
  for (const k of Object.keys(frame.claw || {})) {
    const c = frame.claw[k];
    const planted = c && c[2] < contactZ;
    claws.push(planted ? c : null);
    if (planted) contact++;
  }
  const poly = supportPolygon(claws);
  const inside = poly ? pointInPolygon([frame.pos[0], frame.pos[1]], poly) : false;
  return { contact, inside, poly };
}

/** Score a trajectory window for standing: fraction of frames that have >=3 claws planted with the
 *  body inside the support polygon, discounted by vertical bounce. frames: [{pos, claw}] at any
 *  cadence; bounce is the peak-to-peak thorax z over the whole window, failing the assay when it
 *  exceeds 0.5 (the spec's 0.5 mm is one half-body-unit in this model's mm-scale arena? -- in this
 *  model pos is in the flybody's units; the threshold is a parameter so the caller fixes it).
 *  Returns { score, contactFrac, insideFrac, bounce, n }. */
export function standScore(frames, { contactZ = 0.06, bounceMax = 0.5, minClaws = 3 } = {}) {
  const n = frames.length;
  let contactOk = 0, insideOk = 0, both = 0;
  let zMin = Infinity, zMax = -Infinity;
  for (const f of frames) {
    const { contact, inside, poly } = frameStand(f, { contactZ });
    if (contact >= minClaws) contactOk++;
    if (inside) insideOk++;
    if (contact >= minClaws && inside) both++;
    if (f.pos[2] < zMin) zMin = f.pos[2];
    if (f.pos[2] > zMax) zMax = f.pos[2];
  }
  const bounce = zMax - zMin;
  const pass = both / Math.max(1, n);
  const score = bounce > bounceMax ? 0 : pass;
  return { score, contactFrac: contactOk / Math.max(1, n), insideFrac: insideOk / Math.max(1, n), bounce, n };
}
