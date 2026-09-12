import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadConnectome } from './data.js';
import { DEFAULT_ENV, PRESETS } from './sim/world.js';
import { allocBrainMemory, MAX_FLIES } from './brainsetup.js';
import { parseFlyVis } from './flyvis.js';
import { buildGroups } from './sim/groups.js';
const BASE = import.meta.env.BASE_URL; // "/" in dev, "/fly-brain/" on GitHub Pages

const $ = s => document.querySelector(s);
const status = s => { $('#status').textContent = s; };
const FLY_COLORS = ['#ffb347', '#5ac8fa', '#a3e635', '#f472b6', '#c084fc', '#facc15', '#fb7185', '#2dd4bf'];
const presetKey = new URLSearchParams(location.search).get('env') || 'foraging';
const PRESET = PRESETS[presetKey] || PRESETS.foraging;
const env = PRESET.env();
const flies = [];          // {id, worker, group, bodies[], last, color, ready}
let flyvisMap, shared, meta, bodymap, flyXML, gait, visual, running = false, selected = 0, tool = 'none', speed = 2, brainMem, wasmModule, brainParams, neuromodCalib;

function toShared(ta) { const sab = new SharedArrayBuffer(ta.byteLength); const out = new ta.constructor(sab); out.set(ta); return out; }

