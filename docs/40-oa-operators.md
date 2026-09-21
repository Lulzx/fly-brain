# 40. The octopamine operator family, split in public

Spec S5: hunger reaches the brain through AKH / insulin / OA-VUMa / OA-VPM — that pathway is settled
and shared. What is not settled is the *postsynaptic action* of octopamine. Four operators now
implement the rival hypotheses in `src/sim/neuromod.js` as `oaMode`, and `scripts/oa_split.mjs`
runs the assay meant to split them.

| `oaMode` | postsynaptic action | status |
|---|---|---|
| `synFast` | OA neurons keep their fast synapses in the graph; no field | historical regression arm |
| `thrField` | OA lowers target spike thresholds ≤ 2 mV, saturating, 2 s lowpass | shipped baseline |
| `gainField` | OA exposure multiplies the *outgoing* gain of typed sets (optic lobe, DNs) | new |
| `thrTyped` | threshold field restricted to a versioned type list (`public/data/oa_targets.json`) | new |

All four share the upstream pathway (AKH sigmoid on haemolymph sugar, insulin from IPC rate, the
AKHR/DILP drives onto OA-VUMa/VPM, locomotor corollary discharge onto OA-AL2i/OA-ASM). Only the
synapse from OA release to the rest of the brain differs. `synFast` keeps the OA neurons' chemical
synapses in the graph (it is the only mode where `modulatorySign` does not zero them).

The typed sets are hypotheses, not measurements — the connectome has no receptor data. They are
lists in `public/data/oa_targets.json` with a version field; changing a list is a new degree of
freedom, not a silent edit.

## Predictions, written before the first run

The point of the table is to be wrong in public. Predictions, before any operator ran:

