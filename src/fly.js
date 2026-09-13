// Anatomy viewer: the flybody Drosophila scan at full resolution, rendered as a macro photograph.
// Geometry (cuticle, compound eye facets, macro/microchaetae of head and notum, wing veins) is the scan;
// what the scan leaves out is added procedurally from the literature: leg and abdominal setae, the
// posterior tergite bristle rows, interommatidial bristles, wing-margin bristles, the male sex comb,
// sex-specific tergite pigmentation, wing thin-film interference and the eye's deep pseudopupil.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
const BASE = import.meta.env.BASE_URL;
const $ = s => document.querySelector(s);
const status = s => { $('#status').textContent = s; };

// ---------------- anatomy notes (hover) ----------------
const ANATOMY = [
  [/head_red/, 'Compound eye', 'About 750 ommatidia, each a corneal lens over eight photoreceptors (R1–R8). The brick red is screening pigment (drosopterins + ommochromes). The dark spot that follows you is the deep pseudopupil: the ommatidia looking straight at you.'],
  [/head_ocelli/, 'Ocelli', 'Three simple eyes on the vertex triangle; wide-field light sensors that help stabilise flight attitude.'],
  [/^head/, 'Head capsule', 'Frons, vertex and gena. The long bristles (orbitals, verticals, postverticals, ocellars) are stereotyped macrochaetae, each a single mechanosensory neuron.'],
  [/antenna/, 'Antenna', 'Scape, pedicel and funiculus (third segment, covered in olfactory sensilla), ending in the branched arista. The pedicel houses Johnston’s organ, which hears courtship song and senses wind and gravity.'],
  [/rostrum|haustellum/, 'Proboscis', 'Rostrum and haustellum: the extensible mouthparts, folded under the head at rest.'],
  [/labrum/, 'Labellum', 'Paired sponge-like lobes with pseudotracheae for sucking fluids, lined with gustatory bristles (taste neurons for sugar, bitter, water, salt).'],
  [/wing_.*membrane/, 'Wing membrane', 'Two cuticle sheets a few hundred nm thick. Thin-film interference paints the stable wing interference pattern seen against dark backgrounds; each cell carries one microtrichium.'],
  [/wing_/, 'Wing veins', 'Costa, longitudinal veins L1–L5 and the anterior and posterior cross-veins. The costa bears the triple row of margin bristles; the posterior margin a fringe of fine hairs.'],
  [/haltere/, 'Haltere', 'Reduced hindwing: a club that beats in antiphase with the wings and senses body rotation through Coriolis forces, like a gyroscope.'],
  [/thorax_black/, 'Notal bristles', 'Rows of microchaetae and the paired macrochaetae (dorsocentrals, scutellars, supra-alars…), the classic bristle map of Drosophila genetics.'],
  [/thorax/, 'Thorax', 'Pro-, meso- and metathorax fused into a box packed with indirect flight muscles; the dorsal notum ends in the scutellum.'],
  [/abdomen_8/, 'Terminalia', 'Genital and anal plates at the tip of the abdomen.'],
  [/abdomen.*lower/, 'Sternites', 'Pale, soft ventral plates of the abdomen, joined to the tergites by flexible pleural membrane.'],
  [/abdomen/, 'Abdominal tergite', 'Each dorsal plate has a pigmented posterior band and a row of bristles on its hind margin. In males the last two tergites (A5, A6) are fully dark, a trait controlled by Abd-B and bab.'],
  [/claw/, 'Tarsal claws and pulvilli', 'Paired claws grip rough surfaces; the pad-like pulvilli beneath secrete fluid to stick to smooth ones.'],
  [/tarsus_T1/, 'Basitarsus (foreleg)', 'First of five tarsomeres. In males it carries the sex comb, a row of about ten thick dark bristles used to grasp the female. Tarsi are dense with taste bristles.'],
  [/tarsus/, 'Tarsus', 'Five tarsomeres covered in setae, including gustatory sensilla: flies taste with their feet.'],
  [/tibia/, 'Tibia', 'Long segment with rows of setae and, on the mid leg, an apical spur.'],
  [/femur/, 'Femur', 'Largest leg segment; houses the muscles that move the tibia and the femoral chordotonal organ that senses joint angle.'],
  [/coxa/, 'Coxa', 'Base of the leg, articulating with the thorax.'],
];
const describe = name => ANATOMY.find(([re]) => re.test(name));

// ---------------- renderer, scene ----------------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.005, 60);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.minDistance = 0.08; controls.maxDistance = 4; controls.zoomSpeed = 0.8;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.02).texture;
scene.environmentIntensity = 0.55;

// backdrop: vertical gradient on a far sphere, and a floor that only receives shadow
const backdropMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
  uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: 'uniform vec3 top, bottom; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-.35, .7, vP.z)) * 1.5, 1.); }' });
const backdrop = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), backdropMat); scene.add(backdrop);
const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.ShadowMaterial({ opacity: 0.28 }));
floor.receiveShadow = true; scene.add(floor);

const key = new THREE.DirectionalLight('#fff3e2', 2.6); key.position.set(0.6, 0.9, 1.6); key.castShadow = true;
Object.assign(key.shadow.camera, { left: -0.3, right: 0.3, top: 0.3, bottom: -0.3, near: 0.5, far: 4 });
key.shadow.mapSize.set(4096, 4096); key.shadow.bias = -0.00002; key.shadow.normalBias = 0.0004; key.shadow.radius = 4;
const rim = new THREE.DirectionalLight('#dbe8ff', 2.2); rim.position.set(-1.4, -0.6, 0.7);   // backlight: makes setae glow
const fill = new THREE.HemisphereLight('#fff8ee', '#8a7560', 0.35);
scene.add(key, key.target, rim, fill);