async function main() {
  if (!crossOriginIsolated) console.warn('not cross-origin isolated: SharedArrayBuffer unavailable');
  const data = await loadConnectome(status);
  meta = data.meta;
  status('loading body model');
  const [bm, xml, g, vj, vb, sz, sg, bp, wasmBytes, fvb, fvj, fvi, fvm, nmc] = await Promise.all([
    fetch(`${BASE}data/bodymap.json`).then(r => r.json()), fetch(`${BASE}body/fly_physics.xml`).then(r => r.text()), fetch(`${BASE}body/gait.json`).then(r => r.json()),
    fetch(`${BASE}body/fly_visual.json`).then(r => r.json()), fetch(`${BASE}body/fly_visual.bin`).then(r => r.arrayBuffer()),
    fetch(`${BASE}data/neuron_size.bin`).then(r => r.arrayBuffer()), fetch(`${BASE}data/ntsign.bin`).then(r => r.arrayBuffer()),
    fetch(`${BASE}data/brain_params.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})), fetch(`${BASE}lif.wasm`).then(r => r.arrayBuffer()),
    fetch(`${BASE}vision/flyvis.bin`).then(r => r.arrayBuffer()), fetch(`${BASE}vision/flyvis.json`).then(r => r.json()), fetch(`${BASE}vision/flyvis_inputs.json`).then(r => r.json()), fetch(`${BASE}vision/flyvis_map.json`).then(r => r.json()),
    fetch(`${BASE}data/neuromod.json`).then(r => r.ok ? r.json() : null).catch(() => null)]);
  const vision = { model: parseFlyVis(fvb, fvj, fvi), map: fvm };
  bodymap = bm; flyXML = xml; gait = g; visual = { json: vj, bin: vb };
  shared = { N: data.N, E: data.E, indptr: toShared(data.indptr), indices: toShared(data.indices), weights: toShared(data.weights), nt: toShared(data.nt),
    side: toShared(data.side), superclass: toShared(data.superclass), cls: toShared(data.cls), size: toShared(new Float32Array(sz)), sign: toShared(new Float32Array(sg)) };
  brainParams = { ...bp, neuromod: !!(bp.neuromod && nmc) }; neuromodCalib = nmc; wasmModule = await WebAssembly.compile(wasmBytes);
  status('writing connectome into shared memory');
  status('writing connectome and optic-lobe model into shared memory');
  brainMem = allocBrainMemory({ ...data, superclass: data.superclass }, shared.size, shared.sign, brainParams, MAX_FLIES, vision);
  flyvisMap = fvm;
  window.__data = data;
  buildBrainPanel(data);
  buildScene(data);
  buildUI();
  $('#loading').remove();
  const st0 = PRESET.start || [0, 0, 0];
  await addFly([st0[0], st0[1]], st0[2]);
  for (let k = 1; k < (PRESET.flies || 1); k++) { const ang = k * 2.4; await addFly([1.2 * Math.cos(ang), 1.2 * Math.sin(ang)], ang + Math.PI); }
  if (PRESET.autoThreat) setInterval(() => { if (!running || !flies.length) return; const live = flies.filter(f => f.last?.alive !== false); if (!live.length) return; selected = live[Math.floor(Math.random() * live.length)].id; launchThreat(); }, PRESET.autoThreat * 1000);
  window.__arena = { camera, controls, flies, env, THREE };
  animate();
}

// ---------------- scene ----------------
let renderer, scene, camera, controls, envGroup, raycaster, floorMesh;
let brainRenderer, brainScene, brainCam, brainPts, brainAct;
function buildScene(data) {
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  scene = new THREE.Scene(); scene.background = new THREE.Color('#0b0e14');
  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 100); camera.up.set(0, 0, 1);
  camera.position.set(-1.2, -1.6, 1.3);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 0, 0.1);
  scene.add(new THREE.HemisphereLight('#dde6ff', '#3a3020', 1.1));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(3, 2, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 }); scene.add(sun);
  envGroup = new THREE.Group(); scene.add(envGroup); rebuildEnv();
  raycaster = new THREE.Raycaster();
  renderer.domElement.addEventListener('pointerdown', e => { pd = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => { if (pd && Math.hypot(e.clientX - pd[0], e.clientY - pd[1]) < 4) onClick(e); });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  // brain inset: soma point cloud colored by activity of the selected fly
  const bw = $('#brain').clientWidth || 358, bh = $('#brain').clientHeight || 220;
  brainRenderer = new THREE.WebGLRenderer({ canvas: $('#brain'), antialias: false, alpha: true }); brainRenderer.setPixelRatio(devicePixelRatio);
  brainRenderer.setSize(bw, bh, false);
  brainScene = new THREE.Scene(); brainCam = new THREE.PerspectiveCamera(40, bw / bh, 1, 20000);
  const pos = new Float32Array(data.N * 3), col = new Float32Array(data.N * 3); const c = new THREE.Vector3(); let n = 0;
  for (let i = 0; i < data.N; i++) { const x = data.soma[i * 3]; if (!Number.isFinite(x)) { pos[i * 3] = 1e6; continue; } pos[i * 3] = x * 8e-3; pos[i * 3 + 1] = data.soma[i * 3 + 1] * 8e-3; pos[i * 3 + 2] = data.soma[i * 3 + 2] * 8e-3; c.x += pos[i * 3]; c.y += pos[i * 3 + 1]; c.z += pos[i * 3 + 2]; n++; }
  c.divideScalar(n); for (let i = 0; i < data.N; i++) { pos[i * 3] -= c.x; pos[i * 3 + 1] -= c.y; pos[i * 3 + 2] -= c.z; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.12; }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  brainPts = new THREE.Points(bg, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
  brainPts.rotation.x = Math.PI; brainScene.add(brainPts);
  hlPts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, transparent: true, opacity: 1, depthWrite: false, depthTest: false }));
  hlPts.visible = false; brainScene.add(hlPts);
  brainCam.position.set(0, 0, 1050); brainCam.lookAt(0, 0, 0); brainAct = new Float32Array(data.N);
}
let pd = null;
function discMesh(r, color, opacity = 1, z = 0.0015) { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.8 })); m.position.z = z; m.receiveShadow = true; return m; }
function rebuildEnv() {
  envGroup.clear();
  const R = env.arena.radius;
  // floor: same 0.4 cm checker the flies' eyes see
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { cx.fillStyle = ((i + j) & 1) ? '#9c907a' : '#6f6554'; cx.fillRect(i * 32, j * 32, 32, 32); }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set((R + 0.2) * 2 / 0.8, (R + 0.2) * 2 / 0.8); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
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
function buildFlyMesh(color) {
  const group = new THREE.Group(); const bodies = {};
  const { json, bin } = visual;
  const mats = new Map();
  for (const p of json.parts) {
    let b = bodies[p.body]; if (!b) { b = bodies[p.body] = new THREE.Group(); group.add(b); }
    const pos = new Float32Array(bin, p.vOff, p.vCount * 3), idx = new Uint32Array(bin, p.iOff, p.iCount);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    const key = p.rgba.join(',');
    let mat = mats.get(key); if (!mat) { const [r, g2, b2, a] = p.rgba; mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(r, g2, b2), transparent: a < 0.99, opacity: a, roughness: 0.55, metalness: 0.05, side: a < 0.99 ? THREE.DoubleSide : THREE.FrontSide }); mats.set(key, mat); }
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; b.add(mesh);
  }
  // selection ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.18, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  scene.add(ring);
  return { group, bodies, ring };
}

// beating wings: at 218 Hz a wing sweeps its whole stroke every 4.6 ms, far faster than any frame, so a flying
// fly is drawn with faint copies of each wing across the stroke cycle (poses from the worker), like motion blur
function buildWingBlur(f, poses) {
  if (!poses) return;
  f.wingBlur = ['left', 'right'].map(sd => {
    const src = f.bodies[`wing_${sd}`]; if (!src) return null;
    const ghosts = poses[sd].map(() => { const g = new THREE.Group();
      src.traverse(o => { if (o.isMesh) g.add(new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({ color: '#dfe6ee', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, roughness: 0.4 }))); });
      g.visible = false; f.group.add(g); return g; });
    return { src, ghosts, poses: poses[sd] };
  });
}
const _tq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _v = new THREE.Vector3();
function updateWingBlur(f, s) {
  if (!f.wingBlur) return;
  const th = f.bodyNames.indexOf('thorax'), on = !!s.flying;
  _tq.set(s.xquat[th * 4 + 1], s.xquat[th * 4 + 2], s.xquat[th * 4 + 3], s.xquat[th * 4]);
  for (const w of f.wingBlur) { if (!w) continue; w.src.visible = !on;
    w.ghosts.forEach((g, k) => { g.visible = on; if (!on) return; const p = w.poses[k];
      _v.set(p[0], p[1], p[2]).applyQuaternion(_tq); g.position.set(s.xpos[th * 3] + _v.x, s.xpos[th * 3 + 1] + _v.y, s.xpos[th * 3 + 2] + _v.z);
      _rq.set(p[4], p[5], p[6], p[3]); g.quaternion.copy(_tq).multiply(_rq); }); }
}

// ---------------- flies ----------------
let nextId = 0;
async function addFly(pos, yaw) {
  const id = nextId++; const color = FLY_COLORS[id % FLY_COLORS.length];
  const worker = new Worker(new URL('./sim/fly.worker.js', import.meta.url), { type: 'module' });
  const f = { id, worker, color, ready: false, last: null, prev: null, stats: {}, ...buildFlyMesh(color) };
  scene.add(f.group); flies.push(f);
  worker.onmessage = e => onWorker(f, e.data);
  if (id >= MAX_FLIES) { alert(`At most ${MAX_FLIES} flies`); return; }
  worker.postMessage({ type: 'init', id, graph: shared, meta, bodymap, flyXML, gait, env, pos, yaw, nProxies: 7, mode: $('#mode').value, brainOpts: brainParams, neuromod: neuromodCalib, vision: true,
    brainMem: { memory: brainMem.memory, graph: brainMem.graph, bases: brainMem.bases, opts: brainMem.opts, fv: brainMem.fv }, wasmModule, slot: id, flyvisMap });
  await new Promise(res => { f.onReady = res; });
  if (running) worker.postMessage({ type: 'run' });
  worker.postMessage({ type: 'speed', speed });
  renderFlyList();
}
function onWorker(f, m) {
  if (m.type === 'ready') { f.ready = true; f.bodyNames = m.bodyNames; f.bodyGroups = m.bodyNames.map(n => f.bodies[n] || null); buildWingBlur(f, m.wingPoses); f.onReady?.(); }
  else if (m.type === 'pose') {
    f.prev = f.last; f.last = m; f.recvAt = performance.now();
    m.foodEaten?.forEach((d, k) => { if (d > 0 && env.food[k]) { env.food[k].amount = Math.max(0, env.food[k].amount - d); foodDirty = true; } });
    broadcastOthers();
  } else if (m.type === 'activity') { if (f.id === selected) { brainAct.set(m.trace); onActivity(f, m); } }
}
let foodDirty = false, lastEnvSync = 0, lastOthers = 0;
function broadcastOthers() {
  const now = performance.now(); if (now - lastOthers < 20) return; lastOthers = now;
  for (const f of flies) { if (!f.ready) continue; f.worker.postMessage({ type: 'others', others: flies.filter(o => o !== f && o.last && o.last.alive !== false).map(o => ({ x: o.last.pos[0], y: o.last.pos[1], z: o.last.pos[2], yaw: o.last.yaw })) }); }
}
function syncEnv() { for (const f of flies) if (f.ready) f.worker.postMessage({ type: 'env', env }); }

// ---------------- UI ----------------
function buildUI() {
  $('#play').onclick = () => { running = !running; for (const f of flies) f.worker.postMessage({ type: running ? 'run' : 'pause' }); $('#play').textContent = running ? '❚❚ Pause' : '▶ Run'; };
  $('#addFly').onclick = () => { const a = Math.random() * Math.PI * 2, r = Math.random() * env.arena.radius * 0.6; addFly([r * Math.cos(a), r * Math.sin(a)], Math.random() * Math.PI * 2); };
  $('#speed').oninput = e => { speed = +e.target.value; $('#speedv').textContent = speed.toFixed(2) + '×'; for (const f of flies) f.worker.postMessage({ type: 'speed', speed }); };
  $('#preset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${k === presetKey ? 'selected' : ''}>${p.label}</option>`).join('');
  $('#preset').onchange = e => { location.search = '?env=' + e.target.value; };
  $('#mode').onchange = e => { for (const f of flies) f.worker.postMessage({ type: 'mode', mode: e.target.value }); };
  document.querySelectorAll('.tools button').forEach(b => b.onclick = () => { tool = b.dataset.tool; document.querySelectorAll('.tools button').forEach(x => x.classList.toggle('on', x === b)); });
  setupFolds();
  setInterval(() => { const f = flies.find(x => x.id === selected); if (f?.ready && !$('#brainpanel').classList.contains('folded')) f.worker.postMessage({ type: 'activity' }); }, 120);
  $('#wind').oninput = e => { const v = +e.target.value; $('#windv').textContent = v; env.wind = [v, 0]; syncEnv(); };
  $('#light').oninput = e => { env.light.sky = +e.target.value; scene.background = new THREE.Color().setHSL(0.6, 0.3, 0.02 + 0.05 * env.light.sky); syncEnv(); };
  $('#threat').onclick = () => launchThreat();
  $('#takeoff').onclick = () => flies.find(x => x.id === selected)?.worker.postMessage({ type: 'takeoff' });
  setInterval(() => { if (foodDirty) { foodDirty = false; syncEnv(); envGroup.children.forEach(m => { if (m.userData.food) m.material.opacity = 0.35 + 0.65 * Math.min(1, m.userData.food.amount / 5); }); } renderFlyList(); }, 500);
}
function onClick(e) {
  const m = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(m, camera);
  // select a fly?
  for (const f of flies) { const hit = raycaster.intersectObject(f.group, true); if (hit.length) { selected = f.id; renderFlyList(); return; } }
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
      <div>fly ${f.id} <span style="color:var(--acc)">${s.behavior || ''}</span><div class="bar"><i style="width:${e * 100}%;background:#f2c14e"></i></div><div class="bar"><i style="width:${h * 100}%;background:#4ade80"></i></div></div>
      <span style="color:var(--dim)">${s.t ? (s.t / 1000).toFixed(1) + 's' : '…'}</span></div>`; }).join('');
  $('#flies').querySelectorAll('.fly').forEach(el => el.onclick = () => { selected = +el.dataset.id; renderFlyList(); });
  const f = flies.find(x => x.id === selected); $('#selsec').hidden = !f;
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
  if (u >= 1 && performance.now() - threatAnim.t0 > threatAnim.dur + 600) { threatAnim = null; env.threat = null; threatMesh.visible = false; syncEnv(); return; }
  threatMesh.visible = true; threatMesh.position.set(...pos); env.threat = { x: pos[0], y: pos[1], z: pos[2] };
  for (const fl of flies) if (fl.ready) fl.worker.postMessage({ type: 'env', env: { threat: env.threat } });
}
// ---------------- render loop ----------------
let lastFrame = performance.now(), fpsN = 0, fpsT = 0, lastSim = 0, lastSimReal = performance.now();
const q = new THREE.Quaternion();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now(); fpsT += now - lastFrame; lastFrame = now; if (++fpsN === 30) { $('#fps').textContent = (30000 / fpsT).toFixed(0); fpsN = 0; fpsT = 0; }
  for (const f of flies) {
    const s = f.last; if (!s || !f.bodyGroups) continue;
    for (let b = 1; b < f.bodyGroups.length; b++) { const g = f.bodyGroups[b]; if (!g) continue;
      g.position.set(s.xpos[b * 3], s.xpos[b * 3 + 1], s.xpos[b * 3 + 2]); q.set(s.xquat[b * 4 + 1], s.xquat[b * 4 + 2], s.xquat[b * 4 + 3], s.xquat[b * 4]); g.quaternion.copy(q); }
    f.ring.position.set(s.pos[0], s.pos[1], 0.003); f.ring.visible = f.id === selected;
    updateWingBlur(f, s);
  }
  const sf = flies.find(x => x.id === selected);
  if (sf?.last && $('#follow').checked) { const p = sf.last.pos; const tgt = new THREE.Vector3(p[0], p[1], 0.08); const d = tgt.clone().sub(controls.target); controls.target.add(d.multiplyScalar(0.1)); camera.position.add(d); }
  if (sf?.last) { const t = sf.last.t / 1000; $('#simt').textContent = t.toFixed(2); if (now - lastSimReal > 1000) { $('#rt').textContent = ((t - lastSim) / ((now - lastSimReal) / 1000)).toFixed(2); lastSim = t; lastSimReal = now; } }
  updateThreat(); controls.update(); renderer.render(scene, camera);
  // brain inset (skipped while the brain panel is folded)
  if ($('#brainpanel').classList.contains('folded')) return;
  const col = brainPts.geometry.attributes.color; const a = col.array; const base = new THREE.Color(sf?.color || '#888');
  const dim = hover >= 0 ? 0.08 : 1;   // fade the rest of the brain while a group is highlighted
  for (let i = 0; i < brainAct.length; i++) { const v = Math.min(1, brainAct[i] * 1.6); a[i * 3] = dim * (0.1 + v * (base.r - 0.1)); a[i * 3 + 1] = dim * (0.11 + v * (base.g - 0.11)); a[i * 3 + 2] = dim * (0.14 + v * (base.b - 0.14)); }
  if (hover !== hlShown) showGroupInInset(hover);
  col.needsUpdate = true; brainPts.rotation.y += 0.002; hlPts.rotation.copy(brainPts.rotation); brainRenderer.render(brainScene, brainCam);
}
main().catch(e => { status('error: ' + e.message); console.error(e); });

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
