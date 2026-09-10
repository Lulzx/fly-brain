import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadConnectome } from './data.js';
import { FlyBrain } from './brain.js';

const $ = (s) => document.querySelector(s);
const status = (s) => { $('#status').textContent = s; };

// ---------- palettes ----------
const SC_COLORS = {
  ol_intrinsic: '#3a6ea5', ol_sensory: '#5ac8fa', visual_projection: '#2fb3c9', visual_centrifugal: '#7fd8be',
  cb_intrinsic: '#c084fc', cb_sensory: '#f472b6', cb_motor: '#fb7185', cb_efferent: '#f87171',
  vnc_intrinsic: '#facc15', vnc_sensory: '#fde68a', vnc_motor: '#fb923c', vnc_efferent: '#f97316',
  ascending_neuron: '#4ade80', descending_neuron: '#22c55e', sensory_ascending: '#a3e635',
  unknown: '#6b7280',
};
const NT_COLORS = ['#6b7280', '#38bdf8', '#f43f5e', '#f59e0b', '#a855f7', '#22c55e', '#facc15', '#fb7185'];
const SIDE_COLORS = ['#6b7280', '#38bdf8', '#f97316', '#e5e7eb'];

// ---------- state ----------
let data, brain, N;
let colorTex, actTex, texW = 2048, texH;
let lines, points, uniforms;
let trace = null, spikeCounts = null;
const hidden = new Set(); // hidden legend keys
let colorMode = 'superclass', showMode = 'skeletons';
let selected = -1;
const drives = []; // {label, indices, rate}

async function main() {
  data = await loadConnectome(status);
  N = data.N;
  status('starting simulation');
  brain = new FlyBrain(data);
  await brain.ready;
  buildScene();
  buildUI();
  $('#loading').remove();
  $('#summary').textContent = `${N.toLocaleString()} traced neurons · ${data.E.toLocaleString()} connections (≥${data.meta.minWeight} syn)`;
  brain.onFrame(onFrame);
  animate();
}

