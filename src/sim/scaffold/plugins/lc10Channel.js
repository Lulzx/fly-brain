// Scaffold plugin: the LC10 small-object channel.
//
// LC10 visual projection neurons respond to small moving objects and carry the male's
// eye-to-courtship signal (LC10a -> pC1/pIP10; Ribeiro et al. 2018). Neither the simple
// photoreceptor eye nor the flyvis optic-lobe model resolves the other fly as an object, so a
// nearby fly is injected directly: its angular size drives a quarter of the ipsilateral LC10
// columns at a saturating rate. A supplied sensory channel, not connectome output.
//
// Registered on the FlyAgent host, in step() where the monolith ran this loop. Off: other flies
// produce no LC10 drive, so the courtship readout can only come from cVA pheromone olfaction.
export function create() {
  return {
    id: 'lc10Channel',
    title: 'LC10 small-object drive from a nearby fly',
    claim: 'Without it, another fly in view drives no LC10 neurons, so visual courtship initiation is lost.',
    files: ['src/sim/fly.js'],
    defaultOn: true,
    params: { flyRadius: 0.13, maxHz: 140, gain: 200, maxDist: 3, field: 2.2, minAngular: 0.04, stride: 4 },
    setup() {},
    step() {},
    /** write LC10 rates for each nearby fly; `yaw` is the host fly's heading */
    drive(fly, st, rates, yaw) {
      const P = this.params;
      for (const o of st.otherFlies) {
        const a = Math.atan2(o.y - st.pos[1], o.x - st.pos[0]) - yaw;
        const bearing = Math.atan2(Math.sin(a), Math.cos(a));
        const dd = Math.hypot(o.x - st.pos[0], o.y - st.pos[1]);
        const angular = Math.atan2(P.flyRadius, dd);          // fly ~1.3 mm radius
        if (Math.abs(bearing) < P.field && dd < P.maxDist && angular > P.minAngular) {
          const hz = Math.min(P.maxHz, P.gain * angular);     // saturating small-object response
          const pool = fly.lc10[bearing > 0 ? 'left' : 'right'];
          for (let k = 0; k < pool.length; k += P.stride) if ((rates.get(pool[k]) || 0) < hz) rates.set(pool[k], hz);   // ~1/4 of the column: the object covers part of the visual field
        }
      }
    },
    readout() { return {}; },
  };
}
