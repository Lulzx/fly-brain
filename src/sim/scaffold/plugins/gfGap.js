// Scaffold plugin: the GF -> TTMn electrical synapse.
//
// Giant-fibre spikes drive the tergotrochanteral motor neuron 1:1 through a gap junction that is
// not in the chemical connectome release (it is a declared exception in the graph-only definition,
// and stays a scaffold until a gap-junction table exists). Mechanism: after the brain steps, any
// new GF spike deposits a fixed excitatory pulse on the TTM motor neurons.
//
// Registered on the FlyAgent host; step() is called immediately after the brain's 1 ms step pair.
// Off: GF spikes are visible in the connectome but never reach the jump muscle's motor neuron, so
// the giant-fibre escape channel is closed (loom takeoff DNs and voluntary takeoffs are unaffected).
export function create() {
  return {
    id: 'gfGap',
    title: 'GF->TTMn electrical synapse',
    claim: 'Without it, giant-fibre spikes cannot trigger the TTM jump.',
    files: ['src/sim/fly.js'],
    defaultOn: true,
    params: { pulse: 20 },   // excitatory conductance deposited per GF spike (LIF kernel units)
    last: undefined,
    setup(fly) { this.last = fly.brain.spikeCount[fly.motor.dn.escape[0]] + fly.brain.spikeCount[fly.motor.dn.escape[1]]; },
    step(fly) {
      const c = fly.brain.spikeCount, now = c[fly.motor.dn.escape[0]] + c[fly.motor.dn.escape[1]];
      if (this.last !== undefined && now > this.last) fly.brain.pulse(fly.motor.ttmn, this.params.pulse);
      this.last = now;
    },
    readout(fly) { return { gfSpikes: fly.brain.spikeCount[fly.motor.dn.escape[0]] + fly.brain.spikeCount[fly.motor.dn.escape[1]] }; },
  };
}