// ---------- scene ----------
let renderer, scene, camera, controls, raycaster;
function buildScene() {
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 20000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;

  texH = Math.ceil(N / texW);
  colorTex = new THREE.DataTexture(new Uint8Array(texW * texH * 4), texW, texH, THREE.RGBAFormat);
  colorTex.magFilter = colorTex.minFilter = THREE.NearestFilter;
  actTex = new THREE.DataTexture(new Float32Array(texW * texH), texW, texH, THREE.RedFormat, THREE.FloatType);
  actTex.magFilter = actTex.minFilter = THREE.NearestFilter;
  uniforms = { colorTex: { value: colorTex }, actTex: { value: actTex }, texW: { value: texW }, texH: { value: texH },
    opacity: { value: 0.25 }, selected: { value: -1 }, activeOnly: { value: 0 }, pointSize: { value: 2.5 * devicePixelRatio } };

  const glsl = {
    vert: (isPoint) => `
      attribute float nid; uniform sampler2D colorTex, actTex; uniform float texW, texH, pointSize;
      varying vec4 vColor; varying float vAct, vSel; uniform float selected;
      void main() {
        vec2 uv = vec2((mod(nid, texW) + 0.5) / texW, (floor(nid / texW) + 0.5) / texH);
        vColor = texture2D(colorTex, uv); vAct = texture2D(actTex, uv).r; vSel = (abs(nid - selected) < 0.5) ? 1.0 : 0.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        ${isPoint ? 'gl_PointSize = pointSize * (1.0 + 2.0 * vAct + 2.0 * vSel) * (600.0 / -mv.z + 0.4);' : ''}
      }`,
    frag: `
      varying vec4 vColor; varying float vAct, vSel; uniform float opacity, activeOnly;
      void main() {
        if (vColor.a < 0.01) discard;
        float a = max(vAct, vSel);
        if (activeOnly > 0.5 && a < 0.02) discard;
        vec3 hot = mix(vec3(1.0, 0.85, 0.3), vec3(1.0), vSel);
        vec3 col = mix(vColor.rgb, hot, a);
        float alpha = mix(opacity, 1.0, a);
        gl_FragColor = vec4(col * (0.6 + 1.4 * a), alpha);
      }`,
  };
  const mat = (isPoint) => new THREE.ShaderMaterial({ uniforms, vertexShader: glsl.vert(isPoint), fragmentShader: glsl.frag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  // --- somas as points ---
  const somaPos = new Float32Array(N * 3), somaId = new Float32Array(N);
  const center = new THREE.Vector3(); let cnt = 0;
  for (let i = 0; i < N; i++) { const x = data.soma[i * 3], y = data.soma[i * 3 + 1], z = data.soma[i * 3 + 2];
    if (Number.isFinite(x)) { somaPos[i * 3] = x * 8 / 1000; somaPos[i * 3 + 1] = y * 8 / 1000; somaPos[i * 3 + 2] = z * 8 / 1000; center.x += somaPos[i*3]; center.y += somaPos[i*3+1]; center.z += somaPos[i*3+2]; cnt++; }
    else { somaPos[i * 3] = somaPos[i * 3 + 1] = somaPos[i * 3 + 2] = 1e6; }
    somaId[i] = i; }
  center.divideScalar(cnt);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(somaPos, 3));
  pg.setAttribute('nid', new THREE.BufferAttribute(somaId, 1));
  pg.boundingSphere = new THREE.Sphere(center.clone(), 5000);
  points = new THREE.Points(pg, mat(true)); points.frustumCulled = false;
  scene.add(points);

  // --- skeletons as line segments ---
  if (data.skel) {
    const { V, P, bbox, neuronPathOff, pathOff, q } = data.skel;
    const pos = new Float32Array(V * 3), nid = new Float32Array(V);
    const sx = (bbox[3] - bbox[0]) / 65535 / 1000, sy = (bbox[4] - bbox[1]) / 65535 / 1000, sz = (bbox[5] - bbox[2]) / 65535 / 1000;
    for (let v = 0; v < V; v++) { pos[v * 3] = bbox[0] / 1000 + q[v * 3] * sx; pos[v * 3 + 1] = bbox[1] / 1000 + q[v * 3 + 1] * sy; pos[v * 3 + 2] = bbox[2] / 1000 + q[v * 3 + 2] * sz; }
    let nseg = 0; for (let p = 0; p < P; p++) nseg += Math.max(0, pathOff[p + 1] - pathOff[p] - 1);
    const idx = new Uint32Array(nseg * 2); let k = 0;
    for (let n = 0; n < N; n++) for (let p = neuronPathOff[n]; p < neuronPathOff[n + 1]; p++) {
      for (let v = pathOff[p]; v < pathOff[p + 1]; v++) nid[v] = n;
      for (let v = pathOff[p]; v + 1 < pathOff[p + 1]; v++) { idx[k++] = v; idx[k++] = v + 1; }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lg.setAttribute('nid', new THREE.BufferAttribute(nid, 1));
    lg.setIndex(new THREE.BufferAttribute(idx, 1));
    lines = new THREE.LineSegments(lg, mat(false)); lines.frustumCulled = false;
    scene.add(lines);
    center.set((bbox[0] + bbox[3]) / 2000, (bbox[1] + bbox[4]) / 2000, (bbox[2] + bbox[5]) / 2000);
  }
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0, 0, -1400));
  camera.up.set(0, -1, 0); // EM y axis points down (dorsal up)
  controls.update();
  raycaster = new THREE.Raycaster(); raycaster.params.Points.threshold = 3;
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  renderer.domElement.addEventListener('pointerdown', (e) => { pdown = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => { if (pdown && Math.hypot(e.clientX - pdown[0], e.clientY - pdown[1]) < 4) pick(e); });
  applyColors();
}
let pdown = null;
function pick(e) {
  const m = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(m, camera);
  const hits = raycaster.intersectObject(points);
  // choose the hit nearest to the ray among visible neurons
  let best = -1, bd = 1e9;
  for (const h of hits) { const i = h.index; if (colorTex.image.data[i * 4 + 3] === 0) continue; if (h.distanceToRay < bd) { bd = h.distanceToRay; best = i; } }
  select(best);
}

function keyOf(i) {
  if (colorMode === 'superclass') return data.meta.superclasses[data.superclass[i]];
  if (colorMode === 'nt') return data.meta.nts[data.nt[i]];
  if (colorMode === 'side') return ['?', 'L', 'R', 'M'][data.side[i]];
  return 'all';
}
function colorOf(key) {
  if (colorMode === 'superclass') return SC_COLORS[key] || '#6b7280';
  if (colorMode === 'nt') return NT_COLORS[data.meta.nts.indexOf(key)] || '#6b7280';
  if (colorMode === 'side') return SIDE_COLORS[['?', 'L', 'R', 'M'].indexOf(key)];
  return '#8892a6';
}
function applyColors() {
  const d = colorTex.image.data; const c = new THREE.Color(); const cache = new Map();
  for (let i = 0; i < N; i++) {
    const k = keyOf(i); let rgb = cache.get(k); if (!rgb) { c.set(colorOf(k)); rgb = [c.r * 255, c.g * 255, c.b * 255]; cache.set(k, rgb); }
    d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = hidden.has(k) ? 0 : 255;
  }
  colorTex.needsUpdate = true;
  // legend
  const keys = [...new Set(Array.from({ length: N }, (_, i) => keyOf(i)))].sort();
  $('#legend').innerHTML = keys.map(k => `<span data-k="${k}" class="${hidden.has(k) ? 'off' : ''}"><i style="background:${colorOf(k)}"></i>${k}</span>`).join('');
  $('#legend').querySelectorAll('span').forEach(el => el.onclick = () => { const k = el.dataset.k; hidden.has(k) ? hidden.delete(k) : hidden.add(k); applyColors(); });
}

// ---------- simulation frames ----------
let lastFrameT = performance.now(), fpsAcc = 0, fpsN = 0;
function onFrame(m) {
  trace = m.trace; spikeCounts = m.spikes;
  actTex.image.data.set(trace); actTex.needsUpdate = true;
  $('#simt').textContent = m.t.toFixed(0);
  if (m.windowMs > 0) $('#rate').textContent = (m.spikesWindow / (m.windowMs / 1000)).toFixed(0);
  let act = 0; for (let i = 0; i < N; i++) if (trace[i] > 0.05) act++;
  $('#active').textContent = act.toLocaleString();
  if (selected >= 0) renderSelection();
}
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now(); fpsAcc += now - lastFrameT; lastFrameT = now; if (++fpsN === 30) { $('#fps').textContent = (30000 / fpsAcc).toFixed(0); fpsAcc = 0; fpsN = 0; }
  controls.update();
  if (lines) lines.visible = showMode !== 'somas';
  points.visible = showMode !== 'skeletons' || !lines;
  uniforms.activeOnly.value = showMode === 'active' ? 1 : 0;
  renderer.render(scene, camera);
}

