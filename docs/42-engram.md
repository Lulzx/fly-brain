# 42 — Engram harness (S6)

**Status: in progress — predictions registered before the result.**

The question: can the simulation hold a *memory*? Not a cached behaviour — an installed,
readable, behaviourally consequential synaptic pattern in the mushroom body, written by a named
teaching operator and read back out of the model's own physiology.

Spec S6. The substrate is the KC→MBON edge set, because that is where the field's evidence says
olfactory memory lives: sparse Kenyon-cell odor representations converge on mushroom-body output
neurons whose dopamine-gated plasticity shifts odor valence (Aso et al. 2014; Aso & Rubin 2016;
Cognigni et al. 2018). The dataset carries the anatomy to do this for real — 4,064 KCs, 97 MBONs,
44,042 KC→MBON edges — and the FlyWire instance names carry the published compartment
annotations (`MBON05(y4>y1y2)`, `PAM08(y4)`), so the compartment map is anatomy, not an invented
grouping.

## The mechanism, named

- `src/mb/edges.js` — `buildMB(data)`: parses the compartment annotations, infers the
  unannotated DANs' compartments from their MBON connectivity (cross-checked against the
  annotated ones), and emits the edge table. `edges.pre/post` are KC/MBON *positions*;
  `edges.csr` addresses the packed graph; `edges.comp` is the dendrite's compartment tag set.
  Compartment tags nest by prefix (`y5d` ⊆ `y5`), so an MBON whose dendrite straddles two
  compartments carries both tags on every one of its edges — the packed graph does not record
  which compartment a synapse sits in, and that approximation is stated here, not hidden.
- `src/mb/plastic.js` — `Engram`: one multiplier `m_ij ≥ 0` per KC→MBON edge, `m = 1` naive.
  Deploys through the `edgeGain` channel shared by `LIFDiff` and `writeGraph`, so what the twin
  teaches is literally what the shipped kernel runs. `minSyn` gating still reads the anatomical
  count; `m = 0` silences a synapse without deleting it. Kill test: `edgeGain = null`.
- `src/mb/teach.js` — the three-factor rule:
  `Δm_ij = −η · tr_i/maxTr · el_j/maxEl · dan_c`, where `tr_i` is the KC's spike count in the CS
  window weighted by `exp(−|t−t_US|/τ_E)` (τ_E = 1.5 s — the eligibility window is
  seconds-scale), `el_j` the same for the MBON, and `dan_c` the compartment membership of the
  edge. The US is a real event — the compartment's DANs are driven, on the shipped kernel — so
  whatever else they do in the graph happens; the rule only supplies the spatial selectivity.
  PAM pairing depresses the synapse (negative sign), traces normalised so η reads as fractional
  depression at the maximally tagged edge.
- `src/mb/recall.js` — `probe`: settle, drive the odor's ORN set, count KC/MBON/DN spikes.
  Downstream preference = (forward-DN − backward-DN)/(sum) on the DN pools used in the OA
  split table.
- `scripts/engram_recover.mjs` — the experiment (S6.5/S6.6).

## Protocol

1. Teach: CS+ = vinegar glomeruli, US = the γ4 DAN burst (PAM07/PAM08, 64 cells), overlapping
   the last 400 ms of a 2 s CS. γ4 is the appetitive PAM cluster.
2. Probes: P random 4-glomerulus odors + CS+ (vinegar), CS− (banana — shares glomeruli with
   vinegar, the hard discrimination), novel (geosmin). Naive and trained brains are constructed
   identically and probed in the same order — a paired measurement, not Monte Carlo.
3. Decode: per compartment MBON, ridge-regress `Δy_j(p)` onto `r_i(p)·w_ij` over *all* KC edges
   into that MBON — so the anatomy control can ask whether recovered mass lands on the taught
   compartment's tags specifically.

## Predictions (registered before the P=200 run)

If the operator writes a readable engram:

1. **Signal:** the linear model's predicted Δy correlates with the observed Δy on compartment
   MBONs well above the naive-vs-naive correlation (which should be ~0).
2. **Recovery:** `cos(Δm̂, Δm*)` positive and clearly above the naive decode (~0); top-K overlap
   above its chance rate (K/N ≈ 0.29 for γ4). Ridge is underdetermined at P=200 vs ~450 unknowns
   per MBON, so partial recovery (cosine ~0.2–0.5) is the realistic positive, not ~1.
3. **Attribution:** decoded mass concentrates on compartment-tagged edges above their uniform
   share.
4. **Controls near zero:** naive-vs-naive cosine, shuffled-MBON cosine. The degree-matched
   random engram tests the decoder itself: if it too recovers, the decoder is general; if it
   does not, a positive result for the rule's engram is suspect.
5. **Preference:** γ4 MBONs are avoidance-promoting; depressing them should move CS+ preference
   toward approach (less negative) while CS−/novel move less or not at all. Effect size unknown —
   DN pools are many synapses downstream of the MB lobes.
   *(Outcome: specificity held — only CS+ moved — but the sign falsified the naive prediction:
   the replicated shift is avoid-ward under this readout. See Results.)*

