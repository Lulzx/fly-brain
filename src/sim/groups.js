// Named neuron groups for the arena's brain panel: the senses the world drives and the descending and
// motor neurons that move the body. Shared by the fly worker (which measures their firing rates) and
// the page (which draws them), so both sides agree on membership and order.
import { DN_ROLES } from './motor.js';

const GROUPS = [
  { key: 'smell', label: 'Smell', color: '#9be15d', sensors: s => s.kind === 'odor',
    info: 'Olfactory receptor neurons on each antenna, one population per glomerulus. Odour concentration at each antenna drives them, so the two sides differ when a plume is off to one side.' },
  { key: 'taste', label: 'Taste', color: '#f2c14e', sensors: s => /taste/.test(s.kind),
    info: 'Gustatory neurons on the legs, labellum and pharynx. Sugar and bitter patches drive them on contact, and hunger scales the sugar response.' },
  { key: 'vision', label: 'Photoreceptors', color: '#8fb8ff', eyes: true,
    info: 'Photoreceptors of each compound eye, driven by the brightness their eye column sees (the images above). They adapt, so they respond to change more than to steady light.' },
  { key: 'loom', label: 'Looming detectors', color: '#c792ea', types: ['LC4', 'LPLC2'],
    info: 'Visual projection neurons that respond to a dark object growing in the visual field (LC4, LPLC2). They excite the giant fibre and the other escape descending neurons. Try the looming threat.' },
  { key: 'escape', label: 'Giant fibre', color: '#ff6b6b', types: Object.keys(DN_ROLES.escape),
    info: 'The giant fibre descending neuron (DNp01), one per side. A few spikes fire the jump muscles through an electrical synapse: the escape jump.' },
  { key: 'walk', label: 'Walk forward', color: '#4ade80', types: Object.keys(DN_ROLES.forward),
    info: 'Descending neurons whose activation makes flies walk forward (BDN2, oDN1, DNp09 and others). Their weighted rate sets walking speed in the stepping pattern generator.' },
  { key: 'back', label: 'Walk backward', color: '#38bdf8', types: Object.keys(DN_ROLES.backward),
    info: 'Moonwalker descending neurons (MDN). Activating them makes flies walk backwards.' },
  { key: 'steer', label: 'Steering', color: '#fb923c', types: Object.keys(DN_ROLES.turn),
    info: 'Steering descending neurons (DNa01, DNa02, DNp09). The fly turns towards the side firing more, so watch the left and right traces separate during a turn.' },
  { key: 'groom', label: 'Grooming', color: '#f472b6', types: Object.keys(DN_ROLES.groom),
    info: 'Descending neurons that trigger head grooming with the front legs.' },
  { key: 'court', label: 'Courtship circuit', color: '#f9a8d4', types: ['pIP10', 'DNp13'],
    info: 'The male courtship pathway: pheromone receptor neurons reach the pIP10 cluster (two synapses downstream) and the pursuit descending neuron DNp13. Their rate doubles near another fly — that is what makes him chase and sing.' },
  { key: 'octopamine', label: 'Octopamine (hunger)', color: '#e0a3ff', types: ['OA-VUMa1', 'OA-VUMa2', 'OA-VUMa3', 'OA-VUMa4', 'OA-VUMa5', 'OA-VUMa6', 'OA-VUMa8', 'OA-VPM3', 'OA-VPM4'], pooled: true,
    info: 'Octopaminergic neurons of the subesophageal zone (OA-VUMa, OA-VPM). The hunger hormone AKH excites them and insulin inhibits them, so they fire faster as the fly starves; their octopamine makes it more active. Watch them rise as energy falls. Most are unpaired midline cells, so both sides share one trace.' },
  { key: 'feed', label: 'Feeding motor', color: '#facc15', types: ['MN9'], feeding: true,
    info: 'Proboscis extension motor neurons (MN9) and the pharyngeal pump motor neurons that swallow. Active when a hungry fly tastes sugar.' },
];

/** returns [{ key, label, color, info, L: Int32Array, R: Int32Array }] */
export function buildGroups(bodymap, types, side) {
  const byTypes = (names) => { const set = new Set(names), L = [], R = []; for (let i = 0; i < types.length; i++) if (set.has(types[i])) (side[i] === 2 ? R : L).push(i); return [L, R]; };
  return GROUPS.map(g => {
    let L = [], R = [];
    if (g.sensors) for (const s of bodymap.sensors) if (g.sensors(s)) (/right/.test(s.name) ? R : L).push(...s.idx);
    if (g.eyes) for (const e of bodymap.eyes) (e.side === 'right' ? R : L).push(...e.idx);
    if (g.types) { const [a, b] = byTypes(g.types); if (g.pooled) L.push(...a, ...b); else { L.push(...a); R.push(...b); } }
    if (g.feeding) for (const i of bodymap.feeding) (side[i] === 2 ? R : L).push(i);
    return { key: g.key, label: g.label, color: g.color, info: g.info, L: Int32Array.from(new Set(L)), R: Int32Array.from(new Set(R)) };
  });
}

/** worker side: firing rate (Hz of simulated time) per group and side, smoothed over ~150 ms */
export class GroupMeter {
  constructor(groups, N) { this.groups = groups; this.last = new Uint32Array(N); this.rate = new Float32Array(groups.length * 2); this.t = null; }
  read(spikeCount, tMs) {
    const dt = this.t === null ? 0 : tMs - this.t; this.t = tMs;
    const k = dt > 0 ? 1 - Math.exp(-dt / 150) : 0;
    this.groups.forEach((g, j) => [g.L, g.R].forEach((ix, s) => {
      let n = 0; for (const i of ix) { n += Math.max(0, spikeCount[i] - this.last[i]); this.last[i] = spikeCount[i]; }
      if (dt > 0 && ix.length) this.rate[j * 2 + s] += k * (n / ix.length / (dt / 1000) - this.rate[j * 2 + s]);
    }));
    return this.rate.slice(0);
  }
}
