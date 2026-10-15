// The 01-planning explainer's diagram: the partition map as a board
// (a row per partition, a column per node, a chip per primary and
// replica), each node's tallies, and under them one area that shows,
// as the story needs: the scores for the decision at hand (each node's,
// under its own column), the moves a plan takes (on the board, the
// copies built and deleted; below, each node's counts), the server
// groups' rule. Built once; main.js draws it partway between two frames,
// as the scroll says.
//
// This file has the constructor, the focus box and what main.js calls.
// The rest is in parts, each a class whose methods Diagram takes:
// diagram-board.js, diagram-strip.js, diagram-moves.js and
// diagram-arrows.js; and diagram-shared.js has their helpers.

import { svgEl as el } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { NODES, PARTITIONS, tally } from './scenarios.js';
import { CANVAS, BOARD, STRIP, ANCHORS, colX, colX0, setSlots, setRows, rowY, chipX, HEAD_Y, TALLY_Y } from './layout.js';
import { op, pickOf, boardW, slotsOf } from './diagram-shared.js';
import { BoardPart } from './diagram-board.js';
import { StripPart } from './diagram-strip.js';
import { MovesPart } from './diagram-moves.js';
import { ArrowsPart } from './diagram-arrows.js';
import { SortPart } from './diagram-sort.js';
export { FLY, flight, grown, through } from './diagram-shared.js';

