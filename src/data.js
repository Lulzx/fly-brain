// Loads the preprocessed connectome files from /data.
const BASE = import.meta.env.BASE_URL; // "/" in dev, "/fly-brain/" on GitHub Pages
async function fetchBuf(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const total = +r.headers.get('content-length') || 0;
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress?.(got, total); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

export async function loadConnectome(onStatus) {
  const meta = await (await fetch(`${BASE}data/meta.json`)).json();
  const N = meta.N;
  onStatus?.('loading neurons');
  const nb = await fetchBuf(`${BASE}data/neurons.bin`);
  let off = 8;
  const bodyIds = new BigInt64Array(nb, off, N); off += N * 8;
  const soma = new Float32Array(nb, off, N * 3); off += N * 12;
  const indeg = new Uint32Array(nb, off, N); off += N * 4;
  const outdeg = new Uint32Array(nb, off, N); off += N * 4;
  const cls = new Uint16Array(nb, off, N); off += N * 2;
  const nt = new Uint8Array(nb, off, N); off += N;
  const superclass = new Uint8Array(nb, off, N); off += N;
  const side = new Uint8Array(nb, off, N); off += N;

  onStatus?.('loading connectivity');
  const gb = await fetchBuf(`${BASE}data/graph_w${meta.minWeight}.bin`, (g, t) => onStatus?.(`loading connectivity ${(g / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`));
  const hdr = new Uint32Array(gb, 0, 2); const E = hdr[1];
  const indptr = new Uint32Array(gb, 8, N + 1);
  const indices = new Uint32Array(gb, 8 + (N + 1) * 4, E);
  const weights = new Uint16Array(gb, 8 + (N + 1) * 4 + E * 4, E);

  let skel = null;
  try {
    onStatus?.('loading skeletons');
    const sb = await fetchBuf(`${BASE}data/skeletons_lo.bin`, (g, t) => onStatus?.(`loading skeletons ${(g / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`));
    const h = new Uint32Array(sb, 0, 4); const V = h[1], P = h[2];
    const bbox = new Float32Array(sb, 16, 6);
    let o = 40;
    const neuronPathOff = new Uint32Array(sb, o, N + 1); o += (N + 1) * 4;
    const pathOff = new Uint32Array(sb, o, P + 1); o += (P + 1) * 4;
    const q = new Uint16Array(sb, o, V * 3);
    skel = { V, P, bbox, neuronPathOff, pathOff, q };
  } catch (e) { console.warn('no skeleton bundle yet', e.message); }

  return { meta, N, E, bodyIds, soma, nt, superclass, cls, side, indeg, outdeg, indptr, indices, weights, skel };
}