// ---------------- shader helpers ----------------
const NOISE_GLSL = /* glsl */`
float fhash(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(fhash(i), fhash(i + vec3(1,0,0)), f.x), mix(fhash(i + vec3(0,1,0)), fhash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fhash(i + vec3(0,0,1)), fhash(i + vec3(1,0,1)), f.x), mix(fhash(i + vec3(0,1,1)), fhash(i + vec3(1,1,1)), f.x), f.y), f.z); }
vec3 bumpNormal(vec3 surf_pos, vec3 surf_norm, float h, float faceDirection){   // h: relief height in scene units
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) / max(length(fwidth(surf_pos)), 1e-7);
  vec3 vSigmaX = normalize(dFdx(surf_pos)), vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm), R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad); }`;

// Cuticle: sclerotised chitin with a velvet of microtrichia (sheen), fine microsculpture (procedural bump in
// body coordinates, faded out before it aliases), low-frequency mottling, and optional tergite banding.
function cuticle({ color, roughness = 0.5, sheen = 0.6, sheenColor = '#e8c28a', clearcoat = 0.2, bump = 0.6, band = null }) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness, sheen, sheenRoughness: 0.45, sheenColor: new THREE.Color(sheenColor), clearcoat, clearcoatRoughness: 0.35, specularIntensity: 0.6 });
  const u = { uBump: { value: bump }, uBandOn: { value: band ? 1 : 0 }, uBand: { value: new THREE.Vector4() }, uDark: { value: new THREE.Color('#2a170c') } };
  if (band) u.uBand.value.set(band.y0, band.y1, band.frac, 0);
  m.userData.u = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vObj; uniform float uBump, uBandOn; uniform vec4 uBand; uniform vec3 uDark;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float mott = vnoise(vObj * 90.) * .6 + vnoise(vObj * 260.) * .4;
        diffuseColor.rgb *= .88 + .24 * mott;
        if (uBandOn > .5) { float t = (vObj.y - uBand.x) / (uBand.y - uBand.x);
          float edge = 1. - uBand.z + .05 * (vnoise(vObj * 400.) - .5) + .08 * abs(vObj.x) / max(uBand.y - uBand.x, 1e-4);
          diffuseColor.rgb = mix(diffuseColor.rgb, uDark * (.8 + .4 * mott), smoothstep(edge - .06, edge + .02, t)); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float fq = 1400.; float lod = length(fwidth(vObj)) * fq;
          float h = (vnoise(vObj * fq) + .5 * vnoise(vObj * fq * 2.3)) * 0.00012 * uBump * (1. - smoothstep(.25, .9, lod));
          normal = bumpNormal(-vViewPosition, normal, h, faceDirection); }`);
  };
  return m;
}

// Compound eye: glossy corneal lenses (the scan's facets drive the clearcoat highlights), pigment that darkens where
// the smoothed eye normal faces the camera (deep pseudopupil) and a faint hexagonal lattice between lenses.
function eyeMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: '#76100a', roughness: 0.6, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.3, sheenColor: new THREE.Color('#ff6a4a'), specularIntensity: 0.4 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aSmooth; varying vec3 vSmooth; varying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSmooth = normalize(normalMatrix * aSmooth); vObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vSmooth; varying vec3 vObj;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float facing = dot(normalize(vSmooth), normalize(vViewPosition));
        float pupil = smoothstep(.955, .995, facing);
        diffuseColor.rgb *= (.8 + .35 * vnoise(vObj * 180.)) * mix(1., .06, pupil);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.35, .02, .01), .25 * smoothstep(.6, .1, facing));`);
  };
  return m;
}

// Wing membrane: thin-film iridescence with a thickness map (thicker at the base and along the veins' axis, thinning
// towards the tip), specular kept at full strength while the membrane itself stays nearly clear
// (premultiplied output), and sparse microtrichia speckle.
function membraneMaterial(thicknessMap) {
  const m = new THREE.MeshPhysicalMaterial({ color: '#b8bcc2', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false,
    iridescence: 1, iridescenceIOR: 1.56, iridescenceThicknessRange: [120, 560], iridescenceThicknessMap: thicknessMap, specularIntensity: 0.7, envMapIntensity: 0.9 });
  m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vObj;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.a *= mix(.9 + .5 * step(.93, fhash(floor(vObj * 9000.))), 1., smoothstep(.2, .6, length(fwidth(vObj)) * 9000.));')
      .replace('#include <opaque_fragment>', `
        vec3 wSpec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
        gl_FragColor = vec4((outgoingLight - wSpec) * diffuseColor.a + wSpec, diffuseColor.a);`);
  };
  return m;
}

