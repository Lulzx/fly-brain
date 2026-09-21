// Scaffold registry (docs/37-scaffold-ledger.md).
//
// Every non-graph mechanism is a named module with an on/off switch and a falsifiable claim; this
// is the registry that makes them switchable. `createScaffoldSet(config)` builds the per-fly set:
// missing keys take the plugin's defaultOn, unknown ids fail startup. `"scaffolds"` lives in
// brain_params.json / brainOpts, so disabling one is a config change (`--off=cpg,escapeGate`), not
// a code change. Disabling restores the graph-only behaviour for that channel: the call sites in
// motor.js / senses.js / intrinsic.js / fly.js check the set and run nothing when the entry is null.
//
// A set is built per FlyAgent (per standalone host when there is no agent), so plugin state never
// leaks between animals.
import { create as cpg } from './plugins/cpg.js';
import { create as steeringAdapt } from './plugins/steeringAdapt.js';
import { create as groomPattern } from './plugins/groomPattern.js';
import { create as escapeJump } from './plugins/escapeJump.js';
import { create as rightingReflex } from './plugins/rightingReflex.js';
import { create as reafference } from './plugins/reafference.js';
import { create as escapeGate } from './plugins/escapeGate.js';
import { create as gfGap } from './plugins/gfGap.js';
import { create as lc10Channel } from './plugins/lc10Channel.js';
import { create as boutScheduler } from './plugins/boutScheduler.js';
import { create as feedingStop } from './plugins/feedingStop.js';
import { create as avoidance } from './plugins/avoidance.js';
import { create as courtship } from './plugins/courtship.js';
import { create as femaleRejection } from './plugins/femaleRejection.js';
import { create as flightSaccade } from './plugins/flightSaccade.js';
import { create as oaArousalRule } from './plugins/oaArousalRule.js';

const FACTORIES = {
  cpg, steeringAdapt, groomPattern, escapeJump, rightingReflex,
  reafference, escapeGate, gfGap, lc10Channel,
  boutScheduler, feedingStop, avoidance, courtship, femaleRejection, flightSaccade, oaArousalRule,
};
export const SCAFFOLD_IDS = Object.keys(FACTORIES);

// Named modules that already exist as their own file and are switched by a mechanism outside the
// scaffolds map. They are listed so the ledger accounts for every piece of supplied machinery; they
// are not instantiated here because their hosts own their lifecycle.
export const HOST_MANAGED = [
  { id: 'neuromod', title: 'Hunger hormones (AKH/IPC) -> octopamine -> threshold and sensory modulation',
    claim: 'Without it (brainOpts.neuromod=false), or with the OA channel blocked (neuromod.block), starvation does not change firing thresholds or locomotion.',
    files: ['src/sim/neuromod.js'], hostManaged: true, switch: 'brainOpts.neuromod / neuromod.block' },
  { id: 'song', title: 'Courtship song generator (pulse trains / sine)',
    claim: 'Without the courtship plugin it is never driven; the wing-song motor pattern itself lives here.',
    files: ['src/sim/song.js'], hostManaged: true, switch: 'driven by courtship.courtSing' },
  { id: 'flight', title: 'Wing flight controller',
    claim: 'The connectome supplies no flight command (scripts/wing_mn.mjs, roadmap M1); this controller executes takeoff, thrust, steering and landing.',
    files: ['src/sim/flight.js'], hostManaged: true, switch: 'motor.launchT -> flight.start' },
];

/** config: { [id]: boolean } — missing keys default to the plugin's defaultOn; unknown ids throw.
 *  paramOverrides: { [id]: {key: value} } — merged into the plugin's own params (and, for
 *  paramSource plugins, over a per-instance copy of the bound table) so ensembles can sweep a
 *  mechanism's knobs without mutating the shared INTRINSIC/READOUT tables. */
export function createScaffoldSet(config = {}, paramOverrides) {
  for (const id of Object.keys(config)) {
    const hm = HOST_MANAGED.find(m => m.id === id);
    if (hm) throw new Error(`scaffold '${id}' is host-managed; toggle it via ${hm.switch}, not the scaffolds map`);
    if (!FACTORIES[id]) throw new Error(`unknown scaffold '${id}' (known: ${[...SCAFFOLD_IDS, ...HOST_MANAGED.map(m => m.id)].join(', ')})`);
  }
  const set = {};
  for (const [id, create] of Object.entries(FACTORIES)) {
    const inst = create();
    if (paramOverrides?.[id]) { inst.paramOverrides = { ...paramOverrides[id] }; if (inst.params) Object.assign(inst.params, inst.paramOverrides); }
    set[id] = (config[id] ?? inst.defaultOn) ? inst : null;
  }
  return set;
}

/** give plugins whose parameters live in a host constant table a live reference to it
 *  (paramSource: 'INTRINSIC' | 'READOUT'). The table is bound, not copied, so scripts that mutate
 *  it (scripts/diag_walk.mjs) still reach the plugins — unless the plugin carries paramOverrides,
 *  in which case it gets a per-instance merged copy. */
export function bindScaffoldParams(set, source, table) {
  for (const p of Object.values(set)) if (p && p.paramSource === source) p.P = p.paramOverrides ? { ...table, ...p.paramOverrides } : table;
}

/** registry contents for the ledger: which modules exist, their claims, params and kill switches.
 *  `sources` maps a plugin's paramSource to its live table ({ INTRINSIC, READOUT }) so the ledger
 *  can show values rather than names. */
export function scaffoldManifest(set, sources = {}) {
  const pick = (obj, keys) => { const o = {}; for (const k of keys) o[k] = obj[k]; return o; };
  const plugins = SCAFFOLD_IDS.map(id => {
    const p = set?.[id] || FACTORIES[id]();
    const params = p.params ?? (p.paramKeys && sources[p.paramSource] ? pick(sources[p.paramSource], p.paramKeys) : (p.paramKeys || null));
    return { id, title: p.title, claim: p.claim, files: p.files, defaultOn: p.defaultOn, on: set ? !!set[id] : p.defaultOn, params, kill: p.kill || `scaffolds.${id}=false` };
  });
  const hosted = HOST_MANAGED.map(m => ({ ...m, on: 'host-managed', params: null, kill: m.switch }));
  return [...plugins, ...hosted];
}
