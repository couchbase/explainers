// The 01-vbmap explainer's diagram: the bucket's vbuckets, each copy a
// rounded rect, from a grid of tiles into the nodes' bins, through
// failures and a better deal. Built once; main.js draws it partway
// between two neighboring states (states.js), which differ in one
// field. When that field touches many copies, they change one after
// another, in reading order, not all at once.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import {
  CANVAS, NODES, RACKS, NUM_VBUCKETS, CHIP, GRID, tileXY, RACK_BOX, BIN, BIN_X, binChipXY, GHOST_DY, DOC, ANCHORS,
} from './layout.js';
import { STATE, changed } from './states.js';
import { MAPS, HERO, HERO_KEY } from './story.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const COPIES = [];
for (let v = 0; v < NUM_VBUCKETS; v++) for (const k of [0, 1]) COPIES.push({ v, k, key: `${v}:${k}` });

// Each copy's place in its node's bin, in a deal: the node's actives,
// then its replicas, each by vbucket.
function binSlots(map) {
  const slots = {}, fill = Object.fromEntries(NODES.map((n) => [n, 0]));
  for (const k of [0, 1]) map.forEach((chain, v) => { const n = chain[k]; slots[`${v}:${k}`] = [n, fill[n]++]; });
  return slots;
}
const SLOTS = { naive: binSlots(MAPS.naive), vbmap: binSlots(MAPS.vbmap) };

// A copy, as drawn in a state: where, in what color, and how.
function look(s, { v, k, key }) {
  const dealt = k === 0 ? s.actives : s.replicas;
  let x, y, node = null;
  if (dealt) {
    const [n, i] = SLOTS[s.map][key];
    [x, y] = binChipXY(n, i);
    node = n;
  } else {
    const [tx, ty] = tileXY(v);
    x = s.split ? tx + (k ? 10 : -10) : tx;
    y = ty;
  }
  const chain = MAPS[s.map][v];
  const grey = node && s.grey.includes(node);
  const promoted = node && k === 1 && s.promoted && s.grey.includes(chain[0]) && !grey;
  const lost = s.lost && chain.every((n) => s.grey.includes(n));
  return {
    // (its color: its vbucket's home, the node with its active copy)
    x, y, node, home: dealt ? chain[0] : null,
    // (a replica, before the split, sits under its active, unseen)
    o: k === 1 && !s.split && !dealt ? 0 : 1,
    filled: k === 0 || promoted, grey, promoted, lost: lost && k === 0,
  };
}
const nodeColor = (n) => (n ? `var(--node-${n})` : 'var(--node-none)');