// ---------------- geometry utilities ----------------
function sampler(geo) {   // area-weighted random surface points with interpolated normals
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, I = geo.index.array, nt = I.length / 3;
  const cum = new Float64Array(nt); let tot = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < nt; t++) { a.fromArray(P, I[3 * t] * 3); b.fromArray(P, I[3 * t + 1] * 3).sub(a); c.fromArray(P, I[3 * t + 2] * 3).sub(a); tot += b.cross(c).length() / 2; cum[t] = tot; }
  return { area: tot, sample(rand, pos, nrm) {
    const r = rand() * tot; let lo = 0, hi = nt - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    let u = rand(), v = rand(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v;
    const i0 = I[3 * lo] * 3, i1 = I[3 * lo + 1] * 3, i2 = I[3 * lo + 2] * 3;
    pos.set(P[i0] * w + P[i1] * u + P[i2] * v, P[i0 + 1] * w + P[i1 + 1] * u + P[i2 + 1] * v, P[i0 + 2] * w + P[i1 + 2] * u + P[i2 + 2] * v);
    nrm.set(N[i0] * w + N[i1] * u + N[i2] * v, N[i0 + 1] * w + N[i1 + 1] * u + N[i2 + 1] * v, N[i0 + 2] * w + N[i1 + 2] * u + N[i2 + 2] * v).normalize();
  } };
}
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// one seta: a tapered, gently curved spine along +Y (curving towards +X), base at the origin
function setaGeometry(radial = 4, segs = 5) {
  const pos = [], idx = [];
  for (let s = 0; s <= segs; s++) { const t = s / segs, r = Math.pow(1 - t, 0.9) * (1 - 0.15 * t) + 0.02, x = 0.28 * t * t;
    for (let k = 0; k < radial; k++) { const a = k / radial * Math.PI * 2; pos.push(x + Math.cos(a) * r * 0.5 / 10, t, Math.sin(a) * r * 0.5 / 10); } }
  for (let s = 0; s < segs; s++) for (let k = 0; k < radial; k++) { const a = s * radial + k, b = s * radial + (k + 1) % radial; idx.push(a, a + radial, b, b, a + radial, b + radial); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const SETA = setaGeometry();
// the template has unit length and base radius 0.05, so an instance is scaled (radius / 0.05, length, radius / 0.05)
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
function setaMatrix(out, pos, dir, bendTo, len, radius) {
  _Y.copy(dir).normalize(); _X.copy(bendTo).addScaledVector(_Y, -_Y.dot(bendTo));
  if (_X.lengthSq() < 1e-12) _X.set(1, 0, 0).addScaledVector(_Y, -_Y.x); _X.normalize(); _Z.crossVectors(_X, _Y);
  out.makeBasis(_X, _Y, _Z); _s.set(radius / 0.05, len, radius / 0.05); out.scale(_s); out.setPosition(pos); return out;
}

// ---------------- load ----------------
const json = await fetch(`${BASE}body/fly_hd.json`).then(r => r.json());
const bin = await (async () => {
  const res = await fetch(`${BASE}body/fly_hd.bin`); const total = +res.headers.get('content-length') || 4928364;
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; status(`loading body mesh ${Math.min(100, got / total * 100).toFixed(0)}%`); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out.buffer;
})();
status('building cuticle and setae');
await new Promise(r => setTimeout(r, 0));

// body hierarchy from world poses: local = parentWorld⁻¹ · world
const root = new THREE.Group(); scene.add(root);
const bodies = {}, localPose = { rest: {}, spread: {} };
const worldOf = (pose, name) => { const a = json.poses[pose][name]; return { p: new THREE.Vector3(a[0], a[1], a[2]), q: new THREE.Quaternion(a[4], a[5], a[6], a[3]) }; };
for (const pose of ['rest', 'spread']) for (const name of Object.keys(json.poses[pose])) {
  const w = worldOf(pose, name), par = json.parents[name];
  if (!par || par === 'world') { localPose[pose][name] = w; continue; }
  const pw = worldOf(pose, par), iq = pw.q.clone().invert();
  localPose[pose][name] = { p: w.p.clone().sub(pw.p).applyQuaternion(iq), q: iq.multiply(w.q) };
}
// the spring-reference pose crouches the legs; keep the standing reference pose for everything but the folded wings
for (const name of Object.keys(localPose.rest)) if (!/^wing_/.test(name)) localPose.rest[name] = localPose.spread[name];
for (const [name, sign] of [['wing_left', 1], ['wing_right', -1]])
  localPose.rest[name].q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.22, 0.16 * sign, 'ZYX')));
for (const name of Object.keys(json.poses.rest)) { const g = new THREE.Group(); g.name = name; bodies[name] = g; }
for (const [name, g] of Object.entries(bodies)) { const par = json.parents[name]; (par && bodies[par] ? bodies[par] : root).add(g); const l = localPose.rest[name]; g.position.copy(l.p); g.quaternion.copy(l.q); }

