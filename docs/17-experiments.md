# 17. Experiments and scripts

## Main tools

| Command | Purpose |
|---|---|
| `node scripts/run_fly.mjs <s> <scenario> [mode]` | Headless embodied run with a log every 100 ms. Scenarios: default, onfood, nearodor, onheat, threat |
| `node scripts/behavior_report.mjs [scenario]` | Five survival scenarios with behaviour summaries |
| `node scripts/calib_eval.mjs '<json>'` | Benchmark suite for one parameter set |
| `node scripts/calib_search.mjs '{"coba":true}' <gens> <pop>` | Parameter search |
| `node scripts/sensory_screen.mjs` | Which senses drive which commands |
| `node scripts/visual_test.mjs loom\|circle` | Tethered visual stimuli |
| `node scripts/flyvis_validate.mjs` | flyvis port versus PyTorch |
| `node scripts/check_arena.mjs` | Headless browser test of the arena |
| `node scripts/diag_walk.mjs <s> <scenario> <out.jsonl> [json]` | 20 ms behaviour trace: position, DN rates, endogenous state, flight. Scenarios open, wall, cube, corner; options vision, seed, pos, yaw, mask (sensor regex), freeze, threatAt, takeoffAt, probe |
| `node scripts/flight_test.mjs [turn] [ms]` | Brainless flight-controller test |
| `node scripts/neuromod_calib.mjs [s]` | Calibrates octopamine and insulin cell thresholds for a fed fly; writes `public/data/neuromod.json` |
| `node scripts/starvation.mjs [s] [seeds]` | Starvation-induced hyperactivity, fed vs starved, in five genotypes ([Neuromodulation](25-neuromodulation.md)) |
| `node scripts/ablation_ladder.mjs [seeds]` | Substitution ladder: drop one level of description at a time and re-score the benchmark ([Ablation ladder](31-ablation-ladder.md)) |
| `node scripts/ablation_refit.mjs [gens] [pop]` | The same ablations, each refitted, to separate sensitivity from necessity |
| `node scripts/behavior_eval.mjs` / `evaluate(cfg)` | The embodied objective: five arena scenarios scored on survival, posture, food, feeding, bouts and escape ([Behavioural ladder](35-behaviour-ladder.md)) |
| `node scripts/behavior_ladder.mjs [seeds]` | The same substitutions as `ablation_ladder`, scored in the arena instead of on the benchmark |
| `node scripts/behavior_refit.mjs [gens] [pop] [rung]` | Arm two of the behavioural ladder: the rungs arm one resolved, each refitted |
| `node scripts/identify_test.mjs curve\|sim\|run` | The frozen identification statistic for the individual-validation design ([doc 34](34-individual-validation.md)) |
| `node scripts/motor_identify.mjs run [M] [sigma] [workers]` | [M6](20-roadmap.md): does motor-neuron activity individuate a model better than the behaviour it produces? Runs `identify_test`'s statistic on simulated individuals, scored once on motor pools and once on behaviour |
| `node scripts/motor_bound.mjs [s] [seed]` | [M5](20-roadmap.md): what fraction of motor-neuron output has no route to the body. Answer: 42.4% of spikes |
| `node scripts/muscle_check.mjs [s] [seed]` | [M4](20-roadmap.md): whether the per-class force-frequency model changes anything in `'descending'` mode. It does not, exactly |
| `node scripts/dn_flight.mjs screen\|detail` | [M1](20-roadmap.md): every descending type driven in turn, ranked by what reaches the wing pools rather than the legs |
| `node scripts/mn9_quiet.mjs dose\|sources\|silence\|chain\|fix\|combo\|refine\|paired` | [M3](20-roadmap.md): where the proboscis motor neuron's 26.6 Hz idle comes from, and what it costs to remove |
| `node scripts/check_courtship.mjs` | Song pulse structure and female rejection, measured rather than assumed ([Courtship](26-courtship.md)) |
| `python3 scripts/algo_operators.py fly worm` | Annotation-free operator detectors: expansion, normalization, ring ([Compiler](29-connectome-compiler.md)) |
| `node scripts/check_flyvisgpu.mjs` | WebGPU flyvis kernel against the reference model, real adapter ([WebGPU](27-webgpu.md)) |
| `node scripts/wing_mn.mjs [s] [seed]` | What the wing power and steering motor neurons do through a flight ([Flight](24-flight.md)) |
| `python3 scripts/synapse_confidence.py` | Per-connection measurement uncertainty from bilateral replicates ([Uncertainty](32-synapse-uncertainty.md)) |
| `node scripts/grad_check.mjs [n] [steps]` | Verifies the adjoint in `src/lifdiff.js` against finite differences ([Differentiable brain](33-differentiable-brain.md)) |
| `node --max-old-space-size=14000 scripts/grad_fit.mjs [steps] [iters] [mode]` | Gradient descent on the whole CNS, globals and/or 165,122 per-neuron gains |

## Diagnostic tools
`al_trace`, `ignition`, `paths`, `chain`, `inputs`, `dn_inputs`, `sign_diff`, `sense_ablate`, `kc_test`,
`flip_debug`, `flip_isolate`, `contact_probe`, `profile_fly`.

## Behaviour report, gain 150, with endogenous behaviour and flight

| Scenario | Outcome |
|---|---|
| Foraging, 12 s | Reached the food and fed for about 1 s (141 ingested); groomed 22% of the time |
| On sugar, 4 s | Fed 58% of the time until sated (341 ingested), then walked off |
| Looming threat at 2 s | No escape in this run; 2 of 10 in `diag_walk.mjs` trials |
| Hot patch | Took off and flew clear, health 0.88 |
| Bitter patch | Walked away, stayed upright |

Before these changes: foraging came within 2.6 mm of food without feeding, the fly walked off sugar after
40 ms of feeding, and flipped on the hot patch at health 0.41. Outcomes vary between runs.

Open arena, 40 to 60 s per run, four seeds: no flips, deaths or false escape jumps. Flies walked in bouts,
followed walls, fed when they found the food, and made 0 to 4 flights each.

## Sensory screen findings
- Dimming or looming drives the giant fibre and takeoff neurons.
- Wind on the antennae and hind-leg touch drive the moonwalker neuron.
- Many odours drive steering neurons DNa01 and DNa02.
- Forward-walking neurons are driven mostly through visual inputs.
