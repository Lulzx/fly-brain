# 19. Limitations

## Brain
- The connectome gives wiring, not strengths, neuromodulation, gap junctions, or plasticity.
- **Olfaction.** Cholinergic local neurons such as lLN1_bc make about 200,000 synapses onto projection
  neurons, so odour channels still bleed into each other downstream. Antennal-lobe gain is now bounded by
  a divisive ORN normalisation standing in for GABA_B presynaptic inhibition ([Senses](10-senses.md)) —
  the lateral-inhibitory sharpening of the real lobe is still not modelled.
- **Proboscis, and the antennal lobe behind it.** MN9's 26.6 Hz idle is *entirely* olfactory: cutting the
  antennal lobe's projection neurons out of the network takes it to 0.0 Hz, and 85% of its excitatory
  drive at rest arrives through a single GNG120 neuron ([M3](20-roadmap.md)). The number upstream is the
  real limitation — the lobe idles at **77 Hz per projection neuron** against a few to twenty in the
  imaging literature. The gain control that would bound it exists in the connectome and is deleted by
  the model: `writeGraph` drops every synapse onto a sensory neuron, which removes 51,958 connections
  onto the olfactory receptor neurons, 97.8% of whose inhibitory synapses are ALLN→ORN. Restoring it as
  presynaptic divisive inhibition (`preInh`) moves the lobe from 77 Hz to 67, and to only 53 in the
  limit, because 605 of 2,639 receptor neurons receive no local-neuron inhibition at all in v1.0 and the
  lobe sustains itself once ignited.
- **Tarsal sugar does not reach MN9 at all.** Paired over eight seeds, the tarsal-evoked component of
  MN9 is **−0.16 ± 1.57 Hz**. The `tarsalPER` benchmark term scored 0.85 on it until the term was
  changed to read the evoked increase, at which point it reads 0.05 ([M3](20-roadmap.md)).
- **Tarsal reflex** is weak: 15 Hz, partial extension.
- **Few intrinsic drives.** Hunger reaches the octopamine neurons through AKH and insulin
  ([Neuromodulation](25-neuromodulation.md)), but the bouts it lengthens are still rules
  ([Endogenous behaviour](23-behaviour.md)): octopamine's action on the connectome alone does not make starved
  flies walk more. No circadian state; dopamine and serotonin are still fast excitatory transmitters.
- With octopamine's fast synapses removed, the tethered looming benchmark lost its giant-fibre response;
  refitting recovered the takeoff-DN channel but the GF still does not spike to the loom, and the
  locomotion-linked OA optic-lobe gain did not restore it either ([Neuromodulation](25-neuromodulation.md)).
- Left/right imbalances: the right DNa02 and P9 get more tonic excitation than the left, so the steering
  readout adapts slowly to cancel standing asymmetry.

## Motor
- No connectome-only model produces coordinated walking from the whole nerve cord. Pugliese et al. found
  rhythm in a front-leg subnetwork for about 3% of descending neurons. Hence the descending-command mode.
- The full-connectome mode cannot hold posture.
- Descending-neuron roles and readout thresholds are chosen from the literature, not derived.
- **42% of motor output cannot reach the body.** Over 20 s of foraging, 350 of the model's 815 motor
  neurons have no route to any actuator, and they are not quiet: they fire at 21.4 Hz against 21.9 Hz for
  the ones the body can read, so **42.4% of all motor-neuron spikes are emitted into nothing**
  ([M5](20-roadmap.md), `scripts/motor_bound.mjs`). The largest stranded pools are abdominal, neck and
  haltere; the neck pool is the consequential one, because head stabilisation is a visual-feedback loop
  the model cannot close.
- **The wing motor neurons are annotated and unused, and measurement says why.** All six wing pools —
  power, basalar, both axillary groups, hg and the pitch group — fire at 33–109 Hz whether the fly is
  walking or flying (the power pool changes by 7% at takeoff), and their left-right asymmetry does not
  track the commanded turn (|r| ≤ 0.08). Nothing descends into them to say flight has begun, so the
  stroke stays with the engineered controller ([Flight](24-flight.md)).
- Flight uses blade-element forces from the real 218 Hz stroke, but the stroke is evaluated on a
  kinematic copy and applied to the thorax — the wing bodies carry no aerodynamic load and there is no
  wing-inertia coupling. The controller is a lumped approximation, not a trained one; large attitude kicks
  are not always recovered ([Flight](24-flight.md)).

## Behaviour
- **The supplied scheduler's walk bouts carry no individual information, and the body's do.** Over twelve
  simulated individuals, the scheduler's own bout median has ρ = 0.00 between animals and the bout median
  read off the motor command has ρ = 0.74 ([M6](20-roadmap.md)). The scored `bout` term
  ([doc 35](35-behaviour-ladder.md)) is the first of those. More generally, five of the six behavioural
  observables in [doc 34](34-individual-validation.md) come back at ρ ≤ 0.03 in this arena while the motor
  pools identify all twelve individuals — the model's behaviour is produced by machinery the brain is
  barely in.
- Looming escape is intermittent. The takeoff DNs reach their 70 Hz trigger during self-motion and
  grooming, and real looms reach only 70 to 100 Hz. Escape gating removes the false alarms near walls, but
  2 of 10 test looms produced an escape (the original readout produced none away from walls).
- Feeding completes only with the endogenous feeding stop and hunger-gated MN9 drive. The model's own
  sugar stop and tarsal-sugar to MN9 pathway are too weak on their own.
- Turning away from touched obstacles and from heat is supplied by the endogenous module. The connectome
  responds to these senses, but only weakly steers away.
- Occasional flips; righting recovers about two thirds.
- **Courtship song timing and female rejection are rules, not circuits.** The song's pulse/sine
  structure (35 ms IPI, 160 Hz sine) is generated by `src/sim/song.js` rather than by the song motor
  neurons — which are annotated and could drive it ([Flight](24-flight.md)) — and the female's
  decamping and kicking are a scripted response to his proximity, because a female nervous system is
  not in a male connectome ([Courtship](26-courtship.md)).
- **How much of the walking is scaffolding is now measured, and it is most of it.** The endogenous
  scheduler decides on walk bouts with a 2370 ms median; read off the motor command instead, the same
  runs walk in 240 ms bouts ([doc 35](35-behaviour-ladder.md)). About a tenth of the process that decides
  to walk survives into the walk. The scheduler supplies the bout *distribution* and the brain supplies
  how much of it is expressed, which is why graph ablations move bout length at all.

## Body and senses
- flybody's proboscis servos are weak, so labellum contact is a 0.65 mm distance test.
- Legs pass through walls rather than climbing them. Obstacle touch is computed geometrically for the
  antennae and front claws.
- flyvis uses about 410 of its 721 columns with the real eye map.
- Taste, odour, and heat fields are simple analytic models.