// palette (wild-type Canton-S under white light)
const C = { tan: '#a8733d', thorax: '#94622f', leg: '#bb8a52', pale: '#d9bf92', bristle: '#1d130c', vein: '#5d3f26', claw: '#241710' };
const mats = {
  thorax: cuticle({ color: C.thorax, roughness: 0.6, sheen: 0.8, sheenColor: '#d9c3a0', clearcoat: 0.06, bump: 1.2 }),
  head: cuticle({ color: C.tan, roughness: 0.58, sheen: 0.7, sheenColor: '#d9c3a0', clearcoat: 0.08, bump: 1 }),
  leg: cuticle({ color: C.leg, roughness: 0.48, sheen: 0.55, bump: 0.4 }),
  pale: cuticle({ color: C.pale, roughness: 0.62, sheen: 0.4, clearcoat: 0.05, bump: 0.2 }),
  bristle: new THREE.MeshPhysicalMaterial({ color: C.bristle, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.4, sheenColor: new THREE.Color('#7a4a22') }),
  ocelli: new THREE.MeshPhysicalMaterial({ color: '#3a1d0c', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 }),
  eye: eyeMaterial(),
  vein: new THREE.MeshPhysicalMaterial({ color: C.vein, roughness: 0.45, clearcoat: 0.4, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
  claw: new THREE.MeshPhysicalMaterial({ color: C.claw, roughness: 0.3, clearcoat: 0.8 }),
};
const hairMats = {
  dark: new THREE.MeshPhysicalMaterial({ color: '#1e130b', roughness: 0.4, sheen: 0.25, sheenColor: new THREE.Color('#8a5a30'), sheenRoughness: 0.4 }),
  gold: new THREE.MeshPhysicalMaterial({ color: '#4a2f17', roughness: 0.45, sheen: 0.3, sheenColor: new THREE.Color('#b0834e'), sheenRoughness: 0.4 }),
  pale: new THREE.MeshPhysicalMaterial({ color: '#6a5038', roughness: 0.5, sheen: 0.25, sheenColor: new THREE.Color('#d8b890'), sheenRoughness: 0.4 }),
  comb: new THREE.MeshPhysicalMaterial({ color: '#0f0906', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 }),
};

const geoms = {}, meshes = [], tergites = [], hairGroups = [];
function wingThickness(geo) {   // planar UVs in the wing plane + a thickness map for the interference colours
  geo.computeBoundingBox(); const bb = geo.boundingBox, P = geo.attributes.position.array, uv = new Float32Array(P.length / 3 * 2);
  for (let i = 0; i < P.length / 3; i++) { uv[2 * i] = (P[3 * i] - bb.min.x) / (bb.max.x - bb.min.x); uv[2 * i + 1] = (P[3 * i + 1] - bb.min.y) / (bb.max.y - bb.min.y); }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
const thickTex = (() => {   // u across the chord, v along the span; base (v=1) thick, tip (v=0) thin, with slow ripples
  const W = 128, H = 256, d = new Uint8Array(W * H * 4), r = rng(7);
  const bumps = Array.from({ length: 14 }, () => [r(), r(), 0.05 + r() * 0.15, r() - 0.5]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const u = x / W, v = y / H;
    let t = 0.18 + 0.6 * Math.pow(v, 1.6) + 0.12 * Math.sin(u * 7 + v * 11) * (1 - v);
    for (const [bx, by, br, ba] of bumps) t += ba * 0.25 * Math.exp(-((u - bx) ** 2 + (v - by) ** 2) / (br * br));
    const val = Math.max(0, Math.min(255, t * 255)); const o = 4 * (y * W + x); d[o] = d[o + 1] = d[o + 2] = val; d[o + 3] = 255; }
  const tex = new THREE.DataTexture(d, W, H); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true; return tex;
})();
const membrane = membraneMaterial(thickTex);

for (const p of json.parts) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, p.vOff, p.vCount * 3), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, p.iOff, p.iCount), 1));
  geo.computeVertexNormals(); geoms[p.geom] = geo;
  const n = p.geom, body = p.body; let mat;
  if (n === 'head_red') { mat = mats.eye; addSmoothEyeNormals(geo); }
  else if (n === 'head_ocelli') mat = mats.ocelli;
  else if (/black|bristle/.test(n)) mat = mats.bristle;
  else if (/membrane/.test(n)) { wingThickness(geo); mat = membrane; }
  else if (/wing_.*brown/.test(n)) mat = mats.vein;
  else if (/claw/.test(n)) mat = mats.claw;
  else if (/lower/.test(n)) mat = mats.pale;
  else if (/^abdomen/.test(n)) { geo.computeBoundingBox(); const bb = geo.boundingBox;
    mat = cuticle({ color: C.tan, roughness: 0.5, sheen: 0.6, band: { y0: bb.min.y, y1: bb.max.y, frac: 0.3 } }); tergites.push({ n, mat }); }
  else if (/coxa|femur|tibia|tarsus|haltere/.test(n)) mat = mats.leg;
  else if (/thorax/.test(n)) mat = mats.thorax;
  else mat = mats.head;
  const mesh = new THREE.Mesh(geo, mat); mesh.name = n; mesh.castShadow = true; mesh.receiveShadow = !/membrane/.test(n);
  if (/membrane/.test(n)) mesh.renderOrder = 2;
  bodies[body].add(mesh); meshes.push(mesh);
}

// eye pseudopupil needs the eye's overall curvature, not the facet normals: fit a sphere per eye
function addSmoothEyeNormals(geo) {
  const P = geo.attributes.position.array, n = P.length / 3, out = new Float32Array(P.length);
  for (const side of [-1, 1]) {
    const idx = []; for (let i = 0; i < n; i++) if (Math.sign(P[3 * i]) === side) idx.push(i);
    // linear least squares: x²+y²+z² = 2ax + 2by + 2cz + d
    const A = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), M = new Float64Array(16), rhs = new Float64Array(4);
    for (const i of idx) { const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2], row = [2 * x, 2 * y, 2 * z, 1], s = x * x + y * y + z * z;
      for (let r = 0; r < 4; r++) { rhs[r] += row[r] * s; for (let c = 0; c < 4; c++) M[4 * r + c] += row[r] * row[c]; } }
    A.set(...M); A.invert(); const e = A.elements; // column-major
    const sol = [0, 1, 2].map(r => e[r] * rhs[0] + e[4 + r] * rhs[1] + e[8 + r] * rhs[2] + e[12 + r] * rhs[3]);
    for (const i of idx) { const v = new THREE.Vector3(P[3 * i] - sol[0], P[3 * i + 1] - sol[1], P[3 * i + 2] - sol[2]).normalize(); out.set([v.x, v.y, v.z], 3 * i); }
  }
  geo.setAttribute('aSmooth', new THREE.BufferAttribute(out, 3));
}

