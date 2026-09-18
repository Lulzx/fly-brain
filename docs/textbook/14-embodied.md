# Closing the Loop Through a Body

A stationary neural model receives inputs chosen by its experimenter. An embodied model helps choose its own next input. A motor signal moves a joint, the foot touches the ground, and a sensory pathway reports the contact back to the nervous system. The next motor signal now depends partly on the consequences of the previous one.

This closed loop can reveal failures that an isolated stimulus never exposes. A response that is useful once can become unstable when it repeatedly stimulates itself. A visual pathway that detects approach can also respond to the animal's own moving limbs. A small persistent steering bias can become a large circular trajectory.

The embodied fly is therefore a demanding integration test. It combines the reconstructed graph with a neuron model, a sensory front end, a physical body, motor readouts, and several supplied behavioural mechanisms. Understanding the demonstration means following how those components contribute, rather than assigning the whole animation to the connectome.

## The assembled animal

The neural system represents all 165,122 neurons in the packed dataset. The embodied fit uses conductance-based integrate-and-fire dynamics with a half-millisecond timestep and a connection threshold of six contacts. The larger three-contact graph remains the data source, but not every stored connection contributes under that runtime threshold.

The physical body comes from flybody, a MuJoCo model with sixty-seven bodies, 102 joints, and seventy-eight actuators. Its mass is about 0.98 milligrams, and the physical simulation uses a 0.2-millisecond step. The model includes adhesive tarsal contact, which is important for a small animal whose feet must maintain purchase on surfaces.

Vision comes through a trained flyvis optic-lobe model with a 721-column hexagonal lattice per eye. Its outputs are mapped onto approximately 62,000 corresponding neurons in the male-CNS representation by cell type and retinotopic position. The training embedded in this visual front end is part of the assembled model's prior information. Visual competence cannot all be attributed to the untrained central graph.

Other sensory inputs include taste, smell, contact, proprioception, wind, and heat. They enter as modelled spike trains on 7,745 sensory neurons across 151 channels, using rates motivated by physiological sources. Motor readouts use identified descending populations and a mapping of 439 motor neurons to 170 muscle groups.

Those mappings are scientific assumptions as well as engineering interfaces. A rate-to-force conversion can alter posture. A sensory-rate conversion can alter the likelihood of an escape. Their calibration should be understood alongside the neural weights, because all participate in the causal loop.

## Making the graph executable

The embodied fit adds several properties not specified by contact counts. Synapses use excitatory and inhibitory reversal potentials, with the inhibitory value fitted near negative 76 millivolts. A postsynaptic size correction scales the effect according to volume relative to a regional reference, with an exponent near 0.61.

Kenyon-cell thresholds are raised by about 10.9 millivolts relative to the base setting. Lamina cells receive a resting bias near 5.3 millivolts so that inhibitory photoreceptor input can modulate their activity in the intended regime. Sensory cells are prevented from being directly driven to spike by central feedback in this simplified receptor model.

A known electrical connection associated with the giant-fibre jump pathway is supplied separately because it is absent from the packed chemical graph. Slow octopamine modulation is also implemented explicitly. These additions are motivated, but they remain additions to the information contained in the graph representation.

The fitted configuration uses a synaptic scale near 0.55, inhibitory gain near 0.61, and refractory period near 3.8 milliseconds. Spike-frequency adaptation is zero in this fit. These values differ from the default circuit ensembles, which is why behaviour across the two branches cannot be compared as though only the body had changed.

Several explored alternatives failed useful checks. A whole-network rate model produced large waves of activity without a coordinated stepping rhythm. Adaptation and short-term depression could stabilise some activity while weakening the sugar-to-proboscis pathway. Treating uncertain transmitter assignments as uniformly excitatory caused excessive olfactory spread. These are findings about the tested implementations, not universal arguments against rate models, adaptation, or excitatory uncertainty.

## Calibration and its boundaries

Nine global parameters were searched against a suite of physiological and behavioural targets. The recorded search used twenty generations of twenty-four candidates. Its objective combined several response measures rather than fitting a single attractive demonstration.

The selected model produces about fifty-nine hertz in the proboscis motor neuron under labellar sugar stimulation, while bitter stimulation and a sugar-bitter mixture suppress that response in the measured protocol. Front-leg sugar produces about thirty-four hertz in the same motor readout. Leg sugar reduces the forward-walking drive from about 9.2 to 4.6 hertz and produces little backward-walking activity.

Kenyon-cell recruitment puts an effective 11.9 percent of the population inside the odour response, against a target of eight. Takeoff-related neurons respond more strongly to the modelled loom than to self-motion, thirty-five versus seven hertz in the recorded fit. Direct activation of a walking-associated descending pathway reaches leg muscle groups.

These are calibration outcomes. The observations used to select parameters should not also be described as independent validation of those parameters. They establish that the chosen model can satisfy parts of the objective under the fitting protocol. Generalisation requires other stimuli, states, and perturbations.

