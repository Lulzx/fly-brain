// Visualises public/data/algo_structures.json (written by scripts/algo_structures.py): one card per
// algorithmic structure found in the connectome, with a figure, the key numbers and what they mean.
const BASE = import.meta.env.BASE_URL;
const $ = (s) => document.querySelector(s);
const fmt = (v) => typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(v < 1 ? 3 : 1)) : v;
const pct = (v) => `${Math.round(v * 100)}%`;
const C = { exc: '#38bdf8', inh: '#f43f5e', mod: '#a855f7', acc: '#ffb347', ok: '#4ade80', dim: '#7d8597', line: 'rgba(255,255,255,.12)' };
const svgEl = (w, h) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.setAttribute('width', w); return s; };
const el = (tag, attrs = {}, text) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
// text metrics for the SVG label font, so figures size to their own labels instead of a guessed column
const _mctx = document.createElement('canvas').getContext('2d');
const FONT = '11px ui-sans-serif, system-ui, sans-serif';
const textW = (t) => { _mctx.font = FONT; return _mctx.measureText(String(t)).width; };
/** shorten a label to fit maxW, keeping the full string as a tooltip */
const clip = (t, maxW) => { let s = String(t); if (textW(s) <= maxW) return s; while (s.length > 1 && textW(s + '\u2026') > maxW) s = s.slice(0, -1); return s + '\u2026'; };

// ---------- figure primitives ----------
/** horizontal bars: rows = [{label, value, color?, note?}] */
function bars(rows, { width = 420, max, unit = '', barH = 14, labelW = 130, maxLabelW = 180, format = fmt } = {}) {
  max = max ?? Math.max(...rows.map(r => r.value));
  // the bar track keeps its nominal width; the label and value gutters are measured so nothing spills out of the viewBox
  const notes = rows.map(r => (r.note ?? format(r.value)) + unit);
  const bw = Math.max(60, width - labelW - 70);
  const lw = Math.min(maxLabelW, Math.max(...rows.map(r => textW(r.label)))) + 8;
  const nw = Math.max(0, ...notes.map(textW)) + 10;
  const H = rows.length * (barH + 4) + 4, s = svgEl(Math.ceil(lw + bw + nw), H);
  rows.forEach((r, i) => {
    const y = i * (barH + 4) + 2, w = Math.max(0, bw * r.value / max);
    const label = clip(r.label, lw - 8), t = el('text', { x: lw - 6, y: y + barH - 3, 'text-anchor': 'end' }, label);
    if (label !== String(r.label)) t.append(el('title', {}, String(r.label)));
    s.append(t);
    s.append(el('rect', { x: lw, y, width: w, height: barH, rx: 3, fill: r.color || C.acc, opacity: .9 }));
    s.append(el('text', { x: lw + w + 5, y: y + barH - 3, class: 'dim' }, notes[i]));
  });
  return s;
}
/** heatmap: rows × cols with values, colour by value/max */
function heat(rowLabels, colLabels, M, { cell = 30, labelW = 60, top = 46, color = C.exc, format = (v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v ? String(Math.round(v)) : '' } = {}) {
  const max = Math.max(...M.flat());
  // row labels sit left of the grid and column labels lean out of its top-left corner; both gutters are measured
  const lw = Math.max(labelW, Math.max(...rowLabels.map(textW)) + 8);
  const diag = Math.max(...colLabels.map(textW)) / Math.SQRT2;
  const t0 = Math.max(top, diag + 12), padL = Math.max(0, diag - lw - cell / 2);
  const W = padL + lw + colLabels.length * cell + 6, s = svgEl(Math.ceil(W), Math.ceil(t0 + rowLabels.length * cell + 4));
  const g = el('g', { transform: `translate(${padL.toFixed(1)} 0)` }); s.append(g);
  colLabels.forEach((c, j) => g.append(el('text', { x: lw + j * cell + cell / 2, y: t0 - 6, 'text-anchor': 'end', transform: `rotate(-45 ${lw + j * cell + cell / 2} ${t0 - 6})` }, c)));
  rowLabels.forEach((r, i) => {
    g.append(el('text', { x: lw - 6, y: t0 + i * cell + cell / 2 + 4, 'text-anchor': 'end' }, r));
    colLabels.forEach((c, j) => {
      const v = M[i][j], a = max ? Math.pow(v / max, .5) : 0;
      g.append(el('rect', { x: lw + j * cell, y: t0 + i * cell, width: cell - 1, height: cell - 1, rx: 2, fill: color, opacity: .08 + .92 * a }));
      if (v / max > .03) g.append(el('text', { x: lw + j * cell + cell / 2 - .5, y: t0 + i * cell + cell / 2 + 4, 'text-anchor': 'middle', 'font-size': 9, fill: a > .5 ? '#06121a' : '#d7dbe6' }, format(v)));
    });
  });
  return s;
}
/** polar profile: values indexed by angular bin (period n) */
function polar(vals, { size = 240, color = C.inh, label = (k) => `${k * 360 / vals.length}°` } = {}) {
  const n = vals.length, cx = size / 2, cy = size / 2, R = size / 2 - 26, max = Math.max(...vals), s = svgEl(size, size);
  [.25, .5, .75, 1].forEach(f => s.append(el('circle', { cx, cy, r: R * f, fill: 'none', stroke: C.line })));
  const pt = (k, r) => { const a = -Math.PI / 2 + 2 * Math.PI * k / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const path = vals.map((v, k) => pt(k, R * v / max)).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('') + 'Z';
  s.append(el('path', { d: path, fill: color, 'fill-opacity': .25, stroke: color, 'stroke-width': 2 }));
  vals.forEach((v, k) => { const [x, y] = pt(k, R * v / max); s.append(el('circle', { cx: x, cy: y, r: 3.5, fill: color })); const [lx, ly] = pt(k, R + 14); s.append(el('text', { x: lx, y: ly + 4, 'text-anchor': 'middle', class: 'dim' }, label(k))); });
  s.append(el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'dim', 'font-size': 10 }, 'bump'));
  return s;
}
/** feedforward fan diagram: layers = [{name, n, color}], links = [{a, b, label}] */
function fan(layers, links, { width = 440, height = 170 } = {}) {
  const s = svgEl(width, height), xs = layers.map((_, i) => 60 + i * (width - 120) / (layers.length - 1)), yc = 70;
  const rad = layers.map(l => 8 + 22 * Math.sqrt(l.n) / Math.sqrt(Math.max(...layers.map(m => m.n))));
  links.forEach(l => {
    const [i, j] = [l.a, l.b]; const curve = i === j ? `M${xs[i]},${yc - rad[i]} C${xs[i] - 40},${yc - rad[i] - 55} ${xs[i] + 40},${yc - rad[i] - 55} ${xs[i]},${yc - rad[i]}` : `M${xs[i]},${yc} C${(xs[i] + xs[j]) / 2},${yc + (j < i ? 55 : 0)} ${(xs[i] + xs[j]) / 2},${yc + (j < i ? 55 : 0)} ${xs[j]},${yc}`;
    s.append(el('path', { d: curve, fill: 'none', stroke: l.color || C.exc, 'stroke-width': Math.max(1.5, 8 * l.w), opacity: .6 }));
    if (l.label) s.append(el('text', { x: i === j ? xs[i] : (xs[i] + xs[j]) / 2, y: i === j ? yc - rad[i] - 46 : yc + (j < i ? 52 : -8), 'text-anchor': 'middle', class: 'dim', 'font-size': 10 }, l.label));
  });
  layers.forEach((l, i) => { s.append(el('circle', { cx: xs[i], cy: yc, r: rad[i], fill: l.color, opacity: .9 })); s.append(el('text', { x: xs[i], y: yc + rad[i] + 16, 'text-anchor': 'middle' }, l.name)); s.append(el('text', { x: xs[i], y: yc + rad[i] + 29, 'text-anchor': 'middle', class: 'dim' }, l.n.toLocaleString())); });
  return s;
}
/** motif glyph: nodes {id,x,y,sign}, edges [[a,b,sign]] */
function glyph(nodes, edges) {
  const s = svgEl(150, 90); const P = Object.fromEntries(nodes.map(n => [n.id, n]));
  edges.forEach(([a, b, sg]) => {
    const A = P[a], B = P[b], dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, x2 = B.x - ux * 14, y2 = B.y - uy * 14;
    s.append(el('line', { x1: A.x + ux * 12, y1: A.y + uy * 12, x2, y2, stroke: sg > 0 ? C.exc : C.inh, 'stroke-width': 2 }));
    if (sg > 0) s.append(el('polygon', { points: `${x2},${y2} ${x2 - ux * 6 - uy * 4},${y2 - uy * 6 + ux * 4} ${x2 - ux * 6 + uy * 4},${y2 - uy * 6 - ux * 4}`, fill: C.exc }));
    else s.append(el('line', { x1: x2 - uy * 5, y1: y2 + ux * 5, x2: x2 + uy * 5, y2: y2 - ux * 5, stroke: C.inh, 'stroke-width': 3 }));
  });
  nodes.forEach(n => { s.append(el('circle', { cx: n.x, cy: n.y, r: 11, fill: n.sign > 0 ? C.exc : n.sign < 0 ? C.inh : C.dim, opacity: .9 })); s.append(el('text', { x: n.x, y: n.y + 4, 'text-anchor': 'middle', fill: '#06121a', 'font-weight': 600 }, n.id)); });
  return s;
}
function table(cols, rows) {
  const t = h('table'); t.append(h('thead', '', `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`));
  const b = h('tbody'); rows.forEach(r => b.append(h('tr', '', r.map(v => `<td class="${typeof v === 'number' ? 'n' : ''}">${fmt(v)}</td>`).join('')))); t.append(b);
  // wide tables get two grid tracks and, failing that, scroll inside the card rather than spilling over its edge
  const wrap = h('div', cols.length >= 4 ? 'tbl wide' : 'tbl'); wrap.append(t); return wrap;
}
const stats = (items) => { const d = h('div', 'stats'); items.forEach(([v, l]) => d.append(h('div', '', `<b>${fmt(v)}</b><span>${l}</span>`))); return d; };
const fig = (node, cap) => { const f = h('figure'); if (node.classList?.contains('wide')) f.classList.add('wide'); f.append(node); if (cap) f.append(h('figcaption', '', cap)); return f; };
const legend = (items) => h('div', 'legend', items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join(''));
const ent = (o) => Object.entries(o);
/** deep links to the live brain viewer / arena; ?type selects, ?drive stimulates, ?run starts */
const links = (items) => h('div', 'cardlinks', items.map(([href, label]) => `<a href="${href}">${label} →</a>`).join(''));
const viewer = (type) => `./?type=${encodeURIComponent(type)}`;
const viewerDrive = (types, hz = 80) => `./?drive=${encodeURIComponent(types.join('+'))}@${hz}&run=1`;

