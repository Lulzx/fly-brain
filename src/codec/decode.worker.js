// Fetches one packed data file (with Cache Storage keyed by content hash), decodes it off the main
// thread and transfers the arrays back. Messages: {url, kind, size} -> {progress} ... {result} | {error}
import { decodeGraph } from './graph.js';
import { decodeSkel } from './skel.js';
import { decodeNeurons } from './neurons.js';

const DECODERS = { graph: decodeGraph, skel: decodeSkel, neurons: decodeNeurons };

async function fetchCached(url, size, progress) {
  const cache = self.caches ? await caches.open('fly-brain-data').catch(() => null) : null;
  const hit = cache && await cache.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const reader = r.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; progress(got, size); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  if (cache) {   // replace older versions of the same file
    const path = new URL(url).pathname;
    for (const k of await cache.keys()) if (new URL(k.url).pathname === path) await cache.delete(k);
    await cache.put(url, new Response(out)).catch(() => {});
  }
  return out;
}

self.onmessage = async ({ data: { url, kind, size } }) => {
  try {
    let last = 0;
    const bytes = await fetchCached(url, size, (got, total) => { const now = performance.now(); if (now - last > 100) { last = now; self.postMessage({ progress: [got, total] }); } });
    self.postMessage({ decoding: true });
    const res = DECODERS[kind](bytes);
    const transfer = Object.values(res).filter(v => ArrayBuffer.isView(v)).map(v => v.buffer);
    self.postMessage({ result: res }, [...new Set(transfer)]);
  } catch (e) { self.postMessage({ error: e.message }); }
};
