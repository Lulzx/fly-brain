# 2. Quickstart

## Requirements
- Node.js 20 or newer
- A Chromium-based browser (cross-origin isolation and SharedArrayBuffer are required)
- Python via `uv` only if you want to regenerate data

## Run
```sh
npm install
npm run dev
```
Then open:
- `http://localhost:5173/` for the connectome viewer
- `http://localhost:5173/arena.html` for the embodied arena

The dev server sends the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers set in
`vite.config.js`. Without them the arena cannot share memory between fly workers.

## Data
The app needs about 175 MB of preprocessed files in `public/`. If they are missing, regenerate them with
the [data pipeline](03-data-pipeline.md).

## Using the arena
1. Press **Run**.
2. Pick a **world** preset to reload with a different environment.
3. Use **Place** tools, then click the floor to add sugar, vinegar, CO₂, bitter, heat, or blocks.
4. Press **Looming threat** to send a dark object at the selected fly.
5. Adjust **wind** and **light**.
6. Click a fly to select it. Its brain activity appears in the inset, and its vital signs in the panel.

## Headless runs
```sh
node scripts/run_fly.mjs 6 nearodor
node scripts/behavior_report.mjs
```
See [Experiments and scripts](17-experiments.md).
