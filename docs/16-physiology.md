# 16. Physiology

In `FlyAgent.physiology` in `src/sim/fly.js`.

## Energy
- Decays at 1/240 per second at rest, plus extra for walking and 1/40 per second in flight. Time is
  compressed so hunger matters within minutes.
- At zero energy, health declines.

## Feeding
Ingestion happens when the extended labellum is within 0.65 mm of a food patch. Intake grows with
pharyngeal pump motor neuron activity. Food patches deplete and are shared across flies.
A hungry fly with sugar under its mouthparts stops and extends its proboscis. Hunger gates this reflex in
real flies, and the model's own tarsal-sugar pathway reaches MN9 only weakly
([Endogenous behaviour](23-behaviour.md)).

## Hunger modulates taste
Sugar receptor gain rises and bitter gain falls as energy drops, following Inagaki 2012 and LeDue 2016.
This is receptor physiology, not a behavioural rule.

## Damage
Standing on a hot patch reduces health in proportion to heat. At zero health the fly dies and stops.

## Counters
Distance travelled, takeoffs, flights, and food eaten, shown in the arena panel.