// The order copies change in: only those that change, in reading
// order where they end up (a new deal: node by node).
function orderFor(field, A, B) {
  const moving = COPIES.filter((c) => JSON.stringify(look(A, c)) !== JSON.stringify(look(B, c))).map((c) => ({ key: c.key, b: look(B, c), a: look(A, c) }));
  const at = (m) => (field === 'grey' && !B.grey.length ? m.a : m.b);
  if (field === 'map') moving.sort((p, q) => NODES.indexOf(p.b.node) - NODES.indexOf(q.b.node) || p.b.y - q.b.y || p.b.x - q.b.x);
  else moving.sort((p, q) => at(p).y - at(q).y || at(p).x - at(q).x);
  return moving.map((m) => m.key);
}

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    const g = el('g', {}, svg);
    // the copy of the naive deal, below (drawn first: the real copies sit on top)
    this.ghost = this._buildGhost(g);
    // racks and bins
    this.racks = {};
    for (const [r, [x, y, w, h]] of Object.entries(RACK_BOX)) {
      const rg = el('g', { opacity: 0 }, g);
      el('rect', { x, y, width: w, height: h, rx: 16, class: `rack rack-${r}` }, rg);
      txt(rg, x + 14, y + 22, `rack ${r}`, 'rack-label');
      this.racks[r] = rg;
    }
    this.bins = {};
    for (const n of NODES) {
      const bg = el('g', { opacity: 0 }, g);
      const box = el('rect', { x: BIN_X[n], y: BIN.y, width: BIN.w, height: BIN.h, rx: 10, class: 'bin', style: `stroke: ${nodeColor(n)}` }, bg);
      const down = el('rect', { x: BIN_X[n], y: BIN.y, width: BIN.w, height: BIN.h, rx: 10, class: 'bin-down', opacity: 0 }, bg);
      const name = txt(bg, BIN_X[n] + 4, BIN.y - 8, `node ${n}`, 'bin-label');
      name.style.fill = nodeColor(n);
      const count = txt(bg, BIN_X[n] + BIN.w / 2, BIN.y + BIN.h - 14, '', 'bin-count', 'middle');
      this.bins[n] = { g: bg, box, down, name, count };
    }
    this.dealLabel = txt(g, RACK_BOX.East[0], RACK_BOX.East[1] - 14, '', 'deal-label');
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
    // the copies
    this.chipG = el('g', {}, g);
    this.chips = {};
    for (const c of COPIES) {
      const cg = el('g', {}, this.chipG);
      const r = el('rect', { x: -CHIP.w / 2, y: -CHIP.h / 2, width: CHIP.w, height: CHIP.h, rx: CHIP.rx, class: 'copy' }, cg);
      const x = txt(cg, 0, 4.5, '×', 'lost-mark', 'middle');
      this.chips[c.key] = { g: cg, r, x };
    }
    // the story's vbucket: a ring around each of its copies
    this.heroRings = [0, 1].map((k) => el('rect', { x: -CHIP.w / 2 - 4, y: -CHIP.h / 2 - 4, width: CHIP.w + 8, height: CHIP.h + 8, rx: CHIP.rx + 3, class: `hero-ring hero-ring-${k}` }, g));
    this.heroLabel = txt(g, 0, 0, `vb${HERO}`, 'hero-label');
    this.target = el('circle', { r: 13, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this.cur = null;
    this.heroAt = [[0, 0], [0, 0]];
  }

  // A still copy of the naive deal, dealt and counted: what "a better
  // deal" is compared against.
  _buildGhost(g) {
    const G = el('g', { opacity: 0 }, g);
    for (const [r, [x, y, w, h]] of Object.entries(RACK_BOX)) el('rect', { x, y, width: w, height: h, rx: 16, class: `rack rack-${r} ghost-rack` }, G);
    for (const n of NODES) el('rect', { x: BIN_X[n], y: BIN.y, width: BIN.w, height: BIN.h, rx: 10, class: 'bin', style: `stroke: ${nodeColor(n)}` }, G);
    for (const c of COPIES) {
      const [n, i] = SLOTS.naive[c.key], [x, y] = binChipXY(n, i), home = MAPS.naive[c.v][0];
      el('rect', { x: x - CHIP.w / 2, y: y - CHIP.h / 2, width: CHIP.w, height: CHIP.h, rx: CHIP.rx, class: 'copy', style: `stroke: ${nodeColor(home)}; fill: ${c.k ? 'var(--panel)' : nodeColor(home)}` }, G);
    }
    txt(G, RACK_BOX.East[0], RACK_BOX.East[1] - 14, 'the simple deal: replicas next door', 'deal-label');
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
      const x = lerp(la.x, lb.x, u), y = lerp(la.y, lb.y, u);
      ch.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      op(ch.g, lerp(la.o, lb.o, u));
      const color = s.grey ? 'var(--down)' : nodeColor(s.home);
      ch.r.style.stroke = color;
      ch.r.style.fill = s.filled ? color : 'var(--panel)';
      ch.r.setAttribute('class', `copy${s.promoted ? ' promoted' : ''}`);
      op(ch.x, la.lost === lb.lost ? (la.lost ? 1 : 0) : lb.lost ? u : 1 - u);
      if (c.v === HERO) this.heroAt[c.k] = [x, y];
    }
    // the story's vbucket
    this.heroRings.forEach((r, k) => {
      const [x, y] = this.heroAt[k];
      r.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      op(r, k === 0 ? 1 : lerp(A.split || A.replicas ? 1 : 0, B.split || B.replicas ? 1 : 0, q));
    });
    this.heroLabel.setAttribute('x', (this.heroAt[0][0] - 12).toFixed(1));
    this.heroLabel.setAttribute('y', (this.heroAt[0][1] - 13).toFixed(1));

    // the scaffolding: one field each
    const f = (k, va, vb) => (field === k ? lerp(va, vb, easeQuad(q)) : vb);
    op(this.doc, f('doc', A.doc ? 1 : 0, B.doc ? 1 : 0));
    op(this.gridLabel, f('actives', A.actives ? 0 : 1, B.actives ? 0 : 1));
    for (const r of Object.keys(RACKS)) op(this.racks[r], f('scaffold', A.scaffold ? 1 : 0, B.scaffold ? 1 : 0));
    for (const n of NODES) {
      const bin = this.bins[n];
      op(bin.g, f('scaffold', A.scaffold ? 1 : 0, B.scaffold ? 1 : 0));
      op(bin.down, f('down', A.down.includes(n) ? 1 : 0, B.down.includes(n) ? 1 : 0));
      // "serves N": its actives, and any replicas promoted on it; or down
      const s = field === 'promoted' ? (q < 0.5 ? A : B) : B;
      const serves = MAPS[s.map].filter((chain) => !s.grey.includes(chain[0]) ? chain[0] === n : s.promoted && chain[1] === n && !s.grey.includes(n)).length;
      setText(bin.count, s.down.includes(n) ? 'down' : `serves ${serves}`);
      bin.count.setAttribute('class', `bin-count${serves > 12 ? ' over' : ''}`);
      op(bin.count, f('counts', A.counts ? 1 : 0, B.counts ? 1 : 0));
    }
    // the deal's name, once there's a better one
    setText(this.dealLabel, "vbmap's deal: every replica crosses racks");
    op(this.dealLabel, f('map', A.map === 'vbmap' ? 1 : 0, B.map === 'vbmap' ? 1 : 0));
    // the copy of the naive deal: shifted down from where it was
    const gq = field === 'ghost' ? easeQuad(q) : B.ghost ? 1 : 0;
    this.ghost.setAttribute('transform', `translate(0 ${(gq * GHOST_DY).toFixed(1)})`);
    op(this.ghost, field === 'ghost' ? 1 : B.ghost ? 1 : 0);
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
    return a ? { p: a.p, visible: true } : null;
  }
}