// ---------- groups & stimulation ----------
function groupIndices(kind, query, side) {
  const out = []; const q = query.trim().toLowerCase();
  if (!q) return out;
  for (let i = 0; i < N; i++) {
    if (side && data.side[i] !== side) continue;
    let v;
    if (kind === 'superclass') v = data.meta.superclasses[data.superclass[i]];
    else if (kind === 'class') v = data.meta.classes[data.cls[i]];
    else v = data.meta.types[i];
    if (v && v.toLowerCase() === q) out.push(i);
  }
  return out;
}
function fillDatalist() {
  const kind = $('#groupKind').value;
  let vals = kind === 'superclass' ? data.meta.superclasses : kind === 'class' ? data.meta.classes : [...new Set(data.meta.types)];
  vals = vals.filter(Boolean).sort();
  $('#groupList').innerHTML = vals.slice(0, 4000).map(v => `<option value="${v}">`).join('');
}
function renderDrives() {
  $('#drives').innerHTML = drives.map((d, i) => `<li><span>${d.label} · ${d.indices.length} neurons · ${d.rate} Hz</span><button data-i="${i}">✕</button></li>`).join('');
  $('#drives').querySelectorAll('button').forEach(b => b.onclick = () => { const d = drives.splice(+b.dataset.i, 1)[0]; brain.drive(d.indices, 0); renderDrives(); });
}

