// Loads the packed connectome files (src/codec) from /data. Each file is fetched and decoded in its own
// worker, so the viewer can show somas while the connectivity and skeletons are still arriving.
const BASE = import.meta.env.BASE_URL; // "/" in dev, "/fly-brain/" on GitHub Pages
const FILES = __DATA_FILES__;          // { name: { v: content hash, size: bytes } }, injected by vite.config.js

function decodeInWorker(name, kind, onStatus, label) {
  const f = FILES[name], url = new URL(`${BASE}data/${name}?v=${f.v}`, location.href).href;
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./codec/decode.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data: m }) => {
      if (m.progress) onStatus?.(`${label} ${(m.progress[0] / 1e6).toFixed(1)} / ${(m.progress[1] / 1e6).toFixed(1)} MB`);
      else if (m.decoding) onStatus?.(`decoding ${label}`);
      else { w.terminate(); m.error ? reject(new Error(m.error)) : resolve(m.result); }
    };
    w.onerror = (e) => { w.terminate(); reject(e); };
    w.postMessage({ url, kind, size: f.size });
  });
}

/** meta + per-neuron table (types, classes, somas): small, enough to draw the brain */
export async function loadNeurons(onStatus) {
  const [meta, t] = await Promise.all([fetch(`${BASE}data/meta.json?v=${FILES['meta.json'].v}`).then(r => r.json()), decodeInWorker('neurons.flyn', 'neurons', onStatus, 'neurons')]);
  return { meta, ...t };
}

/** adds the synaptic graph (indptr/indices/weights, E, in/out degree) to `data` */
export async function loadGraph(data, onStatus) {
  const g = await decodeInWorker('graph.flyg', 'graph', onStatus, 'connectome');
  const { N } = data, indeg = new Uint32Array(N), outdeg = new Uint32Array(N);
  for (let i = 0; i < N; i++) outdeg[i] = g.indptr[i + 1] - g.indptr[i];
  for (let k = 0; k < g.E; k++) indeg[g.indices[k]]++;
  return Object.assign(data, { E: g.E, indptr: g.indptr, indices: g.indices, weights: g.weights, indeg, outdeg });
}

/** skeleton line geometry: { V, pos (µm), seg (vertex pairs), vOff (per neuron), bbox (µm) } */
export const loadSkeletons = (onStatus) => decodeInWorker('skeletons.flys', 'skel', onStatus, 'skeletons');

export async function loadConnectome(onStatus) { return loadGraph(await loadNeurons(onStatus), onStatus); }
