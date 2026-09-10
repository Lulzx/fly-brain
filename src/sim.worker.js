import { LIFNetwork } from './lif.js';
let net = null, running = false, timer = null, speed = 1, lastReal = 0, spikesWindow = 0, windowMs = 0;
function loop() {
  if (!running) return;
  const now = performance.now();
  let budget = Math.min(50, now - lastReal) * speed; lastReal = now;
  const t0 = performance.now();
  while (budget > 0 && performance.now() - t0 < 30) { spikesWindow += net.step().length; budget -= net.p.dt; windowMs += net.p.dt; }
  postMessage({ type: 'frame', t: net.t, trace: net.trace.slice(0), spikesWindow, windowMs, spikes: net.spikeCount });
  spikesWindow = 0; windowMs = 0;
  timer = setTimeout(loop, 16);
}
onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init': net = new LIFNetwork(m.N, m.indptr, m.indices, m.weights, m.nt); postMessage({ type: 'ready' }); break;
    case 'params': if (m.params.speed !== undefined) speed = m.params.speed; net.setParams(m.params); break;
    case 'run': running = true; lastReal = performance.now(); loop(); break;
    case 'pause': running = false; clearTimeout(timer); break;
    case 'reset': net.reset(); break;
    case 'drive': net.setDrive(m.indices, m.rate); break;
    case 'clearDrive': net.drive.fill(0); break;
    case 'pulse': net.pulse(m.indices, m.amount); break;
    case 'getState': postMessage({ type: 'state', v: net.v.slice(0), spikes: net.spikeCount.slice(0), t: net.t }); break;
  }
};