function select(i) {
  selected = i; uniforms.selected.value = i;
  $('#selection').hidden = i < 0;
  if (i >= 0) renderSelection();
}
function renderSelection() {
  const i = selected; const m = data.meta;
  const partners = (dir) => {
    const list = [];
    if (dir === 'out') { for (let j = data.indptr[i]; j < data.indptr[i + 1]; j++) list.push([data.indices[j], data.weights[j]]); }
    else { /* inputs: scan is expensive; cache on demand */ list.push(...(inputsOf(i))); }
    list.sort((a, b) => b[1] - a[1]);
    return list.slice(0, 25).map(([j, w]) => `<div data-j="${j}"><span>${m.types[j] || m.superclasses[data.superclass[j]]} <small style="color:var(--dim)">${data.bodyIds[j]}</small></span><span>${w}${spikeCounts ? ` · ${spikeCounts[j]}⚡` : ''}</span></div>`).join('');
  };
  $('#selinfo').innerHTML = `<div><b>${m.types[i] || '(untyped)'}</b> ${m.instances[i] ? `<span style="color:var(--dim)">${m.instances[i]}</span>` : ''}</div>
    <div>body ${data.bodyIds[i]} · ${m.superclasses[data.superclass[i]]} · ${m.nts[data.nt[i]]} · side ${['?', 'L', 'R', 'M'][data.side[i]]}</div>
    <div>in ${data.indeg[i]} · out ${data.outdeg[i]} partners${spikeCounts ? ` · <b>${spikeCounts[i]}</b> spikes` : ''}</div>
    <div class="row" style="margin-top:6px"><button id="stimSel">Drive this neuron</button><button id="pulseSel">Pulse</button><button id="stimType">Drive its type</button></div>
    <div style="margin-top:6px;color:var(--dim)">strongest outputs</div><div class="partners">${partners('out')}</div>
    <div style="margin-top:6px;color:var(--dim)">strongest inputs</div><div class="partners">${partners('in')}</div>`;
  $('#stimSel').onclick = () => addDrive(`${m.types[i] || 'body'} ${data.bodyIds[i]}`, [i], +$('#rateHz').value);
  $('#pulseSel').onclick = () => brain.pulse([i], 10);
  $('#stimType').onclick = () => { const ix = groupIndices('type', m.types[i], 0); addDrive(m.types[i], ix, +$('#rateHz').value); };
  $('#selinfo').querySelectorAll('.partners div').forEach(el => el.onclick = () => select(+el.dataset.j));
}
let inCSR = null;
function inputsOf(i) {
  if (!inCSR) { // build reverse CSR once
    const cnt = new Uint32Array(N + 1); for (let k = 0; k < data.E; k++) cnt[data.indices[k] + 1]++;
    for (let k = 0; k < N; k++) cnt[k + 1] += cnt[k];
    const pre = new Uint32Array(data.E), w = new Uint16Array(data.E), fill = cnt.slice(0, N);
    for (let p = 0; p < N; p++) for (let k = data.indptr[p]; k < data.indptr[p + 1]; k++) { const q = data.indices[k]; const o = fill[q]++; pre[o] = p; w[o] = data.weights[k]; }
    inCSR = { ptr: cnt, pre, w };
  }
  const out = []; for (let k = inCSR.ptr[i]; k < inCSR.ptr[i + 1]; k++) out.push([inCSR.pre[k], inCSR.w[k]]); return out;
}
function addDrive(label, indices, rate) {
  if (!indices.length) return;
  drives.push({ label, indices, rate }); brain.drive(indices, rate); renderDrives();
}

// ---------- UI ----------
function buildUI() {
  let running = false;
  $('#play').onclick = () => { running = !running; running ? brain.run() : brain.pause(); $('#play').textContent = running ? '❚❚ Pause' : '▶ Run'; };
  $('#reset').onclick = () => brain.reset();
  $('#speed').oninput = (e) => { brain.setParams({ speed: +e.target.value }); $('#speedv').textContent = `${(+e.target.value).toFixed(2)}×`; };
  brain.setParams({ speed: 0.5 });
  $('#wSyn').onchange = (e) => brain.setParams({ wSyn: +e.target.value });
  $('#noise').onchange = (e) => brain.setParams({ noise: +e.target.value });
  $('#adaptInc').onchange = (e) => brain.setParams({ adaptInc: +e.target.value });
  $('#depU').onchange = (e) => brain.setParams({ depU: +e.target.value });
  $('#opacity').oninput = (e) => uniforms.opacity.value = +e.target.value;
  $('#colorMode').onchange = (e) => { colorMode = e.target.value; hidden.clear(); applyColors(); };
  $('#showMode').onchange = (e) => showMode = e.target.value;
  $('#groupKind').onchange = fillDatalist; fillDatalist();
  const grp = () => groupIndices($('#groupKind').value, $('#groupQuery').value, +$('#groupSide').value);
  $('#addDrive').onclick = () => addDrive(`${$('#groupQuery').value}${['', ' L', ' R'][+$('#groupSide').value]}`, grp(), +$('#rateHz').value);
  $('#pulse').onclick = () => brain.pulse(grp(), 10);
  window.addEventListener('keydown', (e) => { if (e.key === ' ' && e.target === document.body) { e.preventDefault(); $('#play').click(); } if (e.key === 'Escape') select(-1); });
}
main().catch(e => { status('error: ' + e.message); console.error(e); });