// ---------------- setae ----------------
// Direction conventions in each body frame: setae lean along `comb` (distal on legs, posterior on the abdomen),
// lying at 50–75° from the surface normal like real socketed bristles.
const restWorld = name => worldOf('rest', name);
function combOf(name) {
  const child = Object.keys(json.parents).find(c => json.parents[c] === name && !/haltere|wing|coxa|head|abdomen$/.test(c));
  if (child) return localPose.rest[child].p.clone().normalize();
  return new THREE.Vector3(0, Math.sign(localPose.rest[name].p.y) || 1, 0);
}
function addSetae(body, geomName, { density, len: [l0, l1], radius, mat, lean = [0.9, 1.25], comb = combOf(body), seed = 1, filter = null, cap = 6000 }) {
  const geo = geoms[geomName]; if (!geo) return;
  const s = sampler(geo), count = Math.min(cap, Math.round(s.area * density)), rand = rng(seed + geomName.length * 131);
  const im = new THREE.InstancedMesh(SETA, mat, count); im.castShadow = radius >= 0.0004;   // fine setae cast no visible shadow
  const pos = new THREE.Vector3(), nrm = new THREE.Vector3(), dir = new THREE.Vector3(), tan = new THREE.Vector3(); let k = 0;
  for (let tries = 0; k < count && tries < count * 4; tries++) {
    s.sample(rand, pos, nrm); if (filter && !filter(pos, nrm)) continue;
    tan.copy(comb).addScaledVector(nrm, -nrm.dot(comb)); if (tan.lengthSq() < 1e-8) tan.set(nrm.y, -nrm.x, 0); tan.normalize();
    const a = lean[0] + (lean[1] - lean[0]) * rand(), jitter = (rand() - 0.5) * 0.5;
    tan.applyAxisAngle(nrm, jitter);
    dir.copy(nrm).multiplyScalar(Math.cos(a)).addScaledVector(tan, Math.sin(a));
    pos.addScaledVector(nrm, -radius * 0.5);
    im.setMatrixAt(k++, setaMatrix(_m, pos, dir, tan, l0 + (l1 - l0) * rand(), radius * (0.8 + 0.4 * rand())));
  }
  im.count = k; im.name = `setae:${geomName}`; bodies[body].add(im); hairGroups.push(im); return im;
}

const legBodies = Object.keys(bodies).filter(n => /^(coxa|femur|tibia|tarsus\d?)_T\d_(left|right)$/.test(n));
for (const b of legBodies) {
  const tars = /tarsus/.test(b), tib = /tibia/.test(b);
  addSetae(b, b, { density: tars ? 380000 : tib ? 230000 : 150000, len: tars ? [0.0022, 0.0042] : [0.003, 0.0065], radius: 0.00022, mat: hairMats.gold, lean: [1.0, 1.35], seed: b.length });
  if (tib || /femur/.test(b)) addSetae(b, b, { density: 22000, len: [0.008, 0.014], radius: 0.00042, mat: hairMats.dark, lean: [0.75, 1.05], seed: 99 + b.length });
}
// abdomen: short setae over each tergite, a row of long bristles along its posterior margin, sparse hairs on sternites
for (const t of tergites) {
  const n = t.n, geo = geoms[n]; if (n === 'abdomen_8') { addSetae('abdomen_7', n, { density: 180000, len: [0.004, 0.009], radius: 0.0003, mat: hairMats.dark, comb: new THREE.Vector3(0, 1, 0) }); continue; }
  const body = n, bb = geo.boundingBox, H = bb.max.y - bb.min.y;
  addSetae(body, n, { density: 170000, len: [0.004, 0.0075], radius: 0.00028, mat: hairMats.dark, comb: new THREE.Vector3(0, 1, 0), filter: (p, nr) => nr.z > -0.35 });
  addSetae(body, n, { density: 140000, len: [0.011, 0.018], radius: 0.0004, mat: hairMats.dark, comb: new THREE.Vector3(0, 1, 0), lean: [0.85, 1.1], seed: 5,
    filter: (p, nr) => p.y > bb.max.y - H * 0.16 && nr.z > -0.2, cap: 160 });
  if (geoms[`${n}_lower`]) addSetae(body, `${n}_lower`, { density: 60000, len: [0.003, 0.006], radius: 0.00022, mat: hairMats.pale, comb: new THREE.Vector3(0, 1, 0) });
}
// head capsule, pleura, halteres, labellum, antennae
addSetae('head', 'head', { density: 90000, len: [0.0035, 0.007], radius: 0.00025, mat: hairMats.dark, comb: new THREE.Vector3(0, 1, 0.4).normalize() });
addSetae('thorax', 'thorax', { density: 60000, len: [0.003, 0.006], radius: 0.00022, mat: hairMats.dark, comb: new THREE.Vector3(-1, 0, 0), filter: (p, n) => n.z < 0.3 });
for (const sd of ['left', 'right']) {
  addSetae(`haltere_${sd}`, `haltere_${sd}`, { density: 400000, len: [0.0015, 0.003], radius: 0.00015, mat: hairMats.gold });
  addSetae(`labrum_${sd}`, `labrum_${sd}_lower`, { density: 500000, len: [0.002, 0.004], radius: 0.00016, mat: hairMats.pale, lean: [0.4, 0.8] });
  addSetae(`antenna_${sd}`, `antenna_${sd}`, { density: 700000, len: [0.0012, 0.0025], radius: 0.0001, mat: hairMats.pale, lean: [0.9, 1.3], cap: 2500 });
}
// interommatidial bristles: one short hair at roughly every third facet
addSetae('head', 'head_red', { density: 60000, len: [0.0016, 0.0024], radius: 0.00007, mat: hairMats.dark, lean: [0.25, 0.55], comb: new THREE.Vector3(0, 0, -1), cap: 2400, seed: 3 });

