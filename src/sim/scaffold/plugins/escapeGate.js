// Scaffold plugin: the escape wall-gate.
//
// A static surface the fly is walking up to, touching, or backing away from looms on the eye, its
// own pivots sweep the scene across the retina, and grooming legs pass over it. Touch, optic flow
// that matches its own translation, and efference copies of its movements (Kim et al. 2015) tell
// the brain none of those is a predator. This plugin computes that veto: recent contact or a recent
// pivot suppresses the loom/takeoff trigger for a window. It deletes false alarms by rule, which is
// why it is a scaffold; the replacement is the learned self-motion cancel of roadmap S3.
//
// Registered on the FlyAgent host. Off: the gate's `touching` flag is never asserted, and
// wall/pivot/grooming false-alarm jumps return (docs/19-limitations.md, looming escape).
export function create() {
  return {
    id: 'escapeGate',
    title: 'Escape gating near walls, pivots and grooming',
    claim: 'Without it, looming by self-motion (walls, pivots, grooming sweeps) triggers escape jumps.',
    files: ['src/sim/fly.js', 'src/sim/motor.js'],
    defaultOn: true,
    params: { touchMs: 500, pivotMs: 300 },   // veto windows after last contact / last pivot
    lastTouch: -1e9, lastPivot: -1e9,
    setup() {},
    step() {},
    /** signals: { frontTouch, nearAhead, bodyContact, avoiding, grooming, pivot } -> gated */
    gate(fly, s) {
      if (s.frontTouch.left || s.frontTouch.right || s.nearAhead || s.bodyContact.left || s.bodyContact.right || s.avoiding || s.grooming) this.lastTouch = fly.t;
      if (s.pivot) this.lastPivot = fly.t;
      return fly.t - this.lastTouch < this.params.touchMs || fly.t - this.lastPivot < this.params.pivotMs;
    },
    readout() { return { lastTouch: this.lastTouch, lastPivot: this.lastPivot }; },
  };
}
