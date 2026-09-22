// Tests for the response battery's comparators (src/exp/responses.js). No simulation.
//   node scripts/responses_unit.mjs
import { RESPONSES, RESPONSE_BY_ID, compare, evaluateResponse } from '../src/exp/responses.js';

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' -> ' + JSON.stringify(got)}`); if (!ok) fails++; };
const oc = (...a) => compare(...a).outcome;

check('sign: backward matches', oc('sign', { sign: -1, minAbs: 0.02 }, 0.3, -0.1) === 'match');
check('sign: tiny backward is not a match', oc('sign', { sign: -1, minAbs: 0.02 }, 0.3, -0.01) === 'mismatch');
check('sign: null is undefined', oc('sign', { sign: -1 }, 0.3, null) === 'undefined');
check('direction: slowdown by half matches', oc('direction', { sign: -1, minFrac: 0.5 }, 1.0, 0.4) === 'match');
check('direction: slowdown by a third misses minFrac', oc('direction', { sign: -1, minFrac: 0.5 }, 1.0, 0.7) === 'mismatch');
check('direction: speed-up is a mismatch for a slowdown row', oc('direction', { sign: -1, minFrac: 0.5 }, 1.0, 1.5) === 'mismatch');
check('ratio: 0.4 inside [0.2,0.6]', oc('ratio', { range: [0.2, 0.6] }, 1.0, 0.4) === 'match');
check('ratio: 1.1 outside', oc('ratio', { range: [0.2, 0.6] }, 1.0, 1.1) === 'mismatch');
check('ratio: zero baseline undefined', oc('ratio', { range: [0.2, 0.6] }, 0, 0.4) === 'undefined');
check('unchanged: within tolerance', oc('unchanged', { frac: 0.15, floor: 0.5 }, 0.98, 0.9) === 'match');
check('unchanged: collapsed', oc('unchanged', { frac: 0.15, floor: 0.5 }, 0.98, 0.3) === 'mismatch');
check('below: 0.05 <= 0.1', oc('below', { max: 0.1 }, null, 0.05) === 'match');
check('monotonic: rising series', oc('monotonic', { sign: 1, minSpan: 0.05 }, 0, [0.1, 0.2, 0.3]) === 'match');
check('monotonic: ties allowed', oc('monotonic', { sign: 1, minSpan: 0.05 }, 0, [0.1, 0.1, 0.3]) === 'match');
check('monotonic: a dip fails', oc('monotonic', { sign: 1, minSpan: 0.05 }, 0, [0.1, 0.3, 0.2]) === 'mismatch');
check('monotonic: too small a span fails', oc('monotonic', { sign: 1, minSpan: 0.5 }, 0, [0.1, 0.2, 0.3]) === 'mismatch');
check('monotonic: one value undefined', oc('monotonic', { sign: 1 }, 0, [0.1]) === 'undefined');

// whole rows
{ const r = evaluateResponse(RESPONSE_BY_ID.b13_slowdown, { base: { 'gait.speed': 0.5 }, pert: [{ 'gait.speed': 0.2 }] });
  check('b13 row: 60% slowdown matches', r.outcome === 'match', r); }
{ const r = evaluateResponse(RESPONSE_BY_ID.decapitated_stands, { base: { 'gait.displacement': 0.9, 'gait.upright': 0.98 }, pert: [{ 'gait.displacement': 0.02, 'gait.upright': 0.95 }] });
  check('decapitated row: still, upright kept', r.outcome === 'match', r); }
{ const r = evaluateResponse(RESPONSE_BY_ID.decapitated_stands, { base: { 'gait.displacement': 0.9, 'gait.upright': 0.98 }, pert: [{ 'gait.displacement': 0.02, 'gait.upright': 0.2 }] });
  check('decapitated row: still but fallen is a mismatch', r.outcome === 'mismatch', r); }
{ const r = evaluateResponse(RESPONSE_BY_ID.dng100_dose, { base: { 'gait.speed': 0.1, 'gait.cadence': 4 }, pert: [{ 'gait.speed': 0.1, 'gait.cadence': 5 }, { 'gait.speed': 0.2, 'gait.cadence': 7 }, { 'gait.speed': 0.3, 'gait.cadence': 9 }] });
  check('dose row: speed and cadence both rise', r.outcome === 'match', r); }
{ const r = evaluateResponse(RESPONSE_BY_ID.dng100_dose, { base: { 'gait.speed': 0.1, 'gait.cadence': 4 }, pert: [{ 'gait.speed': 0.1, 'gait.cadence': 5 }, { 'gait.speed': 0.3, 'gait.cadence': 7 }, { 'gait.speed': 0.2, 'gait.cadence': 9 }] });
  check('dose row: speed dips, cadence rises -> mismatch', r.outcome === 'mismatch', r); }

// every row is well-formed
for (const row of RESPONSES) {
  check(`row ${row.id} has status, measure, comparator, expect`, ['measured', 'qualitative', 'prediction', 'pending'].includes(row.status) && /^gait\./.test(row.measure) && typeof row.comparator === 'string' && row.expect && typeof row.expect === 'object', row);
  check(`row ${row.id} has a source or is pending`, row.status === 'pending' ? row.source === null : typeof row.source === 'string' && row.source.length > 20, row.source);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
