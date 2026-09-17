# References and Further Reading

The book combines established anatomical and physiological work with results from an exploratory software project. The sources below serve different roles. Some supply the reconstruction, some motivate model components, and some provide observations against which models are compared. A source used to design or calibrate a model should not also be counted as an independent test of that same choice.

## Connectomes and model substrates

The male central nervous system reconstruction is distributed through the [MaleCNS project](https://male-cns.janelia.org/), a collaboration involving FlyEM at Janelia, Cambridge, the MRC Laboratory of Molecular Biology, and Google Research. The project's [download page](https://male-cns.janelia.org/download/) identifies the release artifacts. The counts in this book refer to the local packed and thresholded representation, rather than every object available in the source release.

Cook and colleagues' 2019 study, *Whole-animal connectomes of both Caenorhabditis elegans sexes*, supplies the worm comparison. The project uses the adult hermaphrodite chemical and electrical graphs distributed through Netzschleuder, with the recorded July 2020 correction. OpenWorm and WormAtlas cell tables inform the transmitter assignments, whose incomplete coverage limits the sign-conditioned analysis.

The embodied physical model comes from Vaxenburg and colleagues' flybody work, available through the [flybody repository](https://github.com/TuragaLab/flybody). The visual front end comes from Lappalainen and colleagues' trained optic-lobe model, available through [flyvis](https://github.com/TuragaLab/flyvis). Walking and wing-motion resources used by the project are associated with [FlySuite](https://github.com/TuragaLab/FlySuite). These components contribute prior modelling and training information to the assembled animal.

## Neural dynamics and sensory processing

Shiu and colleagues' 2024 connectome-based integrate-and-fire work in *Nature* provides part of the project's neuron-model lineage and motivates sugar, bitter, and veto probes. The current implementation contains several configurations, so attribution to that lineage should not be read as identity with every parameter or method in the published model.

Pugliese and colleagues' 2025 work on connectome simulations of walking-related central pattern generation motivates size scaling and probes of selected descending neurons. Its reported subnetwork results should be kept distinct from this project's unsuccessful full motor-mode test. Neither establishes a universal conclusion about all possible connectome-based walking models.

Turner and colleagues' 2008 study of Kenyon-cell olfactory representations in the *Journal of Neurophysiology* motivates the sparseness target. Olsen and Wilson's 2008 *Nature* study concerns lateral presynaptic inhibition in the antennal lobe. Gruntman and Turner's 2013 work concerns integration of Kenyon-cell inputs. Together these studies motivate operating regimes and candidate mechanisms; they do not directly supply every effective parameter in the simulation.

Amin, Apostolopoulou, Suárez-Grimalt, Vrontou, and Lin's 2020 paper, [*Localized inhibition in the Drosophila mushroom body*](https://elifesciences.org/articles/56954), is essential to interpreting the APL result. It motivates the need to compare the current point-neuron approximation with representations that preserve graded and local activity.

## Heading and spatial computation

Turner-Evans and colleagues' 2020 paper, [*The neuroanatomical ultrastructure and function of a biological ring attractor*](https://pmc.ncbi.nlm.nih.gov/articles/PMC8356802/), supplies the Delta7 perturbation observation discussed in Chapter 9. That observation informed the revised inhibitory model. The quantitative width curve presented here remains a model prediction rather than a curve independently validated by citing the paper.

Hulse and colleagues' 2021 *eLife* connectome of the central complex provides anatomical context for columnar organisation and the PFN-to-hΔB pathways. The present localised-stimulation experiments address a restricted transform hypothesis within that broader anatomical context.

Amari's 1977 work on pattern formation in lateral-inhibition neural fields provides the theoretical lineage for the continuous field. The specific phase-gain approximation used by this project still requires the adjoint-mode and numerical checks described in Chapter 8; invoking the general theory does not establish those implementation details.

Dasgupta, Stevens, and Navlakha's 2017 *Science* paper, *A neural algorithm for a fundamental computing problem*, motivates the connection between mushroom-body organisation and locality-sensitive hashing. The analogy concerns an algorithmic interpretation of expansion and sparsity. The fixed-weight, direct Kenyon-cell probe in this book does not test the full learning system.

## Descending pathways and movement

Braun and colleagues' 2024 work on descending networks and Cande and colleagues' 2018 optogenetic dissection of descending control inform the association of populations with motor effects. Bidaye and colleagues' 2014 and 2020 studies concern moonwalker pathways and backward walking. Rayshubskiy and colleagues' 2020 work concerns DNa02 and steering, while Sapkal and colleagues' 2024 study concerns descending control of walking.

The escape and takeoff interpretation draws on von Reyn and colleagues' 2014 work and Namiki and colleagues' 2018 descending-neuron study. Ribeiro and colleagues' 2018 work on LC10 pathways and Deutsch and colleagues' 2020 work on pursuit and pIP10 inform the courtship-related inputs and readouts. These assignments identify experimentally motivated pathways; the supplied motor programmes remain separate components of the embodied model.

Maye and colleagues' 2007 study in *PLoS ONE* and Brembs's 2011 discussion in *Proceedings of the Royal Society B* inform the treatment of spontaneous behaviour. Geurten and colleagues' 2014 study of walking saccades and Seeds and colleagues' 2014 work on grooming sequences motivate selected behavioural statistics. Dethier's 1957 work and Kim and Dickinson's 2017 local-search study inform post-feeding behaviour. These sources motivate an externally supplied bout process, rather than demonstrating that the simulation derives those statistics from wiring.

Kim and colleagues' 2015 work on efference copy in visuomotor processing motivates the distinction between external motion and self-generated sensory input. Tammero and Dickinson's 2002 work concerns collision-avoidance saccades in flight. Dickinson's 1999 haltere work and Dickinson and colleagues' 1999 aerodynamic study inform parts of the embodied flight and reflex modelling.

## Internal state and modulation

Yu and colleagues' 2016 *eLife* study of insulin, AKH, and octopaminergic signalling motivates the nutritional-state chain. Lee and Park's 2004 *Genetics* study and Yang and colleagues' 2015 *PNAS* work provide context for starvation-related activity and octopamine perturbations. The model's qualitative genotype comparison depends partly on its state-aware bout process, as Chapter 14 explains.

Suver and colleagues' 2012 *Neuron* study concerns flight-related modulation of visual processing by octopamine. Marella and colleagues' 2012 work concerns dopaminergic modulation of sucrose acceptance. These motivate state-dependent effects, but do not establish the uniform receptor action assigned to all anatomical targets in the current model.

Inagaki and colleagues' 2012 work and LeDue and colleagues' 2016 work inform hunger-dependent changes in sugar and bitter sensitivity. These sensory-state relations are additional physiological constraints, rather than quantities determined by the chemical contact graph alone.

## Emulation and scaling

Chapter 16 depends on sources outside the fly literature, and their roles differ. The [FlyWire reconstruction of an adult female brain](https://www.nature.com/articles/s41586-024-07558-y) and its [companion annotation and cell-typing paper](https://www.nature.com/articles/s41586-024-07686-5) supply the neuron and synapse counts quoted for that dataset, together with the authors' own estimate of the proofreading effort. They describe a different animal and a different release from the male central nervous system data used elsewhere in this book, so the two sets of counts should not be combined.

The mammalian comparison comes from the MICrONS consortium's [functional connectomics of mouse visual cortex](https://www.nature.com/articles/s41586-025-08790-w), which reconstructed a cubic millimetre containing more than two hundred thousand cells and co-registered it with calcium imaging. It is cited for the scale at which automated reconstruction must operate, not as evidence about any circuit discussed here. The imaging-volume figure of roughly 1.4 petabytes per cubic millimetre derives from the Harvard and Google reconstruction of human temporal cortex; the whole-brain zettabyte figure in Chapter 16 is an extrapolation from it and carries the error of that extrapolation.

Jin, Zhu, Zhang, and Sui's 2026 [Fly-connectomic Graph Model](https://arxiv.org/abs/2602.17997) instantiates a whole-brain connectome as a graph-structured controller trained by reinforcement learning on a biomechanical fly. It is cited in Chapter 16 as evidence that connectome-structured control is achievable, which is a different claim from the one this book's embodied model tests: a trained controller is not constrained to use the biological dynamics, and its success does not bear on whether the wiring alone specifies a motor programme.

Zanichelli, Schons, Freeman, Shiu, and Arkhipov's [State of Brain Emulation Report 2025](https://arxiv.org/abs/2510.15745) reassesses the field against Sandberg and Bostrom's 2008 roadmap and organises it around neural dynamics, connectomics, and emulation with embodiment. Chapter 16 reaches a similar decomposition and should be read as consistent with that report rather than independent of it. The identifiability argument in that chapter is this project's own, and the sources listed here do not establish it.

The lineage for the claim that connectome-constrained fitting has already been demonstrated is given earlier in this appendix: Shiu and colleagues' 2024 integrate-and-fire model and Lappalainen and colleagues' trained optic lobe are both cited above, and both are components of, or precedents for, the system described in Chapter 14. Their use in Chapter 16 is as evidence about what has been achieved, which means they cannot also serve as independent confirmation of the models this project built on them.

The project reports are the sources for the simulation counts, classifications, and benchmark means in this edition. They should be read alongside these primary studies, with the distinction between a measured animal, an implemented model, and a proposed experiment kept intact.
