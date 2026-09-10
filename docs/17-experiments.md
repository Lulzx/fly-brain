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

## Diagnostic tools
`al_trace`, `ignition`, `paths`, `chain`, `inputs`, `dn_inputs`, `sign_diff`, `sense_ablate`, `kc_test`,
`flip_debug`, `flip_isolate`, `contact_probe`, `profile_fly`.

## Final behaviour report, gain 150

| Scenario | Outcome |
|---|---|
| Foraging, 12 s | Explored 23 cm, came within 2.6 mm of food, no false jumps |
| On sugar, 4 s | Walked off; proboscis extended part of the time |
| Looming threat | No escape in this run |
| Hot patch | Flipped, righting too slow, health 0.41 |
| Bitter patch | Walked away, stayed upright |

Outcomes vary between runs. An earlier run at gain 150 walked off the hot patch at health 0.88 and
foraged 9 cm with some ingestion.

## Sensory screen findings
- Dimming or looming drives the giant fibre and takeoff neurons.
- Wind on the antennae and hind-leg touch drive the moonwalker neuron.
- Many odours drive steering neurons DNa01 and DNa02.
- Forward-walking neurons are driven mostly through visual inputs.
