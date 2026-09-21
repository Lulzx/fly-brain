import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { loadCuticleDetail } from './fly-appearance.js';
import { loadBlenderFly, createBlenderFly, loadArenaDetail, blenderOutput } from './fly-blender.js';
import { ArenaBatches } from './arena-batches.js';
import { RenderResolution } from './render-resolution.js';
import { loadConnectome } from './data.js';
import { PRESETS } from './sim/world.js';
import { allocBrainMemory, MAX_FLIES } from './brainsetup.js';
import { parseFlyVis } from './flyvis.js';
import { buildGroups } from './sim/groups.js';
import { SCAFFOLD_IDS, createScaffoldSet } from './sim/scaffold/index.js';
const BASE = import.meta.env.BASE_URL; // "/" in dev, "/fly-brain/" on GitHub Pages

const $ = s => document.querySelector(s);
const status = s => { $('#status').textContent = s; };
const FLY_COLORS = ['#ffb347', '#5ac8fa', '#a3e635', '#f472b6', '#c084fc', '#facc15', '#fb7185', '#2dd4bf'];
const presetKey = new URLSearchParams(location.search).get('env') || 'foraging';
const PRESET = PRESETS[presetKey] || PRESETS.foraging;
// Worker-pool cap. Each fly is one worker running its own brain + MuJoCo world, so the
// practical ceiling is CPU-bound and machine-dependent: on a 16-core laptop aggregate
// throughput stops improving past ~6 flies. ?flies=N caps the pool so a slower machine can
// stay interactive. Defaults to MAX_FLIES, i.e. unchanged behaviour unless asked for, and is
// clamped there because MAX_FLIES is the designed ceiling (proxy bodies, colour cycle).
// The shared brain memory and each world's proxy bodies are both sized from FLY_CAP, so a
// lower cap also costs less memory and less per-step proxy work -- but it is fixed at load
// time and slots are never reclaimed (nothing calls worker.terminate), so this is a lifetime
// budget rather than a concurrency limit: changing it needs a page reload.
const FLY_CAP = Math.min(MAX_FLIES, Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('flies'))) || MAX_FLIES));
// ?vision=0 runs the flies blind: no eye raycasting (2 x 721 rays per fly per 20 ms) and no
// flyvis optic-lobe model. The ~62k optic-lobe neurons stay in the connectome and keep their
// chemical synapses -- they are simply never driven by light, so the fly navigates by smell,
// taste and touch alone. This is a behavioural change, not just an optimisation.
// Accepts the usual spellings of "off" so ?vision=false doesn't silently leave vision on.
const NO_VISION = ['0', 'false', 'off', 'no'].includes((new URLSearchParams(location.search).get('vision') || '').toLowerCase());
const env = PRESET.env();
const flies = [];          // {id, worker, group, bodies[], last, color, ready}
let flyvisMap, shared, meta, bodymap, flyXML, gait, visual, batches, outputPass, running = false, selected = 0, tool = 'none', speed = 2, brainMem, wasmModule, brainParams, neuromodCalib;

function toShared(ta) { const sab = new SharedArrayBuffer(ta.byteLength); const out = new ta.constructor(sab); out.set(ta); return out; }

