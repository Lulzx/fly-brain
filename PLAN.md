# Embodied male-fly connectome: design notes

## Pipeline (all in the browser, also runnable headless in Node)
```
physics state ──► senses.js ──► sensory neuron drive ──► brain (LIF, wasm) ──► motor.js ──► MuJoCo actuators ──► physics
      ▲             (taste, odour, touch,                  165,122 neurons        (descending commands     (flybody fly,
      └──────────── proprioception, heat, eye)             10.5 M connections      or motor neurons)        0.1 ms steps)
```
One fly = one Web Worker (brain + its own MuJoCo world). Other flies appear in each world as kinematic
proxies (collide, are seen, carry pheromone). The connectome lives once in shared WebAssembly memory.

## Body (src/sim/world.js, scripts/prep_body.py)
- flybody fruit fly (Vaxenburg et al. 2024, Apache-2.0): 67 bodies, 102 joints, 78 actuators, adhesion
  on tarsal claws, cm-g-s units. Physics XML keeps the exact compiled masses/inertias; visual meshes are
  decimated separately for three.js.
- Joint sign conventions were measured (scripts in session): femur + = trochanter depression,
  tibia + = extension, coxa + = promotion, coxa_abduct + = adduction, coxa_twist + = anterior rotation,
  femur_twist + = reduction, tarsus + = levation.

## Neuron ↔ body map (scripts/prep_bodymap.py → public/data/bodymap.json)
- Motor: 439 leg/proboscis/antenna motor neurons by annotated muscle (e.g. "Ti flexor MN", "Tr extensor MN",
  "Sternal anterior rotator MN", MN9 rostrum protractor). Abdominal, neck and haltere MNs are unmapped
  (their muscle targets are not annotated in v1.0).
- Sensory: 7,745 neurons in 151 channels: ORNs by glomerulus and antenna, labellar/leg/taste-peg GRNs by
  tastant (identities from the 2026 gustatory connectome: LB3b-c sugar, LB1a-d bitter, LB3a water,
  LB3d high salt; LgLG3/4 & LgAG2 sugar, LgAG1 bitter, LgLG1/2/5-8 pheromone), tactile bristles,
  chordotonal/hair-plate/campaniform proprioceptors, JO, haltere, thermo- and hygrosensory neurons.
- Eyes: 4,107 photoreceptors. Viewing direction = outward normal of a sphere fitted to each eye's lamina
  entry points (retinotopic), rescaled to the Drosophila field of view (az −10…165°, el −60…70°).
  Dorsal-rim R7d/R8d land at +48° elevation on both eyes (orientation check).

## Brain model (src/lif.js, src/wasm/lif.c, src/brainmodel.js)
Leaky integrate-and-fire network (Shiu et al. 2024) with additions, each motivated by physiology:
1. Conductance-based synapses (E_exc 0 mV, E_inh ≈ −70 mV): excitation saturates, inhibition shunts.
2. PSP scaled by (neuron volume / regional median)^−α: large neurons have lower input resistance
   (Pugliese et al. 2025 used α = 1 for the VNC).
3. Connections ≥ 5 synapses (Pugliese et al.).
4. Signs from predicted transmitter; neurons with unclear consensus get a graded sign from the mean
   per-synapse probabilities (P(ACh+monoamines) − P(GABA+Glu+His)).
5. Sensory neurons fire only from their receptors (central inputs onto their terminals are ignored).
6. Kenyon cells have a raised spike threshold (coincidence requirement; Turner 2008, Gruntman & Turner 2013).
7. Lamina monopolar cells get a graded resting depolarisation so histaminergic photoreceptor input can
   modulate them.
8. GF→TTMn electrical synapse (absent from the chemical connectome) added explicitly.
Global parameters were fitted by a cross-entropy search (scripts/calib_search.mjs) against published
behaviours: sugar GRNs → MN9 (Shiu et al.), bitter suppression of MN9, KC sparseness and odour specificity,
DM1 PN responses, bounded baseline activity, return to baseline after stimulus, BDN2 → leg MN activity.

## Vision (src/sim/vision.js, src/flyvis.js, scripts/prep_flyvis_map.py)
- flyvis (Lappalainen et al. 2024, MIT): trained connectome-constrained model of 65 optic-lobe cell types on
  721 columns per eye, exported (45,669 nodes, 1.5 M synapses) and run in WebAssembly; matches PyTorch to 2e-6.
