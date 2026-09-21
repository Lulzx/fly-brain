# 36. Stepping from the nerve cord, as a project

[M2](20-roadmap.md) is one line on the roadmap and about a year of the other items put together. This
document is the separation: what the project is, what it needs that does not exist yet, what would
count as finishing it, and the two points at which it should be stopped instead.

The other five items in Part M are measurements or local repairs. Each has a criterion that an
existing script already computes, and each can be finished in a sitting. M2 is not like them. It
replaces the machinery that produces walking, needs an objective this repository does not have, and is
the only item whose failure would be a claim about the modelling abstraction rather than about the fly.
It is listed here rather than there so that the roadmap stays a list of things that can be finished.

## What is true now

Walking is executed by a tripod generator whose parameters were optimised by CMA-ES against 100
FlySuite trajectories, and the connectome supplies the *decision* to walk and the speed and turn
commands, nothing else ([Gait](13-gait.md), [Limitations](19-limitations.md)). Each leg joint follows
`off + a1·cos(φ + p1) + a2·cos(2φ + p2)`, the phases are hard-coupled into a tripod, and the resulting
gait sits 12° RMS from the real flies it was fitted to.

The full-connectome motor mode — the one where the leg motor neurons drive the joints directly — exists
and **cannot hold posture**. That is the single fact the project starts from, and it is worth being
precise about what it means: the model's 328 leg motor neurons across 126 annotated muscle groups are
simulated, they fire, their activity is converted to muscle force by
`1 − exp(−rate · ln 2 / 17 Hz)` ([Motor](12-motor.md)), and the fly falls over.

The nerve cord itself is not small. 13,151 VNC intrinsic neurons, 708 VNC motor neurons, 1,846
ascending neurons, and 1,454 proprioceptive mechanosensory cells are in the graph, at the same
reconstruction quality as the brain. Nothing about the project is blocked on data that does not exist,
which is what distinguishes it from Parts B and C.

## Why it is a project and not an item

Four things have to be built, and only the first is a day's work.

**1. A stepping objective.** [Doc 13](13-gait.md) compares gaits to FlySuite by joint-angle RMS against
a phase-averaged template. That is a scoring function for a *generator*, and it is the wrong shape for
a fitted nerve cord: it presumes the phase is known, which is exactly the thing the circuit is supposed
to produce. The objective has to be over quantities that survive not knowing the phase — step
frequency, duty factor, inter-leg phase distribution, the tripod coordination strength, and the body's
own trajectory — and every one of them has a published value in the FlySuite set. This is the piece to
build first, because it is also the piece that decides whether the rest is measurable.

**2. Proprioceptive feedback at the timescale it operates on.** The leg's reflex loops are short: a
campaniform sensillum's effect on a motor neuron arrives within a few milliseconds, and the model's
synaptic delay is a uniform 1.8 ms with no conduction-distance term. Whether that uniformity is
survivable is an open question in the model and a known falsehood in the animal.
[Doc 31](31-ablation-ladder.md) already measured that `no_delay` breaks the loom term harder than any
other rung, which says delays are load-bearing somewhere; nobody has asked whether they are
load-bearing here.

**3. A gradient that reaches the body.** [Doc 33](33-differentiable-brain.md) gives an adjoint over
165,122 per-neuron gains, validated against central finite differences to better than 1e-2 with no
truncation. It ends at the spikes. Fitting a nerve cord against a walking trajectory needs the
derivative to continue through the force–frequency model and through MuJoCo, and there are three
routes: differentiate the body too, score the loss on motor-neuron output alone against a target
derived from the kinematics, or use a gradient-free search on a reduced parameter set. The second is
the cheap one and it is also the one that assumes the answer — it presumes a target firing pattern,
which is a supplied gait in a different coordinate system.

**4. A force–frequency model that is not one constant.** This is [M4](20-roadmap.md), and M2 is the
reason M4 is worth doing first. One saturation constant stands in for every neuromuscular junction in
the animal; a postural muscle and the tergotrochanteral muscle differ by more than an order of
magnitude in the literature. A nerve-cord fit against a body driven through a wrong muscle model will
find gains that compensate for the muscle model, and there is no way to tell that from a fit that
found the circuit.

## Success, stated in advance

Two conditions, both already implemented as measurements or a short step from it:

1. **Posture held in `'connectome'` mode for a full 20 s foraging scenario.** `scripts/behavior_eval.mjs`
   runs exactly this scenario and reports `flipFrac` and `alive`; the criterion is the same numbers the
   calibrated descending mode reaches.
2. **A stepping rhythm that is measured rather than imposed.** Step frequency within the FlySuite
   spread around its 9.5 Hz median, a tripod coordination strength that is not zero, and the walking
   speed within the FlySuite range — scored by the objective built in step 1 rather than by joint RMS.

The second condition is the one that matters. A nerve cord that holds the fly up by co-contracting
every muscle would pass the first and should not pass the project.

## The two points at which to stop

**Stop if the objective cannot distinguish the supplied generator from a scrambled one.** Before any
fitting, score the existing tripod generator and a phase-scrambled version of it on the new objective.
If they score the same, the objective does not measure coordination and the project has no scoring
function; that is a week's work to find out and it is worth spending before the year.

**Stop if a fitted VNC holds posture but the rhythm is at the frequency of whatever seeded it.** The
failure mode this project is most likely to produce is a fit that copies its target. A fit seeded from
the supplied generator, converging to something that steps at the supplied generator's frequency, has
demonstrated that the search works and nothing about the nerve cord. The control is to seed two fits
from deliberately different rhythms and require them to converge to the same one.

## What a negative would mean, and why it is worth having

If a fitted VNC still cannot hold posture, the missing quantity is not in the graph. The named
candidates, in the order this document would test them, are the proprioceptive feedback delay, the
muscle force–frequency model, and the absence of the leg's own reflex loops at their real timescale.

That negative is the most valuable outcome this repository can produce, and it is worth saying why: it
would be the strongest available evidence that **a connectome plus a fitted gain per neuron is not
sufficient for motor control**. That is a claim about the level of description, not about the fly, and
it generalises past this project, past this animal and past this reconstruction — which is more than a
successful fit would do, because a successful fit would show only that this graph, fitted this way,
with this body, walks.

[Chapter 16](textbook/16-upload.md) argues the load-bearing question is whether a wiring diagram plus
per-neuron parameters is enough to reproduce an individual. M2 asks the same question about a single
behaviour, in the one part of the nervous system where the answer is not a matter of scoring, and it is
cheap by the standards of that question.

## Cost

The fitting is not the expensive part; nothing here is. The expensive part is that four separable
pieces of engineering have to be right at once before the first informative measurement, which is what
makes it a project and not an item, and what makes the two stopping points above the most important
paragraphs in this document.
