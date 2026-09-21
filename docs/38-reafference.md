# 38. Self-motion cancel in front of the loom pathway (S3)

Spec section S3. The question: can a learned reafference cancel replace the escape wall-gate?
`escapeGate` vetoes the takeoff trigger for a window after contact or a pivot -- it deletes false
alarms by rule. The replacement on offer is an identified forward model: predict the sensory
consequence of the animal's own movement and subtract it before it reaches the loom pathway.

## Mechanism

```
u_t = [fwd, back, turnL, turnR, groom]     DN readouts, 40 ms filtered (Motor.readBrain's tau)
p_t = lowpass(leg joint velocities, 20 ms) tibia + coxa, 6 legs
hat_s = W_u u_t + W_p p_t + b              per target neuron, in membrane-bias units
s_cancelled = s_raw - hat_s                written as a negative `bias` on the target neurons
```

Targets are the loom readout set of S3.2: LC4 (126), LPLC2 (185), DNp02, DNp04, DNp01 (317
neurons). None of them is flyvis-coupled -- the optic-lobe model stops at the columnar types -- so
`s_raw` is read at the membrane (`bias` enters lif.c's membrane bracket alongside the synaptic
terms), which is the spec's second interpretation. The subtract runs through the `reafference`
scaffold plugin's `visual` hook; the footfall gain is the same plugin's other channel. With no
model loaded the channel is inert. Weights live in `public/data/reafference.json`
(`src/vision/cancel.js`, `scripts/reafference_fit.mjs`).

`W` is fitted by ridge regression of target spike rate on `[u, p]` over the self-motion traces
`scripts/loom_protocol.mjs --trace` collects (gait / turn / wall, 10 seeds, 12,000 epochs), then
converted to bias units by a measured sensitivity rho = 3.0 Hz per bias unit (`--bias` runs: a
fixed -1 bias on all targets in the live animal, 12 runs). Only W_u and W_p are fitted -- one
parameter class, per S3.5. The shipped model drops the intercept (`--intercept=0`): reafference is
movement-evoked, so a standing fly has none to cancel, and a nonzero b (up to 2.5 bias units in
the intercept fit) subtracts a tonic term it should not. The intercept-free fit also scored
strictly better on false alarms (wall 2/10 vs 3/10, gait 2/10 vs 3/10).

## What the protocol measured

`scripts/loom_protocol.mjs` emits the four conditions of S3.4 on shared seeds: `gait` (open
field), `turn` (a tight post corral), `disk` (the loom_disk swoop, unchanged: threatAt 2000 ms,
loomMs 700), `wall` (0.8 m facing the arena wall). Takeoff rate is `cmd.takeoff`, the 40 ms-filtered
weighted mean of DNp02/DNp04 that the escape detector reads; "jumped" counts `jumps || flight`.

Baselines first, `escapeGate` OFF, 10 seeds (the shipped model is the intercept-free fit):

| cond | no model | + linear cancel | blind (no eye) |
|---|---|---|---|
| gait jumps | 4/10 | 2/10 | 1/5 |
| turn jumps | 2/10 | 2/10 | -- |
| wall jumps | **8/10** | **2/10** | 1/5 |
| disk escapes | 4/10 | 1/10 | -- |

Three findings:

1. **The self-motion noise is mostly visual.** With no eye at all, takeoff-DN peaks collapse from
   50-150 Hz to ~8-38 Hz, and wall false alarms drop to ~1/5. A visual reafference cancel is the
   right mechanism in principle. A residual ~2/10 false-alarm floor remains blind -- central or
   proprioceptive bursts no visual cancel can reach.

2. **The noise rides the LC4 channel, not LPLC2.** In the traces, epoch takeoff rate correlates
   0.59 with LC4 population rate and -0.05 with LPLC2; high-takeoff wall epochs show LC4 at
   10.8 Hz vs a 4.4 Hz baseline (DNp02/DNp04 are the takeoff readout itself: 79-86 Hz).

3. **The reafferent drive is scene-dominated, not command-dominated.** Linear `u,p -> rate`
   explains a median 0.6% of per-target variance (population-mean LC4: 4.2% with lagged commands).
   The spec's v2 fallback -- a 32-hidden-unit tanh net on the same features -- reaches 19% on LC4,
   8.5% on the takeoff DNs. The information that decides which part of the retina looms is the
   scene's depth map, which is not in the efference copy; a model that predicts it is a second
   optic lobe, which the spec bounds.

## The cancel does work -- partially

The fitted linear model subtracts the command-predictable component: wall-condition takeoff p95
drops from ~30-42 Hz to ~5-15 Hz, and wall false alarms fall from 8/10 to 2/10. Walking straight
at a wall is the most predictable self-motion there is; the model gets that part. What it cannot
predict -- and cannot cancel -- are the transient peaks that actually cross the detector
(`takeoff > 70 Hz` and `> 3x` its 3 s baseline), because those are triggered by scene events:
the wall's edge sweeping the eye on a pivot, an obstacle looming during a sidestep.

## S3.7 verdict: recorded negative

- **disk >= 8/10:** unreachable in this build. The loom assay escapes ~2.5-4/10 *at baseline* --
   the seed-dependent noise the scaffold ledger already documents (loomEscape = 0.25 over its
   four seeds). The cancel did not worsen it measurably (the 1/10 vs 4/10 difference is inside
   that noise -- the fly's trajectory at loom onset differs run to run), but nothing about S3 can
   lift an assay that misses three quarters of its looms.
- **gait/turn/wall <= 1/10:** not reached (2/10 wall with the cancel; the blind residual alone is
   ~2/10 -- even a perfect visual cancel cannot get below the non-visual floor).
- **Verdict:** the cancel cannot separate wall from disk at this eye resolution and feature set.
   The spec's anticipated negative was "optical aliasing, not missing corollary discharge"; the
   measurement here is sharper -- the reafference is real, visual, and LC4-routed, but its
   predictable part is small because what matters is *which* surface looms, and that is scene
   geometry, not command. `escapeGate` stays; the ledger keeps it in the loom required-set. The
   fitted model ships anyway: it is a real, killable mechanism with a measured partial effect, and
   `reafference: false` is now the kill test for both reafference channels.

## Commands

```
node scripts/loom_protocol.mjs --seeds=1-10 --off=escapeGate --nomodel      # baseline
node scripts/loom_protocol.mjs --conds=gait,turn,wall --seeds=1-10 --trace=/tmp/reaf_trace.json
node scripts/loom_protocol.mjs --conds=gait,wall --seeds=1-6 --bias=-1 --results=/tmp/reaf_calib.json
node scripts/reafference_fit.mjs --trace=/tmp/reaf_trace.json --calib=/tmp/reaf_calib.json --intercept=0
node scripts/loom_protocol.mjs --seeds=1-10 --off=escapeGate                # validates the fitted model
```