- Lattice orientation fixed by the trained direction selectivity (T4a front-to-back, T4b back-to-front, T4c up).
- Male-CNS optic-lobe neurons get retinotopic directions by propagating photoreceptor directions through the
  connectome (correlation with the dataset's own hex column coordinates |r| up to 0.87), then each is matched to
  the flyvis node of its type in its column (~62k neurons). These neurons are driven by flyvis (rate ∝ deviation
  from resting activity) and masked from recurrent input; everything downstream (LC/LPLC, LPTCs, central brain,
  DNs) is the spiking connectome. Result: looming → LC4/LPLC2 → DNp02/DNp04 (+GF) → escape.

## Motor output (src/sim/motor.js)
- 'descending' (default): the brain's real DNs set locomotion: BDN2/oDN1/P9 forward, MDN backward,
  DNa01/DNa02/P9/DNg13 steering (ipsilateral), GF escape. A tripod stepping pattern generator (CMA-ES
  optimised on the flybody model: ≥3 feet on ground, ~3 cm/s, <0.5 mm bounce) executes the command.
  This is a stand-in for the VNC's own pattern generator; decisions remain the brain's.
- 'connectome': every leg muscle is driven by its motor neurons through the full VNC wiring.
- Proboscis (MN9, MN11/12, MN6-8, retractors), antennae and the jump are always driven by their MNs.
- DN readout (Cande et al. 2018 phenotypes + Bidaye/Sapkal/Rayshubskiy/Namiki): forward population
  {BDN2, oDN1, P9, DNa05, DNa07, DNp26, DNg25, DNa01/02}, backward {MDN}, steering ipsilateral {DNa02, DNa01, P9},
  head grooming {DNg07, DNg08, DNg12}, escape {GF spike → TTMn, or looming takeoff DNs DNp02/DNp04}.
- Stepping pattern generator: tripod (confirmed by FlySuite real-fly data: L1/R2/L3 vs R1/L2/R3, 9.5 Hz),
  optimised for straight walking, ±turning, slow and backward walking; jump program chosen to land upright
  from any stride phase (scripts/jump_test2.py).
- Muscle activation from MN rate saturates (half-maximal ~17 Hz).

## Physiology
Energy (hunger) decays; ingestion when the extended labellum touches food and pharyngeal pump MNs fire.
Hunger raises sugar-GRN and lowers bitter-GRN gain (Inagaki 2012, LeDue 2016). Heat patches damage.

## Physical robustness fixes (each tested headless)
- Claws/labella and legs touch only the floor (contact bits); head/thorax/abdomen/wings collide with walls,
  obstacles and other flies. Without this the fly climbed walls with its legs and flipped over backwards.
- Jump = 30 ms symmetric pre-posture + 20 ms TTM push + 80 ms airborne: lands upright 24/24 from fast turning
  gaits. Escape needs a GF burst (>=3 spikes / 50 ms) or takeoff-DN activity > 70 Hz and > 3x its baseline.
- Righting reflex (VNC-level): inverted > 150 ms -> wing push + leg flailing; rights ~2/3 of inverted states.
- flyvis -> brain gain 150: calm exploration without spurious escapes (250 gave frequent false jumps).

## Behaviour report (scripts/behavior_report.mjs, gain 150)
- Foraging: explores (walks/turns/stands), approaches food, occasional ingestion; no spurious jumps.
- Heat: walks off the hot patch (health ~0.9 after 4 s).
- Bitter: MN9 silenced, walks away.
- Tarsal sugar: forward drive drops (stop signal) but visual drive often keeps the fly walking.
- Looming threat: escape is intermittent (the loom->LC4/LPLC2->GF/DNp02/04 chain is weak relative to
  natural-scene activity; higher visual gain makes escapes reliable but also frequent false alarms).

## Known limitations (honest list)
- MN9 (proboscis) is partly driven by olfactory channels (downstream of the AL spread), so flies sometimes
  extend the proboscis while walking in odour.
- The connectome gives wiring, not synaptic strengths, neuromodulation, gap junctions or plasticity.
- Antennal lobe: cholinergic LNs (e.g. lLN1_bc, ground truth ACh) make ~200k synapses onto PNs; in this
  chemical-only model one glomerulus recruits most PNs, so odour identity is poorly preserved downstream.
  GABA_B presynaptic inhibition of ORNs (the main AL gain control) is not modelled.
- No connectome-only model today produces coordinated walking from the whole VNC (Pugliese et al. found
  rhythms in a front-leg subnetwork for ~3% of DNs); hence the descending-command mode.
- Proboscis servos in flybody are weak; the labellum counts as touching food within 0.65 mm when extended.
- The brain has no intrinsic drives (circadian, hunger peptides); spontaneous behaviour comes only from
  sensory input (vision drives the forward-walking DNs through their visual inputs).
- flyvis covers 65 columnar optic-lobe types; its column lattice is a regular hexagon, so ~410 of 721 model
  columns are used by the real (non-hexagonal) male-CNS eye map. No flight yet (wing-beat generator exists in FlySuite).
