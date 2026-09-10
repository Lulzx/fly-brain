import { defineConfig } from 'vite';
import { createHash } from 'crypto';
import fs from 'fs';
// Content hash + size of each packed data file: versioned URLs (cached forever by the decode worker)
// and exact download progress even when the host gzips the response.
const DATA_FILES = Object.fromEntries(['meta.json', 'neurons.flyn', 'graph.flyg', 'skeletons.flys'].map(f => {
  const b = fs.readFileSync(`public/data/${f}`);
  return [f, { v: createHash('sha1').update(b).digest('hex').slice(0, 10), size: b.length }];
}));
// Unpacked tables stay in public/data for the node scripts and Python pipeline but are not deployed.
const NOT_DEPLOYED = ['graph_w3.bin', 'neurons.bin'];
const dropUnpacked = { name: 'drop-unpacked-data', apply: 'build', closeBundle() { for (const f of NOT_DEPLOYED) fs.rmSync(`dist/data/${f}`, { force: true }); } };
// Cross-origin isolation enables SharedArrayBuffer (one read-only connectome shared by all fly workers)
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
export default defineConfig({
  base: process.env.BASE_PATH || '/', // CI sets /fly-brain/ for GitHub Pages
  plugins: [dropUnpacked],
  define: { __DATA_FILES__: JSON.stringify(DATA_FILES) },
  server: { headers: isolation },
  preview: { headers: isolation },
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  worker: { format: 'es' },
  build: { target: 'esnext', rollupOptions: { input: { main: 'index.html', arena: 'arena.html' } } },
});
