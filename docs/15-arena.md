# 15. Arena app

Files: `arena.html`, `src/arena.js`, `src/sim/fly.worker.js`, `src/sim/fly.js`.

## Architecture
- The main thread loads data, writes the connectome and flyvis model into shared memory, and renders.
- Each fly runs in its own Web Worker with its own MuJoCo world and brain slot.
- Workers post poses every 16 ms of simulated time. The main thread shares other flies' positions so each
  world moves its proxies, which collide, are seen, and carry pheromone.
- Food consumption is summed across workers and broadcast back.

## Rendering
Three.js with flybody meshes per body part, shadows, a checkered floor and striped wall matching what the
eyes see, odour plumes as soft discs, and a brain inset showing the selected fly's activity at each soma.

## World presets

| Preset | Contents |
|---|---|
| Foraging arena | One fly, food with vinegar, bitter patch, hot patch, block |
| Open field | Three flies, five small food patches |
| Predator zone | Two flies, a looming threat every 6 s |
| Maze | Three walls, food at the far end |
| Social | Five flies, one food patch |

## Controls
Run and pause, speed, add fly, motor mode, follow camera, placement tools, looming threat, wind, light.
The panel shows each fly's behaviour label, energy, health, food eaten, distance, jumps, and live
descending-neuron commands.
