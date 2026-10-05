// Picks for the x8 long-run follow-up (docs/54): the eight lower-bit settings
// (tonic, graded, slow adaptation: members 0-31 of a row-set group) whose
// real-wiring live legs anticorrelate most at 100 ms bins under row-set 3
// (within-hemilineage inhibition x0), by median r over live legs, ties by
// member index. Each is run paired at row-sets 0 (x1), 3 (hl x0) and 7 (own x0).
//
//   node scripts/cord_scale_picks.mjs     # writes ext/x8/picks.json
import fs from 'node:fs';
import { corrAt, liveLegs } from './cord_scale.mjs';

const lo = [...Array(32).keys()].map(k => {
  const rs = liveLegs('x8', 'real', 3 * 32 + k).map(l => corrAt(l.f, l.e, 100));
  const s = rs.sort((a, b) => a - b);
  return { k, n: s.length, med: s.length ? s[s.length >> 1] : Infinity };
}).filter(x => x.n >= 2).sort((a, b) => a.med - b.med || a.k - b.k).slice(0, 8);
const picks = [0, 3, 7].map(g => lo.map(x => g * 32 + x.k));
fs.writeFileSync('ext/x8/picks.json', JSON.stringify({
  rule: 'eight lower-bit settings with the most negative median live-leg r at 100 ms under row-set 3, needing >= 2 live legs; each paired at row-sets 0, 3, 7',
  rowsets: [0, 3, 7], lower: lo, picks }, null, 1));
console.log(JSON.stringify(lo), '\n', JSON.stringify(picks));
