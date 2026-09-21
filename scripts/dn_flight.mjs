// M1: find a descending command the wing system can follow (docs/20-roadmap.md).
//
// scripts/wing_mn.mjs flew the fly and found the wing pools carrying nothing: 33-109 Hz whether the
// animal is on the ground or in the air, the power pool changing 7% at takeoff, and no steering pool's
// left-right asymmetry correlating with the commanded turn above |r| = 0.08. The cause is upstream --
// flight is started and maintained by the endogenous module in src/sim/intrinsic.js, so nothing ever
// tells the wing motor neurons that the animal is airborne.
//
// Before wiring a descending population into the flight controller, this screens for one that could
// carry the signal. Every descending type is driven in turn, and what comes out at the motor neurons is
// measured: a flight command has to reach the wing pools and *not* the legs, because a population that
// drives both is a general arousal signal and would start the wings every time the fly walks.
//
//   node scripts/dn_flight.mjs screen [rate] [ms]    # every descending type, ranked; writes public/data/dn_flight.json
//   node scripts/dn_flight.mjs detail <TYPE> [rate]  # one type, pool by pool
//
// The screen is disembodied on purpose. It asks what the *graph* connects, at the calibrated operating
// point, with no body in the loop -- so a negative here is a statement about the connectome and the
// model's excitability rather than about the flight controller.
import fs from 'node:fs';
import { D, makeBrain } from './calib_eval.mjs';
import { motorPools } from './motor_pools.mjs';

const CAL = JSON.parse(fs.readFileSync('public/data/brain_params.json'));
const PARAMS = Object.fromEntries(Object.entries(CAL).filter(([k]) => !k.startsWith('_')));
const POOLS = motorPools(D);
const WING = ['wing_power', 'wing_basalar', 'wing_first', 'wing_third', 'wing_hg', 'wing_pitch'];
const LEG = ['leg_T1', 'leg_T2', 'leg_T3'];
const ORN = D.bodymap.sensors.filter(s => s.kind === 'odor').flatMap(s => s.idx);

const mode = process.argv[2] || 'screen';
const RATE = +(process.argv[mode === 'detail' ? 4 : 3] || 150);
const MS = +(process.argv[4] || 400);

// Every descending type with at least one cell. Both sides are driven together: a flight command is
// bilateral, and the steering asymmetry M1 also wants is a *response* to a turn command rather than
// something a screen should build in.
const dnTypes = new Map();
for (let i = 0; i < D.N; i++) {
  if (D.meta.superclasses[D.sc[i]] !== 'descending_neuron') continue;
  const t = String(D.meta.types[i] || ''); if (!t) continue;
  if (!dnTypes.has(t)) dnTypes.set(t, []); dnTypes.get(t).push(i);
}

function run(drive) {
  const net = makeBrain({ ...PARAMS, seed: 1000 });
  net.setDrive(ORN, 6);
  if (drive) net.setDrive(drive, RATE);
  const steps = MS / net.p.dt;
  for (let s = 1; s <= steps; s++) net.step();
  const sp = Uint32Array.from(net.spikeCount);
  const hz = ix => ix.length ? [...ix].reduce((a, i) => a + sp[i], 0) / ix.length / (MS / 1000) : 0;
  const o = {};
  for (const [k, p] of Object.entries(POOLS)) o[k] = hz(p.idx);
  return o;
}

const f2 = x => (+x).toFixed(1);
const baseline = run(null);

if (mode === 'detail') {
  const t = process.argv[3];
  const ix = dnTypes.get(t) || D.byType(t);
  if (!ix.length) { console.log(`no cells of type ${t}`); process.exit(1); }
  const o = run(ix);
  console.log(`${t}: ${ix.length} cells driven at ${RATE} Hz for ${MS} ms\n`);
  console.log('pool            baseline Hz   driven Hz   change');
  for (const k of Object.keys(POOLS))
    console.log(`${k.padEnd(15)} ${f2(baseline[k]).padStart(11)} ${f2(o[k]).padStart(11)}   ${(o[k] - baseline[k] >= 0 ? '+' : '') + f2(o[k] - baseline[k])}`);
} else {
  const wingOf = o => WING.reduce((a, k) => a + o[k], 0) / WING.length;
  const legOf = o => LEG.reduce((a, k) => a + o[k], 0) / LEG.length;
  const bw = wingOf(baseline), bl = legOf(baseline);
  console.log(`screening ${dnTypes.size} descending types at ${RATE} Hz for ${MS} ms`);
  console.log(`baseline: wing pools ${f2(bw)} Hz, leg pools ${f2(bl)} Hz\n`);
  const rows = [];
  let n = 0;
  for (const [t, ix] of dnTypes) {
    const o = run(ix);
    const dW = wingOf(o) - bw, dL = legOf(o) - bl;
    rows.push({ type: t, cells: ix.length, wing: +wingOf(o).toFixed(2), leg: +legOf(o).toFixed(2),
      dWing: +dW.toFixed(2), dLeg: +dL.toFixed(2),
      // Selectivity: how much of the motor change this command puts on the wings rather than the legs.
      // +1 is wings only, -1 legs only, 0 is an arousal signal that moves both.
      sel: +((dW - dL) / Math.max(1e-6, Math.abs(dW) + Math.abs(dL))).toFixed(3),
      power: +o.wing_power.toFixed(2), dPower: +(o.wing_power - baseline.wing_power).toFixed(2) });
    if (++n % 25 === 0) process.stdout.write(`\r  ${n}/${dnTypes.size}   `);
  }
  process.stdout.write('\r');
  rows.sort((a, b) => b.dPower - a.dPower);
  fs.writeFileSync('public/data/dn_flight.json', JSON.stringify({ _source: 'scripts/dn_flight.mjs', rate: RATE, ms: MS, baseline, rows }, null, 1));
  console.log('the twenty descending types that raise the wing power pool most:\n');
  console.log('type              cells   power Hz   d power   d wing   d leg   selectivity');
  for (const r of rows.slice(0, 20))
    console.log(`${r.type.padEnd(17)} ${String(r.cells).padStart(5)}   ${f2(r.power).padStart(8)}  ${(r.dPower >= 0 ? '+' : '') + f2(r.dPower).padStart(7)}  ${(r.dWing >= 0 ? '+' : '') + f2(r.dWing).padStart(6)}  ${(r.dLeg >= 0 ? '+' : '') + f2(r.dLeg).padStart(5)}   ${r.sel.toFixed(2).padStart(6)}`);
  const sel = rows.filter(r => r.dPower > 1).sort((a, b) => b.sel - a.sel);
  console.log('\nof those that move the power pool at all, the most wing-selective:\n');
  console.log('type              cells   d power   d wing   d leg   selectivity');
  for (const r of sel.slice(0, 15))
    console.log(`${r.type.padEnd(17)} ${String(r.cells).padStart(5)}  ${(r.dPower >= 0 ? '+' : '') + f2(r.dPower).padStart(7)}  ${(r.dWing >= 0 ? '+' : '') + f2(r.dWing).padStart(6)}  ${(r.dLeg >= 0 ? '+' : '') + f2(r.dLeg).padStart(5)}   ${r.sel.toFixed(2).padStart(6)}`);
  console.log(`\n${rows.filter(r => r.dPower > 1).length} of ${rows.length} types raise the power pool by more than 1 Hz.`);
  console.log('wrote public/data/dn_flight.json');
}
