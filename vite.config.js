import { defineConfig } from 'vite';
// Cross-origin isolation enables SharedArrayBuffer (one read-only connectome shared by all fly workers)
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  worker: { format: 'es' },
  build: { target: 'esnext', rollupOptions: { input: { main: 'index.html', arena: 'arena.html' } } },
});
