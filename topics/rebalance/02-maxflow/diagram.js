// The 02-maxflow explainer's diagram: the bucket's vbuckets, each copy a
// rounded rect, from a grid of tiles into the nodes' bins, through
// failures and a better deal. Built once; main.js draws it partway
// between two neighboring states (states.js), which differ in one
// field. When that field touches many copies, they change one after
// another, in reading order, not all at once. A node that's down gets
// a grey curtain dropped over it (its whole rack, if the rack's down),
// under the copies, which keep their colors.
//
// A copy: an active is filled, with a small A; a replica is outlined,
// filled but for a small bottom-right corner in a light tint of its
// color, with a small R. Both in the color of their vbucket's home
// node, with the same light letter.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import {
  CANVAS, NODES, ALL_NODES, LAYOUT, firstLayout, TRIES, NUM_VBUCKETS, CHIP, GRID, tileXY, RACK_BOX, BIN, BIN_X, binChipXY, GHOST_DY, LOW_DY, DOC, ANCHORS,
} from './layout.js';
import { STATE, changed } from './states.js';
import { MAPS, SIX, HERO, HERO_KEY } from './deals.js';
import { buildPlumbing, drawPlumbing, pairXY } from './diagram-plumbing.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const COPIES = [];
for (let v = 0; v < NUM_VBUCKETS; v++) for (const k of [0, 1]) COPIES.push({ v, k, key: `${v}:${k}` });

// Each copy's place in its node's bin, in a deal: its row (actives,
// replicas) and its place in the row, by vbucket.
function binSlots(map) {
  const slots = {};
  for (const k of [0, 1]) {
    const fill = Object.fromEntries(ALL_NODES.map((n) => [n, 0]));
    map.forEach((chain, v) => { const n = chain[k]; slots[`${v}:${k}`] = [n, k, fill[n]++]; });
  }
  return slots;
}
const SLOTS = Object.fromEntries(Object.entries(MAPS).map(([k, m]) => [k, binSlots(m)]));