The best recorded composite score is 0.780 selected on a single seed, 0.794 ± 0.005 re-scored across twelve. An earlier configuration had a higher isolated score but a lower repeated mean. A composite objective is useful for optimisation, but its numerical scale is not a percentage of biological correctness. Its interpretation depends on the weighting and form of its terms.

Some failures remain visible even in the selected fit. The odour terms scored zero across every searched configuration, and that turned out to be a defect in the measurement rather than in the model: both thresholded raw spike counts at a level the baseline drive already exceeded, so they compared baseline activity to baseline activity. Rebuilt to count a response as a rise over the neuron's own baseline of three Poisson sigmas, the same model separates the two odours — the Kenyon-cell populations they recruit overlap at a Jaccard of 0.07. What the repaired measure exposes instead is a different gap: the Kenyon-cell response to one odour is broad and weak rather than sparse and strong, and only 0.3 percent of antennal-lobe projection neurons clear the significance bar against the 4.1 percent the odour's receptor innervates directly. The saved calibration also records background activity and a nonzero baseline proboscis-motor response, so the successful evoked response should not be read as complete resting-state fidelity.

The olfactory failure may involve broad cholinergic local-neuron pathways, but the search does not isolate that explanation. Missing receptor-specific effects, inappropriate dynamics, or sensory stimulation could contribute. What it establishes is that the tested global parameterisation did not preserve the desired specificity.

## When an objective rewards the wrong solution

Two implementation failures encountered during calibration are worth understanding because neither requires exotic biology. An odour-specificity objective could be satisfied by making Kenyon cells silent. If no cells respond, two odours do not share an active pattern, but the system has not produced a useful sensory representation.

A specificity measure therefore needs a response constraint. It should reward distinct informative activity, rather than merely low overlap. This is a general problem whenever a desired property has a trivial degenerate solution. A sparse code can be too sparse to carry information; a stable network can be stable because it never responds.

A separate issue involved reused simulation memory retaining activity counts between evaluations. Without a complete reset, one parameter candidate could inherit part of another candidate's state. The resulting score would appear stochastic or state-dependent even though it reflected an evaluation bug.

These checks are part of the experimental method. An optimisation process is good at finding weaknesses in its objective and implementation. A plausible final score becomes more credible when the obvious degenerate routes have been examined, but passing those checks does not replace independent biological tests.

## Reafference changes the operating point

With the body held still, the forward-walking descending populations were largely silent in the relevant probe. Allowing the body to move produced foot-contact bursts that drove them to around ten to thirteen hertz. The simulated fly then ran persistently. Masking tarsal contact reduced the same drive to roughly three hertz.

The network was responding to the consequences of movement. This is reafference: sensory input generated by the animal's own action. It can be useful feedback, but in this model it also reinforced locomotor drive strongly enough to dominate the behaviour.

The implementation therefore attenuates footfall bursts during stepping, using a suppression factor tied to step amplitude. This resembles a plausible form of sensory gating, but the numerical attenuation is supplied by the model. The reconstructed contacts did not specify its gain or state dependence.

Constant food contact created a related problem. Persistent tactile drive could keep the animal moving rather than allowing it to stop. Introducing adaptation in the tactile input made sustained contact less effective than a new contact. Again, the correction changes the sensory dynamics at the interface, and its contribution should remain visible when interpreting feeding behaviour.

The steering readout exposed asymmetry. Right-side descending populations received different excitation and inhibition from their left-side counterparts, and the uncorrected model tended to circle. A slow adaptation with a four-second timescale was added to the steering readout. The observed circling belongs to the interaction between asymmetric wiring and the chosen dynamics; it does not uniquely diagnose an anatomical defect or a biological turning preference.

## Commands are not motor programmes

The network can propagate stimuli to identified descending populations associated with forward walking, backward walking, steering, grooming, escape, takeoff, and courtship. This is useful evidence about pathway recruitment. It is not the same as producing the complete corresponding movement through raw motor-neuron output.

Walking makes the distinction unavoidable. In the tested full-connectome motor mode, directly using nerve-cord output to drive leg muscles did not maintain posture or coordinated locomotion. That failure applies to this model and motor interface. It does not establish that rhythm or posture are absent from the animal's wiring.

The working walking mode uses a stepping generator fitted to one hundred recorded trajectories. Its source movements have a median step frequency around 9.5 hertz and speed around 1.7 centimetres per second, with the fitted joint trajectories reporting roughly twelve degrees RMS error. Descending signals influence the generator, which supplies the detailed coordination needed by the legs.

A video of the resulting fly walking therefore demonstrates an integrated neural-command and movement-generation system. To claim that the connectome generated the rhythm would require replacing or disabling the supplied generator and showing the rhythm in the neural motor output under an appropriate body model.

The same distinction applies to escape and righting. Explicit movement programmes support the jump and wing-assisted recovery. The jump landed upright in twenty-four recorded trials, while wing-assisted righting succeeded in four of six inverted starts. These are small, configuration-specific tests of supplied motor programmes, rather than evidence that those programmes were inferred from the connectome.

## Where spontaneous activity comes from

