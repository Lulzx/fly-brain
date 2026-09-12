# 27. WebGPU brain kernel

File: `src/lifgpu.js`. Same model as the WASM kernel ([doc 6](06-wasm-kernel.md), `src/wasm/lif.c`),
running the brain's two 0.5 ms LIF steps on the GPU. Selected automatically in `attachBrain` when
`navigator.gpu` exists; `?gpu=0` on the arena URL or `gpu: false` in brain params forces WASM. Any
initialisation failure falls back to WASM silently.

## Layout

Chrome's default `maxStorageBuffersPerShaderStage` is 8, so the kernel uses five bindings:

1. `hdr` — parameters, ring position, RNG state (u32/f32 header, 144 B).
2. `graph` — read-only connectome pack: indptr | indices | weights | sign as u32 words (~84 MB).
3. `st` — f32 state pack: v | refr | trace | adapt | res | bias | thr | drive (8 × N).
4. `at` — atomic-i32 pack: gE | gI | spikeCount | delay ring | ring counts | driven list. Conductances are
   fixed-point ×1024 because WGSL has no f32 atomics.
5. `deltas` — the CPU→GPU write list (see below).

## A step

Seven dispatches per 0.5 ms step: `applyDeltas` (once per pass) → `deliver` (arriving spikes scatter into
gE/gI) → `driven` (Poisson sensory spikes) → `background` → `membrane` (N-wide integration) → `threshold`
(spike append) → `tick` (advances the delay-ring head, RNG and background accumulator on-device).

Because `tick` keeps ring state on the GPU, steps are encoded back-to-back into an open compute pass and
submitted in batches (~8 steps or every ~2 ms wall) — a batch needs no per-step queue calls. WebGPU
guarantees ordering and memory visibility between dispatches in a pass.

## CPU↔GPU interface

- **Writes** (`setDriveOne`, `setBias`, `setThr`, `addG`, `pulse`) push `(index, kind, value)` deltas; the
  list is uploaded once per batch and applied by its first dispatch. `neuromod.js` and `intrinsic.js`
  write conductances and thresholds only through `addG`/`setThr` so both backends stay in step.
- **Reads.** Each submitted batch copies spikeCount + trace + fired-count into a rotating staging buffer;
  `mapAsync` updates the CPU shadows when it resolves. Shadows lag by about one submit boundary — during a
  synchronous burst the worker loop yields every 8 steps so the maps land mid-burst. Consequences:
  motor/behaviour readouts see spikes a few ms late (the readout EMA is 40 ms, so this is invisible), and
  the GF→TTMn electrical-synapse shortcut gains ~1–4 ms of extra delay.

## Verified

On the full connectome, 1000 steps driven identically produce within-RNG-equal activity: WASM 10,298 vs
GPU 9,580 sampled spikes. Kernel throughput on this machine's (emulated) adapter: ~1.8k steps/s GPU vs
~5.6k WASM — SwiftShader software Vulkan, not a real GPU; on hardware the N-wide passes should pull well
ahead, and the arena stays interactive on either backend. The honest claim: the backend exists, is
correct, and is free to be faster — not that it outruns WASM everywhere yet.
