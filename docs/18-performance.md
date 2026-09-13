# 18. Performance

## Per fly
About 0.2 times real time in the browser, with vision. Five flies ran together on a 12-core Mac.

## Where time went, and what changed

| Stage | Change | Effect |
|---|---|---|
| Brain | JavaScript to WebAssembly with SIMD | 2.5 times faster |
| Brain | Event-driven updates | Little gain; about 120,000 neurons stay awake |
| Physics | 0.1 to 0.2 ms timestep, no no-slip | 2 times faster, same gait quality |
| Physics | Solver variants | 10 to 20% |
| Vision | 4,107 photoreceptor rays to 2 × 721 flyvis columns | Fewer rays; flyvis adds about 53 ms per simulated second |
| Contacts | Read every 10 ms and freed explicitly | Avoids leaks and overhead |
| Memory | Shared connectome | About 86 MB once instead of per fly |
| Brain | WebGPU kernel ([doc 27](27-webgpu.md)) | Matches WASM within RNG; throughput depends on the adapter — one GPU device per fly for now |

## Remaining options
- Share one GPU device across flies, and move flyvis up to WebGPU too.
- Split one brain across threads with SharedArrayBuffer barriers.
- Move physics to the multi-threaded MuJoCo build.
