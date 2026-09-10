// Brain-viewer worker: the calibrated whole-CNS model (same wasm kernel and parameters as the arena flies).
import { allocBrainMemory, attachBrain } from './brainsetup.js';
let net = null, running = false, timer = null, speed = 1, lastReal = 0, spikesWindow = 0, windowMs = 0;
function loop() {
  if (!running) return;
  const now = performance.now();
  let budget = Math.min(50, now - lastReal) * speed; lastReal = now;
  const t0 = performance.now();
  while (budget > 0 && performance.now() - t0 < 30) { spikesWindow += net.step().length; budget -= net.p.dt; windowMs += net.p.dt; }
  postMessage({ type: 'frame', t: net.t, trace: net.trace.slice(0), spikesWindow, windowMs, spikes: net.spikeCount.slice(0) });
  spikesWindow = 0; windowMs = 0;
  timer = setTimeout(loop, 16);
}
onmessage = async (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      const data = { N: m.N, E: m.E, meta: m.meta, indptr: m.indptr, indices: m.indices, weights: m.weights, nt: m.nt, superclass: m.superclass, cls: m.cls, side: m.side };
      const mem = allocBrainMemory(data, m.size, m.sign, m.params, 1);
      net = await attachBrain(m.wasm, mem, 0, data, 1);
      postMessage({ type: 'ready' }); break; }
    case 'params': if (m.params.speed !== undefined) speed = m.params.speed; if (m.params.bgRate !== undefined) net.setBackground(m.params.bgRate, m.params.bgAmp ?? 1); break;
    case 'run': running = true; lastReal = performance.now(); loop(); break;
    case 'pause': running = false; clearTimeout(timer); break;
    case 'reset': net.reset(); break;
    case 'drive': net.setDrive(m.indices, m.rate); break;
    case 'clearDrive': for (const i of [...net.drivenSet]) net.setDriveOne(i, 0); break;
    case 'pulse': net.pulse(m.indices, m.amount); break;
  }
};
