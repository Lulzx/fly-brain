// The plastic scalar layer (spec S6.1/S6.3): one multiplier m_ij >= 0 per existing KC->MBON edge.
// m lives in the order of `mb.edges` (one entry per packed edge, in this dataset one edge per
// KC-MBON pair). m = 1 everywhere is the naive animal: the shipped weight is the empirical-Bayes
// connectome estimate when the caller passes the wEB table, the raw count otherwise -- the harness
// records which it ran on. Edge existence is never modified; m = 0 silences a synapse without
// deleting it, and the minSyn gate still reads the anatomical count.
//
// Deployment is the `edgeGain` channel shared by LIFDiff (opts.edgeGain) and the shipped kernel
// (o.edgeGain -> writeGraph -> baked W). A multiplier that reaches both kernels through the same
// parameter is the whole point: what the twin teaches, the arena runs.
export class Engram {
  /** @param mb  the table from buildMB(); m defaults to 1 on every KC->MBON edge */
  constructor(mb, m = null) {
    this.mb = mb;
    this.m = m ? Float32Array.from(m) : new Float32Array(mb.edges.csr.length).fill(1);
  }

  /** The E-length multiplier the kernels take: 1 everywhere except the KC->MBON edges. */
  edgeGain(E) {
    const g = new Float32Array(E).fill(1), { csr } = this.mb.edges, m = this.m;
    for (let k = 0; k < csr.length; k++) g[csr[k]] = m[k];
    return g;
  }

  get nChanged() { let n = 0; for (const v of this.m) if (v !== 1) n++; return n; }

  /** Serializable: only edges whose multiplier differs from 1, keyed by CSR position. */
  toJSON() {
    const { csr } = this.mb.edges, out = [];
    for (let k = 0; k < csr.length; k++) if (this.m[k] !== 1) out.push([csr[k], +this.m[k].toFixed(5)]);
    return out;
  }

  /** Rebuild from a serialized entry list plus the edge table. */
  static fromEntries(mb, entries) {
    const e = new Engram(mb);
    const pos = new Map(); for (let k = 0; k < mb.edges.csr.length; k++) pos.set(mb.edges.csr[k], k);
    for (const [csr, v] of entries) { const k = pos.get(csr); if (k !== undefined) e.m[k] = v; }
    return e;
  }
}
