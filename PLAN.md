# Roadmap: from connectome to embodied, autonomous flies

## Phase 1 — see it and simulate it (this repo, done)
- Male CNS v1.0 connectome loaded in the browser, LIF simulation in a worker, 3D view of all neurons.
- `FlyBrain` is self-contained: one worker per fly; inputs `drive(indices, Hz)`, outputs spike counts / traces.

## Phase 2 — a body the brain controls (nothing scripted by us)
Goal: sensors → sensory neurons, motor neurons → muscles; the network decides everything.
- **Body**: MuJoCo `flybody` (Janelia/DeepMind, anatomically detailed adult fly, 59 DoF incl. wings, legs,
  antennae, head) or NeuroMechFly v2 (EPFL). Both are MuJoCo MJCF; MuJoCo runs in the browser via
  `mujoco-wasm`. flybody already exposes leg/wing/antenna actuators and touch/joint sensors.
- **Motor side**: the male CNS annotates VNC motor neurons (`vnc_motor`, 708 neurons) with MANC types that
  name their target muscles (leg muscles per segment, wing steering/power muscles, neck, abdomen).
  Map each motor neuron's spike rate → muscle activation via a low-pass filter (muscle twitch ~20 ms).
- **Sensory side** (all real cell classes in the connectome):
  - Vision: render the arena from the fly's head with two hemispherical cameras → photoreceptor
    (`ol_sensory`, R1–R8) drive rates per ommatidium column.
  - Olfaction / taste: odor & sugar concentration fields in the arena → ORN / GRN rates.
  - Mechanosensation: joint angles & loads from MuJoCo → chordotonal / hair-plate / campaniform
    (`mechanosensory_proprioceptive`, `mechanosensory_tactile`), Johnston's organ from air flow / wing beat.
  - Hunger/state: internal variables gating neuromodulatory neurons (DANs, OA, 5-HT).
- **Closed loop timing**: physics at 1 kHz, brain at 2 kHz (0.5 ms steps) — the current core runs
  ~1 ms sim / 1.2 ms real on one core; multiple flies = multiple workers, later WebGPU.

## Phase 3 — environments and survival
- Arena with food patches, hazards, temperature gradient, other flies (courtship uses the male-specific
  fruitless/doublesex circuits annotated in this dataset).
- Metrics: energy, damage, distance travelled; no reward shaping — the connectome as it is.
- Multiple flies: N `FlyBrain` instances sharing the read-only graph via `SharedArrayBuffer`.

## Honest caveats
- The connectome gives wiring, not synaptic strengths, neuromodulation, gap junctions, or plasticity.
  The LIF model is a first-order approximation; we should expect reflexes and sensorimotor
  transformations to work (as in Shiu et al. 2024) and complex behaviour to need tuning.
