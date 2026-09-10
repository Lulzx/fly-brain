# 6. WebAssembly kernel

File: `src/wasm/lif.c`, built to `public/lif.wasm` (about 10 KB).

## Build
```sh
zig cc --target=wasm32-freestanding -O3 -msimd128 -matomics -mbulk-memory -nostdlib \
  -Wl,--no-entry -Wl,--import-memory -Wl,--shared-memory -Wl,--max-memory=4294901760 \
  -Wl,--export=lif_step -Wl,--export=fv_step -o public/lif.wasm src/wasm/lif.c
```

## Exports
- `lif_step(Brain*)`: one 0.5 ms step. Delivers delayed spikes, fires Poisson-driven neurons, integrates
  membranes in a vectorisable loop, then detects threshold crossings.
- `fv_step(...)`: one step of the flyvis optic-lobe network, see [Vision](11-vision.md).

## Shared memory layout
`src/brainsetup.js` allocates one shared `WebAssembly.Memory`:

1. The connectome once: indptr, targets, effective weights, per-neuron signs, about 86 MB.
2. One state block per fly, about 12 MB, holding voltages, conductances, refractory timers, traces,
   drive, spike counts, and the delay ring.
3. flyvis weights once, then two eye state blocks per fly.

Every fly worker instantiates the same module against this memory, so the graph is never copied.
Up to 12 flies are reserved.

## Accuracy and speed
- Statistically identical to the JavaScript model: 11,363 versus 11,261 spikes in the same test.
- 2.5 times faster than JavaScript under full CPU load.
- The flyvis port matches PyTorch to within 2 × 10⁻⁶ and takes 0.53 ms per step.

## JavaScript wrapper
`src/lifwasm.js` exposes the same API as the JS model: `step`, `setDrive`, `setDriveOne`, `setBias`,
`pulse`, `reset`, `setBackground`, and typed-array views of state.
