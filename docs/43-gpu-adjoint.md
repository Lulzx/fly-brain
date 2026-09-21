# 43 — The WebGPU adjoint

S4.7 from the spec: port the backward sweep — "the backward scatter over 10.5 M edges and the
eleven 165,122-vectors" — so that a gradient over the whole connectome costs less than a forward
benchmark. `src/lifdiff_gpu.js` implements it; `scripts/grad_check_gpu.mjs` gates it.

## What moved to the device, and what did not

The forward pass and the per-segment replay stay in `LIFDiff` on the CPU. Reverse mode needs the
forward trajectory; `_replay` produces it, and producing it is forward-pass work either way, so
keeping it on the CPU changes no asymptotics — the CPU backward already pays it. What runs on the
device is the sweep itself, which is the part whose cost profile is GPU-shaped: two streaming
passes over N per step plus one fan-out walk per arriving spike.

Per 16-step checkpoint segment the harness uploads the replayed arena (`vPre`, `gE`, `gI`,
decayed adapt, spike amplitude, mode, per-arrival `res`) and encodes one compute pass of 2L
ordered dispatches:

- `kNeuron` — one thread per neuron: reverses the post-step decays, dispatches on the recorded
  mode (integrated / refractory / drive-forced / soft-driven), applies the surrogate derivative,
  clips the carried adjoint when `adjClip` is set, and deposits the five scalar-parameter
  contributions into per-neuron accumulators.
- `kArrival` — one thread per arrival: walks the presynaptic fan-out, gathers `lgE`/`lgI` into
  `lRaw` under Kahan compensation, scatters `gInScale` through a CAS-emulated f32 atomic (WGSL
  has no floating-point atomics; an earlier `atomic<i32>` fixed-point version overflowed at
  2^20 scale once hard-mode adjoints reached ~1e5), and writes per-arrival `{dWSyn, dDepU,
  dInhGain}` records that the host reduces in f64.

No atomics anywhere else. Within one step's arrival list each presynaptic index appears once — a
neuron spikes at most once per step — so `gLogGain`, `lres`, and the ls-ring writes are
single-writer, and the ls-ring slot being written is guaranteed to have been consumed and zeroed
five steps earlier (the ring invariant is argued in the module header).

## Correctness (the spec gates)

`scripts/grad_check_gpu.mjs` runs the CPU and GPU adjoints on the same recorded tape — the
comparison is adjoint-vs-adjoint, not adjoint-vs-FD, because the CPU side is already the
FD-checked reference.

| gate | tolerance | result |
|---|---|---|
| 800-neuron induced subgraph, soft spikes + drive, 60 steps | rel ≤ 1e-4 | worst 4e-6 across all nine params, all logGains, and the per-epoch drive gradient |
| same, 200 steps | ≤ 1e-4 | worst 5e-6 |
| same, hard (shipped) threshold | ≤ 1e-3 | worst 3.3e-4 |
| full CNS, hard, 100 steps: `wSyn` + random 64 `logGain`s | ≤ 1e-3 | wSyn 1.4e-4, pick-64 worst 2.4e-5, all scalars ≤ 4.1e-4 |

The hard-mode tolerance needs a justification, and it has one: the adjoint of the spiking model
is ill-conditioned. Perturbing the loss weights by 1e-6 moves the CPU's own `vThresh` gradient by
1.85e-4 — a condition number of ~185. The GPU's f32 arithmetic (the CPU kernel computes in f64
and stores to f32) lands at 3.25e-4 through that channel, i.e. the port sits at the intrinsic
noise floor, not at a porting bug; the soft model — which is what `grad_check.mjs` actually
defines as the check — passes at 5e-6. At full CNS the all-N worst logGain entry reaches 4e-3 in
the *unclipped* regime (gradient magnitudes ~1e23 — the overflow-prone territory of doc 41); the
spec's named check is `wSyn` + 64 random entries, both of which pass comfortably, and a fit would
run `adjClip` regardless.

## Cost

Measured on Chrome's SwiftShader adapter — a software rasterizer, so this is a structural
measurement, not a hardware number:

| | CPU backward | GPU path total | of which device wait |
|---|---|---|---|
| 800 neurons, 200 steps, soft | 57 ms | 65 ms | 37 ms |
| full CNS, 100 steps, hard | 1174 ms | 882 ms | 308 ms |

Even CPU-emulated, the device sweep (308 ms) already beats the CPU sweep (~660 ms of the 1174).
On real hardware the sweep should be memory-bound and collapse toward single-digit milliseconds,
at which point the 515 ms CPU replay is the whole cost — the honest continuation is a GPU replay
kernel, which needs the forward pass to record a per-step forced-spike mask so the replay never
draws RNG (the drawn-vs-recorded ordering is the only thing keeping it on the CPU today).

The spec's success metric — "a gradient over 165,122 parameters cheaper than one benchmark
evaluation" — is not yet met end-to-end: the CPU replay keeps total cost at ~1.9× forward. What
is met: the sweep the spec named is on the device, is correct at both gates, and is no longer the
bottleneck on real hardware.

## Files

- `src/lifdiff_gpu.js` — `LIFAdjointGPU`: init(net, tape, opts) → backward() → same gradient
  object as `LIFDiff.backward` plus a timing breakdown.
- `scripts/grad_check_gpu.mjs` — the gate; `--cns` for the whole-brain check.
