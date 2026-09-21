// Scaffold plugin: the behavioural arousal signal.
//
// Starved flies walk more (Yang et al. 2015). In this model the drive comes from the octopamine
// level of the AKH-sensitive OA neurons when neuromodulation is on (ctx.arousal, see neuromod.js);
// without it the energy deficit itself stands in. This plugin is the single point where that signal
// is decided, so every consumer — bout durations, the forward-drive boost, the takeoff draw — sees
// the same scalar and hunger can never reach locomotion by any other path (spec: no direct
// forward-DN hunger multiplier).
//
// Registered on the Intrinsic host. Off: `level()` is bypassed and the host uses the neutral 0.5,
// so starvation and the OA neurons change nothing about locomotion — the hunger discriminator.
export function create() {
  return {
    id: 'oaArousalRule',
    title: 'Arousal signal for locomotion (OA level, hunger fallback)',
    claim: 'Without it, starvation and octopamine have no effect on walking bouts, drive or takeoff rate.',
    files: ['src/sim/intrinsic.js', 'src/sim/neuromod.js'],
    defaultOn: true,
    params: { neutral: 0.5 },   // the flat arousal the host uses when this plugin is off
    setup() {},
    step() {},
    /** effective arousal for behaviour: the OA neurons' level when the neuromod module is running,
     *  else the energy deficit. The host substitutes params.neutral when this plugin is off. */
    level(ctx, hunger) { return ctx.arousal ?? hunger; },
    readout(host, ctx) { return { arousal: ctx?.arousal ?? null }; },
  };
}