// wing margin: outline of the membrane in its plane (angular extremes around the centroid) with outward bristles
function addWingMargin(sd) {
  const geo = geoms[`wing_${sd}_membrane`], P = geo.attributes.position.array, n = P.length / 3;
  const c = new THREE.Vector3(); for (let i = 0; i < n; i++) c.x += P[3 * i] / n, c.y += P[3 * i + 1] / n, c.z += P[3 * i + 2] / n;
  const bins = 720, far = new Array(bins).fill(null);
  for (let i = 0; i < n; i++) { const dx = P[3 * i] - c.x, dy = P[3 * i + 1] - c.y, b = Math.floor((Math.atan2(dy, dx) / (2 * Math.PI) + 0.5) * bins) % bins, r = dx * dx + dy * dy;
    if (!far[b] || r > far[b][3]) far[b] = [P[3 * i], P[3 * i + 1], P[3 * i + 2], r]; }
  const pts = far.filter(Boolean), rand = rng(sd.length * 17), im = new THREE.InstancedMesh(SETA, hairMats.dark, pts.length * 3); let k = 0;
  const pos = new THREE.Vector3(), out = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  for (let j = 0; j < pts.length; j++) {
    const a = pts[j], b = pts[(j + 1) % pts.length], z = pts[(j + pts.length - 1) % pts.length];
    for (let h = 0; h < 3; h++) { const t = rand();
      pos.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      out.set(pos.x - c.x, pos.y - c.y, 0).normalize();
      const tipward = Math.max(0, -(pos.y - c.y) / 0.13);                 // span runs along −y: margin hairs lengthen toward the tip
      out.addScaledVector(new THREE.Vector3(b[0] - z[0], b[1] - z[1], 0).normalize(), 0.6 + 0.3 * rand()).normalize();
      im.setMatrixAt(k++, setaMatrix(_m, pos, out, up, 0.003 + 0.003 * tipward * rand() + 0.0015 * rand(), 0.00012)); } }
  im.count = k; im.name = `setae:wing_${sd}`; bodies[`wing_${sd}`].add(im); hairGroups.push(im);
}
addWingMargin('left'); addWingMargin('right');

// male sex comb: ~10 thick, blunt, black teeth in a row across the distal basitarsus, on its anterior-ventral face
const sexComb = [];
for (const sd of ['left', 'right']) {
  const b = `tarsus_T1_${sd}`, geo = geoms[b]; geo.computeBoundingBox(); const bb = geo.boundingBox, P = geo.attributes.position.array, N = geo.attributes.normal.array;
  const w = restWorld(b), toLocal = w.q.clone().invert();
  const want = new THREE.Vector3(0.7, 0, -0.7).applyQuaternion(toLocal).normalize();   // world anterior + ventral
  const distal = new THREE.Vector3(0, 1, 0), im = new THREE.InstancedMesh(SETA, hairMats.comb, 11); im.castShadow = true;
  const teeth = 11, pos = new THREE.Vector3(), nrm = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let k = 0; k < teeth; k++) {
    const y = bb.min.y + (bb.max.y - bb.min.y) * (0.55 + 0.38 * k / (teeth - 1)); let best = -Infinity;
    for (let i = 0; i < P.length / 3; i++) { if (Math.abs(P[3 * i + 1] - y) > 0.0008) continue; const v = N[3 * i] * want.x + N[3 * i + 1] * want.y + N[3 * i + 2] * want.z;
      if (v > best) { best = v; pos.fromArray(P, 3 * i); nrm.fromArray(N, 3 * i); } }
    pos.addScaledVector(distal, -0.0012 * Math.sin(k / (teeth - 1) * Math.PI));          // gentle arc like the real row
    dir.copy(nrm).multiplyScalar(0.45).addScaledVector(distal, 0.9).normalize();
    im.setMatrixAt(k, setaMatrix(_m, pos, dir, nrm.clone().negate(), 0.0042 + 0.0008 * Math.sin(k / (teeth - 1) * Math.PI), 0.00055));
  }
  im.name = `sexcomb:${sd}`; bodies[b].add(im); sexComb.push(im);
}

// flying: the wing sweeps its whole stroke every 4.6 ms, so it is drawn as faint copies across the stroke
const ghostMat = new THREE.MeshPhysicalMaterial({ color: '#aab2ba', roughness: 0.35, transparent: true, opacity: 0.013, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.5 });
const wingGhosts = ['left', 'right'].map(sd => { const src = bodies[`wing_${sd}`];
  return Array.from({ length: 16 }, (_, k) => { const g = new THREE.Group();
    for (const m of src.children) if (m.isMesh && !m.isInstancedMesh) g.add(new THREE.Mesh(m.geometry, ghostMat));
    g.visible = false; bodies.thorax.add(g); return { g, phase: k / 16 * Math.PI * 2 }; }); });
// wing mesh axes: span along −y (left) / +y (right, the mirror image), chord along ±x
const wingFrames = ['wing_left', 'wing_right'].map((w, wi) => { const sgn = wi ? -1 : 1;
  const span = new THREE.Vector3(0, -sgn, 0), chord = new THREE.Vector3(sgn, 0, 0);
  const chordBack = chord.clone().applyQuaternion(localPose.spread[w].q).x < 0;   // does +chord run to the trailing edge?
  return { sgn, chordBack, inv: new THREE.Matrix4().makeBasis(span, chord, span.clone().cross(chord)).transpose() }; });
const _S = new THREE.Vector3(), _C = new THREE.Vector3(), _M = new THREE.Matrix4(), _tilt = new THREE.Quaternion();