## Results

Run: `node scripts/engram_recover.mjs --probes=200` (200 probes = 106 single-glomerulus +
94 random 4-glomerulus blends; artifact `public/data/engram_recover.json`, raw probe matrices
included so the decoder can be re-run offline by `scripts/engram_decode.mjs`).

Teach wrote **1,069 of 3,721 γ4 edges** (η = 0.7, τ_E = 1.5 s, 64 PAM07/PAM08 DANs driven).

| measurement | value | control | verdict |
|---|---|---|---|
| comp-MBON mean \|Δy\|, trained−naive | **6.16 Hz** | naive−naive 0.74 Hz | write is real (8× noise) |
| untagged-MBON mean \|Δy\| | 2.03 Hz | noise 0.74 Hz | compartment-concentrated, with propagation |
| predicted-Δy correlation | **0.892** | noise −0.022 | engram readable at population level |
| per-edge cosine (ridge) | **0.000** | naive decode 0.001 | inversion fails |
| per-edge cosine (ISTA, 2000 it) | **0.006** | 0.000 | sparse prior doesn't rescue it |
| shuffled-MBON cosine | −0.002 | — | wiring control clean |
| random-m* cosine | −0.001 (L1 0.006) | — | decoder doesn't invent patterns |
| CS+ preference shift, 5 seeds | **−0.030 mean, 5/5 same sign** | CS− +0.010 (mixed), novel −0.003 (mixed) | reliable odor-specific shift |

The single-seed preference row from the discovery run (−0.415→−0.362, "approach-ward") did not
survive replication: probe-order RNG desync makes unpaired deltas ±0.05 noise. The multi-seed
table is the result to believe: CS+ moved **avoid-ward** on every seed (per-seed −0.009, −0.020,
−0.044, −0.047, −0.029) while CS− and novel moved inconsistently. The trained brain treats CS+
differently — the memory expresses on held-out recall — but the sign under the
forward-vs-backward-DN readout is *opposite* the naive "depress avoidance-promoting γ4 →
approach" story. The DN pools measure a locomotor balance, not valence, and the MBON→DN wiring
does not map cleanly onto it; the honest claim is a consistent odor-specific downstream shift,
not "learned attraction". `scripts/engram_recon_pref.mjs` reinstalls the *decoded* engram and
gets exactly naive preferences — a failed decode carries nothing, as it should.

### What this means

- **The write works and the anatomy matters.** Only tagged MBONs moved strongly; the untagged
  spillover (2 Hz) is network propagation through MBON05's downstream targets — largest on
  MBON30(y1y2y3), which shares the γ-lobe neighbourhood and draws 30 Hz of propagated delta.
  That propagation is itself a finding: an engram in γ4 is not siloed.
- **The memory is readable in aggregate, not invertible per-synapse.** The linear model applied
  to the written m* predicts the observed MBON deltas at 0.89 correlation — so the engram is
  verifiably *there* in the physiology. But 200 probes against ~450 collinear unknowns per MBON
  (KC responses overlap heavily across odors) cannot recover which synapses carried it, for
  either ridge or a properly converged ISTA. This is a measurement-limit statement, not an
  absence statement: `engram_decode.mjs` replays the saved matrices, so a future probe design
  can be tested without re-simulating.
- **Held-out recall is the headline**: after one pairing, the trained brain's downstream
  preference for CS+ shifted reliably across seeds while CS− and novel did not — the engram
  expresses as an odor-specific behavioural change. Its sign under this readout is the open
  question, not the fact of the shift.

### Acceptance (spec S6.6)

- "recover m* above chance": **met at the population level** (predicted-Δy 0.89 ≫ 0), **not met
  per-edge** (cosine ≈ 0). Stated plainly: the harness can verify *that* the engram exists and
  *where* it lives, not yet *which synapses* carry it.
- "trained preference on held-out recall": met as a reliable odor-specific shift (5/5 seeds);
  the naive approach-direction prediction was falsified, and the valence sign under the DN
  readout is recorded as unresolved rather than claimed.
- The operator itself satisfies the ledger contract: named (`edgeGain` / `Engram`), typed
  (Float32 per-edge multiplier), killable (`edgeGain: null` is the naive animal — twin audit
  still bit-identical), and deployed through the same `writeGraph` path the arena uses.

### Notes for the next iteration

- Per-edge recovery likely needs probe count comparable to the per-MBON unknown count
  (~450–850), i.e. P ≳ 1000, or a spike-resolved rather than rate-resolved readout.
- `changed=1069` means the rule wrote ~29% of γ4 edges; η and the trace window are the levers
  if a sparser, more decodable engram is wanted.
- The DAN burst is a real network event — 64 PAM neurons driven at 120 Hz for 400 ms. Whatever
  else they do downstream is in the probe data too, by design.
