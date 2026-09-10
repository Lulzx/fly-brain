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

## Brain panel
The right-hand panel follows the selected fly. Every 120 ms the page asks that fly's worker for:
- **Eyes:** the brightness in each of the 721 columns per eye that the flyvis model receives, drawn by
  azimuth and elevation with the front of each eye towards the middle.
- **Named neuron groups:** firing rate per side in Hz of simulated time, smoothed over about 150 ms,
  for smell, taste, photoreceptors, looming detectors (LC4, LPLC2), the giant fibre, forward and backward
  walking DNs, steering DNs, grooming DNs and feeding motor neurons. Each row keeps about 18 s of
  history. The "?" opens a short explanation. Hovering a row fades the brain inset and marks that
  group's somas.

Group membership is defined once in `src/sim/groups.js` and used by both the worker (`GroupMeter`)
and the page.

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
