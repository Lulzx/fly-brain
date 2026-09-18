// Courtship song with the real pulse structure (docs/26-courtship.md).
//
// The wing display this replaces was a 30 Hz flutter: visible, and wrong in every measurable way. A
// courting D. melanogaster male produces two modes with distinct statistics, and the statistics are
// what a song is:
//
//   pulse song  trains of single-cycle pulses, inter-pulse interval ~35 ms, carrier ~250 Hz,
//               one wing extended (Bennet-Clark & Ewing 1969; Arthur et al. 2013 give IPI 34-36 ms
//               at 25 C, and the IPI is the species-identifying parameter the female reads)
//   sine song   a continuous hum near 160 Hz, smaller wing amplitude (Bennet-Clark & Ewing 1968)
//
// Mode choice is not random: it tracks the male's own motion and his distance to the female. Coen
// et al. 2014 show sine song dominating when he is slow and close and pulse song when he is faster
// and further away, with a feedback loop from her motion to his mode. That is the rule implemented
// here, with a refractory bout structure so mode does not chatter frame to frame.
//
// This module produces the wing *envelope* and the pulse timing; it is not acoustic output. The wing
// muscle motor neurons that would drive the real stroke are not annotated in the male CNS release
// (docs/19-limitations.md), so the envelope is applied to the flybody wing joints directly.

export const SONG = {
  ipiMs: 35,            // pulse song inter-pulse interval, Arthur et al. 2013
  pulseMs: 6,           // single pulse envelope duration
  pulseCarrierHz: 250,  // within-pulse carrier, Bennet-Clark & Ewing 1969
  sineHz: 160,          // sine-song frequency
  boutMinMs: 120,       // a mode persists at least this long once chosen
  slowCmS: 0.6,         // "slow" male: below this speed sine song is favoured
  nearCm: 0.35,         // "close": within this range sine song is favoured
  pulseAmp: 1.0, sineAmp: 0.45,
};

export class Song {
  constructor(seed = 1) {
    this.t = 0;                  // ms since the current mode started
    this.mode = null;            // 'pulse' | 'sine' | null
    this.pulses = 0;             // pulses emitted in the current bout
    this.sineMs = 0;             // sine song time in the current bout
    this.total = { pulses: 0, sineMs: 0, pulseMs: 0, ipi: [] };
    this.lastPulseAt = null;
    this._rand = (() => { let a = (seed * 2654435761) >>> 0;
      return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  }

  // ctx: { sing, dist (cm), speed (cm/s) }. Returns { mode, amp, pulse } — amp is the wing
  // vibration envelope in [0, 1], pulse true on the sample a new pulse starts.
  update(tMs, dtMs, ctx) {
    if (!ctx || !ctx.sing) { this.mode = null; this.t = 0; this.pulses = 0; this.sineMs = 0;
      this.lastPulseAt = null; this.nextAt = 0;
      return { mode: null, amp: 0, pulse: false }; }
    const wantSine = (ctx.dist ?? 1) < SONG.nearCm && (ctx.speed ?? 0) < SONG.slowCmS;
    const want = wantSine ? 'sine' : 'pulse';
    if (this.mode !== want && (this.mode === null || this.t >= SONG.boutMinMs)) {
      this.mode = want; this.t = 0; this.pulses = 0; this.sineMs = 0; this.lastPulseAt = null; this.nextAt = 0;
    }
    this.t += dtMs;
    if (this.mode === 'sine') {
      this.sineMs += dtMs; this.total.sineMs += dtMs;
      // a sine hum: the envelope is the carrier itself, so the wing traces the 160 Hz oscillation
      const amp = SONG.sineAmp * (0.5 + 0.5 * Math.sin(2 * Math.PI * SONG.sineHz * tMs / 1000));
      return { mode: 'sine', amp, pulse: false };
    }
    // pulse song: one pulse per inter-pulse interval, with the next interval drawn when a pulse fires
    // so that the jitter is jitter of the interval and not of the sampling
    if (this.nextAt === undefined || this.nextAt === null) this.nextAt = 0;
    const newPulse = this.t >= this.nextAt;
    if (newPulse) {
      if (this.lastPulseAt !== null) this.total.ipi.push(this.t - this.lastPulseAt);
      this.lastPulseAt = this.t; this.pulses++; this.total.pulses++;
      this.nextAt = this.t + SONG.ipiMs * (0.92 + 0.16 * this._rand());   // real IPI jitters a few %
    }
    const since = this.t - this.lastPulseAt;
    const sounding = since < SONG.pulseMs;
    if (sounding) this.total.pulseMs += dtMs;
    const env = sounding ? Math.sin(Math.PI * since / SONG.pulseMs) : 0;       // pulse envelope
    const carrier = Math.sin(2 * Math.PI * SONG.pulseCarrierHz * tMs / 1000);
    return { mode: 'pulse', amp: SONG.pulseAmp * env * (0.5 + 0.5 * carrier), pulse: newPulse };
  }

  // summary for the headless tests: median IPI is the parameter the female's auditory pathway reads
  stats() {
    const ipi = [...this.total.ipi].sort((a, b) => a - b);
    return { pulses: this.total.pulses, sine_ms: Math.round(this.total.sineMs),
             pulse_ms: Math.round(this.total.pulseMs),
             ipi_median_ms: ipi.length ? +ipi[ipi.length >> 1].toFixed(1) : null,
             ipi_n: ipi.length };
  }
}