async function main() {
  if (!crossOriginIsolated) console.warn('not cross-origin isolated: SharedArrayBuffer unavailable');
  const data = await loadConnectome(status);
  meta = data.meta;
  status('loading body model');
  const [bm, xml, g, blender, levels, output, sz, sg, bp, wasmBytes, fvb, fvj, fvi, fvm, nmc, detail, reaf] = await Promise.all([
    fetch(`${BASE}data/bodymap.json`).then(r => r.json()), fetch(`${BASE}body/fly_physics.xml`).then(r => r.text()), fetch(`${BASE}body/gait.json`).then(r => r.json()),
    loadBlenderFly(BASE, status), loadArenaDetail(BASE), blenderOutput(BASE),
    fetch(`${BASE}data/neuron_size.bin`).then(r => r.arrayBuffer()), fetch(`${BASE}data/ntsign.bin`).then(r => r.arrayBuffer()),
    fetch(`${BASE}data/brain_params.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})), fetch(`${BASE}lif.wasm`).then(r => r.arrayBuffer()),
    fetch(`${BASE}vision/flyvis.bin`).then(r => r.arrayBuffer()), fetch(`${BASE}vision/flyvis.json`).then(r => r.json()), fetch(`${BASE}vision/flyvis_inputs.json`).then(r => r.json()), fetch(`${BASE}vision/flyvis_map.json`).then(r => r.json()),
    fetch(`${BASE}data/neuromod.json`).then(r => r.ok ? r.json() : null).catch(() => null), loadCuticleDetail(`${BASE}body/cuticle_detail.png`),
    fetch(`${BASE}data/reafference.json`).then(r => r.ok ? r.json() : null).catch(() => null)]);
  // Passing null here also skips the sensoryMask that would otherwise zero these neurons'
  // incoming synapses (allocBrainMemory marks flyvis-driven neurons sensory because flyvis
  // normally replaces their input). Blind flies therefore keep an intact, wired optic lobe.
  const vision = NO_VISION ? null : { model: parseFlyVis(fvb, fvj, fvi), map: fvm };
  bodymap = bm; flyXML = xml; gait = g; visual = createBlenderFly(blender, detail, levels); outputPass = output;
  shared = { N: data.N, E: data.E, indptr: toShared(data.indptr), indices: toShared(data.indices), weights: toShared(data.weights), nt: toShared(data.nt),
    side: toShared(data.side), superclass: toShared(data.superclass), cls: toShared(data.cls), size: toShared(new Float32Array(sz)), sign: toShared(new Float32Array(sg)) };
  brainParams = { ...bp, neuromod: !!(bp.neuromod && nmc) };
  // the fitted self-motion cancel (spec S3) rides to the reafference plugin through scaffoldParams;
  // no file = unfitted model = inert channel
  if (reaf) brainParams.scaffoldParams = { ...(bp.scaffoldParams || {}), reafference: { ...(bp.scaffoldParams?.reafference || {}), model: reaf } };
  if (new URLSearchParams(location.search).get('gpu') === '0') brainParams.gpu = false;   // ?gpu=0 forces the WASM kernel
  // ?off=cpg,escapeGate disables scaffold plugins at load (docs/37-scaffold-ledger.md); the
  // panel checkboxes below toggle them live afterwards
  const offParam = (new URLSearchParams(location.search).get('off') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (offParam.length) brainParams.scaffolds = { ...(brainParams.scaffolds || {}), ...Object.fromEntries(offParam.map(id => [id, false])) };
  neuromodCalib = nmc; wasmModule = await WebAssembly.compile(wasmBytes);
  status('writing connectome into shared memory');
  status('writing connectome and optic-lobe model into shared memory');
  brainMem = allocBrainMemory({ ...data, superclass: data.superclass }, shared.size, shared.sign, brainParams, FLY_CAP, vision);
  flyvisMap = fvm;
  window.__data = data;
  buildBrainPanel(data);
  buildScene(data);
  buildUI();
  $('#loading').remove();
  const st0 = PRESET.start || [0, 0, 0];
  if (PRESET.flySpots) for (const s of PRESET.flySpots.slice(0, FLY_CAP)) await addFly(s.pos, s.yaw, s.sex);
  else { await addFly([st0[0], st0[1]], st0[2]);
    for (let k = 1; k < Math.min(PRESET.flies || 1, FLY_CAP); k++) { const ang = k * 2.4; await addFly([1.2 * Math.cos(ang), 1.2 * Math.sin(ang)], ang + Math.PI); } }
  if (PRESET.autoThreat) setInterval(() => { if (!running || !flies.length) return; const live = flies.filter(f => f.last?.alive !== false); if (!live.length) return; selected = live[Math.floor(Math.random() * live.length)].id; launchThreat(); }, PRESET.autoThreat * 1000);
  window.__arena = { camera, controls, flies, env, THREE, renderer, scene, gtao, composer, metrics, resolution, batches, visual, addFly, rebuildEnv, FLY_CAP, MAX_FLIES };
  animate();
}

// ---------------- scene ----------------
let renderer, scene, camera, controls, envGroup, raycaster, floorMesh, sun, composer, gtao, resolution;
let shadowDirty = true, lastShadow = -Infinity, shadowExtent = 0, lastBrainDraw = 0, brainDirty = true;
let brainColorFly = -1, brainColorHover = -2;
const shadowCenter = new THREE.Vector3(Infinity, Infinity, Infinity), viewPoint = new THREE.Vector3();
const viewFrustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), flyBounds = new THREE.Sphere(new THREE.Vector3(), 0.24);
const metrics = { calls: 0, triangles: 0, renderMs: 0, shadowUpdates: 0, brainUploads: 0, brainDraws: 0 };
let brainRenderer, brainScene, brainCam, brainPts, brainAct;
function buildScene(data) {
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: false, powerPreference: 'high-performance' });
  resolution = new RenderResolution(() => resize(), { targetFps: 120 });
  renderer.setPixelRatio(resolution.ratio); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  scene = new THREE.Scene(); scene.background = new THREE.Color('#0b0e14');
  scene.matrixAutoUpdate = false;
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture; scene.environmentIntensity = 0.24;
  room.dispose(); pmrem.dispose();
  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.005, 100); camera.up.set(0, 0, 1);
  camera.position.set(-1.2, -1.6, 1.3);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 0, 0.1);
  controls.minDistance = 0.16; controls.maxDistance = env.arena.radius * 5;
  scene.add(new THREE.HemisphereLight('#f4f2ed', '#514432', 0.22));
  sun = new THREE.DirectionalLight('#fff1da', 2.7); sun.position.set(3, 2, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.00002; sun.shadow.normalBias = 0.0003; sun.shadow.radius = 2;
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 20 }); scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight('#f9e5c4', 0.65); rim.position.set(-3, -2, 3); scene.add(rim);
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt); composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 0.012, distanceExponent: 1.5, thickness: 0.6, scale: 1, samples: 8 });
  // Cycles already baked body/hair occlusion. Keep the ground contact shadow; skip redundant AO.
  gtao.enabled = false; composer.addPass(gtao); composer.addPass(outputPass);
  // Only solid cuticle/environment surfaces belong in AO. Films, plume overlays and subpixel hairs do not.
  const override = gtao._renderOverride, hidden = [];
  gtao._renderOverride = function (...args) {
    scene.traverseVisible(o => { if (o.isMesh && (o.isInstancedMesh || o.material.transparent)) { hidden.push(o); o.visible = false; } });
    try { return override.apply(this, args); } finally { for (const o of hidden) o.visible = true; hidden.length = 0; }
  };
  function resize() {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setPixelRatio(resolution.ratio); renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
    gtao.setSize(Math.ceil(innerWidth * renderer.getPixelRatio() / 2), Math.ceil(innerHeight * renderer.getPixelRatio() / 2));
    shadowDirty = true;
  }
  addEventListener('resize', () => { resolution.reset(); resize(); }); resize();
  envGroup = new THREE.Group(); scene.add(envGroup); rebuildEnv();
  batches = new ArenaBatches(scene, visual, FLY_CAP);
  raycaster = new THREE.Raycaster();
  renderer.domElement.addEventListener('pointerdown', e => { pd = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => { if (pd && Math.hypot(e.clientX - pd[0], e.clientY - pd[1]) < 4) onClick(e); });
  // brain inset: soma point cloud colored by activity of the selected fly
  const bw = $('#brain').clientWidth || 358, bh = $('#brain').clientHeight || 220;
  brainRenderer = new THREE.WebGLRenderer({ canvas: $('#brain'), antialias: false, alpha: true }); brainRenderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  brainRenderer.setSize(bw, bh, false);
  brainScene = new THREE.Scene(); brainCam = new THREE.PerspectiveCamera(40, bw / bh, 1, 20000);
  const pos = new Float32Array(data.N * 3), col = new Float32Array(data.N * 3); const c = new THREE.Vector3(); let n = 0;
  for (let i = 0; i < data.N; i++) { const x = data.soma[i * 3]; if (!Number.isFinite(x)) { pos[i * 3] = 1e6; continue; } pos[i * 3] = x * 8e-3; pos[i * 3 + 1] = data.soma[i * 3 + 1] * 8e-3; pos[i * 3 + 2] = data.soma[i * 3 + 2] * 8e-3; c.x += pos[i * 3]; c.y += pos[i * 3 + 1]; c.z += pos[i * 3 + 2]; n++; }
  c.divideScalar(n); for (let i = 0; i < data.N; i++) { pos[i * 3] -= c.x; pos[i * 3 + 1] -= c.y; pos[i * 3 + 2] -= c.z; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.12; }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  brainPts = new THREE.Points(bg, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
  brainPts.rotation.x = Math.PI; brainScene.add(brainPts);
  hlPts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, transparent: true, opacity: 1, depthWrite: false, depthTest: false }));
  hlPts.visible = false; brainScene.add(hlPts);
  brainCam.position.set(0, 0, 1050); brainCam.lookAt(0, 0, 0); brainAct = new Float32Array(data.N);
}
let pd = null;
function discMesh(r, color, opacity = 1, z = 0.0015) { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.8 })); m.position.z = z; m.receiveShadow = true; return m; }
function rebuildEnv() {
  // Placement rebuilds own their resources; release old GPU buffers/textures before replacing them.
  envGroup.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
  envGroup.clear(); shadowDirty = true;
  const R = env.arena.radius;
  // floor: same 0.4 cm checker the flies' eyes see
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { cx.fillStyle = ((i + j) & 1) ? '#9c907a' : '#6f6554'; cx.fillRect(i * 32, j * 32, 32, 32); }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set((R + 0.2) * 2 / 0.8, (R + 0.2) * 2 / 0.8); tex.magFilter = THREE.LinearFilter; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); tex.colorSpace = THREE.SRGBColorSpace;
  floorMesh = new THREE.Mesh(new THREE.CircleGeometry(R + 0.1, 96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  floorMesh.receiveShadow = true; envGroup.add(floorMesh);
  // striped wall (24 stripes), matching the visual environment used for the compound eye
  const wc = document.createElement('canvas'); wc.width = 1024; wc.height = 8; const wx = wc.getContext('2d');
  for (let k = 0; k < 24; k++) { wx.fillStyle = (k & 1) ? '#c9c9cf' : '#2a2a2e'; wx.fillRect(k * 1024 / 24, 0, 1024 / 24 + 1, 8); }
  const wt = new THREE.CanvasTexture(wc); wt.colorSpace = THREE.SRGBColorSpace;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, env.arena.wallHeight, 96, 1, true), new THREE.MeshStandardMaterial({ map: wt, side: THREE.BackSide, roughness: 0.9 }));
  wall.rotation.x = Math.PI / 2; wall.position.z = env.arena.wallHeight / 2; envGroup.add(wall);
  for (const o of env.obstacles) { const m = new THREE.Mesh(o.type === 'box' ? new THREE.BoxGeometry(o.sx * 2, o.sy * 2, o.sz) : new THREE.CylinderGeometry(o.r, o.r, o.sz, 32), new THREE.MeshStandardMaterial({ color: '#3d4a3d', roughness: 0.7 }));
    if (o.type !== 'box') m.rotation.x = Math.PI / 2; m.position.set(o.x, o.y, o.sz / 2); m.castShadow = m.receiveShadow = true; envGroup.add(m); }
  for (const f of env.food) { const m = discMesh(f.r, '#f2c14e', 0.35 + 0.65 * Math.min(1, f.amount / 5)); m.position.set(f.x, f.y, 0.002); m.userData.food = f; envGroup.add(m); }
  for (const b of env.bitterPatches) { const m = discMesh(b.r, '#4f8fd6', 0.9); m.position.set(b.x, b.y, 0.002); envGroup.add(m); }
  for (const h of env.hazards) { const m = discMesh(h.r, '#d9502f', 0.9); m.position.set(h.x, h.y, 0.002); envGroup.add(m); const glow = discMesh(h.r + 0.4, '#d9502f', 0.12, 0.001); glow.position.set(h.x, h.y, 0.001); envGroup.add(glow); }
  for (const o of env.odors) { // plume as a soft radial gradient
    const g = document.createElement('canvas'); g.width = g.height = 128; const gx = g.getContext('2d'); const grd = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
    const col = o.odor === 'co2' ? '120,200,255' : '190,255,120'; grd.addColorStop(0, `rgba(${col},0.45)`); grd.addColorStop(1, `rgba(${col},0)`); gx.fillStyle = grd; gx.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.CircleGeometry(o.sigma * 2.2, 48), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(g), transparent: true, depthWrite: false }));
    m.position.set(o.x, o.y, 0.004); envGroup.add(m); }
}
function buildFlyMesh(color, sex) {
  const appearance = visual.instantiate(sex);
  // Fine ground marker leaves the legs and contact shadow readable at macro scale.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.175, 0.177, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }));
  scene.add(ring);
  return { ...appearance, ring };
}

// One instanced draw per wing film across the sampled beat cycle. Poses are thorax-local and immutable.
const blurMaterial = new THREE.MeshStandardMaterial({ color: '#c0c7ce', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, roughness: 0.35 });
blurMaterial.forceSinglePass = true;
function buildWingBlur(f, poses) {
  if (!poses) return;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);
  f.wingBlur = ['left', 'right'].map(sd => {
    const src = f.bodies[`wing_${sd}`]; if (!src) return null;
    const film = f.meshes.find(m => m.name === `wing_${sd}_membrane`);
    const blur = new THREE.InstancedMesh(film.userData.low, blurMaterial, poses[sd].length);
    poses[sd].forEach((p, k) => { position.set(p[0], p[1], p[2]); rotation.set(p[4], p[5], p[6], p[3]); blur.setMatrixAt(k, matrix.compose(position, rotation, scale)); });
    blur.computeBoundingSphere(); blur.visible = false; blur.renderOrder = 2; f.bodies.thorax.add(blur);
    return { src, blur };
  });
}
function updateWingBlur(f, s) {
  if (!f.wingBlur) return;
  for (const w of f.wingBlur) if (w) { w.src.visible = !s.flying; w.blur.visible = !!s.flying; }
}

// ---------------- flies ----------------
let nextId = 0;
async function addFly(pos, yaw, sex = 'm') {
  if (nextId >= FLY_CAP) { alert(`Worker-pool cap reached: ${FLY_CAP} flies (?flies=N to raise, max ${MAX_FLIES})`); return; }
  const id = nextId++; const color = FLY_COLORS[id % FLY_COLORS.length];
  const worker = new Worker(new URL('./sim/fly.worker.js', import.meta.url), { type: 'module' });
  const f = { id, worker, color, sex, ready: false, last: null, prev: null, stats: {}, ...buildFlyMesh(color, sex) };
  scene.add(f.group); flies.push(f); batches.add(f);
  worker.onmessage = e => onWorker(f, e.data);
  worker.postMessage({ type: 'init', id, graph: shared, meta, bodymap, flyXML, gait, env, pos, yaw, nProxies: FLY_CAP - 1, mode: $('#mode').value, brainOpts: brainParams, neuromod: neuromodCalib, vision: !NO_VISION, sex,
    brainMem: { memory: brainMem.memory, graph: brainMem.graph, bases: brainMem.bases, opts: brainMem.opts, fv: brainMem.fv }, wasmModule, slot: id, flyvisMap });
  await new Promise(res => { f.onReady = res; });
  if (running) worker.postMessage({ type: 'run' });
  worker.postMessage({ type: 'speed', speed });
  renderFlyList();
  return f;
}
function onWorker(f, m) {
  if (m.type === 'ready') { f.ready = true; f.bodyNames = m.bodyNames; f.bodyGroups = m.bodyNames.map(n => f.bodies[n] || null); buildWingBlur(f, m.wingPoses); f.onReady?.(); }
  else if (m.type === 'pose') {
    f.prev = f.last; f.last = m; shadowDirty = true;
    const received = performance.now(); f.poseInterval = f.recvAt ? Math.max(16, Math.min(100, received-f.recvAt)) : 1000/30; f.recvAt = received;
    m.foodEaten?.forEach((d, k) => { if (d > 0 && env.food[k]) { env.food[k].amount = Math.max(0, env.food[k].amount - d); foodDirty = true; } });
    if (f.id === selected && (f.prev?.takeoffPending !== m.takeoffPending || f.prev?.flying !== m.flying)) renderFlyList();
    broadcastOthers();
  } else if (m.type === 'activity' && f.id === selected && (f.activityTime !== m.t || histFly !== f.id)) {
    f.activityTime = m.t; brainAct.set(m.trace); brainDirty = true; onActivity(f, m);
  }
}
let foodDirty = false, lastOthers = 0;
function broadcastOthers() {
  const now = performance.now(); if (now - lastOthers < 1000 / 30) return; lastOthers = now;
  const poses = flies.filter(o => o.last && o.last.alive !== false).map(o => ({ id:o.id, x:o.last.pos[0], y:o.last.pos[1], z:o.last.pos[2], yaw:o.last.yaw, sex:o.sex }));
  for (const f of flies) if (f.ready) f.worker.postMessage({ type:'others', others:poses.filter(o => o.id !== f.id) });
}
function syncEnv() { for (const f of flies) if (f.ready) f.worker.postMessage({ type: 'env', env }); }

// ---------------- UI ----------------
function buildUI() {
  $('#play').onclick = () => { running = !running; for (const f of flies) f.worker.postMessage({ type: running ? 'run' : 'pause' }); $('#play').textContent = running ? '❚❚ Pause' : '▶ Run'; };
  $('#addFly').onclick = () => { const a = Math.random() * Math.PI * 2, r = Math.random() * env.arena.radius * 0.6; addFly([r * Math.cos(a), r * Math.sin(a)], Math.random() * Math.PI * 2); };
  $('#addFemale').onclick = () => { const a = Math.random() * Math.PI * 2, r = Math.random() * env.arena.radius * 0.6; addFly([r * Math.cos(a), r * Math.sin(a)], Math.random() * Math.PI * 2, 'f'); };
  $('#speed').oninput = e => { speed = +e.target.value; $('#speedv').textContent = speed.toFixed(2) + '×'; for (const f of flies) f.worker.postMessage({ type: 'speed', speed }); };
  $('#preset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${k === presetKey ? 'selected' : ''}>${p.label}</option>`).join('');
  $('#preset').onchange = e => { location.search = '?env=' + e.target.value; };
  $('#mode').onchange = e => { for (const f of flies) f.worker.postMessage({ type: 'mode', mode: e.target.value }); };
  document.querySelectorAll('.tools button').forEach(b => b.onclick = () => { tool = b.dataset.tool; document.querySelectorAll('.tools button').forEach(x => x.classList.toggle('on', x === b)); });
  setupFolds();
  setInterval(() => { const f = flies.find(x => x.id === selected); if (!document.hidden && f?.ready && !$('#brainpanel').classList.contains('folded')) f.worker.postMessage({ type: 'activity' }); }, 120);
  $('#wind').oninput = e => { const v = +e.target.value; $('#windv').textContent = v; env.wind = [v, 0]; syncEnv(); };
  $('#light').oninput = e => { env.light.sky = +e.target.value; scene.background = new THREE.Color().setHSL(0.6, 0.3, 0.02 + 0.05 * env.light.sky); syncEnv(); };
  $('#threat').onclick = () => launchThreat();
  $('#takeoff').onclick = () => flies.find(x => x.id === selected)?.worker.postMessage({ type: 'takeoff' });
  buildScaffoldUI();
  setInterval(() => { if (foodDirty) { foodDirty = false; syncEnv(); envGroup.children.forEach(m => { if (m.userData.food) m.material.opacity = 0.35 + 0.65 * Math.min(1, m.userData.food.amount / 5); }); } renderFlyList(); }, 500);
}
// Scaffold toggles: one checkbox per registered plugin (src/sim/scaffold/). Unchecking posts a new
// config to every fly's worker (FlyAgent.setScaffolds); new flies inherit via brainParams.scaffolds.
function buildScaffoldUI() {
  const box = $('#scaffolds'); if (!box) return;
  const titles = Object.fromEntries(SCAFFOLD_IDS.map(id => [id, createScaffoldSet()[id].title]));
  const state = () => Object.fromEntries(SCAFFOLD_IDS.map(id => [id, brainParams.scaffolds?.[id] !== false]));
  box.innerHTML = SCAFFOLD_IDS.map(id =>
    `<label class="scf" title="${titles[id]}"><input type="checkbox" data-scf="${id}" ${brainParams.scaffolds?.[id] === false ? '' : 'checked'}> ${id}</label>`).join('');
  box.querySelectorAll('input').forEach(cb => cb.onchange = () => {
    brainParams.scaffolds = { ...(brainParams.scaffolds || {}), [cb.dataset.scf]: cb.checked };
    const cfg = state();
    for (const f of flies) if (f.ready) f.worker.postMessage({ type: 'scaffolds', scaffolds: cfg });
  });
}
function onClick(e) {
  const m = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(m, camera);
  // select a fly?
  for (const f of flies) { const hit = raycaster.intersectObjects(f.meshes.filter(m => m.parent.visible), false); if (hit.length) { selected = f.id; renderFlyList(); return; } }
  if (tool === 'none') return;
  const hit = raycaster.intersectObject(floorMesh); if (!hit.length) return; const p = hit[0].point;
  if (tool === 'food') { env.food.push({ x: p.x, y: p.y, r: 0.25, sugar: 1, bitter: 0, water: 0.2, amount: 5 }); env.odors.push({ x: p.x, y: p.y, odor: 'vinegar', strength: 0.8, sigma: 0.7 }); }
  if (tool === 'odor') env.odors.push({ x: p.x, y: p.y, odor: 'vinegar', strength: 1, sigma: 0.9 });
  if (tool === 'co2') env.odors.push({ x: p.x, y: p.y, odor: 'co2', strength: 1, sigma: 0.8 });
  if (tool === 'bitter') env.bitterPatches.push({ x: p.x, y: p.y, r: 0.25, bitter: 1 });
  if (tool === 'hazard') env.hazards.push({ x: p.x, y: p.y, r: 0.3, heat: 1 });
  if (tool === 'obstacle') { alert('Obstacles change the physics world; they apply to flies added after this point.'); env.obstacles.push({ type: 'box', x: p.x, y: p.y, sx: 0.2, sy: 0.2, sz: 0.3 }); }
  rebuildEnv(); syncEnv();
}
function renderFlyList() {
  $('#nfly').textContent = flies.length;
  $('#flies').innerHTML = flies.map(f => { const s = f.last || {}; const e = s.energy ?? 0, h = s.health ?? 1;
    return `<div class="fly ${f.id === selected ? 'sel' : ''}" data-id="${f.id}"><i class="dot" style="background:${f.color}"></i>
      <div>${f.sex === 'f' ? '♀' : '♂'} fly ${f.id} <span style="color:var(--acc)">${s.behavior || ''}</span><div class="bar"><i style="width:${e * 100}%;background:#f2c14e"></i></div><div class="bar"><i style="width:${h * 100}%;background:#4ade80"></i></div></div>
      <span style="color:var(--dim)">${s.t ? (s.t / 1000).toFixed(1) + 's' : '…'}</span></div>`; }).join('');
  $('#flies').querySelectorAll('.fly').forEach(el => el.onclick = () => { selected = +el.dataset.id; renderFlyList(); });
  const f = flies.find(x => x.id === selected); $('#selsec').hidden = !f;
  $('#takeoff').textContent = f?.last?.takeoffPending ? (running ? 'Takeoff queued' : 'Takeoff queued · press Run') : 'Activate takeoff DNs';
  $('#takeoff').disabled = !f?.ready || f.last?.flying || f.last?.alive === false;
  if (f?.last) { const s = f.last, c = s.cmd || {};
    $('#sel').innerHTML = `<div class="kv"><span>behaviour</span><span style="color:var(--acc)">${s.behavior || ''}</span><span>energy</span><span>${(s.energy * 100).toFixed(0)}%</span><span>health</span><span>${(s.health * 100).toFixed(0)}%</span>
      <span>food eaten</span><span>${(s.eaten * 1000).toFixed(1)} mg·eq</span><span>distance travelled</span><span>${(s.dist || 0).toFixed(1)} cm</span><span>takeoffs / flights</span><span>${s.jumps || 0} / ${s.flights || 0}</span><span>endogenous state</span><span>${s.drive || '–'}</span>${s.nm ? `<span>AKH / insulin</span><span>${s.nm.akh.toFixed(2)} / ${s.nm.dilp.toFixed(2)}</span><span>octopamine (AKHR neurons)</span><span>${s.nm.oa.toFixed(1)} Hz, arousal ${(s.nm.arousal * 100).toFixed(0)}%</span>` : ''}<span>walk drive (BDN2/oDN1/P9)</span><span>${(c.drive || 0).toFixed(0)} Hz</span>
      <span>backward (MDN)</span><span>${(c.back || 0).toFixed(0)} Hz</span><span>steering (DNa01/02)</span><span>${(c.turn || 0).toFixed(2)}</span>
      <span>giant fibre</span><span>${(c.escape || 0).toFixed(0)} Hz</span><span>MN9 (proboscis)</span><span>${(s.mn9 || 0).toFixed(0)} Hz</span>
      <span>pharyngeal pump</span><span>${((s.feeding || 0) * 100).toFixed(0)}%</span><span>sensory neurons driven</span><span>${s.nSensory}</span></div>`; }
}

// ---------------- brain panel: what the selected fly sees, and its named neuron groups ----------------
const HIST = 150;                    // samples kept per trace (~18 s at the 120 ms poll)
let groups = [], hist = [], histFly = -1, hover = -1, hlShown = -1, hlPts = null, eyeDots = null;
// hovered group's neurons as large points over the inset (small groups vanish among 165k somas otherwise)
function showGroupInInset(j) {
  hlShown = j; hlPts.visible = j >= 0; if (j < 0) return;
  const g = groups[j], src = brainPts.geometry.attributes.position.array, pos = [];
  for (const ix of [g.L, g.R]) for (const i of ix) if (src[i * 3] < 1e5) pos.push(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
  hlPts.geometry.dispose(); hlPts.geometry = new THREE.BufferGeometry(); hlPts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hlPts.material.color.set(g.color);
}
function buildBrainPanel(data) {
  groups = buildGroups(bodymap, meta.types, data.side);
  $('#groups').innerHTML = groups.map((g, j) => `<div class="g" data-j="${j}">
      <span class="name"><i style="background:${g.color}"></i>${g.label} <small>${g.L.length + g.R.length}</small><button class="q" title="what is this?">?</button></span>
      <canvas width="236" height="48"></canvas><span class="v"><b class="l">–</b><b class="r">–</b></span>
      <div class="info" hidden>${g.info}</div></div>`).join('');
  $('#groups').querySelectorAll('.g').forEach(el => {
    const j = +el.dataset.j;
    el.onmouseenter = () => { hover = j; }; el.onmouseleave = () => { hover = -1; };
    el.querySelector('.q').onclick = () => { const i = el.querySelector('.info'); i.hidden = !i.hidden; };
  });
  // eye columns: azimuth/elevation of each column's viewing direction; the front of each eye faces the middle
  const W = 168, H = 116;
  eyeDots = ['L', 'R'].map(sd => flyvisMap.eyes[sd].dirs.map(([x, y, z]) => {
    const az = Math.atan2(y, x) * 180 / Math.PI, el = Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI;
    return [(sd === 'L' ? 165 - az : 10 - az) / 175 * (W - 8) + 4, (69 - el) / 129 * (H - 8) + 4];
  }));
  $('#brainpanel').hidden = false;
}
function onActivity(f, m) {
  if (histFly !== f.id) { histFly = f.id; hist = groups.map(() => [[], []]); $('#bpTitle').innerHTML = `Inside fly ${f.id} <i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${f.color}"></i>`; }
  const rows = $('#groups').children;
  groups.forEach((g, j) => {
    const h = hist[j]; h[0].push(m.groups[j * 2]); h[1].push(m.groups[j * 2 + 1]); if (h[0].length > HIST) { h[0].shift(); h[1].shift(); }
    const row = rows[j], cv = row.querySelector('canvas'), cx = cv.getContext('2d'), w = cv.width, hh = cv.height;
    const peak = Math.max(5, ...h[0], ...h[1]);
    cx.clearRect(0, 0, w, hh);
    [[h[0], '#6cb6ff'], [h[1], '#ff9f5a']].forEach(([ys, c]) => { cx.strokeStyle = c; cx.lineWidth = 2; cx.beginPath();
      ys.forEach((y, i) => { const px = w - (ys.length - 1 - i) * w / (HIST - 1), py = hh - 3 - y / peak * (hh - 6); i ? cx.lineTo(px, py) : cx.moveTo(px, py); }); cx.stroke(); });
    const fmt = (x) => x >= 100 ? x.toFixed(0) : x.toFixed(1);
    const v = row.querySelector('.v'); v.children[0].textContent = g.L.length ? fmt(m.groups[j * 2]) + ' Hz' : '–'; v.children[1].textContent = g.R.length ? fmt(m.groups[j * 2 + 1]) + ' Hz' : '–';
  });
  if (m.eyes) ['#eyeL', '#eyeR'].forEach((id, s) => {
    const cx = $(id).getContext('2d'), lum = m.eyes[s], dots = eyeDots[s];
    cx.fillStyle = '#05070c'; cx.fillRect(0, 0, 168, 116);
    for (let c = 0; c < dots.length; c++) { const v = Math.round(255 * Math.min(1, lum[c])); cx.fillStyle = `rgb(${v},${v},${v})`; cx.beginPath(); cx.arc(dots[c][0], dots[c][1], 3, 0, 6.2832); cx.fill(); }
  });
  else ['#eyeL', '#eyeR'].forEach(id => {   // ?vision=0: no eyes sampled, say so rather than leave a stale frame
    const cx = $(id).getContext('2d');
    cx.fillStyle = '#05070c'; cx.fillRect(0, 0, 168, 116);
    cx.fillStyle = '#5b6472'; cx.font = '11px system-ui, sans-serif'; cx.textAlign = 'center';
    cx.fillText('vision off', 84, 62);
  });
}

// ---------------- looming threat: a dark sphere swoops toward the selected fly's head from the front-side ----------------
let threatMesh = null, threatAnim = null;
function launchThreat() {
  const f = flies.find(x => x.id === selected); if (!f?.last) return;
  const p = f.last.pos, yaw = f.last.yaw, a = yaw + 0.6;
  const start = [p[0] + 3.0 * Math.cos(a), p[1] + 3.0 * Math.sin(a), 1.6], end = [p[0] + 0.25 * Math.cos(a), p[1] + 0.25 * Math.sin(a), 0.45];
  if (!threatMesh) { threatMesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 16), new THREE.MeshStandardMaterial({ color: '#0d0d10', roughness: 0.6 })); threatMesh.castShadow = true; scene.add(threatMesh); }
  threatAnim = { t0: performance.now(), start, end, dur: 700 / speed };
}
function updateThreat() {
  if (!threatAnim) return;
  const u = Math.min(1, (performance.now() - threatAnim.t0) / threatAnim.dur), k = u * u;   // accelerating approach
  const pos = threatAnim.start.map((s, i) => s + (threatAnim.end[i] - s) * k);
  if (u >= 1 && performance.now() - threatAnim.t0 > threatAnim.dur + 600) { threatAnim = null; env.threat = null; threatMesh.visible = false; shadowDirty = true; syncEnv(); return; }
  threatMesh.visible = true; threatMesh.position.set(...pos); env.threat = { x: pos[0], y: pos[1], z: pos[2] };
  for (const fl of flies) if (fl.ready) fl.worker.postMessage({ type: 'env', env: { threat: env.threat } });
}
// ---------------- render loop ----------------
let lastFrame = performance.now(), fpsN = 0, fpsT = 0, lastSim = 0, lastSimReal = performance.now();
const q = new THREE.Quaternion(), previousQ = new THREE.Quaternion(), followDelta = new THREE.Vector3(), brainBase = new THREE.Color();
function updateShadows(now) {
  const extent = Math.min(env.arena.radius + 0.5, Math.max(0.35, camera.position.distanceTo(controls.target) * 0.75));
  const center = controls.target;
  // Quantise camera following to avoid constantly shifting the shadow texels.
  if (Math.abs(extent - shadowExtent) > Math.max(0.04, extent * 0.1) || center.distanceToSquared(shadowCenter) > (extent * 0.06) ** 2) {
    shadowExtent = extent; shadowCenter.copy(center);
    sun.target.position.copy(center); sun.position.copy(center).add(shadowOffset);
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    sun.shadow.camera.updateProjectionMatrix(); shadowDirty = true;
  }
  if (shadowDirty && now - lastShadow >= 1000 / 30) {
    renderer.shadowMap.needsUpdate = true; shadowDirty = false; lastShadow = now; metrics.shadowUpdates++;
  }
}
const shadowOffset = new THREE.Vector3(3, 2, 8);
function animate() {
  requestAnimationFrame(animate);
  if (document.hidden) return;
  const now = performance.now(); fpsT += now - lastFrame; lastFrame = now; if (++fpsN === 30) { $('#fps').textContent = (30000 / fpsT).toFixed(0); fpsN = 0; fpsT = 0; }
  for (const f of flies) {
    const s = f.last; if (!s || !f.bodyGroups) continue;
    const previous = f.prev, blend = running && previous && s.t>previous.t ? Math.min(1,(now-f.recvAt)/f.poseInterval) : 1;
    f.poseUpdated = f.drawnPose !== s || f.drawnBlend !== blend;
    if (f.poseUpdated) {
      shadowDirty = true;
      for (let b = 1; b < f.bodyGroups.length; b++) { const g = f.bodyGroups[b]; if (!g) continue;
        g.position.set(s.xpos[b * 3], s.xpos[b * 3 + 1], s.xpos[b * 3 + 2]);
        q.set(s.xquat[b * 4 + 1], s.xquat[b * 4 + 2], s.xquat[b * 4 + 3], s.xquat[b * 4]);
        if (blend<1) {
          g.position.x=previous.xpos[b*3]+(g.position.x-previous.xpos[b*3])*blend;
          g.position.y=previous.xpos[b*3+1]+(g.position.y-previous.xpos[b*3+1])*blend;
          g.position.z=previous.xpos[b*3+2]+(g.position.z-previous.xpos[b*3+2])*blend;
          previousQ.set(previous.xquat[b*4+1],previous.xquat[b*4+2],previous.xquat[b*4+3],previous.xquat[b*4]);
          q.slerpQuaternions(previousQ,q,blend);
        }
        g.quaternion.copy(q); g.updateMatrix();
      }
      f.ring.position.set(s.pos[0], s.pos[1], 0.003);
      updateWingBlur(f, s); f.drawnPose = s; f.drawnBlend = blend;
    }
    f.ring.visible = f.id === selected;
  }
  const sf = flies.find(x => x.id === selected);
  if (sf?.last && $('#follow').checked) { const p = sf.last.pos; followDelta.set(p[0], p[1], p[2]).sub(controls.target).multiplyScalar(0.1); controls.target.add(followDelta); camera.position.add(followDelta); }
  if (sf?.last) { const t = sf.last.t / 1000; $('#simt').textContent = t.toFixed(2); if (now - lastSimReal > 1000) { $('#rt').textContent = ((t - lastSim) / ((now - lastSimReal) / 1000)).toFixed(2); lastSim = t; lastSimReal = now; } }
  updateThreat(); controls.update();
  camera.updateMatrixWorld();
  viewFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  let largest = 0;
  const projection = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  for (const f of flies) {
    if (!f.last) continue;
    flyBounds.center.fromArray(f.last.pos);
    viewPoint.fromArray(f.last.pos).applyMatrix4(camera.matrixWorldInverse);
    const pixels = viewPoint.z < 0 && viewFrustum.intersectsSphere(flyBounds) ? 0.3 * projection / Math.max(0.05, -viewPoint.z) : 0;
    largest = Math.max(largest, pixels);
    const changed = f.setDetail(pixels);
    if (changed) shadowDirty = true;
    batches.update(f, f.poseUpdated, changed);
  }
  batches.finish();
  resolution.update(now, largest > 290);
  if (threatAnim) shadowDirty = true;
  updateShadows(now);
  renderer.info.reset(); const renderStart = performance.now(); composer.render();
  metrics.renderMs = performance.now() - renderStart; metrics.calls = renderer.info.render.calls; metrics.triangles = renderer.info.render.triangles;
  // The trace arrives at ~8 Hz. Upload colours only when the trace, selection or highlight changes.
  // Rotate/draw the inset at 30 Hz independently from the main camera.
  if ($('#brainpanel').classList.contains('folded') || now - lastBrainDraw < 1000 / 30) return;
  const elapsed = Math.min(0.1, (now - lastBrainDraw) / 1000); lastBrainDraw = now;
  if (brainDirty || brainColorFly !== selected || brainColorHover !== hover) {
    const col = brainPts.geometry.attributes.color, a = col.array;
    brainBase.set(sf?.color || '#888'); const dim = hover >= 0 ? 0.08 : 1;
    for (let i = 0; i < brainAct.length; i++) {
      const v = Math.min(1, brainAct[i] * 1.6);
      a[i * 3] = dim * (0.1 + v * (brainBase.r - 0.1)); a[i * 3 + 1] = dim * (0.11 + v * (brainBase.g - 0.11)); a[i * 3 + 2] = dim * (0.14 + v * (brainBase.b - 0.14));
    }
    col.needsUpdate = true; brainDirty = false; brainColorFly = selected; brainColorHover = hover; metrics.brainUploads++;
  }
  if (hover !== hlShown) showGroupInInset(hover);
  brainPts.rotation.y += elapsed * 0.12; hlPts.rotation.copy(brainPts.rotation); brainRenderer.render(brainScene, brainCam); metrics.brainDraws++;

}
main().catch(e => { if ($('#status')) status('error: ' + e.message); console.error(e); });

// side panels fold to their title bar (chevron button, or the [ and ] keys); the choice persists
function setupFolds() {
  const folds = [['#panel', '#panelFold', '[', '‹', '›', 'controls'], ['#brainpanel', '#bpFold', ']', '›', '‹', 'brain panel']];
  const apply = ([panel, btn, key, open, shut, what], folded) => {
    $(panel).classList.toggle('folded', folded); const b = $(btn);
    b.textContent = folded ? shut : open; b.title = `${folded ? 'Show' : 'Hide'} ${what} (${key})`; b.setAttribute('aria-expanded', String(!folded));
    try { localStorage.setItem(`fold${panel}`, folded ? '1' : ''); } catch {}
  };
  for (const f of folds) {
    let saved = false; try { saved = localStorage.getItem(`fold${f[0]}`) === '1'; } catch {}
    apply(f, saved);
    $(f[1]).onclick = () => apply(f, !$(f[0]).classList.contains('folded'));
  }
  addEventListener('keydown', e => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const f = folds.find(x => x[2] === e.key); if (f) apply(f, !$(f[0]).classList.contains('folded'));
  });
}