// ---------- cards ----------
function card(id, algo, title, desc, ...parts) {
  const s = h('section', 'card'); s.id = id;
  s.append(h('div', 'algo', algo), h('h2', '', title), h('p', '', desc)); const figs = h('div', 'figs');
  parts.forEach(p => (p instanceof HTMLElement && (p.tagName === 'DIV' && (p.className === 'stats' || p.className === 'cardlinks') || p.tagName === 'P') ? s : figs).append(p));
  s.append(figs); $('#main').append(s);
  const a = h('a', '', title.split(':')[0]); a.href = `#${id}`; $('#nav').append(a);
}

function render(R) {
  $('#status').remove();
  // 1 hierarchy
  { const f = R.flow, hops = ent(f.hops_from_sensory).filter(([k]) => +k >= 0).map(([k, v]) => ({ label: `${k} hop${k == 1 ? '' : 's'}`, value: v }));
    const depth = ent(f.median_depth_by_class).filter(([k, v]) => v > 0).concat([['descending', f.median_depth_by_superclass.descending_neuron[0]], ['VNC intrinsic', f.median_depth_by_superclass.vnc_intrinsic[0]]]).sort((a, b) => a[1] - b[1]).map(([k, v]) => ({ label: k, value: v, color: C.ok }));
    card('flow', 'feedforward hierarchy + massive lateral processing', 'Depth: three synapses from sense to muscle',
      `Breadth-first search from every sensory neuron over connections of 5 or more synapses reaches almost the whole CNS in three hops. Half the descending neurons are one hop from a sensory neuron; 465 of 708 motor neurons are one hop. A harmonic depth (sensory pinned at 0, motor at 1, every other neuron at the mean depth of its partners) orders the classes as expected for a feedforward pipeline, yet along that order only ${pct(f.forward_weight_frac)} of synaptic weight runs forward, ${pct(f.feedback_weight_frac)} backward and ${pct(f.lateral_frac)} sideways between neurons at the same depth. The algorithm is a shallow pipeline whose stages are themselves large recurrent networks.`,
      stats([[f.forward_weight_frac, 'forward weight'], [f.feedback_weight_frac, 'feedback weight'], [f.lateral_frac, 'lateral weight'], [f.dn_hops_from_sensory['1'], 'DNs one hop from sensory']]),
      fig(bars(hops, { max: 90000 }), 'neurons first reached at each hop from sensory neurons'),
      fig(bars(depth, { format: (v) => v.toFixed(2) }), 'median harmonic depth by class (0 = sensory, 1 = motor)')); }
  // 2 recurrence
  { const r = R.recurrence, cyc = r.two_cycles_by_sign;
    card('rec', 'recurrent network', 'Recurrence: one giant loop, feedback inhibition its commonest cycle',
      `${pct(r.giant_scc_frac)} of neurons (${r.giant_scc_size.toLocaleString()}) belong to a single strongly connected component: from any of them a path leads to any other and back. Only sensory terminals, motor neurons and endocrine cells sit outside. ${pct(r.reciprocal_weight_frac)} of synaptic weight is reciprocal, and among reciprocally connected pairs an excitatory neuron paired with an inhibitory one (feedback inhibition, a negative-feedback loop) outnumbers recurrent excitation two to one and mutual inhibition five to one.`,
      stats([[r.giant_scc_size, 'neurons in giant SCC'], [r.reciprocal_edge_frac, 'reciprocal connections'], [r.reciprocal_weight_frac, 'reciprocal weight']]),
      fig(bars([{ label: 'E ↔ I', value: cyc['E<->I'], color: C.mod }, { label: 'E ↔ E', value: cyc['E<->E'], color: C.exc }, { label: 'I ↔ I', value: cyc['I<->I'], color: C.inh }]), 'reciprocally connected neuron pairs by sign'),
      fig(bars(ent(r.giant_scc_frac_by_superclass).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v, color: C.ok, note: pct(v) })), { max: 1, barH: 11 }), 'fraction of each superclass inside the giant loop')); }
  // 3 sign
  { const s = R.sign, nt = ent(s.weight_by_nt).filter(([, v]) => v > 0.002).sort((a, b) => b[1] - a[1]);
    const ntc = { acetylcholine: C.exc, gaba: C.inh, glutamate: C.inh, histamine: C.inh, dopamine: C.mod, octopamine: C.mod, serotonin: C.mod, unknown: C.dim };
    card('sign', 'excitation / inhibition balance, neuromodulatory broadcast', 'Sign structure: 44% of every neuron\'s input is inhibitory',
      `Synaptic weight is ${pct(s.exc_weight_frac)} excitatory and ${pct(s.inh_weight_frac)} inhibitory. The median neuron takes ${pct(s.inh_input_frac_neuron_p10_50_90[1])} of its input from inhibitory neurons, and the spread between classes is where the algorithms differ: central-complex neurons are the most inhibited (a competitive network), Kenyon cells and MBONs the least (a sparse, mostly feedforward code). Monoamine neurons are broadcasters rather than point-to-point wires: a median octopaminergic cell contacts ${s.modulatory.octopamine.median_target_types} cell types, serotonergic ${s.modulatory.serotonin.median_target_types}.`,
      fig(bars(nt.map(([k, v]) => ({ label: k, value: v, color: ntc[k], note: pct(v) })), { max: .6 }), 'synaptic weight by presynaptic transmitter'),
      fig(bars(ent(s.inh_input_frac_by_class).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v, color: C.inh, note: pct(v) })), { max: 1, barH: 11 }), 'inhibitory fraction of input by class'),
      fig(table(['modulator', 'neurons', 'median out synapses', 'median target types', 'max target types'], ent(s.modulatory).map(([k, v]) => [k, v.n, v.median_out_synapses, v.median_target_types, v.max_target_types])), 'fan-out of neuromodulatory neurons')); }
  // 4 bilateral
  { const b = R.bilateral;
    card('bil', 'cross-hemisphere competition', 'Bilateral wiring: the two sides inhibit each other',
      `${pct(b.crossing_weight_frac)} of synaptic weight crosses the midline. Optic lobes stay ipsilateral; the VNC, descending and ascending neurons cross heavily. Crossing synapses are more often inhibitory (${pct(b.inh_frac_of_crossing)}) than ipsilateral ones (${pct(b.inh_frac_of_ipsilateral)}). The strongest reciprocal inhibition between a type and its mirror-image homologue is in the ring neurons of the central complex (ER4d, ER2, ER3, ER5) and in Delta7: the inputs to the heading circuit compete across hemispheres before they reach the attractor.`,
      fig(bars(ent(b.crossing_frac_by_superclass).sort((a, b2) => b2[1] - a[1]).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v, color: C.acc, note: pct(v) })), { max: 1, barH: 11 }), 'fraction of output weight crossing the midline, by superclass'),
      fig(table(['type', 'L → R', 'R → L', 'n L', 'n R'], b.mutual_inhibition_LR_homologues.slice(0, 12).map(p => [p.type, p.L_to_R, p.R_to_L, p.nL, p.nR])), 'strongest left ↔ right mutual inhibition between homologous inhibitory types (synapses)')); }
  // 4b dynamics footprint
  if (R.spectral) { const sp = R.spectral;
    card('spec', 'loop gain and where the computation is', 'Dynamics footprint: the signed wiring matrix',
      `Treating the wiring as a linear operator — each synapse weighted by its count and the transmitter's sign — the largest eigenvalue has magnitude ${fmt(sp.spectral_radius_power_iter)} synapses. That is the loop gain the dynamics must tame; the calibrated simulation buys stability with conductance-based inhibition and refractory periods. ${sp.n_eigs_positive_real_of40 ?? '?'} of the 40 largest eigenvalues have positive real part (net positive feedback), and the dominant eigenvector is ${sp.dominant_eigvec_participation ? `concentrated on ~${fmt(sp.dominant_eigvec_participation)} neurons` : 'localised'} — the biggest loop is a specific circuit, not a global resonance. The net-flow axis separates broadcasters (neurons whose synaptic output exceeds their input — sensors, modulators, command cells) from receivers (motor pools, output neurons).`,
      stats([[sp.spectral_radius_power_iter, 'spectral radius (synapse-weight)'], [sp.n_eigs_positive_real_of40, 'of top 40 eigs, Re(λ) > 0'], [sp.dominant_eigvec_participation, 'neurons in dominant eigenvector'],]),
      ...(sp.eig_top_magnitude ? [fig(bars(sp.eig_top_magnitude.slice(0, 12).map(([re, im, mg], i) => ({ label: `λ${i + 1} ${re >= 0 ? '+' : ''}${re}${im ? (im > 0 ? '+' : '') + im + 'i' : ''}`, value: mg, color: re > 0 ? C.exc : C.inh })), { format: (v) => fmt(v) }), 'largest eigenvalues of the signed weight matrix by magnitude (real part coloured)')] : []),
      ...(sp.dominant_eigvec_types ? [fig(table(['type', 'eigenvector share'], sp.dominant_eigvec_types.map(([t, w]) => [t, pct(w)])), 'the dominant eigenmode is carried mostly by these cell types')] : []),
      fig(bars(ent(sp.netflow_median_by_superclass).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v, color: v > 0 ? C.exc : C.inh })), { barH: 11 }), 'median net flow (output − input synapses) per neuron, by superclass'),
      fig(table(['broadcaster', 'cells in top 300'], sp.top_broadcaster_types), 'net-output champions: cells that broadcast'),
      fig(table(['receiver', 'cells in top 300'], sp.top_receiver_types), 'net-input champions: cells that integrate'));
  }
  // 5 motifs
  { const m = R.motifs, ffi = m.feedforward_inhibition, dis = m.disinhibition;
    const box = h('div', 'motifs');
    const mk = (title, g, n, small) => { const d = h('div', 'motif'); d.append(h('h3', '', title), g, h('div', 'n', n), h('small', '', small)); box.append(d); };
    mk('Feedforward inhibition', glyph([{ id: 'A', x: 25, y: 45, sign: 1 }, { id: 'I', x: 75, y: 15, sign: -1 }, { id: 'B', x: 125, y: 45, sign: 0 }], [['A', 'B', 1], ['A', 'I', 1], ['I', 'B', -1]]), `${pct(ffi.frac)} of ${ffi.E_type_edges.toLocaleString()} strong E edges`, 'A drives B and, through I, also cancels it a synapse later: a temporal derivative and a gain limiter. ' + ffi.top_central.slice(0, 3).map(t => `${t.A}→${t.I}→${t.B}`).join(', '));
    mk('Feedback inhibition', glyph([{ id: 'E', x: 40, y: 45, sign: 1 }, { id: 'I', x: 110, y: 45, sign: -1 }], [['E', 'I', 1], ['I', 'E', -1]]), `${m.reciprocal_type_pairs_by_sign['E<->I'].toLocaleString()} type pairs`, 'Negative feedback: activity level is sensed and subtracted. ' + m.feedback_inhibition_central.slice(0, 3).map(p => `${p[0]}↔${p[1]}`).join(', '));
    mk('Recurrent excitation', glyph([{ id: 'A', x: 40, y: 45, sign: 1 }, { id: 'B', x: 110, y: 45, sign: 1 }], [['A', 'B', 1], ['B', 'A', 1]]), `${m.reciprocal_type_pairs_by_sign['E<->E'].toLocaleString()} type pairs`, 'Positive feedback: amplification and persistence. ' + m.recurrent_excitation_central.slice(0, 3).map(p => `${p[0]}↔${p[1]}`).join(', '));
    mk('Mutual inhibition', glyph([{ id: 'A', x: 40, y: 45, sign: -1 }, { id: 'B', x: 110, y: 45, sign: -1 }], [['A', 'B', -1], ['B', 'A', -1]]), `${m.reciprocal_type_pairs_by_sign['I<->I'].toLocaleString()} type pairs`, 'Winner-take-all: whichever is more active silences the other. ' + m.mutual_inhibition_central.slice(0, 3).map(p => `${p[0]}↔${p[1]}`).join(', '));
    mk('Disinhibition', glyph([{ id: 'I₁', x: 25, y: 45, sign: -1 }, { id: 'I₂', x: 75, y: 45, sign: -1 }, { id: 'X', x: 125, y: 45, sign: 1 }], [['I₁', 'I₂', -1], ['I₂', 'X', -1]]), `${dis.I_to_I_type_edges.toLocaleString()} I→I type edges`, 'Inhibiting an inhibitor releases its target: a gate. ' + dis.top_central.slice(0, 3).map(t => `${t.I1}→${t.I2}→${t.target}`).join(', '));
    mk('Normalisation cell', glyph([{ id: 'P', x: 40, y: 45, sign: 1 }, { id: 'N', x: 110, y: 45, sign: -1 }], [['P', 'N', 1], ['N', 'P', -1]]), `${m.normalisation_candidates.length} candidates`, 'An inhibitory cell whose input population is also its output population: it reads the total and divides it back out. ' + m.normalisation_candidates.slice(0, 5).map(c => c.type).join(', '));
    if (m.feedforward_loops) {
      const ffl = m.feedforward_loops, bm = ffl.by_middle;
      mk('Coherent feedforward loop', glyph([{ id: 'A', x: 25, y: 45, sign: 1 }, { id: 'E', x: 75, y: 15, sign: 1 }, { id: 'C', x: 125, y: 45, sign: 0 }], [['A', 'C', 1], ['A', 'E', 1], ['E', 'C', 1]]), `${ffl.coherent_edges.toLocaleString()} direct edges in a coherent FFL`, 'Direct and indirect paths push the same way: a delay line and a coincidence detector. ' + `${bm.E_E.instances.toLocaleString()} E-middled instances.`);
      mk('Incoherent feedforward loop', glyph([{ id: 'A', x: 25, y: 45, sign: 1 }, { id: 'I', x: 75, y: 15, sign: -1 }, { id: 'C', x: 125, y: 45, sign: 0 }], [['A', 'C', 1], ['A', 'I', 1], ['I', 'C', -1]]), `${ffl.incoherent_edges.toLocaleString()} direct edges in an incoherent FFL`, 'A fires C and then withdraws it: pulse shaping and response acceleration. ' + `${bm.E_I.instances.toLocaleString()} I-middled instances.`);
    }
    const nullRow = m.null_model ? fig(table(['metric', 'observed', 'null mean ± sd', 'z'],
      [['FFI share of E edges', pct(m.null_model.ffi_frac.obs), `${pct(m.null_model.ffi_frac.null_mean)} ± ${m.null_model.ffi_frac.null_std.toFixed(3)}`, m.null_model.ffi_frac.z],
       ['reciprocal E↔E pairs', m.null_model.recip_EE.obs, `${fmt(m.null_model.recip_EE.null_mean)} ± ${m.null_model.recip_EE.null_std.toFixed(1)}`, m.null_model.recip_EE.z],
       ['reciprocal I↔I pairs', m.null_model.recip_II.obs, `${fmt(m.null_model.recip_II.null_mean)} ± ${m.null_model.recip_II.null_std.toFixed(1)}`, m.null_model.recip_II.z],
       ['reciprocal E↔I pairs', m.null_model.recip_EI.obs, `${fmt(m.null_model.recip_EI.null_mean)} ± ${m.null_model.recip_EI.null_std.toFixed(1)}`, m.null_model.recip_EI.z],
       ['edges in coherent FFL', m.null_model.ffl_coh_edges.obs, `${fmt(m.null_model.ffl_coh_edges.null_mean)} ± ${fmt(m.null_model.ffl_coh_edges.null_std)}`, m.null_model.ffl_coh_edges.z],
       ['edges in incoherent FFL', m.null_model.ffl_incoh_edges.obs, `${fmt(m.null_model.ffl_incoh_edges.null_mean)} ± ${fmt(m.null_model.ffl_incoh_edges.null_std)}`, m.null_model.ffl_incoh_edges.z],
       ['I→I edges (control)', m.null_model.dis_II_control.obs, `${fmt(m.null_model.dis_II_control.null_mean)} ± ${m.null_model.dis_II_control.null_std.toFixed(1)}`, m.null_model.dis_II_control.z]]),
      `${m.null_model.n_nulls} degree- and sign-preserving rewires of the type graph. Every measured motif is far above chance; the I→I control is exactly conserved by the null, as it should be.`) : null;
    card('motif', 'motif census over 11,752 cell types', 'Circuit motifs: the building blocks and how often each occurs',
      `Neurons were merged into cell types and type→type edges kept when they carry at least 3 synapses per target neuron and 20 in total (${m.strong_type_edges.toLocaleString()} edges). Counting the classic motifs over this graph shows which computational primitives the fly uses everywhere and which are reserved for particular circuits. Feedforward inhibition accompanies four of every five excitatory pathways${m.null_model ? ` — against a rewired null of the same degree sequence and sign structure, that is a ${Math.round(m.null_model.ffi_frac.z)}σ enrichment, and both coherent and incoherent feedforward loops are about three times as common as chance` : ''}. Winner-take-all pairs concentrate in the ring neurons and antennal-lobe local neurons. Examples are from the central brain and nerve cord; the optic lobe has larger instances of each.`,
      box,
      ...(nullRow ? [nullRow] : []),
      fig(table(['A', 'I', 'B', 'A→B', 'A→I', 'I→B'], ffi.top_central.slice(0, 10).map(t => [t.A, t.I, t.B, t.A_B, t.A_I, t.I_B])), 'strongest central feedforward-inhibition triads (synapses)'),
      fig(table(['type', 'population', 'in', 'out', 'input synapses', 'cells'], m.normalisation_candidates.slice(0, 12).map(c => [c.type, c.population.replace(/_/g, ' '), pct(c.in_frac), pct(c.out_frac), c.in_syn, c.n])), 'normalisation cells: share of input from and output to the same population')); }
  // 6 antennal lobe
  { const a = R.antennal_lobe, fl = a.synapse_flows;
    card('al', 'labelled lines + divisive normalisation', 'Antennal lobe: 50 labelled lines, one shared gain control',
      `${pct(a.orn_to_pn_same_glomerulus_frac)} of ORN→PN weight stays inside a glomerulus: each odorant-receptor class has its own output channel. About ${a.orn_per_glomerulus_median} receptor neurons converge on ${a.pn_per_glomerulus_median} projection neurons per glomerulus, averaging out receptor noise. Local neurons implement the normalisation: ORNs give more synapses to LNs than to PNs, LNs span a median ${a.ln_input_glomeruli_p10_50_90[1]} input and ${a.ln_output_glomeruli_p10_50_90[1]} output glomeruli (the top decile more than ${a.ln_input_glomeruli_p10_50_90[2]}), and they feed back onto ORN terminals with ${pct(a.ln_to_orn_over_orn_to_pn)} of the ORN→PN weight, the presynaptic gain control the simulation models as GABA_B. Total odour drive is measured and each channel divided by it.`,
      stats([[a.glomeruli, 'glomeruli'], [a.n_orn, 'ORNs'], [a.n_pn, 'uniglomerular PNs'], [a.n_ln, 'local neurons'], [a.orn_to_pn_same_glomerulus_frac, 'within-glomerulus ORN→PN'], [a.convergence_ratio_median, 'ORN : PN per glomerulus']]),
      links([[viewerDrive(['ORN_DA1'], 100), 'drive ORN_DA1 in the live brain'], [viewer('APL'), 'APL, the big normaliser']]),
      fig(fan([{ name: 'ORN', n: a.n_orn, color: C.exc }, { name: 'LN', n: a.n_ln, color: C.inh }, { name: 'PN', n: a.n_pn, color: C.exc }], [{ a: 0, b: 2, w: fl['ORN->PN'] / 6e5, label: `ORN→PN ${fmt(fl['ORN->PN'])}` }, { a: 0, b: 1, w: fl['ORN->LN'] / 6e5, label: `ORN→LN ${fmt(fl['ORN->LN'])}` }, { a: 1, b: 2, w: fl['LN->PN'] / 6e5, color: C.inh, label: `LN→PN ${fmt(fl['LN->PN'])}` }, { a: 1, b: 0, w: fl['LN->ORN (presynaptic)'] / 6e5, color: C.inh, label: `LN→ORN ${fmt(fl['LN->ORN (presynaptic)'])}` }, { a: 1, b: 1, w: fl['LN->LN'] / 6e5, color: C.inh, label: `LN→LN ${fmt(fl['LN->LN'])}` }]), 'synapse flows between the three antennal-lobe populations'),
      fig(bars(ent(a.ln_transmitters).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ label: k, value: v, color: k === 'acetylcholine' ? C.exc : k === 'unknown' ? C.dim : C.inh }))), 'local-neuron transmitters: GABA and glutamate inhibit, cholinergic LNs excite')); }
  // 6b lateral horn
  if (R.lateral_horn) { const lh = R.lateral_horn, fl = lh.synapse_flows;
    card('lh', 'innate-valence pathway, parallel to the learned one', 'Lateral horn: the hard-wired odour meanings',
      `The projection neurons split their output between two readouts: ${fmt(fl['PN->LH'])} synapses to the lateral horn against ${fmt(fl['PN->KC'])} to the mushroom body — the innate pathway is wired at the same weight as the learnable one. The lateral horn has its own local interneurons (${lh.n_local_cells} cells in ${lh.local_types.length} types that keep most of their output inside the structure, the same normalisation pattern as the antennal lobe) and ${lh.n_output_cells} output neurons in ${lh.n_output_types} types, each pooling a median ${lh.lh_pn_breadth_p50} PN types with its strongest channel carrying ${pct(lh.lh_top_pn_share_p50)} of its PN input — broader than the labelled lines of the antennal lobe, narrower than the mushroom body's random sampling. Learned and innate channels talk: MBON→LH is ${fmt(fl['MBON->LH'])} synapses, and the horn reports ${fmt(fl['LH->DN'])} synapses directly onto descending neurons.`,
      stats([[lh.n_lh, 'LH neurons'], [lh.n_lh_types, 'LH types'], [lh.pn_lh_vs_pn_kc, 'PN→LH / PN→KC weight'], [lh.lh_pn_breadth_p50, 'PN types per LH output (median)'], [lh.pn_cells_reaching_lh_frac, 'PNs that reach the LH'], [fl['LH->DN'], 'LH → DN synapses']]),
      links([[viewer('LHAD1b2'), 'a lateral-horn output cell']]),
      fig(fan([{ name: 'PN', n: R.mushroom_body ? R.mushroom_body.n_pn : 686, color: C.exc }, { name: 'LH local', n: lh.n_local_cells, color: C.inh }, { name: 'LH output', n: lh.n_output_cells, color: C.acc }, { name: 'DN', n: 1314, color: C.ok }], [{ a: 0, b: 2, w: fl['PN->LH'] / 8e5, color: C.exc, label: `PN→LH ${fmt(fl['PN->LH'])}` }, { a: 1, b: 2, w: fl['LH(local)->LH(out)'] / 8e5, color: C.inh, label: `local→out ${fmt(fl['LH(local)->LH(out)'])}` }, { a: 1, b: 1, w: fl['LH(local)->LH(local)'] / 8e5, color: C.inh, label: `local⇄ ${fmt(fl['LH(local)->LH(local)'])}` }, { a: 2, b: 3, w: fl['LH->DN'] / 8e5, color: C.ok, label: `LH→DN ${fmt(fl['LH->DN'])}` }]), 'the innate pathway: projection neurons → lateral horn → descending neurons'),
      fig(bars(fl ? ent(fl).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ label: k.replace('->', '→'), value: v, color: /local/.test(k) ? C.inh : /DN|CX/.test(k) ? C.ok : /MBON/.test(k) ? C.mod : C.exc })) : [], { barH: 11 }), 'synapse flows through the lateral horn'),
      fig(table(['LH type', 'PN synapses', 'top PN share', 'PN types ≥5%'], lh.per_type_pn.slice(0, 12).map(t => [t.type, t.pn_syn, pct(t.top_share), t.n_pn_types_ge5pct])), 'the largest lateral-horn output types by PN input'),
      fig(table(['descending neuron', 'synapses'], lh.lh_to_dn_top.map(([t, w]) => [t, w])), 'LH → descending: where innate valence reaches the motor funnel')); }
  // 7 mushroom body
  { const m = R.mushroom_body, fl = m.synapse_flows;
    card('mb', 'random expansion → sparse code → compartmental readout with three-factor plasticity', 'Mushroom body: an associative memory',
      `${m.n_pn} projection neurons fan out onto ${m.n_kc.toLocaleString()} Kenyon cells, each sampling a median ${m.claws_per_kc_p10_50_90[1]} PNs. The sampling is close to random (mean correlation between PN types over the KCs they share ${m.pn_type_pair_corr_observed}, shuffled ${m.pn_type_pair_corr_shuffled}), which is what makes the expanded code decorrelated. Two APL neurons receive from every Kenyon cell and inhibit every Kenyon cell: global feedback that keeps the code sparse. ${m.n_mbon} output neurons each read a median ${m.kc_per_mbon_median} KCs, and dopamine neurons synapse on KC axons (${fmt(fl['DAN->KC'])}) far more than on MBONs (${fmt(fl['DAN->MBON'])}), ${pct(m.dan_mbon_same_compartment_frac)} of it within a matching compartment: the third factor of a KC–MBON learning rule, delivered per compartment. MBON→DAN and MBON→MBON synapses let one compartment's verdict train another.`,
      stats([[m.expansion_ratio, 'expansion (KC per PN)'], [m.claws_per_kc_p10_50_90[1], 'PN inputs per KC (median)'], [m.apl_covers_kc_frac, 'KCs inhibited by APL'], [m.kc_per_mbon_median, 'KCs per MBON (median)'], [m.mbon_per_kc_median, 'MBONs per KC'], [m.dan_mbon_same_compartment_frac, 'DAN→MBON same compartment']]),
      links([[viewer('APL'), 'APL, the global normaliser'], [viewer('PPL101'), 'a dopaminergic input']]),
      fig(fan([{ name: 'PN', n: m.n_pn, color: C.exc }, { name: 'KC', n: m.n_kc, color: C.exc }, { name: 'MBON', n: m.n_mbon, color: C.acc }], [{ a: 0, b: 1, w: fl['PN->KC'] / 5e5, label: `PN→KC ${fmt(fl['PN->KC'])}` }, { a: 1, b: 2, w: fl['KC->MBON'] / 5e5, label: `KC→MBON ${fmt(fl['KC->MBON'])}` }, { a: 1, b: 1, w: fl['APL->KC'] / 5e5, color: C.inh, label: `KC⇄APL ${fmt(fl['KC->APL'])} / ${fmt(fl['APL->KC'])}` }, { a: 2, b: 1, w: fl['MBON->KC'] / 5e5, color: C.mod, label: `DAN→KC ${fmt(fl['DAN->KC'])}` }]), 'expansion, global feedback and readout'),
      fig(bars(ent(fl).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace('->', '→'), value: v, color: /APL->|MBON->/.test(k) ? C.inh : /DAN/.test(k) ? C.mod : C.exc })), { barH: 11 }), 'synapse flows inside the mushroom body')); }
  // 7b MBON convergence
  if (R.mbon_convergence) { const mc = R.mbon_convergence;
    card('mbc', 'compartment outputs recombine on shared targets', 'MBON convergence: where learned valences meet',
      `The ${mc.n_mbon} mushroom-body output neurons fall into ${mc.n_mbon_types} types — ${ent(mc.nt_split).map(([nt, n]) => `${n} ${nt}`).join(', ')} — each carrying a sign: dopamine-driven depression of a glutamatergic or cholinergic MBON encodes valence oppositely. Downstream, the compartmental readouts recombine: ${mc.convergent_targets.length} target types receive from two or more MBON types, and the median target-profile similarity between same-sign MBONs is ${mc.same_valence_cosine_p50 ?? '—'} versus ${mc.diff_valence_cosine_p50 ?? '—'} across signs${mc.same_valence_cosine_p50 != null && mc.diff_valence_cosine_p50 != null ? `, so valence channels keep separate target repertoires` : ''}. ${fmt(mc.mbon_to_dn_synapses)} synapses reach descending neurons directly — learned value placed on the command bottleneck.`,
      stats([[mc.n_mbon, 'MBON cells'], [mc.n_mbon_types, 'MBON types'], [mc.convergent_targets.length, 'shared downstream targets'], [mc.same_valence_cosine_p50 ?? '—', 'same-sign target cos'], [mc.diff_valence_cosine_p50 ?? '—', 'cross-sign target cos'], [mc.mbon_to_dn_synapses, 'MBON → DN synapses']]),
      fig(table(['convergent target', 'MBON types in', 'synapses'], mc.convergent_targets.slice(0, 14)), 'downstream types fed by ≥2 MBON types — where compartments recombine'),
      fig(bars(ent(mc.output_by_superclass).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v, color: k === 'descending' ? C.ok : C.acc })), { barH: 11 }), 'MBON output by target superclass'),
      fig(table(['MBON', '→ descending neuron', 'synapses'], mc.mbon_dn_top.map(([a, b, w]) => [a, b, w])), 'the strongest MBON → descending channels')); }
  // 8 central complex
  { const c = R.central_complex, d7 = Array.from({ length: 8 }, (_, k) => c.offset_profiles_mod8.EPG_to_D7_to_EPG[k]), p1 = Array.from({ length: 8 }, (_, k) => c.offset_profiles_mod8.PEN1_to_EPG[k]);
    const sp = c.side_resolved_profiles, ratio = (key, side) => { const g = sp[key]; const m = (o) => g[`${side}->${side} ${o}`] || 0; return ((m('-1') + m('+7')) / (m('+1') + m('-7'))).toFixed(2); };
    const penL = c.pen_to_epg_shift_L, penR = c.pen_to_epg_shift_R, cf = c.delta7_cosine_fit;
    card('cx', 'ring attractor with a cosine inhibition kernel, a shifter, and vector shifts', 'Central complex: the heading compass',
      `The EPG neurons carry a bump of activity round the ellipsoid body that tracks heading. The wiring holds the bump in place: EPGs in one column excite each other and their PEG partners, and two synapses away the Delta7 network inhibits every other column with a weight that grows with angular distance, minimal at the bump and maximal opposite it. The folded profile fits a − b·cos(2πk/8) with R² = ${cf ? cf.r2 : '?'} — the cosine kernel of a ring attractor, contrast ${cf ? cf.contrast : '?'}. Each Delta7 reads a median ${c.delta7_inputs_per_cell_median} EPGs and writes on ${c.delta7_epg_targets_per_cell_median}. PEN neurons move the bump: weighting each PEN's EPG targets by column gives a clean bimodal shift — left-hemisphere PENs write ${penL ? `${penL[1]} columns` : '?'} ahead, right-hemisphere PENs ${penR ? `${penR[1]} columns` : '?'} the other way (the pooled median is near zero because the two sides cancel), so a left–right imbalance in PEN drive integrates angular velocity. In the fan-shaped body, hDelta cells hand their signal to columns 4–5 away, half the array, a 180° vector shift; vDelta stay in column. The output cells PFL3 and PFL2 project to the steering descending neurons.`,
      stats([[c.n.EPG, 'EPG'], [c.n.PEN1 + c.n.PEN2, 'PEN'], [c.n.Delta7, 'Delta7'], [c.delta7_inhibition_min_over_mean, 'Delta7 weight at bump ÷ mean'], ...(penL ? [[penL[1], 'PEN_L → EPG shift (cols)'], [penR[1], 'PEN_R → EPG shift (cols)']] : []), ...(cf ? [[cf.r2, 'Delta7 kernel: cosine fit R²']] : [])]),
      links([[viewer('EPG'), 'the bump cells'], [viewerDrive(['PEN_a(PEN1)'], 60), 'drive PENs and watch the bump'], [viewer('Delta7'), 'the ring of inhibition']]),
      fig(polar(d7, { label: (k) => `${k * 45}°` }), 'EPG → Delta7 → EPG inhibition by angular offset from the bump (mean synapses)'),
      fig(bars(p1.map((v, k) => ({ label: `${k >= 4 ? k - 8 : k} col`, value: v, color: C.exc })), { labelW: 60, format: (v) => v.toFixed(1) }), 'PEN1 → EPG by column offset (the shift straddles the two bins next to 0)'),
      fig(table(['pre', 'post', 'synapses', 'peak offset', 'at peak', 'mean |offset|'], c.fb_columnar_offsets.slice(0, 12).map(o => [o.pre, o.post, o.synapses, o.peak_offset, pct(o.peak_frac), o.abs_offset_mean])), 'fan-shaped body: column offset of the strongest connections between column-tagged types'),
      fig(bars(ent(c.pfl_to_dn).map(([k, v]) => ({ label: k, value: v, color: C.ok }))), 'PFL2/PFL3 output onto descending neurons (synapses)')); }
  // 9 optic lobe
  { const o = R.optic_lobe, lam = Object.keys(o.lamina_to_medulla), med = Object.keys(o.lamina_to_medulla.L1);
    const subs = ['a', 'b', 'c', 'd'], lp = ent(o.lptc_pooling).filter(([, v]) => Object.values(v.inputs).some(x => x[0] > 2000)).slice(0, 12);
    const inTypes = [...new Set(subs.flatMap(s => Object.keys(o.t4_input_composition[s])))].slice(0, 8);
    card('ol', 'shared convolution kernels, ON/OFF channels, a direction filter bank, wide-field pooling', 'Optic lobe: a convolutional front end',
      `${o.columnar_types} cell types have one copy per column of the eye. For the strongest pairs of them every source neuron is connected, to the same number of partners, with a coefficient of variation of total weight of 0.2–0.36: the same kernel applied at every position, which is a convolution. The lamina splits the signal into ON (L1 → Mi1, Tm3) and OFF (L2 → Tm1, Tm2, Tm4) channels with no cross-talk. The four T4 subtypes have the same input composition (cosine similarity ${Math.min(...o.t4_subtype_input_cosine.flat().filter(x => x < 1)).toFixed(2)}–${Math.max(...o.t4_subtype_input_cosine.flat().filter(x => x < 1)).toFixed(2)}) and differ only in the spatial offset of those inputs: one motion-detector kernel in four orientations. The wide-field lobula-plate cells then pool a single subtype each, hundreds of local detectors into one integrator per direction.`,
      fig(heat(lam, med, lam.map(l => med.map(m => o.lamina_to_medulla[l][m]))), 'lamina → medulla synapses: block-diagonal ON (L1, L5) and OFF (L2, L4) channels'),
      fig(heat(subs.map(s => 'T4' + s), inTypes, subs.map(s => inTypes.map(t => (o.t4_input_composition[s][t] || 0) * 100)), { color: C.ok, format: (v) => v >= 3 ? `${Math.round(v)}%` : '' }), 'T4 subtypes share one input recipe (percent of input)'),
      links([[viewer('T4a'), 'one motion-detector column type']]),
      fig(heat(lp.map(([k]) => k), subs.flatMap(s => ['T4' + s, 'T5' + s]), lp.map(([, v]) => subs.flatMap(s => [v.inputs['T4' + s][0], v.inputs['T5' + s][0]])), { cell: 26, labelW: 44 }), 'lobula-plate tangential cells pool one direction each (synapses)'),
      fig(table(['pre', 'post', 'synapses', 'sources connected', 'partners per source', 'weight CV'], o.weight_sharing.slice(0, 12).map(r => [r.pre, r.post, r.synapses, pct(r.src_frac_connected), r.partners_per_src, r.weight_cv])), 'weight sharing between columnar types')); }
  // 9b optic glomeruli
  if (R.optic_glomeruli) { const g = R.optic_glomeruli;
    card('og', 'feature channels out of the optic lobe, focused then recombined', 'Optic glomeruli: the visual feature menu',
      `${g.n_vpn.toLocaleString()} visual projection neurons in ${g.n_vpn_types} types leave the optic lobe for the glomeruli of the central brain. Each channel is focused: the median type puts ${pct(g.focus_median)} of its output weight on its single favourite target class and reaches a median ${g.breadth_median} target types at ≥5% share. Channels are distinct — the median cosine similarity between strong types' target profiles is ${g.pairwise_cosine_p50} — but they recombine on shared grounds: the top convergence sites are fed by up to ${g.convergent_targets[0] ? g.convergent_targets[0][1] : '?'} different VPN types. Feature channels then fan back toward behaviour: ${fmt(g.vpn_to_dn_synapses)} synapses to descending neurons, ${fmt(g.vpn_to_er_synapses)} to compass ring neurons, ${fmt(g.vpn_to_lh_synapses)} to the lateral horn.`,
      stats([[g.n_vpn, 'VPN cells'], [g.n_vpn_types, 'VPN types'], [g.focus_median, 'top-target share (median)'], [g.pairwise_cosine_p50, 'channel cosine p50'], [g.vpn_to_dn_synapses, 'VPN → DN synapses'], [g.vpn_to_er_synapses, 'VPN → ring neurons']]),
      links([[viewer('LC10a'), 'LC10a, the biggest feature channel']]),
      fig(table(['convergent target', 'VPN types in', 'synapses'], g.convergent_targets.slice(0, 14)), 'target types reached by the most VPN types'),
      fig(table(['VPN type', 'cells', 'output syn', 'focus', 'top targets'], g.per_type.slice(0, 14).map(t => [t.type, t.n, t.out_syn, pct(t.focus), t.top_targets.slice(0, 2).map(([n]) => n).join(', ')])), 'the largest visual projection channels'),
      fig(table(['VPN', '→ DN', 'synapses'], g.vpn_dn_top.slice(0, 12).map(([a, b, w]) => [a, b, w])), 'visual features onto descending neurons')); }
  // 10 escape
  { const e = R.escape;
    card('escape', 'convergent detector → single command neuron', 'Escape: a three-synapse looming detector',
      `The giant fibre integrates ${e.gf_total_input.toLocaleString()} input synapses. ${e.n_lc4} LC4 neurons (${e.lc4_per_gf.join(' and ')} of them onto each giant fibre) and ${e.n_lplc2} LPLC2 neurons (${e.lplc2_per_gf.join(' and ')} each) contribute a third of it: two populations of small-field looming detectors summed onto one command neuron. Photoreceptor to giant fibre is ${e.photoreceptor_to_gf_hops} synapses. Its outputs go to the jump motor neuron TTMn, the flight-initiating PSI and the GFC interneurons.`,
      links([[viewer('DNp01'), 'the giant fibre itself'], ['./arena.html?env=predator', 'looming arena: trigger the escape live']]),
      fig(bars(e.gf_inputs_top.map(([t, w, f, n]) => ({ label: t, value: w, color: C.exc, note: `${w.toLocaleString()} (${n} cells)` })), { barH: 11 }), 'giant fibre inputs by presynaptic type'),
      fig(bars(e.gf_outputs_top.map(([t, w]) => ({ label: t, value: w, color: C.ok }))), 'giant fibre outputs')); }
  // 11 descending
  { const d = R.descending;
    card('dn', 'bottleneck with a return loop', 'Descending neurons: a narrow command channel wrapped in a loop',
      `${d.n_dn.toLocaleString()} descending neurons receive only ${pct(d.brain_output_to_dn_frac)} of the brain's output synapses, yet they carry every command to the body. The median DN integrates ${d.dn_in_synapses_p10_50_90[1].toLocaleString()} synapses from ${d.dn_input_types_p10_50_90[1]} cell types. DNs are cross-connected (${d.dn_dn_connections.toLocaleString()} connections, ${d.dn_dn_reciprocal_connections.toLocaleString()} reciprocal) and only ${pct(d.dn_output_to_mn_frac)} of their output reaches motor neurons directly; the rest goes to VNC interneurons. ${d.n_an.toLocaleString()} ascending neurons send ${fmt(d.an_to_dn_synapses)} synapses back onto DNs, more than the ${fmt(d.dn_to_an_synapses)} DNs send to them: the command channel is a closed loop with the nerve cord.`,
      stats([[d.n_dn, 'descending neurons'], [d.brain_output_to_dn_frac, 'share of brain output'], [d.dn_in_synapses_p10_50_90[1], 'median input synapses'], [d.dn_input_types_p10_50_90[1], 'median input types'], [d.dn_output_to_mn_frac, 'output direct to MNs'], [d.an_to_dn_synapses, 'AN → DN synapses']]),
      links([[viewer('DNa02'), 'a steering descending neuron']]),
      fig(bars(d.top_dn_by_input.map(([t, w]) => ({ label: t, value: w, color: C.ok })), { barH: 11 }), 'largest descending neurons by input synapses')); }
  // 12 vnc
  { const v = R.vnc;
    card('vnc', 'motor pools, commissural inhibition, half-centres', 'Nerve cord: motor pools and mutual inhibition',
      `Each of the ${v.n_mn} motor neurons integrates a median ${v.premotor_neurons_per_mn_p10_50_90[1]} premotor neurons, ${pct(v.mn_inhibitory_input_frac_median)} of the weight inhibitory; ${pct(v.mn_input_sources['VNC intrinsic'])} of it comes from nerve-cord interneurons and ${pct(v.mn_input_sources.DN)} straight from descending neurons. Motor neurons of the same type and side share premotor partners ${Math.round(v.pool_premotor_jaccard_median / v.random_mn_pair_jaccard_median)}× more than random pairs, the signature of motor pools driven as units. ${pct(v.vnc_crossing_weight_frac)} of nerve-cord weight crosses the midline and ${pct(v.vnc_crossing_inh_frac)} of that is inhibitory. Reciprocally inhibiting interneuron types are candidate half-centre oscillators for the stepping rhythm.`,
      stats([[v.n_mn, 'motor neurons'], [v.premotor_neurons_per_mn_p10_50_90[1], 'premotor neurons per MN'], [v.mn_inhibitory_input_frac_median, 'inhibitory input to MNs'], [v.pool_premotor_jaccard_median, 'pool premotor overlap'], [v.random_mn_pair_jaccard_median, 'random pair overlap'], [v.vnc_crossing_inh_frac, 'crossing weight inhibitory']]),
      fig(bars(ent(v.mn_input_sources).map(([k, val]) => ({ label: k, value: val, color: k === 'DN' ? C.ok : C.exc, note: pct(val) })), { max: 1 }), 'where motor-neuron input comes from'),
      fig(table(['type A', 'type B', 'A → B', 'B → A'], v.mutual_inhibition_vnc_top.slice(0, 10).map(p => [p.a, p.b, p.a_b, p.b_a])), 'reciprocally connected inhibitory interneuron types in the nerve cord (synapses)')); }
  // 12b state circuits
  if (R.state_circuits) { const st = R.state_circuits, lk = st.links;
    const nCells = ent(st.per_group).reduce((a, [, g]) => a + g.n, 0);
    card('state', 'slow broadcasters wired onto every fast circuit', 'State: clock, sleep and modulator cells',
      `${nCells} identified cells carry state: circadian clock neurons (DN1a, DN1p, s-LNv, LNd, LPN), sleep-need cells (hDeltaC, ExR1/2, ER5), octopamine and serotonin broadcasters, and peptidergic populations. They are few but their wiring is dense where it matters — ${fmt(lk['state->CX'])} synapses onto the compass and ${fmt(lk['CX->state'])} back, a closed loop between state and heading; ${fmt(lk['state->DN'])} synapses straight onto the command channel; and ${fmt(lk['state->state'])} synapses among themselves. Structure says state is not a layer on top of the network; it is woven through it.`,
      stats([[nCells, 'state cells'], [lk['state->CX'], 'state → compass synapses'], [lk['CX->state'], 'compass → state synapses'], [lk['state->DN'], 'state → DN synapses'], [lk['state->MBON'], 'state → MBON synapses'], [lk['state->state'], 'state ⇄ state synapses']]),
      links([[viewer('s-LNv'), 'the morning clock cells'], [viewer('hDeltaC'), 'the sleep-need integrator'], [viewer('DN1a'), 'clock output onto the compass']]),
      fig(bars(ent(lk).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace('->', '→'), value: v, color: /CX/.test(k) ? C.acc : /DN/.test(k) ? C.ok : /state/.test(k) ? C.mod : C.exc })), { barH: 11 }), 'wiring between the state populations and the fast circuits'),
      fig(bars(ent(st.group_flows).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => ({ label: k.replace('->', '→'), value: v, color: C.mod })), { barH: 11 }), 'synapse flows between state groups'),
      fig(table(['clock type', 'targets (≥20 syn)'], st.clock_matrix.slice(0, 14).map(([t, row]) => [t, ent(row).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, w]) => `${n} ${fmt(w)}`).join(', ')])), 'how the clock cell types wire to each other'),
      fig(table(['target type', 'synapses'], st.top_state_targets.slice(0, 14)), 'the strongest outputs of all state cells combined')); }
  // 13 hubs
  { const hb = R.hubs;
    card('hubs', 'heavy-tailed degree distribution; hubs are normalisers', 'Hubs: the most connected cells are the ones that divide',
      `Input and output synapse counts have a heavy tail (exponent about ${hb.in_degree_tail_exponent} in, ${hb.out_degree_tail_exponent} out): a median neuron has ${hb.synapses_in_p50_90_99[0]} input synapses, the top percent more than ${hb.synapses_in_p50_90_99[2].toLocaleString()}. The hubs are not command neurons but the wide-field inhibitory cells that appear in the normalisation motif: APL in the mushroom body, CT1 and the LPi, Am1 and Li cells of the optic lobe, DPM, the antennal-lobe LN il3LN6. The largest nodes of the network are its gain controls.`,
      links([[viewer('APL'), 'the biggest hub of all']]),
      fig(bars(hb.top_in.slice(0, 12).map(([t, s, w]) => ({ label: t, value: w, color: C.inh })), { barH: 11 }), 'most input synapses'),
      fig(bars(hb.top_out.slice(0, 12).map(([t, s, w]) => ({ label: t, value: w, color: C.inh })), { barH: 11 }), 'most output synapses')); }
  $('#main').append(legend([[C.exc, 'excitatory'], [C.inh, 'inhibitory'], [C.mod, 'modulatory / mixed'], [C.ok, 'descending / output'], [C.acc, 'other']]));
  // highlight nav on scroll
  const navLinks = [...$('#nav').children]; const obs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) navLinks.forEach(a => a.classList.toggle('on', a.hash === `#${e.target.id}`)); }), { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('section.card').forEach(s => obs.observe(s));
}

fetch(`${BASE}data/algo_structures.json`).then(r => r.json()).then(render).catch(e => { $('#status').textContent = `failed to load results: ${e.message}`; });
