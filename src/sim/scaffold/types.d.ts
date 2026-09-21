// The scaffold plugin contract (docs/37-scaffold-ledger.md).
//
// Every mechanism that produces behaviour without being the connectome is a named, switchable
// module: the stepping generator, grooming and righting programs, the jump program, reafference
// cancellation, the escape wall-gate, the steering leak, the LC10 channel, the GF->TTMn electrical
// synapse, and the endogenous-activity family inside intrinsic.js (bout scheduler, feeding stop,
// avoidance, courtship, rejection, flight saccades, arousal). A plugin registers here, carries a
// one-sentence falsifiable claim, and must no-op when disabled -- "off" restores the graph-only
// behaviour for that channel, not a third code path.
//
// Lifecycle: create() -> params bound via bindScaffoldParams() for paramSource plugins ->
// setup(host) once the host's brain+body exist -> per-step domain hooks called by the host at the
// exact point the monolith ran the block. Domain hooks are deliberately free-form (each plugin
// declares the calls its host makes); step() is the generic hook for plugins that have one.

export type ScaffoldId =
  | "cpg" | "steeringAdapt" | "groomPattern" | "escapeJump" | "rightingReflex"   // Motor host
  | "reafference"                                                             // Senses host
  | "escapeGate" | "gfGap" | "lc10Channel"                                    // FlyAgent host
  | "boutScheduler" | "feedingStop" | "avoidance" | "courtship"
  | "femaleRejection" | "flightSaccade" | "oaArousalRule";                      // Intrinsic host

/** host-managed named modules (src/sim/{neuromod,song,flight}.js): in the ledger, switched elsewhere */
export type HostManagedId = "neuromod" | "song" | "flight";

/**
 * The host object a plugin is registered under. For fly-level mechanisms (escapeGate, gfGap,
 * lc10Channel) it is the FlyAgent; for mechanisms that live inside one subsystem it is that
 * subsystem (Motor, Senses, Intrinsic). It is the existing worker state -- brain arrays, MuJoCo
 * data, senses, neuromod -- not a second world object.
 */
export type SimCtx = any;

export interface ScaffoldPlugin {
  id: ScaffoldId;
  title: string;
  claim: string;               // one sentence, falsifiable: what breaks when it is off
  files: string[];             // implementation paths
  defaultOn: boolean;
  /** literal parameters the plugin owns (CPG pivot, reafference gain, jump program, ...) */
  params?: Record<string, number>;
  /** name of the host constant table its parameters live in ('INTRINSIC' | 'READOUT') */
  paramSource?: string;
  /** the keys of paramSource this plugin consumes; bound live as `P` by bindScaffoldParams() */
  paramKeys?: string[];
  /** the kill switch for the ledger (default: `scaffolds.<id>=false`) */
  kill?: string;
  /** Called once after the host's brain+body exist. */
  setup?(host: SimCtx): void;
  /** Generic per-step hook for plugins that have one (Motor plugins, gfGap). */
  step?(host: SimCtx, ...args: any[]): void;
  /** Domain hooks are free-form and declared per plugin (gate/update/trigger/drive/cancel/...). */
  [hook: string]: any;
  /** Optional: contribute readout used by the ledger. */
  readout?(host: SimCtx, ...args: any[]): Record<string, any>;
}

export interface LedgerRow {
  behaviour: string;           // walk | stand | loomEscape | feed | starveWalk | court | groom | steer
  graphOnly: number;           // [0,1]
  withScaffolds: number;
  required: (ScaffoldId | HostManagedId)[];
  kill: string;                // test that removed the required set
}