// ---------------- stage ----------------
root.updateMatrixWorld(true);
const box = new THREE.Box3(); for (const m of meshes) box.expandByObject(m);
let footZ = Infinity; for (const n of Object.keys(bodies).filter(n => /claw/.test(n))) footZ = Math.min(footZ, new THREE.Box3().setFromObject(bodies[n]).min.z);
const center = box.getCenter(new THREE.Vector3());
root.position.set(-center.x, -center.y, -footZ);
const target = new THREE.Vector3(0, 0, center.z - footZ);
controls.target.copy(target);
camera.position.set(0.55, -0.62, 0.36).add(target);
key.target.position.copy(target);

// ---------------- post ----------------
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1, 1); gtao.updateGtaoMaterial({ radius: 0.012, distanceExponent: 1.5, thickness: 0.6, scale: 1.1, samples: 12 });
composer.addPass(gtao);
const bokeh = new BokehPass(scene, camera, { focus: 0.8, aperture: 0.006, maxblur: 0.006 });
composer.addPass(bokeh);
composer.addPass(new OutputPass());
// see-through films (membranes, stroke blur) must not occlude in the AO and focus depth passes
const hideFilms = () => { const hidden = []; scene.traverse(o => { if (o.isMesh && o.visible && o.material.depthWrite === false && o !== backdrop) { o.visible = false; hidden.push(o); } }); return hidden; };
const withoutFilms = fn => function (...args) { const h = hideFilms(); try { return fn.apply(this, args); } finally { for (const o of h) o.visible = true; } };
gtao._renderOverride = withoutFilms(gtao._renderOverride);
bokeh.render = withoutFilms(bokeh.render);   // its only scene draw is the depth pass; the blur itself is a full-screen quad
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h); gtao.setSize(w * renderer.getPixelRatio() / 2, h * renderer.getPixelRatio() / 2); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();   // (AO runs at half resolution: it is low-frequency)

// ---------------- UI state ----------------
const state = { sex: 'm', wings: 'rest', wingBlend: 0, flight: 0, labels: false };
const setSeg = (attr, v) => document.querySelectorAll(`[data-${attr}]`).forEach(b => b.classList.toggle('on', b.dataset[attr] === v));
function applySex(sex) {
  state.sex = sex; setSeg('sex', sex); $('#sexLabel').textContent = sex === 'm' ? 'male' : 'female';
  for (const im of sexComb) im.visible = sex === 'm';
  for (const { n, mat } of tergites) {   // male A5–A6 (and the terminal segment) fully melanised; females banded throughout
    const full = sex === 'm' && /abdomen_(6|7|8)$/.test(n); mat.userData.u.uBand.value.z = full ? 1.2 : /abdomen$/.test(n) ? 0.18 : 0.32; }
  const s = sex === 'f' ? 1.1 : 1; root.scale.setScalar(s);
  for (const n of ['abdomen', 'abdomen_2', 'abdomen_3', 'abdomen_4', 'abdomen_5', 'abdomen_6']) bodies[n].scale.set(sex === 'f' ? 1.1 : 1, 1, sex === 'f' ? 1.08 : 1);
  root.position.z = -footZ * s;
}
function applyBg(bg) {
  setSeg('bg', bg); document.body.classList.toggle('dark', bg === 'dark');
  if (bg === 'dark') { backdropMat.uniforms.top.value.set('#0b0a09'); backdropMat.uniforms.bottom.value.set('#020202'); floor.material.opacity = 0.5; scene.environmentIntensity = 0.25; rim.intensity = 2.4; key.intensity = 1.8; fill.intensity = 0.06; }
  else { backdropMat.uniforms.top.value.set('#f7f4ef'); backdropMat.uniforms.bottom.value.set('#d9d2c7'); floor.material.opacity = 0.22; scene.environmentIntensity = 0.55; rim.intensity = 2.2; key.intensity = 2.6; fill.intensity = 0.35; }
}
document.querySelectorAll('[data-sex]').forEach(b => b.onclick = () => applySex(b.dataset.sex));
document.querySelectorAll('[data-wings]').forEach(b => b.onclick = () => { state.wings = b.dataset.wings; setSeg('wings', state.wings); });
document.querySelectorAll('[data-bg]').forEach(b => b.onclick = () => applyBg(b.dataset.bg));
$('#hairs').onchange = e => { for (const h of hairGroups) h.visible = e.target.checked; };
$('#dof').onchange = e => { bokeh.enabled = e.target.checked; };
$('#labels').onchange = e => { state.labels = e.target.checked; if (!state.labels) $('#tip').hidden = true; };
const qs = new URLSearchParams(location.search);
applySex(qs.get('sex') === 'f' ? 'f' : 'm'); applyBg(qs.get('bg') === 'dark' ? 'dark' : 'light');
if (qs.get('wings')) { state.wings = qs.get('wings'); setSeg('wings', state.wings); state.wingBlend = state.wings === 'rest' ? 0 : 1; state.flight = state.wings === 'flight' ? 1 : 0; }

