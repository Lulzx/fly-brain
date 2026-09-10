// Cross-entropy search over physically meaningful global parameters, 12 parallel evaluators.
import { fork } from 'node:child_process';
import fs from 'node:fs';
const SPACE = {   // [lo, hi, scale]
  wSyn: [0.2, 1.2, 'log'], sizeAlpha: [0, 1, 'lin'], kcThreshold: [0, 30, 'lin'], inhGain: [0.5, 5, 'log'], eInh: [-85, -55, 'lin'], minSyn: [3, 10, 'int'], adaptInc: [0, 3, 'lin'], tRef: [2, 6, 'lin'], laminaBias: [0, 25, 'lin'],
};
const fixed = JSON.parse(process.argv[2] || '{"coba":true}'); const GENS = +(process.argv[3] || 12), POP = +(process.argv[4] || 24), NW = +(process.env.NW || 12);
const keys = Object.keys(SPACE);
const toU = (k, v) => { const [lo, hi, sc] = SPACE[k]; return sc === 'log' ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo); };
const fromU = (k, u) => { const [lo, hi, sc] = SPACE[k]; u = Math.min(1, Math.max(0, u)); const v = sc === 'log' ? lo * Math.pow(hi / lo, u) : lo + u * (hi - lo); return sc === 'int' ? Math.round(v) : +v.toFixed(3); };
const seed = fs.existsSync('data/calib_best.json') ? JSON.parse(fs.readFileSync('data/calib_best.json')).cfg : {};
let mu = keys.map(k => toU(k, { wSyn: 0.5, sizeAlpha: 0.4, kcThreshold: 10, inhGain: 1.2, eInh: -70, minSyn: 5, adaptInc: 0.5, tRef: 3, laminaBias: 9, ...seed }[k])), sd = keys.map(() => 0.2);
const workers = [...Array(NW)].map(() => fork('scripts/calib_eval.mjs'));
const log = fs.createWriteStream('data/calib_log.jsonl', { flags: 'a' });
let best = null;
function evalAll(cfgs) { return new Promise(res => { const out = new Array(cfgs.length); let next = 0, done = 0;
  const give = w => { if (next >= cfgs.length) return; const id = next++; w.once('message', m => { out[id] = m; done++; log.write(JSON.stringify(m) + '\n'); if (done === cfgs.length) res(out); else give(w); }); w.send({ id, cfg: cfgs[id] }); };
  workers.forEach(give); }); }
const gauss = () => { const u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
for (let g = 0; g < GENS; g++) {
  const U = [...Array(POP)].map((_, n) => n === 0 && best ? keys.map(k => toU(k, best.cfg[k])) : mu.map((m, i) => m + sd[i] * gauss()));
  const cfgs = U.map(u => ({ ...fixed, ...Object.fromEntries(keys.map((k, i) => [k, fromU(k, u[i])])) }));
  const t0 = Date.now(); const res = await evalAll(cfgs);
  const scored = res.map((r, i) => ({ u: U[i].map(x => Math.min(1, Math.max(0, x))), s: r.error ? -1 : r.out.score, r })).sort((a, b) => b.s - a.s);
  if (!best || scored[0].s > best.s) { best = { s: scored[0].s, cfg: scored[0].r.cfg, out: scored[0].r.out }; fs.writeFileSync('data/calib_best.json', JSON.stringify(best, null, 1)); }
  const elite = scored.slice(0, Math.max(4, POP >> 2));
  mu = keys.map((_, i) => elite.reduce((a, e) => a + e.u[i], 0) / elite.length);
  sd = keys.map((_, i) => Math.max(0.04, Math.sqrt(elite.reduce((a, e) => a + (e.u[i] - mu[i]) ** 2, 0) / elite.length)));
  console.log(`gen ${g} best ${best.s.toFixed(3)} gen-best ${scored[0].s.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)}s) mu ${keys.map((k, i) => k + '=' + fromU(k, mu[i])).join(' ')}`);
  if (scored[0].r.out) console.log('   terms', JSON.stringify(scored[0].r.out.terms, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
}
workers.forEach(w => w.kill()); console.log('BEST', JSON.stringify(best.cfg), best.s.toFixed(3));
