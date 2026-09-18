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
(spike append) → `tick` (advances the delay-ring head, RNG and background accumulator on-device, and
clears the delivered slot's spike count — a single thread doing it after all of `deliver`'s readers,
whereas a store inside `deliver` could land before a late-scheduled workgroup's load and drop spikes).

Because `tick` keeps ring state on the GPU, steps are encoded back-to-back into an open compute pass and
submitted in batches (~8 steps or every ~2 ms wall) — a batch needs no per-step queue calls. WebGPU
guarantees ordering and memory visibility between dispatches in a pass.

## CPU↔GPU interface

- **Writes** (`setDriveOne`, `setBias`, `setThr`, `addG`, `pulse`) push `(index, kind, value)` deltas; the
  list is uploaded once per batch and applied by its first dispatch. The buffer holds 65,536 deltas; a
  queue that fills mid-batch is drained by a standalone apply pass rather than allowed to overflow (an
  oversized `writeBuffer` would fail validation, drop the whole batch, and leave the CPU shadows
  permanently ahead of GPU state). `neuromod.js` and `intrinsic.js` write conductances and thresholds
  only through `addG`/`setThr` so both backends stay in step.
- **Reads.** Each submitted batch copies spikeCount + trace + the last step's fired count and index list
  (capped at 65,536) into a rotating staging buffer; `mapAsync` updates the CPU shadows when it resolves.
  Shadows lag by about one submit boundary — during a synchronous burst the worker loop yields every 8
  steps so the maps land mid-burst. Consequences: motor/behaviour readouts see spikes a few ms late (the
  readout EMA is 40 ms, so this is invisible), and the GF→TTMn electrical-synapse shortcut gains ~1–4 ms
  of extra delay.

## One device, one connectome, however many flies

A `GPUDevice` cannot be moved between workers, so "share the device across flies" means share it among
the flies hosted in the same context. `gpuDevice()` hands out one device per context and the graph pack
is cached on it by `(N, E)`: the first brain uploads the 84 MB connectome, every later brain on that
device binds the same buffer, and the pack is freed when the last one is destroyed. Per-fly state — the
header, the f32 state pack, the atomics and the delta list — stays private, which is what makes the
sharing safe: the graph is read-only and identical for every fly.

With one fly per worker, as the arena runs today, nothing changes. What the cache buys is that hosting
K flies in one worker costs one graph pack instead of K, which is the difference between 84 MB and
1 GB at the arena's twelve-fly limit — the memory wall that made co-hosting pointless before.

## flyvis on the GPU

`src/flyvisgpu.js` runs the optic lobe on the same device. The model is small and regular — 45,669
nodes, 1.5 M synapses, one rectified scatter and one node update per 20 ms step — so it is three
dispatches (`clear`, `scatter`, `integrate`) against the brain kernel's seven, with the same
fixed-point-atomics trick because WGSL still has no f32 atomics. The scale is 65,536 rather than the
brain's 1,024, and the accumulate rounds rather than truncates: at 1/4096 with truncation, ~33 incoming
edges per node and 25 steps of integration accumulated a 0.027 disagreement with the reference, which is
the kind of error that looks like a modelling difference and is not.

Both eyes of a fly, and every fly in the worker, share one parameter pack (12.7 MB: edges, weights, bias
and dt/tau). Only `v` and the input vector are per-eye. Reading back follows the brain kernel's pattern —
each submit copies `v` into a rotating staging buffer and `mapAsync` refreshes the CPU shadow — so
`vision.js` keeps reading `eyes[s].v` synchronously and sees a value that lags by about one 20 ms step.

`scripts/check_flyvisgpu.mjs` runs it against a transcription of `fv_step` on the shipped export, through
a real adapter in headless Chrome:

| check | result |
|---|---|
| max \|GPU − reference\| over 45,669 nodes, 25 steps | **0.00032** |
| mean \|difference\| | 0.000025 |
| parameter packs on the device for two eyes | **1** (12.7 MB) |
| second eye's state after the first eye runs | unchanged from rest |

Since the WASM kernel matches the trained PyTorch model to 2e-6 ([Vision](11-vision.md)), agreeing with
its transcription to 3e-4 closes the chain to the published model, with the residual explained by the
fixed-point step.

## Verified

On the full connectome, 1000 steps driven identically produce within-RNG-equal activity: WASM 10,298 vs
GPU 9,580 sampled spikes. A deterministic bias-driven synaptic chain (`scripts/_tmp/gpu_test.mjs`, real
adapter via headless Chrome) produces spike counts identical to the JS kernel (16,8,6,5 along the chain),
the fired-index readback returns real neuron indices, and a >65,536-delta burst drains without error.
Kernel throughput on this machine's (emulated) adapter: ~1.8k steps/s GPU vs ~5.6k WASM — SwiftShader
software Vulkan, not a real GPU; on hardware the N-wide passes should pull well ahead, and the arena
stays interactive on either backend. The honest claim: the backend exists, is correct, and is free to be
faster — not that it outruns WASM everywhere yet.
