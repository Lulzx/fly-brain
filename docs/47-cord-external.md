# 47. A second cord through the same kernel: the external-IR path

Doc 46 put the MaleCNS cord through the checked pipeline and found no leg rhythm. This
document does the same run on a second, independently assembled nerve cord — the public BANC
(brain-and-nerve-cord) connectome — to ask the question doc 46 could not: is the null a property
of one cord, or of the model class?

The answer is not a repeat of the null. This cord produces a strong bilateral rhythm of its
own — a left-right **in-phase** population mode near 8 Hz — and it still produces no leg gait.

| file | contents |
|---|---|
| `scripts/prep_cord_banc.py` | packs the public BANC connectome into the cord IR: every nerve-cord-region cell plus every descending cell, the induced edges between them, delta-encoded |
| `cordx.bend` | the ensemble, generalised: graph size from the file headers, an eight-channel tally, and a four-state proprioceptive loop |
| `scripts/cordx_search.mjs` | the gait instrument plus the bilateral phase statistic |
| `ext/` | where the packed IR, kernel input, tables, and output live (gitignored; regenerated in minutes) |

## 1. The external path

`cordx.bend` is `cordens.bend` with three generalisations, each small:

- **Nothing about the graph is a constant.** N, E, and every section offset are read out of the
  file headers, so the same binary runs any cord IR. The checker still sees the same programs:
  `Rows.build`, `Chan.tal`, and the kernel's four phases are unchanged.
- **The tally is an eight-channel table, not a pool list.** Channels 0-5 are the leg motor
  pools, exactly as before; channels 6 and 7 are the left and right halves of the whole cord
  population, which is what a bilateral phase statistic needs. A cell's channel is a column in
  the ensemble table, so the split is a property of the dataset, not the runner.
- **The proprioceptive loop has an open setting.** A two-bit axis selects open, or closed at 5,
  20, or 80 ms of feedback delay. Open keeps the proprioceptors' basal drive and drops the
  feedback term, which separates "the loop made the rhythm" from "the cord made the rhythm".

The members are 128: the five gain/drive axes of doc 46 plus the two proprio-loop bits,
crossed with the same six named perturbations. The run is 4000 steps of 0.5 ms. One lane per
(member, condition), 768 lanes in three commissural groups, as before.

The packer reads the published annotation table (region, super_class, cell_class, hemilineage,
side, neuromere, neurotransmitter, volume) and the published simple edgelist. Membership is one
line: `region == "ventral_nerve_cord"`, or `super_class == "descending"`. That is 33,004 cells
and 3,180,883 induced edges. One deliberate difference from MaleCNS: the reconstruction's count
distribution is sparser, so the edge gate is `minSyn 3` (retains 78% of synaptic weight) rather
than 6; it is a flag, and the descriptor records it.

## 2. The statistic

With `xL`, `xR` the two population channels at 1 ms, `P+` the power of `xL + xR` and `P-` the
power of `xL - xR`, the **in-phase fraction** is `P+(f*) / (P+(f*) + P-(f*))` where `f*` is the
band peak of `P+` over 2-20 Hz. 1.0 is a fully in-phase bilateral mode; ~0.5 is the no-structure
floor; near 0 would be an alternating mode. The band-integrated version sums both spectra over
the whole band. The control is pairing a run's left channel with a *different* run's right
channel: the same mode at the same frequency but no shared fluctuation.

## 3. What the ensemble reads

| read | value |
|---|---|
| in-phase fraction at the peak, baseline median | **0.92** (band-integrated 0.65) |
| the mode | ~7.8 Hz fundamental; per-run peaks split between it and its 15.6 Hz second harmonic |
| cross-run control | 0.58 — the lock is inside the runs, not in the statistic |
| proprio loop open | 0.88 — the mode is a cord property, not a loop property |
| loop closed (5 / 20 / 80 ms) | +0.03 / +0.04 / +0.04 over matched open twins |
| commissural class cut | 0.85 — commissures strengthen the lock, do not create it |
| command silenced | 0.89, pool rate 171 -> 72 Hz — weaker, still in-phase |
| leg motor pairs (T1/T2/T3, L vs R) | 0.86 / 0.87 / 0.82 — in-phase too |
| live leg rhythms | **0 of 128 members** |

The hemilineage ablations move the rate without breaking the mode: 13A off triples the median
pool rate (329 Hz — net inhibitory on this rhythm), 19B off halves it (103 Hz), 13B off lands
between. The gain axes and commissural boost modulate the amplitude of the same pattern.

## 4. What this is evidence for, and what it is not

For: a bilateral in-phase population mode near 8 Hz is a property this wiring produces under
the plain kernel — static weights, one delay, Poisson drive, no graded release. It does not
need the sensorimotor loop, and it appears in a cord assembled from a different animal's data
than the one doc 46 ran. Whatever produces it lives in the shared model class — LIF cells over
a real connectome — not in any one engine's extra semantics.

Against: the kernel here is the shipped one, not anyone else's simulator — no per-neuron
delays, no graded transmission, no muscle plant. A match or mismatch against any other engine's
output is a statement about model classes, not a port. And the gait null is shared: two cords,
two reconstructions, the same absence — the population mode does not organise into alternating
legs under this kernel, which points at dynamics the model class lacks rather than at anatomy.

The boundary the run respects is the same one doc 46 states: every perturbation a member
carries is a proven operation on the checked graph, and the kernel is the gated one. What the
ensemble adds is a second independent wiring diagram through the same instrument.