// hover anatomy + double-click focus
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(ev) { ndc.set(ev.clientX / innerWidth * 2 - 1, -ev.clientY / innerHeight * 2 + 1); ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(meshes, false).find(h => h.object.visible && !/membrane/.test(h.object.name) || /membrane/.test(h.object.name)); }
let hoverQueued = null;
canvas.addEventListener('pointermove', ev => { if (!state.labels) return; hoverQueued = ev; });
canvas.addEventListener('dblclick', ev => { const h = pick(ev); if (h) focusTo.copy(h.point), focusing = 1; });
const focusTo = new THREE.Vector3(); let focusing = 0;
function updateHover() {
  if (!hoverQueued) return; const ev = hoverQueued; hoverQueued = null; const h = pick(ev), tip = $('#tip');
  const d = h && describe(h.object.name); if (!d) { tip.hidden = true; return; }
  tip.hidden = false; tip.querySelector('b').textContent = d[1]; tip.querySelector('span').textContent = d[2];
  tip.style.left = `${Math.min(ev.clientX + 16, innerWidth - 300)}px`; tip.style.top = `${Math.min(ev.clientY + 16, innerHeight - 140)}px`;
}

// ---------------- animation ----------------
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3();
const WINGS = ['wing_left', 'wing_right'];
const clock = new THREE.Timer(); let frame = 0;
function tick() {
  clock.update(); const dt = Math.min(clock.getDelta(), 0.05), t = clock.getElapsed();
  state.wingBlend += ((state.wings === 'rest' ? 0 : 1) - state.wingBlend) * (1 - Math.exp(-dt * 5));
  state.flight += ((state.wings === 'flight' ? 1 : 0) - state.flight) * (1 - Math.exp(-dt * 4));
  const wb = state.wingBlend * state.wingBlend * (3 - 2 * state.wingBlend);
  for (const name of Object.keys(bodies)) {
    const r = localPose.rest[name], s = localPose.spread[name], g = bodies[name];
    if (WINGS.includes(name) || /abdomen|haltere/.test(name)) g.quaternion.slerpQuaternions(r.q, s.q, name.startsWith('wing') ? wb : 0); else g.quaternion.copy(r.q);
  }
  // idle life: breathing abdomen, antennae twitching in the air current, small head movements, grooming-still legs
  const breathe = Math.sin(t * 2 * Math.PI * 0.35);
  for (let i = 2; i <= 7; i++) bodies[`abdomen_${i}`].quaternion.multiply(_q.setFromAxisAngle(_X.set(1, 0, 0), 0.006 * breathe));
  for (const [sd, ph] of [['left', 0], ['right', 1.7]]) {
    const tw = Math.sin(t * 3.1 + ph) * 0.5 + Math.sin(t * 7.3 + ph * 2) * 0.25 + Math.sin(t * 0.7 + ph) * 0.6;
    bodies[`antenna_${sd}`].quaternion.multiply(_q.setFromEuler(_e.set(0.05 * tw, 0, 0.04 * Math.sin(t * 1.3 + ph))));
    // halteres beat with the wings in flight
    bodies[`haltere_${sd}`].quaternion.multiply(_q.setFromAxisAngle(_X.set(1, 0, 0), state.flight * 0.5 * Math.sin(t * 173 + ph)));
  }
  bodies.head.quaternion.multiply(_q.setFromEuler(_e.set(0.02 * Math.sin(t * 0.9), 0.015 * Math.sin(t * 0.53 + 1), 0.03 * Math.sin(t * 0.41))));
  // flight: lift off, blur the wings across the stroke (±65° about the dorsal axis, pitching over at reversal)
  const fl = state.flight, flying = fl > 0.02;
  root.position.z = -footZ * root.scale.z + fl * 0.1 + fl * 0.004 * Math.sin(t * 2.2);
  root.rotation.y = -0.5 * fl;   // hovering flies hold the body ~45° nose-up, stroke plane near horizontal
  WINGS.forEach((w, wi) => { bodies[w].visible = !flying || fl < 0.5;
    const { sgn, chordBack, inv } = wingFrames[wi];
    // one cycle sampled evenly in time: stroke angle φ (positive = back) sinusoidal over ~145°, the wing
    // feathering at each reversal; stroke plane tilted to stay horizontal while the body pitches up
    _tilt.setFromAxisAngle(_Y.set(0, 1, 0), 0.5 * fl);
    for (const { g, phase } of wingGhosts[wi]) { g.visible = flying && fl >= 0.5; if (!g.visible) continue;
      const phi = 0.25 + 1.27 * Math.cos(phase), beta = 0.75 * Math.sin(phase);
      _S.set(-Math.sin(phi), sgn * Math.cos(phi), 0);
      _C.set(-Math.cos(phi), -sgn * Math.sin(phi), 0).multiplyScalar(Math.cos(beta)).addScaledVector(_Z.set(0, 0, 1), Math.sin(beta));
      if (!chordBack) _C.negate();
      _S.applyQuaternion(_tilt); _C.applyQuaternion(_tilt);
      _M.makeBasis(_S, _C, _Z.crossVectors(_S, _C)).multiply(inv); g.quaternion.setFromRotationMatrix(_M);
      g.position.copy(localPose.spread[w].p); }
  });
  if (focusing > 0) { controls.target.lerp(focusTo, 0.12); focusing = controls.target.distanceTo(focusTo) > 1e-4 ? 1 : 0; }
  controls.update();
  bokeh.uniforms.focus.value = camera.position.distanceTo(controls.target);
  const dist = camera.position.distanceTo(controls.target);
  bokeh.uniforms.aperture.value = 0.0045 / Math.max(dist, 0.15); bokeh.uniforms.maxblur.value = 0.008;
  updateHover();
  if (frame++ % 3 === 0) renderer.shadowMap.needsUpdate = true;   // idle motion is slow; flight moves the body but the shadow is far below
  composer.render();
  requestAnimationFrame(tick);
}
window.__fly = { camera, controls, state, bodies, gtao, bokeh, key, renderer, composer };   // for scripted screenshots
tick();
$('#loading').classList.add('done');