// A frame's rows: each partition's place, from the top.
const rowsOf = (f) => Object.fromEntries((f.order || PARTITIONS).map((p, i) => [p, i]));

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    const defs = el('defs', {}, svg);
    const pat = el('pattern', { id: 'bspread', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 6, height: 6, class: 'bspread-bg' }, pat);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'bspread-line' }, pat);
    const g = el('g', {}, svg);
    this._board(g);
    this.movesOnBoard = el('g', {}, g);
    this.moveMarks = new Map(); // chip key -> {ghost, ring}
    // (a column greyed out, chips and all: a replica's primary's node,
    // which can't take the replica; under the strip, whose label for it
    // stays readable)
    this.greyed = Object.fromEntries(NODES.map((n) => [n, el('rect', { rx: 10, class: 'bgreyed', opacity: 0 }, g)]));
    this.strip = this._buildStrip(g);
    this.movesArea = this._buildMoves(g);
    this.treeArea = this._buildTree(g);
    this.focusBox = el('rect', { rx: 14, class: 'sfocus', opacity: 0 }, g);
    this.traceG = el('g', {}, g);
    this.traces = new Map();
    this.arcG = el('g', {}, g);
    this.arcs = new Map(); // key -> {path, head, len}
    // (a pass's sort: its rules, over everything under the board, and
    // on top of everything)
    this.sortPanel = this._buildSort(g);
    this.target = el('circle', { r: 13, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this.cur = null;
  }

  // ---- the attention box ----

  // A focus region's box: [x, y, w, h].
  regionBox(name) {
    const bw = this.boardW || BOARD.x1 - BOARD.x0 + 10;
    const top = HEAD_Y - 28;
    if (name === 'board') return [BOARD.x0 - 8, top, bw + 16, BOARD.y1 - top + 8];
    if (name === 'tallies') return [BOARD.col0 - 6, TALLY_Y - 22, BOARD.x0 + bw - BOARD.col0 + 12, 62];
    if (name === 'strip') return [BOARD.x0 - 8, STRIP.titleY - 30, bw + 16, STRIP.labelY + 56 - (STRIP.titleY - 30)];
    const n = name.slice(4);
    return [colX(n) - BOARD.colW / 2 + 3, top, BOARD.colW - 6, STRIP.labelY + 28 - top];
  }

  // From step A's focus to step B's, partway (q): the box glides from
  // one region to the other, or fades in or out.
  setFocus(fa, fb, q) {
    const b = this.focusBox;
    if (!fa && !fb) { op(b, 0); return; }
    const ra = fa && this.regionBox(fa), rb = fb && this.regionBox(fb);
    const r = ra && rb ? ra.map((v, k) => lerp(v, rb[k], q)) : ra || rb;
    ['x', 'y', 'width', 'height'].forEach((k, i) => b.setAttribute(k, r[i].toFixed(1)));
    op(b, ra && rb ? 1 : ra ? 1 - q : q);
  }

  // ---- what main.js calls ----

  // Frames FA to FB (scenarios.js), partway (q); panels kindA to kindB,
  // partway (pq).
  draw(FA, FB, q, kindA, kindB, pq, PA = FA, PB = FB) {
    // the columns' slots, partway, and each column's parts moved to its
    // (when columns close up, the node leaving fades first, then the
    // others slide over: this.closing, for _drawBoard's fade)
    const sa = slotsOf(FA), sb = slotsOf(FB);
    this.closing = NODES.some((n) => sa[n] !== sb[n]);
    const qs = this.closing ? easeQuad(clamp01(q * 2 - 1)) : q;
    setSlots(Object.fromEntries(NODES.map((n) => [n, lerp(sa[n], sb[n], qs)])));
    for (const n of NODES) {
      const t = `translate(${(colX(n) - colX0(n)).toFixed(1)} 0)`;
      for (const e of [this.cols[n].g, ...Object.values(this.cols[n].tags), this.strip.cols[n].g, this.movesArea.cols[n].g]) e.setAttribute('transform', t);
    }
    // the rows' places, partway (a pass's sort moves them; so does the
    // plan's end, back to name order)
    const ra = rowsOf(FA), rb = rowsOf(FB);
    setRows(Object.fromEntries(PARTITIONS.map((p) => [p, lerp(ra[p], rb[p], easeQuad(q))])));
    const sameD = FA.decision && FA.decision === FB.decision;
    const stageOf = (f) => f.stage ?? (f.decision ? pickOf(f.decision) : 0);
    this._drawBoard(FA, FB, q, sameD ? lerp(stageOf(FA), stageOf(FB), q) : null);
    this._drawLeft(FA, FB, q);
    this._drawVerdict(FA, FB, q, sameD ? lerp(stageOf(FA), stageOf(FB), q) : null);
    // what the area under the board shows: one fades out as the next fades in
    const w = (k) => clamp01(kindA === k ? (kindB === k ? 1 : 1 - pq * 2) : kindB === k ? pq * 2 - 1 : 0);
    this._drawMoves(pq < 0.5 ? PA : PB, w('moves'));
    op(this.treeArea.g, w('tree'));
    const so = w('score');
    // (the decision's marks on the board, the outlined row and its label,
    // the chosen chip's ring and the verdict, go with the scores: not
    // when the area under the board is about the moves, say)
    for (const e of [this.band, this.bandLabel, this.chosenRing, this.verdict.g]) {
      op(e, +(e.getAttribute('opacity') || 0) * so);
    }
    op(this.strip.g, so);
    this._drawStrip(FA, FB, q);
    this._drawGreyed(FA, FB, q);
    this._drawSort(FA, FB, q);
    // the arrows: of the decision in hand, or the one before, fading
    const da = FA.decision, db = FB.decision;
    if (da && da === db) this._drawArcs(FA.scenario, da, lerp(stageOf(FA), stageOf(FB), q), so);
    else if (da) this._drawArcs(FA.scenario, da, stageOf(FA), so * clamp01(1 - q * 2));
    else this._drawArcs(null, null, 0, 0);
    this.cur = { frame: q < 0.5 ? FA : FB, panel: pq < 0.5 ? kindA : kindB };
  }

  setTarget(p) {
    if (!p) { this.target.setAttribute('cx', -9999); return; }
    this.target.setAttribute('cx', p[0]);
    this.target.setAttribute('cy', p[1]);
  }

  anchor(id) {
    const cur = this.cur;
    if (!cur) return null;
    const d = cur.frame.decision;
    const strip = cur.panel === 'score';
    if (id === 'winner' || id.startsWith('bar.')) {
      const p = d && (this.stripTops || {})[id === 'winner' ? d.chosen[0] : id.slice(4)];
      return p ? { p, visible: strip } : { p: [0, 0], visible: false };
    }
    // (a row: where it is now)
    if (id.startsWith('row.')) return { p: [BOARD.labelX - 8, rowY(id.slice(4))], visible: true };
    if (id === 'deciding') return d ? { p: [BOARD.x0 + 4, rowY(d.partition)], visible: true } : { p: [0, 0], visible: false };
    if (id === 'chosen') return d ? { p: [chipX(d.chosen[0], d.state) - 20, rowY(d.partition)], visible: true } : { p: [0, 0], visible: false };
    const a = ANCHORS[id];
    if (!a) return null;
    const panelOf = { moves: 'moves', tree: 'tree', scores: 'score' };
    if (id === 'moves.total' || id === 'tree') return { p: a.p, visible: cur.panel === panelOf[id.split('.')[0]] };
    const kind = id.split('.')[0];
    // (a node's name and tallies: where its column is now)
    if (kind === 'node' || kind === 'tally') {
      const n = id.slice(kind.length + 1);
      return { p: [a.p[0] + colX(n) - colX0(n), a.p[1]], visible: true };
    }
    return { p: a.p, visible: kind in panelOf ? cur.panel === panelOf[kind] : true };
  }
}

// Its parts: each a file of related methods, copied onto Diagram.
for (const part of [BoardPart, StripPart, MovesPart, ArrowsPart, SortPart]) {
  for (const k of Object.getOwnPropertyNames(part.prototype)) if (k !== 'constructor') Diagram.prototype[k] = part.prototype[k];
  for (const k of Object.getOwnPropertyNames(part)) if (!['length', 'name', 'prototype'].includes(k)) Diagram[k] = part[k];
}
