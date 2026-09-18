// Checks the two supplied halves of courtship that the connectome cannot provide: the song's pulse
// structure (src/sim/song.js) and the female's rejection behaviour (src/sim/intrinsic.js).
//
// Neither needs a body or a brain, which is the point of testing them here: both are rule-based
// machinery standing in for circuitry that is absent from a male-CNS release, so what can be checked
// is that the rules produce the statistics they claim (docs/26-courtship.md). The embodied version is
// scripts/check_social.mjs, which needs a browser.
//
//   node scripts/check_courtship.mjs
import { Song, SONG } from '../src/sim/song.js';
import { Intrinsic } from '../src/sim/intrinsic.js';

let fails = 0;
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) fails++;
};

// ---------------------------------------------------------------- song
function sing(ms, ctx, dt = 1) {
  const s = new Song(7);
  let pulses = 0, modes = new Set(), maxAmp = 0;
  for (let t = 0; t < ms; t += dt) {
    const r = s.update(t, dt, ctx);
    if (r.pulse) pulses++;
    if (r.mode) modes.add(r.mode);
    maxAmp = Math.max(maxAmp, r.amp);
  }
  return { ...s.stats(), pulses, modes: [...modes], maxAmp };
}

const far = sing(4000, { sing: true, dist: 0.8, speed: 1.5 });     // moving, further away -> pulse song
ok(far.modes.join() === 'pulse', 'a moving male at 0.8 cm sings pulse song', far.modes.join());
ok(Math.abs(far.ipi_median_ms - SONG.ipiMs) <= 3, 'inter-pulse interval matches the target',
   `${far.ipi_median_ms} ms vs ${SONG.ipiMs} ms target (n=${far.ipi_n})`);
const expected = 4000 / SONG.ipiMs;
ok(Math.abs(far.pulses - expected) / expected < 0.15, 'pulse count matches the interval',
   `${far.pulses} pulses in 4 s, expected ~${Math.round(expected)}`);

const near = sing(4000, { sing: true, dist: 0.2, speed: 0.2 });    // slow and close -> sine song
ok(near.modes.join() === 'sine', 'a slow male at 0.2 cm sings sine song', near.modes.join());
ok(near.pulses === 0 && near.sine_ms > 3500, 'sine song is continuous, with no pulses',
   `${near.sine_ms} ms sine, ${near.pulses} pulses`);
ok(near.maxAmp < far.maxAmp, 'the sine display is the smaller wing movement',
   `${near.maxAmp.toFixed(2)} vs ${far.maxAmp.toFixed(2)}`);

// mode switching follows his motion, and holds for at least one bout
{
  const s = new Song(3); const seen = [];
  for (let t = 0; t < 2000; t += 1) {
    const slow = (t % 500) < 250;                                  // alternate the switch condition
    const r = s.update(t, 1, { sing: true, dist: slow ? 0.2 : 0.8, speed: slow ? 0.2 : 1.5 });
    if (!seen.length || seen[seen.length - 1].mode !== r.mode) seen.push({ t, mode: r.mode });
  }
  const held = seen.slice(1).every((x, i) => x.t - seen[i].t >= SONG.boutMinMs);
  ok(seen.length >= 4, 'song mode tracks his speed and distance', `${seen.length - 1} switches in 2 s`);
  ok(held, 'no mode chatters below the bout minimum', `min bout ${SONG.boutMinMs} ms`);
  ok(s.update(2001, 1, null).mode === null, 'song stops when he stops courting');
}

// ---------------------------------------------------------------- female rejection
// Intrinsic needs a type/side table only to find its output populations; a female's rejection path
// touches none of them, so a stub is enough to exercise the state machine.
function female(seed = 1) {
  const typeOf = ['MN9', 'BDN2', 'MDN', 'DNa02', 'DNg07'], sideOf = [3, 3, 3, 2, 3];
  const brain = { pulse() {}, addG() {} };
  return { it: new Intrinsic(typeOf, sideOf, seed), brain };
}
function step(f, ms, ctx) {
  const out = { states: new Set(), kicks: 0, turnAway: 0, fwd: [] };
  for (let t = 0; t < ms; t += 1) {
    f.it.update(1, f.brain, { energy: 0.5, touch: { left: false, right: false }, rearing: false,
      heat: { left: 0, right: 0 }, sugar: 0, flying: false, ahead: [1, 1, 1], court: null,
      mouthOnFood: false, ...ctx });
    out.states.add(f.it.state);
    if (f.it.kick) out.kicks++;
    if (f.it.rejecting) { out.fwd.push(f.it.bias.fwd); if (f.it.bias.turnR > 0) out.turnAway++; }
  }
  out.rejections = f.it.rejections || 0; out.kickEvents = f.it.kicks || 0;
  return out;
}

{
  const f = female(2);
  const r = step(f, 3000, { suitor: { dist: 0.4, bearing: 0.6, singing: true } });   // male on her left
  ok(r.states.has('reject'), 'a male inside rejection range makes her reject', [...r.states].join(','));
  ok(r.rejections >= 2, 'rejection repeats while he keeps at it', `${r.rejections} bouts in 3 s`);
  ok(r.turnAway > 0, 'she turns away from his side', `turnR active ${r.turnAway} ms with him on the left`);
  const mf = Math.max(...r.fwd, 0);
  ok(mf > 12, 'she runs rather than walks while decamping', `forward drive ${mf}`);
  ok(r.kickEvents === 0, 'no kick at 0.4 cm — that is outside kicking range');
}
{
  const f = female(4);
  const r = step(f, 3000, { suitor: { dist: 0.2, bearing: -0.3, singing: true } });  // close, on her right
  ok(r.kickEvents >= 2, 'a male at 0.2 cm gets kicked', `${r.kickEvents} kicks in 3 s`);
}
{
  const f = female(6);
  const r = step(f, 3000, { suitor: { dist: 1.4, bearing: 0.2, singing: false } });  // far away
  ok(!r.states.has('reject') && r.rejections === 0, 'a distant male is ignored');
}
{
  const f = female(8);                                             // no other fly at all
  const r = step(f, 2000, {});
  ok(!r.states.has('reject'), 'no suitor, no rejection state');
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall courtship checks passed');
process.exit(fails ? 1 : 0);