The model includes an endogenous process that schedules bouts, pauses, grooming, saccades, and local search. Its statistics are motivated by behavioural literature: walk bouts around a 2.2-second median, pauses around 1.4 seconds, and saccades occurring during walking with a tendency to alternate direction.

This process delivers drive to identified descending populations rather than writing actuator commands directly. That keeps the neural network in the signal path, but it does not make the timing of bouts connectome-derived. The network mediates a supplied schedule.

This distinction is worth dwelling on because it applies to many demonstrations of embodied intelligence. A system can pass every motor command through a neural model while an external process still determines when to walk, when to stop, and which action to favour. The origin of the command matters as much as the route through which it passes.

In the embodied operating state, descending neurons receive substantial inhibitory conductance. A nominal current-like bias can therefore have less effect than expected from the resting model. The project uses excitatory conductance to deliver the endogenous drive more effectively. This is a reasonable interface adjustment, and it is another reminder that the operating point changes when the loop is closed.

The failure to obtain spontaneous bouts from the unaided model does not show that bout structure is absent from anatomy. It shows that the selected neuronal dynamics, inputs, and state variables did not generate the desired statistics. The missing explanation could involve a parameter, an omitted state process, or a more appropriate circuit model.

## Escape in a moving world

Looming detection is harder once the animal moves. A wall approached by the fly expands on the retina, but so can a grooming leg. A pathway tuned to image expansion may therefore fire during self-generated movement unless other information changes its interpretation.

The implementation adds gating based on contact, optic flow, and action-related signals. Without sufficient gating, the fly can repeatedly trigger escape near walls or during grooming. With strong gating, genuine external looms can be missed. The tradeoff is exposed by closing the sensory loop.

In one recorded test, only two of ten looms produced escape. Takeoff-neuron activity during self-motion and grooming could approach the trigger level, while real looms provided only a limited additional margin. This is a weak discriminator in the tested system, even if the isolated calibration shows a larger loom response than a particular self-motion stimulus.

The next useful work is pathway-specific: examine the visual inputs, giant fibre, and takeoff populations under matched naturalistic and self-generated stimuli. A single global score cannot identify which stage loses the distinction. The existing model helps locate a problematic chain without having established its unique weak link.

## A state signal that does not explain its phenotype

Octopamine provides a particularly instructive example of an anatomically motivated addition. The model links nutritional state to hormonal and neural signals, then uses octopamine-related activity to lower target thresholds over a slow timescale. About 12,851 anatomical targets receive this simplified modulatory effect.

The model does not have a receptor map specifying which target should change in which way. It applies a common effect, capped near two millivolts, and calibrates the resting activity of the modulatory populations. Fast octopamine contributions are removed as part of this modelling choice. That choice should not be generalised into a claim that every octopaminergic neuron lacks every fast or co-transmitted effect.

With the full state-aware behavioural system, the recorded wild-type moving fraction rises from about 0.55 when fed to 0.73 when starved. The no-octopamine-synthesis condition rises only from about 0.51 to 0.56, while the AKH-receptor condition changes little, from about 0.64 to 0.65. These qualitative patterns resemble the targeted phenotypes, but the bout process can read the arousal state and contributes to the match.

When that behavioural process is made blind to arousal, direct modulation of the graph does not reproduce the intended starvation-induced increase. The recorded moving fraction instead changes from about 0.60 to 0.57, with a lower walking speed in the starved condition.

This is an important negative. The uniform threshold-modulation model is insufficient to produce the target phenotype through the network alone in this setup. The anatomical distribution of contacts may contribute, since steering and backward pathways receive substantial modulation, but the experiment does not isolate that distribution as the cause. Receptor-specific effects, dose, dynamics, and the motor readout remain alternatives.

Removing fast octopamine contributions also weakened the loom pathway in the recorded configuration. Subsequent fitting recovered some takeoff response without recovering the giant-fibre response. An added locomotion-associated visual modulation did not resolve the problem either. These interventions rule out particular attempted repairs; they do not uniquely localise the biological mechanism that is missing.

## What the moving model establishes

The project has shown that a large reconstructed graph can be connected to a physical body and sensory environment, and that this system can express several plausible pathway responses and supplied movements. It has also exposed failures of specificity, coordination, self-motion discrimination, and state dependence that are much harder to see in a static diagram.

Its runtime is an engineering result with a hardware-dependent scope. Earlier measurements reported roughly one fifth of real time per fly with vision and several simultaneous flies on a twelve-core laptop. These figures describe that implementation and machine, not a timeless performance property.

Cross-backend checks provide partial implementation evidence. A deterministic chain gave matching spike counts in the two tested kernels, while a longer stochastic drive produced differing totals, about 10,298 versus 9,580 sampled spikes. One close aggregate comparison is not proof of stochastic equivalence; matched streams and distributions over repeated trials would provide stronger evidence.

The scientific value lies in the boundaries exposed by the integration. We can distinguish pathway recruitment from movement generation, state-aware bout scheduling from direct modulation, and isolated sensory responses from closed-loop behaviour. Each distinction suggests a more targeted experiment. The body makes the model answer harder questions, while the circuit analyses help explain which part of the answer came from which assumption.
