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
