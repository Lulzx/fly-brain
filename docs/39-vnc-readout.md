# 39. The VNC readout fit, and its reservoir answer

Spec S2 asked whether the leg-premotor connectome, frozen, can route a recorded premotor state into
the muscle commands a real run needed — and whether the *wiring* is what does it. The machinery is
now built and the kill test has run. The answer is a clean negative: **the frozen connectome loses
to a degree-matched scramble of itself.**

## The pieces

- `src/vnc/subgraph.js` — the frozen subgraph: 21,843 neurons (leg MNs plus their two-hop
  VNC/descending presynaptic ancestors), 1.62M edges in local CSR, per-node
  sign/superclass/side/type/size metadata, `origIdx` back-map, and the role partition
  (14,395 interneuron / 328 motor / 1,273 descending / 5,847 sensory). `prep_vnc_subgraph.mjs`
  writes it to `public/data/vnc_subgraph.json` as a self-contained, sha256-hashed artifact — a
  value, not a pointer.
- `scripts/record_vnc_fitdata.mjs` — live descending-mode runs, recording per 20 ms epoch the
  boundary rates, MN rates, CPG `ctrl`, joint angles and body context, plus the exact boundary
  spike trains at fly-step resolution (version-2 binary; each event is `(fly step, boundary
  node)`).
- The boundary is **every non-motor node**. That was the honest discovery of the earlier attempts:
  the two-hop ball cannot self-ignite — the live premotor layer is held near threshold by tonic
  drive from outside the ball — so the replay clamps the whole premotor state to its recorded
  spike times and asks the frozen edges to do the last mile. What the graph computes is the
  *readout*: only the 328 leg MNs are live.
- `src/lifdiff.js` — `forward(steps, { spikeTrain })` forces the recorded spikes (no RNG draw,
  refractory respected) and `_replay` repeats them in backward, so `logGain` gradients flow
  through the taped arrival times.
- `scripts/stand_fit.mjs` — Adam over per-source-neuron `logGain` (plus optionally the global
  `inhGain`), loss = per-epoch MSE between the readout's predicted `ctrl` and the CPG's recorded
  `ctrl` (the same force-frequency readout `motor.js` uses in connectome mode), on 200 ms windows
  with a 40 ms warmup. `stand_scramble.mjs` is the same fit on a degree-matched, same-sign edge
  permutation; `stand_ablate.mjs` scores named gain/edge groups on held-out seeds.
- Deployment: `typeGains` accepts `neuronGainTable` — `{origIdx: logGain}` multiplied into
  `outScale`, baked into the shipped kernel's weights — and `behavior_eval.mjs` autoloads
  `public/data/stand_fit.json` (kill switch: `standFit: false`). Named, in the ledger, removable.

## Two bugs the instrumentation caught

The replay reproduced 11.1 Hz mean MN rate vs 11.1 Hz recorded — but only after two footguns were
found. `Float32Array.from(sub.origIdx.map(...))` silently truncated every `inScale` to an integer
(Int32Array.map returns Int32Array), zeroing half the subgraph's synaptic weights; and
`Buffer.from(b64).buffer` returned the whole pool, not the decoded slice. Both are the kind of bug
that produces a plausible-looking dead model instead of an error — the audit chain (recorded vs
replayed per-neuron spike counts, then single-edge delivery) is what cornered them.

## The result

8 seeds × 30 s recorded, 6 train / 2 holdout (seeds 7, 8). 500 Adam iterations, pure ctrl loss
(`--lrate=0`; the MN-rate auxiliary term is diagnostics, not target — at λ=0.1 it dominated and
overfit). Held-out ctrl MSE:

| graph | raw (gains off) | fitted | gain contribution |
|---|---|---|---|
| intact connectome | 0.401 | 0.285 | +0.115 — the gains do learn real signal |
| degree-matched scramble | 0.083 | **0.073** | +0.009 |

The scrambled graph — same neurons, same out-degrees, same Dale signs, same replayed spikes,
different partners — fits **4× better** than the connectome's own wiring. Spec S2.7's kill test
asked whether the scramble could reach 80% of the real fit; it reached 26%. The readout task —
"turn a premotor spike pattern into actuator commands" — is a random-projection problem, and any
balanced wiring solves it; the connectome's actual partners are apparently *worse* than random for
it, which makes sense: the real wiring is doing things this loss does not reward (phase structure,
postural loops, gating), not optimising a static map onto the CPG's command vector.

The ablation table on the intact fit says where the gains went: interneuron sources carry it
(+0.14 ctrl MSE when their outgoing edges die), descending and sensory channels contribute ~0, and
no individual DN type matters (2–4 neurons each, all |Δ| ≤ 0.001).

## What this is not

- It does not say the connectome is wrong. It says the **routing** from a clamped premotor state to
  muscle commands does not depend on the specific edge identities — the information is in the
  activity, not the last-mile wiring. The wiring's contribution would show in the part of the loop
  this assay removes: the premotor state itself (which we replayed, not computed).
- The fitted gains are a real readout improvement (+29% over the raw graph on holdout), so they
  deploy — but the ledger entry must carry the scramble result with it, so `standFit` reads as
  "a fitted readout", not "evidence the wiring is load-bearing".

## The standing implication for M2

Doc 36's fear was a fit that copies its target. The reservoir result is sharper: at this level of
the stack there is nothing to copy *into* — the frozen edge set is interchangeable with noise for
the readout. If posture is to come from the graph at all, the differentiating work has to be where
the activity is generated (the premotor dynamics we currently replay), not where it is delivered.
The next informative measurement is not a better readout fit; it is a recurrence test — whether
the VNC subgraph produces the premotor pattern, rather than merely routes it.