| observation | `synFast` | `thrField` | `gainField` | `thrTyped` |
|---|---|---|---|---|
| starved walk fraction vs fed, arousal rule **off** | ≤ 1 or worse (OA's fast synapses are mostly inhibitory) | ≈ 1 — the documented surprise: OA targets skew to steering/backward | > 1 via the DN set if OA tone reaches it | ≈ thrField, diluted |
| loom GF (DNp01) spikes while walking | unchanged or degraded | weak — a tonic −2 mV does not gate an evoked burst | possibly restored — LC4/LPLC2 are in the optic set and gain multiplies the evoked response | like thrField but only on listed types |
| T4/T5 ÷ L2 rate, walking vs standing | ~1 | ~1 (threshold shifts do not multiply driven rates) | ~1 — T4/T5 are flyvis-driven; a gain field scales what they *send*, not what they fire | ~1 |
| VPN (LC4/LPLC2/LPLC4) rate ÷ T4/T5, walking vs standing | ~1 | ~1 (driven upstreams and a threshold field do not multiply the evoked signal) | > 1 — the gain field sits on exactly this link | ~1 |
| fed baseline behaviour | likely broken — OA fast synapses are net-new graph edges | unchanged (it is the shipped model) | ≈ unchanged at low OA tone | ≈ unchanged |

The discriminating row is the fourth: T4/T5 are flyvis-driven neurons, so no postsynaptic operator
can move their own firing — and the connectome gives them almost no OA input anyway (6/13,580 have
an OA synapse ≥5; 62/408 LC4/LPLC2/LPLC4 do, all from OA-AL2i/ASM). Under `gainField`, exposure
scales a typed neuron's *outgoing* edges, so the gain lands on VPN→downstream links (the loom row's
GF count sees it) and on the heavily-innervated medulla interneurons (Dm10, MeLo8, TmY5a) feeding
the motion pathway — `VPN ÷ T4/T5` is the rate readout (the spec's literal `T4/T5 ÷ L2` stays in
the table as the flyvis model's own gain, which every operator predicts ≈ 1).
The discriminating row for the
ledger is the first: if no operator produces starved hyperactivity with `oaArousalRule` off, the
rule stays labelled required and the honest state is that hyperactivity is not in the chemical
graph plus these fields.

## Results

Ran `scripts/oa_split.mjs` — 96 jobs (4 conditions × 4 modes × 2 hunger states × seeds 1–3) into
`public/data/oa_split.json`, plus a 24-job `oaArousalRule`-off `walkFrac` sweep
(`public/data/oa_split_ruleoff.json`) and 12 extra `loomWalk` jobs on seeds 4–6 for the two field
modes. Shared controls first: starved OA tone reached ~9–13 Hz vs fed ~2–6 Hz, identical across
operators (the upstream pathway is shared by construction — good), and the tethered forward-DN
ratio stayed ≈ 1.0 for every mode (starved/fed: synFast 1.00, thrField 1.05, gainField 0.99,
thrTyped 1.07). The documented surprise is operator-independent: octopamine does not scale
forward-drive DN output under any of these postsynaptic actions.

| observation | `synFast` | `thrField` | `gainField` | `thrTyped` |
|---|---|---|---|---|
| starved walkFrac ÷ fed, rule on | 0.84 | 1.16 | 1.09 | 1.35 |
| starved walkFrac ÷ fed, rule **off** | 0.85 | 1.06 | 0.90 | 1.09 |
| GF spikes in loom window, stv ÷ fed (6 seeds, field modes; 3 otherwise) | 9.7/30.7 | 10.2/16.7 | 1.7/4.8 | 8.0/16.3 |
| T4/T5 ÷ L2, walk ÷ stand | 0.59/0.44 | 0.59/0.43 | 0.58/0.31 | 0.58/0.46 |
| VPN ÷ T4/T5, walk ÷ stand (starved) | 0.18/0.16 | 0.15/0.10 | 0.10/0.06 | 0.19/0.16 |

What the assay resolved, and what it did not:

- **No operator reproduces starved hyperactivity.** With `oaArousalRule` off and OA tone at
  9–13 Hz, starved/fed walk fraction is 0.85–1.09 — at most a few percent of extra walking, and
  `synFast`/`gainField` walk *less* when starved. The rule keeps its required label; the honest
  statement is sharper now: hunger-driven hyperactivity is not in the chemical graph under any of
  the four postsynaptic actions tested.
- **`synFast` is split from the fields.** It is the only operator where starvation reduces walking
  (0.84–0.85 in both rule states) — consistent with OA's fast synapses being net inhibitory. The
  connectome's OA connectivity, taken literally as fast transmission, acts *against* the hunger
  phenotype. The field operators exist because this literal reading fails.
- **The GF loom count is bimodal, not discriminative at n ≤ 6.** Per-seed counts are ~0 or
  ~10–50; seeds 1–3 suggested gainField silenced the starved GF (0/0/0), seeds 4–6 did not
  replicate (0,10,0). The row is variance-limited — a fair statement is that escape-gating is
  all-or-nothing in this arena and the operators' differences, if any, are inside the noise.
- **Optic gain:** T4/T5÷L2 rises walking→~0.58 vs standing~0.31–0.46 identically in every mode —
  that is the flyvis model's own locomotor gain, insensitive to the operator as predicted. The
  VPN-transfer ratio is noisier but directionally consistent with the pre-registration: gainField
  shows the largest walk-vs-stand amplification of VPN output per T4/T5 input (0.10/0.06 = 1.7×
  vs 1.1–1.5× for the others), while sitting lowest in absolute terms. Weak support, not a
  demonstration — the exposure anatomy (62/408 VPNs innervated, almost no T4/T5) bounds how large
  the effect can be.
- **Forward-DN insensitivity is confirmed, not assumed:** the tethered preparation gives every
  mode stv/fed ≈ 1.0 on the forward pool, so any walking difference is downstream of DN rate.

Net: the split table separates `synFast` (sign-flipped hunger effect) from the field family, and
the field family members from each other only weakly — `thrTyped` walks most when starved (1.35
with the rule on), `gainField` carries the only mechanism that can in principle express a
postsynaptic optic gain, and none replaces `oaArousalRule`. This is recorded as a partial
discrimination: one operator eliminated on direction, the remainder degenerate at this assay's
resolution — the degeneracy itself is the finding worth keeping (three mechanistically distinct
fields are nearly indistinguishable at the behaviour level, which is why the shipped model needed
a named rule rather than an emergent one).
