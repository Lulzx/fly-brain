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

## Motor output (src/sim/motor.js)
- 'descending' (default): the brain's real DNs set locomotion: BDN2/oDN1/P9 forward, MDN backward,
  DNa01/DNa02/P9/DNg13 steering (ipsilateral), GF escape. A tripod stepping pattern generator (CMA-ES
  optimised on the flybody model: ≥3 feet on ground, ~3 cm/s, <0.5 mm bounce) executes the command.
  This is a stand-in for the VNC's own pattern generator; decisions remain the brain's.
- 'connectome': every leg muscle is driven by its motor neurons through the full VNC wiring.
- Proboscis (MN9, MN11/12, MN6-8, retractors), antennae and the jump are always driven by their MNs.

## Physiology
Energy (hunger) decays; ingestion when the extended labellum touches food and pharyngeal pump MNs fire.
Hunger raises sugar-GRN and lowers bitter-GRN gain (Inagaki 2012, LeDue 2016). Heat patches damage.

## Known limitations (honest list)
- The connectome gives wiring, not synaptic strengths, neuromodulation, gap junctions or plasticity.
- Antennal lobe: cholinergic LNs (e.g. lLN1_bc, ground truth ACh) make ~200k synapses onto PNs; in this
  chemical-only model one glomerulus recruits most PNs, so odour identity is poorly preserved downstream.
  GABA_B presynaptic inhibition of ORNs (the main AL gain control) is not modelled.
- No connectome-only model today produces coordinated walking from the whole VNC (Pugliese et al. found
  rhythms in a front-leg subnetwork for ~3% of DNs); hence the descending-command mode.
- Proboscis servos in flybody are weak; the labellum counts as touching food within 0.65 mm when extended.
- The brain has no intrinsic drives (circadian, hunger peptides); spontaneous behaviour comes only from
  background synaptic noise and sensory input.
