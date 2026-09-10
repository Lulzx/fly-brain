// Builds the MuJoCo world for one fly: the flybody fly (mesh-free physics), a walled arena with
// obstacles and food discs, and kinematic (mocap) proxies standing in for the other flies.
// Units follow flybody: cm, g, s. The floor is z = 0; a standing fly's thorax sits at z ~ 0.13.
export const DEFAULT_ENV = {
  arena: { radius: 2.5, wallHeight: 0.4, segments: 48 },
  food: [
    { x: 1.0, y: 0.6, r: 0.25, sugar: 1.0, bitter: 0, water: 0.2, amount: 5 },
  ],
  bitterPatches: [{ x: -1.0, y: -0.7, r: 0.25, bitter: 1.0 }],
  odors: [{ x: 1.0, y: 0.6, odor: 'vinegar', strength: 1.0, sigma: 0.9 }],
  obstacles: [{ type: 'box', x: -0.4, y: 1.2, sx: 0.25, sy: 0.25, sz: 0.3 }],
  hazards: [{ x: -1.4, y: 0.6, r: 0.35, heat: 1.0 }],   // hot floor: damages the fly
  light: { sky: 1.0, sun: [0.3, 0.2, 1.0] },
  wind: [0, 0],
  threat: null,   // { x, y, z } position of the looming object (set by the host), or null
};

export function buildWorldXML(flyXML, env, { flyPos = [0, 0, 0.13], flyYaw = 0, nProxies = 0 } = {}) {
  const a = env.arena, parts = [];
  parts.push(`<geom name="floor" type="plane" size="${a.radius + 1} ${a.radius + 1} .1" rgba=".55 .5 .42 1" friction="1" solref="0.0002 1" group="0"/>`);
  // circular wall from box segments
  const n = a.segments, t = 0.05;
  for (let k = 0; k < n; k++) {
    const th = (k + 0.5) / n * 2 * Math.PI, len = 2 * Math.PI * a.radius / n * 0.55;
    const x = (a.radius + t) * Math.cos(th), y = (a.radius + t) * Math.sin(th);
    parts.push(`<geom name="wall${k}" type="box" size="${t} ${len.toFixed(4)} ${a.wallHeight / 2}" pos="${x.toFixed(4)} ${y.toFixed(4)} ${a.wallHeight / 2}" euler="0 0 ${th.toFixed(4)}" rgba=".35 .35 .38 1" group="0"/>`);
  }
  env.obstacles.forEach((o, k) => {
    if (o.type === 'box') parts.push(`<geom name="obst${k}" type="box" size="${o.sx} ${o.sy} ${o.sz / 2}" pos="${o.x} ${o.y} ${o.sz / 2}" rgba=".25 .3 .25 1" group="0"/>`);
    else parts.push(`<geom name="obst${k}" type="cylinder" size="${o.r} ${o.sz / 2}" pos="${o.x} ${o.y} ${o.sz / 2}" rgba=".25 .3 .25 1" group="0"/>`);
  });
  // food and patches are flat visual discs (no collision), seen by the eyes
  env.food.forEach((f, k) => parts.push(`<geom name="food${k}" type="cylinder" size="${f.r} 0.002" pos="${f.x} ${f.y} 0.002" rgba=".95 .8 .3 1" contype="0" conaffinity="0" group="0"/>`));
  env.bitterPatches.forEach((f, k) => parts.push(`<geom name="bitter${k}" type="cylinder" size="${f.r} 0.002" pos="${f.x} ${f.y} 0.002" rgba=".3 .55 .85 1" contype="0" conaffinity="0" group="0"/>`));
  env.hazards.forEach((h, k) => parts.push(`<geom name="hazard${k}" type="cylinder" size="${h.r} 0.002" pos="${h.x} ${h.y} 0.002" rgba=".85 .3 .2 1" contype="0" conaffinity="0" group="0"/>`));
  // other flies: kinematic ellipsoid proxies (body + head), collide with this fly and are visible
  for (let k = 0; k < nProxies; k++) parts.push(`<body name="proxy${k}" mocap="true" pos="${50 + k} 50 -5"><geom name="proxy${k}_body" type="ellipsoid" size="0.14 0.05 0.05" pos="-0.03 0 0" rgba=".2 .15 .1 1" group="0"/><geom name="proxy${k}_head" type="sphere" size="0.045" pos="0.08 0 0.01" rgba=".5 .1 .08 1" group="0"/></body>`);
  // a looming threat (predator / swatter): kinematic dark sphere, parked far away until launched
  parts.push(`<body name="threat" mocap="true" pos="0 0 -20"><geom name="threat_geom" type="sphere" size="0.35" rgba=".05 .05 .06 1" contype="0" conaffinity="0" group="0"/></body>`);
  const q = [Math.cos(flyYaw / 2), 0, 0, Math.sin(flyYaw / 2)];
  let xml = flyXML.replace('<worldbody>', `<worldbody>\n${parts.join('\n')}`);
  xml = xml.replace('<body name="thorax" childclass="body">', `<body name="thorax" childclass="body" pos="${flyPos.join(' ')}" quat="${q.map(v => v.toFixed(6)).join(' ')}">`);
  xml = xml.replace(/<size [^>]*\/>/, '<size njmax="600" nconmax="200" nkey="1"/>');
  // 0.2 ms physics step without no-slip iterations: same gait quality as flybody's 0.1 ms (tested), half the cost
  xml = xml.replace('timestep="0.0001"', 'timestep="0.0002"').replace('noslip_iterations="3"', 'noslip_iterations="0"');
  return xml;
}