// The redeal (naive to vbmap): each replica that moves travels on a
// U-shaped arc, down under the bins and up into its new place (deeper
// the farther it goes). An arc: a cubic Bézier's four points.
const REDEAL = {};
const bezier = (P, u) => {
  const w = [(1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u * u, u ** 3];
  return [0, 1].map((i) => P.reduce((s, p, j) => s + w[j] * p[i], 0));
};
const isRedeal = (field, A, B) => field === 'map' && A.map === 'naive' && B.map === 'vbmap';
// (a deal's trails: shown once the redeal has dealt them, till they fade)
const trailsOn = (s) => (s.map === 'vbmap' && s.trails ? 1 : 0);

// A copy, as drawn in a state: where, in what color, and how.
function look(s, { v, k, key }) {
  const dealt = k === 0 ? s.actives : s.replicas;
  let x, y, node = null;
  if (dealt && s.view !== 'bins') {
    // (in its seat, or a bead on its thread: its active left, its replica right)
    [x, y] = pairXY(v, s.view, s.chartUp);
    x += k ? 8 : -8;
  } else if (dealt) {
    const [n, row, i] = SLOTS[s.map][key];
    [x, y] = binChipXY(s.cluster, n, row, i);
    y += s.lifted ? 0 : LOW_DY;
    node = n;
  } else {
    const [tx, ty] = tileXY(v);
    // (an active stays put; its replica slides out to its right)
    x = s.split && k ? tx + 22 : tx;
    y = ty;
  }
  const chain = MAPS[s.map][v];
  // (its color's map: the uneven deal's copies keep their old colors
  // till they're recolored, and through the rebalance, the colors of
  // where they were before it)
  const colors = MAPS[s.map === 'uneven' ? (s.recolor ? 'uneven' : 'vbmap') : SIX_MAPS.includes(s.map) ? 'uneven' : s.map];
  const down = node && s.down.includes(node);
  const promoted = node && k === 1 && s.promoted && s.down.includes(chain[0]) && !down;
  const lost = s.lost && chain.every((n) => s.down.includes(n));
  return {
    // (its color: its vbucket's home, the node with its active copy)
    x, y, node, home: colors[v][0],
    // (a replica, before the split, sits under its active, unseen)
    // (and, bundled into a pipe, it's part of the pipe's flow)
    o: (k === 1 && !s.split && !dealt) || s.pipes ? 0 : 1,
    filled: k === 0 || promoted, promoted, lost: lost && k === 0,
    // (a six-node map's copy on a node that didn't hold its vbucket:
    // built from scratch)
    fresh: !!node && SIX_MAPS.includes(s.map) && !MAPS.uneven[v].includes(node),
  };
}
const SIX_MAPS = ['dealt6', 'six'];
const nodeColor = (n) => (n ? `var(--node-${n})` : 'var(--node-none)');

function buildRedeal() {
  for (const c of COPIES) {
    const a = look(STATE.ghost, c), b = look(STATE.vbmap, c);
    if (c.k !== 1 || (a.x === b.x && a.y === b.y)) continue;
    const d = 70 + 0.18 * Math.abs(b.x - a.x);
    REDEAL[c.key] = [[a.x, a.y], [a.x, a.y + d], [b.x, b.y + d], [b.x, b.y]];
  }
}

// A copy's marks: its frame, a replica's half, its letter, a lost ×,
// and its vbucket's number (shown in place of its letter on hover).
function makeChip(parent, { v, k }) {
  const g = el('g', { class: 'chip' }, parent), w = CHIP.w / 2, h = CHIP.h / 2, i = 1.6;
  el('title', {}, g).textContent = `vbucket ${v}, ${k ? 'replica' : 'active'}`;
  const chip = {
    g,
    frame: el('rect', { x: -w, y: -h, width: CHIP.w, height: CHIP.h, rx: CHIP.rx, class: 'copy' }, g),
    // (all but a light corner, its legs this much of the card's sides)
    half: el('path', { d: `M${-w + i},${-h + i} L${w - i},${-h + i} L${w - i},${h - 0.5 * CHIP.h} L${w - 0.6 * CHIP.w},${h - i} L${-w + i},${h - i} Z`, class: 'copy-half' }, g),
    letter: txt(g, 0, 0, '', 'copy-letter', 'middle'),
    x: txt(g, 0, 5.5, '×', 'lost-mark', 'middle'),
  };
  txt(g, 0, 3, String(v), 'copy-num', 'middle');
  return chip;
}
// Paints a copy: in its home's color, as an active (or a replica
// promoted to one) or a replica; edged in red if it's to be built from
// scratch.
function paintChip(c, { color, active, promoted = false, fresh = false }) {
  c.frame.style.stroke = fresh ? 'var(--danger)' : promoted ? 'var(--ink)' : color;
  c.frame.style.fill = active ? color : `color-mix(in srgb, ${color} 32%, white)`;
  c.frame.setAttribute('class', `copy${active ? '' : ' replica'}${promoted ? ' promoted' : ''}${fresh ? ' fresh' : ''}`);
  c.half.style.fill = color;
  op(c.half, active ? 0 : 1);
  setText(c.letter, active ? 'A' : 'R');
  c.letter.setAttribute('x', -2.2);
  c.letter.setAttribute('y', -2.6);
  c.letter.style.fill = 'var(--panel)';
}

// The order copies change in: only those that change, in reading
// order where they end up (a new deal: node by node).
function orderFor(field, A, B) {
  // (the cluster lifts as one, the chart rises as one, and the bins
  // make room for a new node as one: the copies ride along, together)
  if (field === 'lifted' || field === 'chartUp' || field === 'cluster') return [];
  const moving = COPIES.filter((c) => JSON.stringify(look(A, c)) !== JSON.stringify(look(B, c))).map((c) => ({ key: c.key, b: look(B, c), a: look(A, c) }));
  const at = (m) => m.b;
  // (the redeal's replicas set off left to right, from where they were)
  if (isRedeal(field, A, B)) moving.sort((p, q) => p.a.x - q.a.x || p.a.y - q.a.y);
  else if (field === 'map') moving.sort((p, q) => ALL_NODES.indexOf(p.b.node) - ALL_NODES.indexOf(q.b.node) || p.b.y - q.b.y || p.b.x - q.b.x);
  else moving.sort((p, q) => at(p).y - at(q).y || at(p).x - at(q).x);
  return moving.map((m) => m.key);
}

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    let g = el('g', {}, svg);
    // the copy of the naive deal, below (drawn first: the real copies sit on top)
    this.ghost = this._buildGhost(g);
    // the cluster: racks, bins, curtains, counts, moved as one
    const outer = g;
    g = this.cluster = el('g', {}, outer);
    // (their places come from the state's cluster, each frame: see _place)
    this.racks = {};
    for (const r of Object.keys(RACK_BOX)) {
      const rg = el('g', { opacity: 0 }, g);
      this.racks[r] = { g: rg, box: el('rect', { y: 120, height: 230, rx: 16, class: `rack rack-${r}` }, rg), label: txt(rg, 0, 142, `rack ${r}`, 'rack-label') };
    }
    this.bins = {};
    for (const n of ALL_NODES) {
      const bg = el('g', { opacity: 0 }, g);
      const box = el('rect', { y: BIN.y, height: BIN.h, rx: 10, class: 'bin', style: `stroke: ${nodeColor(n)}` }, bg);
      const name = txt(bg, 0, BIN.y - 8, `node ${n}`, 'bin-label');
      name.style.fill = nodeColor(n);
      this.bins[n] = { g: bg, box, name };
    }
    // the curtains, over the bins and under the copies: a node's, or
    // its whole rack's
    const cg = el('g', {}, g);
    this.curtains = {};
    for (const n of ALL_NODES) this.curtains[n] = { rect: el('rect', { y: BIN.y - 4, height: 0, rx: 10, class: 'curtain' }, cg), h: BIN.h + 8 };
    for (const r of Object.keys(RACK_BOX)) this.curtains[r] = { rect: el('rect', { y: 120, height: 0, rx: 16, class: 'curtain' }, cg), h: 230 };
    // each node's count, over the curtains: "serves N", or "down"
    for (const n of ALL_NODES) this.bins[n].count = txt(g, 0, BIN.y + BIN.h - 14, '', 'bin-count', 'middle');
    g = outer;
    this.dealLabel = txt(g, RACK_BOX.West[0], RACK_BOX.West[1] - 14, '', 'deal-label');
    // the bucket's grid label
    this.gridLabel = txt(g, GRID.x0 - GRID.tileW / 2, GRID.y0 - 28, `the bucket: ${NUM_VBUCKETS} vbuckets`, 'grid-label');
    // the document card, and its line to its vbucket
    this.doc = el('g', {}, g);
    el('rect', { x: DOC.x, y: DOC.y, width: DOC.w, height: DOC.h, rx: 8, class: 'doc' }, this.doc);
    txt(this.doc, DOC.x + 12, DOC.y + 24, `{ "id": "${HERO_KEY}",`, 'doc-text');
    txt(this.doc, DOC.x + 12, DOC.y + 44, '  "name": "40-Mile Air" }', 'doc-text');
    const [hx, hy] = tileXY(HERO);
    el('path', { d: `M${DOC.x + DOC.w},${DOC.y + DOC.h / 2} C${hx - 40},${DOC.y + DOC.h / 2} ${hx},${hy - 60} ${hx},${hy - 14}`, class: 'doc-line' }, this.doc);
    txt(this.doc, DOC.x + DOC.w + 20, DOC.y + 16, `crc32("${HERO_KEY}") → vbucket ${HERO}`, 'doc-hash');
    // act 3's chart, threads, pipes (under the copies)
    buildPlumbing(this, g);
    // the redeal's trails (under the copies)
    buildRedeal();
    this.trails = Object.entries(REDEAL).map(([key, P]) => ({
      key,
      path: el('path', { d: `M${P[0]} C${P[1]} ${P[2]} ${P[3]}`, pathLength: 1, class: 'trail', style: `stroke: ${nodeColor(MAPS.vbmap[+key.split(':')[0]][0])}` }, g),
    }));
    // act 5: the table of ns_server's tries
    this.triesG = this._buildTries(g);
    // the copies
    this.chipG = el('g', {}, g);
    this.chips = {};
    for (const c of COPIES) {
      this.chips[c.key] = makeChip(this.chipG, c);
    }
    // the story's vbucket: a ring around each of its copies
    this.heroRings = [0, 1].map((k) => el('rect', { x: -CHIP.w / 2 - 4, y: -CHIP.h / 2 - 4, width: CHIP.w + 8, height: CHIP.h + 8, rx: CHIP.rx + 3, class: `hero-ring hero-ring-${k}` }, g));
    this.heroLabel = txt(g, 0, 0, `vb${HERO}`, 'hero-label');
    // (and, on a node, its replica's name under it)
    // (in two lines, its "vb9" right under the card)
    this.heroRepLabel = el('g', {}, g);
    txt(this.heroRepLabel, 0, CHIP.h / 2 + 16, `vb${HERO}`, 'hero-label hero-rep-label', 'middle');
    txt(this.heroRepLabel, 0, CHIP.h / 2 + 28, 'replica', 'hero-label hero-rep-label', 'middle');
    this.target = el('circle', { r: 13, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this.cur = null;
    this.heroAt = [[0, 0], [0, 0]];
  }

  // A still copy of the naive deal, dealt and counted: what "a better
  // deal" is compared against.
  _buildGhost(g) {
    const G = el('g', { opacity: 0 }, g);
    for (const [r, [x, y, w, h]] of Object.entries(RACK_BOX)) el('rect', { x, y, width: w, height: h, rx: 16, class: `rack rack-${r} ghost-rack` }, G);
    for (const n of NODES) el('rect', { x: BIN_X[n], y: BIN.y, width: LAYOUT.four.binW, height: BIN.h, rx: 10, class: 'bin', style: `stroke: ${nodeColor(n)}` }, G);
    for (const c of COPIES) {
      const [n, row, i] = SLOTS.naive[c.key], [x, y] = binChipXY('four', n, row, i), chip = makeChip(G, c);
      chip.g.setAttribute('transform', `translate(${x} ${y})`);
      paintChip(chip, { color: nodeColor(MAPS.naive[c.v][0]), active: c.k === 0 });
      op(chip.x, 0);
    }
    txt(G, RACK_BOX.West[0], RACK_BOX.West[1] - 14, 'the simple deal: replicas next door', 'deal-label');
    return G;
  }

  // ns_server's nine tries at the six-node map: each node order and
  // run, what vbmap's map would cost as dealt and once seated; the
  // cheapest is kept.
  _buildTries(g) {
    const G = el('g', { opacity: 0 }, g), { x0, y0, dy } = TRIES;
    const cols = [x0, x0 + 112, x0 + 160, x0 + 380];
    const cost = ([copies, takeovers]) => `${copies} copies, ${takeovers} takeovers`;
    txt(G, x0, y0 - 30, "ns_server's nine tries: vbmap's map, as dealt and as seated", 'tries-title');
    ['node order', 'run', 'as vbmap dealt it', 'seated by ns_server'].forEach((h, i) => txt(G, cols[i], y0, h, 'tries-head'));
    SIX.tried.forEach((t, r) => {
      const y = y0 + (r + 1) * dy, best = t === SIX.best;
      const row = el('g', { class: `tries-row${best ? ' tries-best' : ''}` }, G);
      [t.order.split('').join(' '), String(t.seed), cost(t.asDealt), cost(t.score)].forEach((v, i) => txt(row, cols[i], y, v, 'tries-cell'));
      if (best) txt(row, cols[3] + 196, y, '← kept', 'tries-cell');
    });
    return G;
  }

  // From state a to its neighbor b, partway (q, 0..1).
  draw(a, b, q) {
    const A = STATE[a], B = STATE[b] || A;
    this.cur = { key: q < 0.5 ? a : b, state: q < 0.5 ? A : B };
    const field = a === b ? null : changed(A, B)[0];
    // each copy's own progress: in turn, when its field changes
    const order = field ? orderFor(field, A, B) : [];
    const rank = Object.fromEntries(order.map((key, i) => [key, i]));
    const SPREAD = 0.6;
    const own = (key) => (key in rank ? clamp01((q - (rank[key] / Math.max(1, order.length)) * SPREAD) / (1 - SPREAD)) : q);

    for (const c of COPIES) {
      const la = look(A, c), lb = look(B, c), u = easeQuad(own(c.key)), s = u < 0.5 ? la : lb;
      const ch = this.chips[c.key];
      const arc = isRedeal(field, A, B) && REDEAL[c.key];
      const [x, y] = arc ? bezier(arc, u) : [lerp(la.x, lb.x, u), lerp(la.y, lb.y, u)];
      ch.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      const o = lerp(la.o, lb.o, u);
      op(ch.g, o);
      // (an unseen copy doesn't take the hover from the one over it)
      ch.g.style.pointerEvents = o < 0.5 ? 'none' : '';
      // (a copy changing color blends from the old to the new)
      const color = la.home === lb.home ? nodeColor(lb.home) : `color-mix(in srgb, ${nodeColor(la.home)} ${((1 - u) * 100).toFixed(1)}%, ${nodeColor(lb.home)})`;
      paintChip(ch, { color, active: s.filled, promoted: s.promoted, fresh: s.fresh });
      const xo = la.lost === lb.lost ? (la.lost ? 1 : 0) : lb.lost ? u : 1 - u;
      op(ch.x, xo);
      op(ch.letter, 1 - xo);
      if (c.v === HERO) this.heroAt[c.k] = [x, y];
    }
    // the story's vbucket
    this.heroRings.forEach((r, k) => {
      const [x, y] = this.heroAt[k];
      r.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      const shown = k === 0 ? 1 : lerp(A.split || A.replicas ? 1 : 0, B.split || B.replicas ? 1 : 0, q);
      op(r, shown * +this.chips[`${HERO}:${k}`].g.getAttribute('opacity'));
    });
    op(this.heroLabel, +this.chips[`${HERO}:0`].g.getAttribute('opacity'));
    this.heroLabel.setAttribute('x', (this.heroAt[0][0] - 11).toFixed(1));
    this.heroLabel.setAttribute('y', (this.heroAt[0][1] - CHIP.h / 2 - 8).toFixed(1));
    const onNode = (s) => (s.replicas && s.view === 'bins' && s.scaffold ? 1 : 0);
    op(this.heroRepLabel, lerp(onNode(A), onNode(B), q) * +this.chips[`${HERO}:1`].g.getAttribute('opacity'));
    this.heroRepLabel.setAttribute('transform', `translate(${this.heroAt[1][0].toFixed(1)} ${this.heroAt[1][1].toFixed(1)})`);

    // the scaffolding: one field each
    const f = (k, va, vb) => (field === k ? lerp(va, vb, easeQuad(q)) : vb);
    op(this.doc, f('doc', A.doc ? 1 : 0, B.doc ? 1 : 0));
    op(this.gridLabel, f('actives', A.actives ? 0 : 1, B.actives ? 0 : 1));
    this._place(A, B, field === 'cluster' ? easeQuad(q) : 1);
    for (const r of Object.keys(RACK_BOX)) op(this.racks[r].g, f('scaffold', A.scaffold ? 1 : 0, B.scaffold ? 1 : 0));
    for (const n of ALL_NODES) {
      const bin = this.bins[n];
      const inA = LAYOUT[A.cluster].nodes.includes(n) ? 1 : 0, inB = LAYOUT[B.cluster].nodes.includes(n) ? 1 : 0;
      op(bin.g, f('scaffold', A.scaffold ? 1 : 0, B.scaffold ? 1 : 0) * f('cluster', inA, inB));
      // "serves N": its actives, and any replicas promoted on it; or
      // "down", once the curtain's down
      const s = field === 'promoted' || field === 'down' ? (q < 0.5 ? A : B) : B;
      const serves = MAPS[s.map].filter((chain) => !s.down.includes(chain[0]) ? chain[0] === n : s.promoted && chain[1] === n && !s.down.includes(n)).length;
      // (and, once asked, how many replicas it holds)
      const sh = field === 'holds' ? (q < 0.5 ? A : B) : B;
      const holds = MAPS[s.map].filter((chain) => chain[1] === n).length;
      setText(bin.count, s.down.includes(n) ? 'down' : sh.holds ? `serves ${serves} · holds ${holds}` : `serves ${serves}`);
      bin.count.setAttribute('class', `bin-count${serves > 12 || (sh.holds && holds > 8) ? ' over' : ''}${B.cluster === 'six' ? ' tight' : ''}`);
      // (a joining node's count waits till its bin's nearly grown)
      op(bin.count, f('counts', A.counts ? 1 : 0, B.counts ? 1 : 0) * f('cluster', inA, inB) ** 4);
    }
    // the cluster: below the grid, till it's lifted into place
    this.dy = f('lifted', A.lifted ? 0 : LOW_DY, B.lifted ? 0 : LOW_DY);
    this.cluster.setAttribute('transform', `translate(0 ${this.dy.toFixed(1)})`);
    // the curtains: dropping, or rising, over what's down
    const covered = (s) => {
      const out = new Set();
        const racks = LAYOUT[s.cluster].racks;
      for (const [r, ns] of Object.entries(racks)) if (ns.every((n) => s.down.includes(n))) out.add(r);
      for (const n of s.down) if (!out.has(Object.keys(racks).find((r) => racks[r].includes(n)))) out.add(n);
      return out;
    };
    const ca = covered(A), cb = covered(B);
    for (const [k, c] of Object.entries(this.curtains)) {
      const v = f('down', ca.has(k) ? 1 : 0, cb.has(k) ? 1 : 0);
      c.rect.setAttribute('height', (c.h * v).toFixed(1));
    }
    // the deal's name, once there's a better one (and while there's a cluster)
    setText(this.dealLabel, "vbmap's deal: every replica crosses racks");
    const named = (s) => (s.map === 'vbmap' && s.scaffold ? 1 : 0);
    op(this.dealLabel, f(field === 'scaffold' ? 'scaffold' : 'map', named(A), named(B)));
    op(this.cluster, f('scaffold', A.scaffold ? 1 : 0, B.scaffold ? 1 : 0));
    // act 3
    drawPlumbing(this, A, B, q, field);
    // the redeal's trails: each drawn behind its copy as it goes, then
    // shown till they fade
    for (const t of this.trails) {
      const redeal = isRedeal(field, A, B), u = redeal ? easeQuad(own(t.key)) : 1;
      t.path.style.strokeDashoffset = (1 - u).toFixed(3);
      op(t.path, redeal ? (u > 0 ? 1 : 0) : lerp(trailsOn(A), trailsOn(B), q));
    }
    // the copy of the naive deal: shifted down from where it was
    // (it slides down out of the cluster; once done with, it fades where
    // it is)
    const fading = field === 'ghost' && A.ghost;
    const gq = fading ? 1 : field === 'ghost' ? easeQuad(q) : B.ghost ? 1 : 0;
    this.ghost.setAttribute('transform', `translate(0 ${(gq * GHOST_DY).toFixed(1)})`);
    const go = fading ? 1 - q : field === 'ghost' ? 1 : B.ghost ? 1 : 0;
    op(this.ghost, go);
    this.ghost.style.pointerEvents = go ? '' : 'none';
    // act 5's table
    op(this.triesG, f('tries', A.tries ? 1 : 0, B.tries ? 1 : 0));
  }

  // The racks', bins', curtains' and counts' places: cluster A's, cluster
  // B's, or partway between (u). A node not in a cluster is a sliver at
  // the end of its rack, unseen: joining, it grows out of there.
  _place(A, B, u) {
    const La = LAYOUT[A.cluster], Lb = LAYOUT[B.cluster];
    const at = (L, n) => {
      if (n in L.binX) return [L.binX[n], L.binW];
      const F = firstLayout(n), r = Object.keys(F.racks).find((k) => F.racks[k].includes(n));
      const last = L.racks[r].at(-1);
      return [L.binX[last] + L.binW + (L.binGap ?? 20), 0];
    };
    for (const n of ALL_NODES) {
      const [xa, wa] = at(La, n), [xb, wb] = at(Lb, n);
      const x = lerp(xa, xb, u), w = lerp(wa, wb, u), b = this.bins[n];
      b.box.setAttribute('x', x.toFixed(1)); b.box.setAttribute('width', w.toFixed(1));
      b.name.setAttribute('x', (x + 4).toFixed(1));
      b.count.setAttribute('x', (x + w / 2).toFixed(1));
      this.curtains[n].rect.setAttribute('x', (x - 4).toFixed(1));
      this.curtains[n].rect.setAttribute('width', (w + 8).toFixed(1));
      this.binAt = this.binAt || {};
      this.binAt[n] = [x, w];
    }
    for (const r of Object.keys(RACK_BOX)) {
      const [xa, , wa] = La.rack[r], [xb, , wb] = Lb.rack[r], x = lerp(xa, xb, u), w = lerp(wa, wb, u);
      this.racks[r].box.setAttribute('x', x.toFixed(1)); this.racks[r].box.setAttribute('width', w.toFixed(1));
      this.racks[r].label.setAttribute('x', (x + 14).toFixed(1));
      this.curtains[r].rect.setAttribute('x', x.toFixed(1)); this.curtains[r].rect.setAttribute('width', w.toFixed(1));
      this.rackAt = this.rackAt || {};
      this.rackAt[r] = x;
    }
  }

  setTarget(p) {
    if (!p) { this.target.setAttribute('cx', -9999); return; }
    this.target.setAttribute('cx', p[0]);
    this.target.setAttribute('cy', p[1]);
  }

  anchor(id) {
    if (id === 'hero') return { p: [this.heroAt[0][0] - CHIP.w / 2 - 4, this.heroAt[0][1]], visible: true };
    if (id === 'hero.replica') return { p: [this.heroAt[1][0] - CHIP.w / 2 - 4, this.heroAt[1][1]], visible: !!(this.cur && (this.cur.state.split || this.cur.state.replicas)) };
    const a = ANCHORS[id];
    if (!a) return null;
    // (the cluster's parts: where the cluster, and the node, are now)
    const [kind, name] = id.split('.');
    if (this.binAt && (kind === 'node' || kind === 'count') && this.binAt[name]) {
      const [x, w] = this.binAt[name];
      return { p: [kind === 'node' ? x + 6 : x + w / 2 - 40, a.p[1] + (this.dy || 0)], visible: true };
    }
    if (this.rackAt && kind === 'rack') return { p: [this.rackAt[name] + 10, a.p[1] + (this.dy || 0)], visible: true };
    return { p: a.p, visible: true };
  }
}
