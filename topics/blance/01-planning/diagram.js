// The 01-planning explainer's diagram: the partition map as a board
// (a row per partition, a column per node, a chip per primary and
// replica), each node's tallies, and the panel: the scores for the
// decision at hand, the moves a plan takes, the server groups' tree, or
// the stickiness table. Built once; main.js draws it partway between
// two frames, as the scroll says.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01 } from '../../../engine/js/ui/util/anim.js';
import { calcPartitionMoves } from '../lib/moves.js';
import { NODES, PARTITIONS, STATES, GROUPS, STICKINESS, SCENARIOS, tally } from './scenarios.js';
import {
  CANVAS, BOARD, PANEL, TREE, ANCHORS, colX, rowY, chipX, HEAD_Y, GROUP_Y, TALLY_Y,
  scoreX, movesRowY, stickRowY,
} from './layout.js';

const f4 = (x) => x.toFixed(4);
const short = (x) => (Math.abs(x) >= 0.01 || x === 0 ? String(+x.toFixed(3)) : x.toFixed(4));
const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
// one frame's chips: {key, p, state, node}
const chipsOf = (board) => PARTITIONS.flatMap((p) => STATES.flatMap((s) => board[p][s].map((node, i) => ({ key: `${p}:${s}:${i}`, p, state: s, node }))));
// a node's place in a scenario: not in the cluster, joining one that
// has partitions placed already, leaving (and, once dropped, gone), or in
const placed = (board) => PARTITIONS.some((p) => STATES.some((s) => board[p][s].length));
function nodeStatus(scn, node, frame) {
  if (!scn.nodes.includes(node)) return 'absent';
  if (scn.leaving.includes(node)) return frame.k < 0 ? 'leaving' : 'gone';
  if (scn.joining.includes(node) && placed(scn.prev)) return 'joining';
  return 'in';
}
const STATUS_TAG = { absent: 'not in the cluster', leaving: 'leaving', gone: 'leaving', joining: 'joining' };

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
    this.panelG = el('g', {}, g);
    this.panels = new Map(); // content key -> <g>
    this.target = el('circle', { r: 13, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this.cur = null;
  }

  // ---- the board ----

  _board(g) {
    this.title = txt(g, BOARD.x0, 36, 'the partition map', 'btitle');
    this.subA = txt(g, BOARD.x1 + 10, 36, '', 'bsub', 'end');
    this.subB = txt(g, BOARD.x1 + 10, 36, '', 'bsub', 'end');
    // server groups
    this.groupG = el('g', { opacity: 0 }, g);
    for (const [grp, nodes] of [['g1', ['a', 'b']], ['g2', ['c', 'd']]]) {
      const xa = colX(nodes[0]) - BOARD.colW / 2 + 8, xb = colX(nodes[1]) + BOARD.colW / 2 - 8;
      el('path', { d: `M${xa},${GROUP_Y + 7} V${GROUP_Y} H${xb} V${GROUP_Y + 7}`, class: 'bgroup' }, this.groupG);
      txt(this.groupG, (xa + xb) / 2, GROUP_Y - 6, `server group ${grp}`, 'bgroup-label', 'middle');
    }
    // rows
    for (const p of PARTITIONS) {
      const y = rowY(p);
      if (PARTITIONS.indexOf(p) % 2 === 0) el('rect', { x: BOARD.x0, y: y - BOARD.rowH / 2, width: BOARD.x1 - BOARD.x0 + 10, height: BOARD.rowH, class: 'brow' }, g);
      txt(g, BOARD.labelX, y + 5, `partition ${p}`, 'brow-label');
    }
    this.band = el('rect', { x: BOARD.x0, y: 0, width: BOARD.x1 - BOARD.x0 + 10, height: BOARD.rowH, rx: 6, class: 'bband', opacity: 0 }, g);
    // columns
    this.cols = {};
    for (const n of NODES) {
      const x = colX(n);
      const cg = el('g', {}, g);
      el('line', { x1: x - BOARD.colW / 2, y1: BOARD.y0, x2: x - BOARD.colW / 2, y2: BOARD.y1, class: 'bcol-line' }, cg);
      txt(cg, x, HEAD_Y, `node ${n}`, 'bnode', 'middle');
      const tags = {};
      for (const [k, s] of Object.entries({ absent: STATUS_TAG.absent, joining: 'joining', leaving: 'leaving' })) {
        tags[k] = txt(g, x, HEAD_Y + 16, s, `btag btag-${k}`, 'middle');
        op(tags[k], 0);
      }
      // tallies: a bar each for primaries and replicas, and the counts
      const pBar = el('rect', { x: x - 30, y: TALLY_Y - 10, height: 8, width: 0, rx: 2, class: 'tbar-primary' }, cg);
      const rBar = el('rect', { x: x - 30, y: TALLY_Y + 2, height: 8, width: 0, rx: 2, class: 'tbar-replica' }, cg);
      const tText = txt(cg, x, TALLY_Y + 30, '', 'tcount', 'middle');
      this.cols[n] = { g: cg, tags, pBar, rBar, tText };
    }
    this.chipG = el('g', {}, g);
    this.chips = new Map();
    this.chosenRing = el('rect', { width: 40, height: 28, rx: 8, class: 'bchosen', opacity: 0 }, g);
  }

  _chip(key, state) {
    let c = this.chips.get(key);
    if (!c) {
      const g = el('g', { opacity: 0 }, this.chipG);
      el('rect', { x: -17, y: -12, width: 34, height: 24, rx: 6, class: `chip chip-${state}` }, g);
      txt(g, 0, 5, state === 'primary' ? 'P' : 'R', `chip-label chip-label-${state}`, 'middle');
      c = { g, x: null };
      this.chips.set(key, c);
    }
    return c;
  }

  _drawBoard(FA, FB, q) {
    const A = chipsOf(FA.board), B = chipsOf(FB.board);
    const byKey = new Map();
    for (const c of A) byKey.set(c.key, { a: c });
    for (const c of B) byKey.set(c.key, { ...(byKey.get(c.key) || {}), b: c });
    const shown = new Set();
    for (const [key, { a, b }] of byKey) {
      const c = this._chip(key, (a || b).state);
      shown.add(key);
      let x, y, o;
      if (a && b) { x = lerp(chipX(a.node, a.state), chipX(b.node, b.state), q); y = rowY(b.p); o = 1; }
      else if (a) { x = chipX(a.node, a.state); y = rowY(a.p); o = 1 - q; }
      else { x = chipX(b.node, b.state); y = rowY(b.p); o = q; }
      c.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y})`);
      op(c.g, o);
    }
    for (const [key, c] of this.chips) if (!shown.has(key)) op(c.g, 0);

    // the partition being decided
    const da = FA.decision, db = FB.decision;
    if (da || db) {
      const ya = da ? rowY(da.partition) : rowY(db.partition), yb = db ? rowY(db.partition) : ya;
      this.band.setAttribute('y', (lerp(ya, yb, q) - BOARD.rowH / 2).toFixed(1));
      op(this.band, lerp(da ? 1 : 0, db ? 1 : 0, q));
    } else op(this.band, 0);
    const chosen = q < 0.5 ? da : db;
    if (chosen) {
      this.chosenRing.setAttribute('x', chipX(chosen.chosen[0], chosen.state) - 20);
      this.chosenRing.setAttribute('y', rowY(chosen.partition) - 14);
      op(this.chosenRing, Math.abs(q - 0.5) * 2);
    } else op(this.chosenRing, 0);

    // nodes: in the cluster or not, joining, leaving
    const sa = SCENARIOS[FA.scenario], sb = SCENARIOS[FB.scenario];
    const ta = tally(FA.board), tb = tally(FB.board);
    for (const n of NODES) {
      const col = this.cols[n];
      const st = (s, f) => nodeStatus(s, n, f);
      const dim = (x) => (x === 'absent' || x === 'gone' ? 0.3 : 1);
      op(col.g, lerp(dim(st(sa, FA)), dim(st(sb, FB)), q));
      const tag = (x) => (x === 'gone' ? 'leaving' : x);
      for (const [k, e] of Object.entries(col.tags)) op(e, lerp(tag(st(sa, FA)) === k ? 1 : 0, tag(st(sb, FB)) === k ? 1 : 0, q));
      const w = (t, s) => t[n][s] * 14;
      col.pBar.setAttribute('width', lerp(w(ta, 'primary'), w(tb, 'primary'), q).toFixed(1));
      col.rBar.setAttribute('width', lerp(w(ta, 'replica'), w(tb, 'replica'), q).toFixed(1));
      const t = q < 0.5 ? ta : tb;
      setText(col.tText, `${t[n].primary} P · ${t[n].replica} R`);
    }
    op(this.groupG, lerp(sa.groups ? 1 : 0, sb.groups ? 1 : 0, q));
    setText(this.subA, sa.title);
    setText(this.subB, sb.title);
    op(this.subA, sa === sb ? 1 : 1 - q);
    op(this.subB, sa === sb ? 0 : q);
  }

  // ---- the panel: one <g> per content, built when first shown ----

  _content(kind, frame) {
    if (kind === 'none') return null;
    const key = kind === 'score' ? `score:${frame.decision ? frame.key : `${frame.scenario}:${frame.done ? 'done' : 'start'}`}`
      : kind === 'moves' ? `moves:${frame.key}`
        : kind === 'tree' ? `tree:${SCENARIOS[frame.scenario].id === 'groups' ? 'rule' : 'plain'}`
          : kind;
    let g = this.panels.get(key);
    if (!g) {
      g = el('g', { opacity: 0 }, this.panelG);
      el('rect', { x: PANEL.x0, y: PANEL.y0, width: PANEL.x1 - PANEL.x0, height: 470, rx: 10, class: 'panel' }, g);
      if (kind === 'score') this._score(g, frame);
      else if (kind === 'moves') this._moves(g, frame);
      else if (kind === 'tree') this._tree(g, key === 'tree:rule');
      else this._stick(g);
      this.panels.set(key, g);
    }
    return { key, g };
  }

  _score(g, f) {
    const d = f.decision;
    const scn = SCENARIOS[f.scenario];
    const x0 = PANEL.x0 + 20;
    if (!d) {
      txt(g, x0, PANEL.titleY, 'the planner', 'ptitle');
      const msg = f.done ? `pass ${scn.iterations} changed nothing: done, in ${scn.iterations} passes`
        : f.k < 0 ? (scn.joining.length && scn.id === 'add' ? `nodes to add: ${scn.joining.join(', ')}` : scn.leaving.length ? `nodes to remove: ${scn.leaving.join(', ')}` : 'nothing placed yet')
          : `${scn.leaving.join(', ')} taken out of every partition`;
      txt(g, x0, PANEL.titleY + 40, msg, 'pnote');
      return;
    }
    const top = d.topPriorityNode;
    txt(g, x0, PANEL.titleY, `partition ${d.partition}: its ${d.state}`, 'ptitle');
    txt(g, x0, PANEL.titleY + 22, d.state === 'replica' ? `its primary is on ${top}` : top ? `held by ${top} now` : 'not placed yet', 'pnote');
    // the axis
    el('line', { x1: PANEL.zeroX, y1: PANEL.rowY0 - 26, x2: PANEL.zeroX, y2: PANEL.rowY0 + 5 * PANEL.rowH - 20, class: 'paxis' }, g);
    txt(g, PANEL.zeroX, PANEL.rowY0 - 32, '0', 'paxis-label', 'middle');
    for (const v of [1, 2, 3]) {
      el('line', { x1: scoreX(v), y1: PANEL.rowY0 - 26, x2: scoreX(v), y2: PANEL.rowY0 + 5 * PANEL.rowH - 20, class: 'pgrid' }, g);
      txt(g, scoreX(v), PANEL.rowY0 - 32, String(v), 'paxis-label', 'middle');
    }
    txt(g, PANEL.x1 - 20, PANEL.rowY0 - 32, 'score', 'paxis-label', 'end');
    const rows = [...d.scored];
    // the nodes that can't take it: a replica's primary node
    const excluded = d.state === 'replica' ? f.board[d.partition].primary.filter((n) => scn.nodes.includes(n) && !scn.leaving.includes(n)) : [];
    const allowed = d.hierarchyPicks.length ? d.hierarchyPicks[0].candidates : null;
    rows.forEach((s, i) => {
      const y = PANEL.rowY0 + i * PANEL.rowH;
      const won = d.chosen.includes(s.node);
      const rg = el('g', { class: won ? 'prow prow-won' : 'prow' }, g);
      if (won) el('rect', { x: PANEL.x0 + 8, y: y - 20, width: PANEL.x1 - PANEL.x0 - 16, height: PANEL.rowH - 6, rx: 6, class: 'prow-won-bg' }, rg);
      txt(rg, x0, y, `node ${s.node}`, 'prow-node');
      if (allowed && !allowed.includes(s.node)) txt(rg, x0, y + 16, 'other rule', 'pterm');
      const pre = s.count + s.lowerPriorityBalanceFactor + s.filledFactor;
      const preW = pre / s.weight;
      // count, spread, fill, stacked from 0
      const seg = (a, b, cls) => el('rect', { x: scoreX(a), y: y - 12, width: Math.max(0, scoreX(b) - scoreX(a)), height: 12, class: cls }, rg);
      seg(0, s.count / s.weight, `pbar pbar-count pbar-${d.state}`);
      seg(s.count / s.weight, (s.count + s.lowerPriorityBalanceFactor) / s.weight, 'pbar pbar-spread');
      seg((s.count + s.lowerPriorityBalanceFactor) / s.weight, Math.max(preW, (s.count + s.lowerPriorityBalanceFactor) / s.weight + 0.02), 'pbar pbar-fill');
      const terms = [`${s.count}`, `+ ${short(s.lowerPriorityBalanceFactor)}`, `+ ${short(s.filledFactor)}`]
        .concat(s.weight !== 1 ? [`÷ ${s.weight}`] : []).join(' ');
      if (s.currentFactor) {
        // stickiness, taken off: back from the stack to the score, and
        // its label under it, clear of the terms (12px mono: 7.2px a char)
        el('path', { d: `M${scoreX(preW)},${y + 4} H${scoreX(s.score)}`, class: 'psticky' }, rg);
        const label = `− ${short(s.currentFactor)} sticky`;
        const x = Math.min(scoreX(Math.min(s.score, preW)), PANEL.x1 - 20 - terms.length * 7.2 - 12 - label.length * 7.2);
        txt(rg, x, y + 16, label, 'pterm pterm-sticky');
      }
      el('circle', { cx: scoreX(s.score), cy: y - 6, r: 4, class: 'pscore-dot' }, rg);
      txt(rg, PANEL.x1 - 20, y, f4(s.score), won ? 'pscore pscore-won' : 'pscore', 'end');
      txt(rg, PANEL.x1 - 20, y + 16, terms, 'pterm', 'end');
    });
    excluded.forEach((n, j) => {
      const y = PANEL.rowY0 + (rows.length + j) * PANEL.rowH;
      txt(g, x0, y, `node ${n}`, 'prow-node prow-out');
      txt(g, PANEL.zeroX + 10, y, 'holds its primary: not a candidate', 'pterm');
    });
    const ly = PANEL.rowY0 + 5 * PANEL.rowH - 4;
    const key = [['pbar-count pbar-' + d.state, d.state === 'primary' ? 'primaries held' : 'replicas held'], ['pbar-spread', 'backing the same primary'], ['pbar-fill', 'all partitions held']];
    let kx = x0;
    for (const [cls, label] of key) {
      el('rect', { x: kx, y: ly, width: 14, height: 10, class: `pbar ${cls}` }, g);
      txt(g, kx + 20, ly + 9, label, 'pkey');
      kx += 20 + label.length * 6.4 + 22;
    }
  }

  _moves(g, f) {
    const scn = SCENARIOS[f.scenario];
    const x0 = PANEL.x0 + 20;
    const moves = Object.fromEntries(PARTITIONS.map((p) => [p, calcPartitionMoves(STATES, scn.prev[p], f.board[p])]));
    txt(g, x0, PANEL.titleY, `the moves: ${scn.title}`, 'ptitle');
    let total = 0, moved = 0;
    for (const p of PARTITIONS) {
      const y = movesRowY(p);
      txt(g, x0, y + 5, `partition ${p}`, moves[p].length ? 'prow-node' : 'prow-node prow-out');
      let x = x0 + 110;
      if (!moves[p].length) txt(g, x, y + 5, 'stays', 'pterm');
      for (const m of moves[p]) {
        const label = m.op === 'del' ? `del ${m.node}` : `${m.op} ${m.node} as ${m.state}`;
        const w = label.length * 7.4 + 18;
        el('rect', { x, y: y - 10, width: w, height: 22, rx: 11, class: `pmove pmove-${m.op}` }, g);
        txt(g, x + w / 2, y + 5, label, 'pmove-label', 'middle');
        x += w + 8;
      }
      total += moves[p].length;
      if (moves[p].length) moved++;
    }
    txt(g, x0, movesRowY(PARTITIONS[PARTITIONS.length - 1]) + 50, `${total} moves, over ${moved} partitions`, 'ptotal');
  }

  _tree(g, rule) {
    const x0 = PANEL.x0 + 20;
    txt(g, x0, PANEL.titleY, 'the node hierarchy: each node\'s parent', 'ptitle');
    const pos = { dc: [915, TREE.y0 + 10], g1: [805, TREE.y0 + 100], g2: [1025, TREE.y0 + 100], a: [760, TREE.y0 + 190], b: [850, TREE.y0 + 190], c: [980, TREE.y0 + 190], d: [1070, TREE.y0 + 190] };
    for (const [child, parent] of Object.entries(GROUPS)) {
      el('line', { x1: pos[child][0], y1: pos[child][1] - 14, x2: pos[parent][0], y2: pos[parent][1] + 12, class: 'tedge' }, g);
    }
    for (const [n, [x, y]] of Object.entries(pos)) {
      const leaf = NODES.includes(n);
      const cls = rule ? (n === 'a' ? 'tnode tnode-from' : ['c', 'd'].includes(n) ? 'tnode tnode-in' : leaf ? 'tnode tnode-out' : 'tnode') : 'tnode';
      el('rect', { x: x - 30, y: y - 14, width: 60, height: 26, rx: 13, class: cls }, g);
      txt(g, x, y + 4, leaf ? `node ${n}` : n, 'tnode-label', 'middle');
    }
    const y = TREE.y0 + 250;
    if (rule) {
      txt(g, x0, y, 'replica rule: include level 2, exclude level 1', 'pnote');
      txt(g, x0, y + 26, 'from a: up 2 levels, dc → a, b, c, d', 'pterm');
      txt(g, x0, y + 46, 'minus up 1 level, g1 → a, b', 'pterm');
      txt(g, x0, y + 66, '= c, d: the other group', 'pterm pterm-strong');
    } else {
      txt(g, x0, y, 'a: g1, b: g1, c: g2, d: g2, g1: dc, g2: dc', 'pterm');
    }
  }

  _stick(g) {
    const x0 = PANEL.x0 + 20;
    txt(g, x0, PANEL.titleY, 'adding d to the first map: how many moves', 'ptitle');
    STICKINESS.forEach((s, i) => {
      const y = stickRowY(i);
      txt(g, x0, y, s.label, 'prow-node');
      el('rect', { x: x0, y: y + 8, width: Math.max(2, s.moves * 18), height: 12, rx: 3, class: 'pbar pbar-moves' }, g);
      txt(g, x0 + Math.max(2, s.moves * 18) + 8, y + 19, String(s.moves), 'pscore');
    });
  }

  _drawPanel(kindA, FA, kindB, FB, q) {
    const a = this._content(kindA, FA), b = this._content(kindB, FB);
    const same = a && b && a.key === b.key;
    for (const [key, g] of this.panels) {
      let o = 0;
      if (same && key === a.key) o = 1;
      else {
        if (a && key === a.key) o = Math.max(o, 1 - q * 2);
        if (b && key === b.key) o = Math.max(o, q * 2 - 1);
      }
      op(g, o);
      g.style.display = o > 0.001 ? '' : 'none';
    }
  }

  // ---- what main.js calls ----

  // Frames FA to FB (scenarios.js), partway (q); panels kindA to kindB,
  // partway (pq).
  draw(FA, FB, q, kindA, kindB, pq, PA = FA, PB = FB) {
    this._drawBoard(FA, FB, q);
    this._drawPanel(kindA, PA, kindB, PB, pq);
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
    if (id === 'winner') {
      if (!d || cur.panel !== 'score') return { p: [0, 0], visible: false };
      const i = d.scored.findIndex((s) => d.chosen.includes(s.node));
      return { p: [PANEL.x0 + 14, PANEL.rowY0 + i * PANEL.rowH - 6], visible: true };
    }
    if (id === 'chosen') {
      if (!d) return { p: [0, 0], visible: false };
      return { p: [chipX(d.chosen[0], d.state) - 20, rowY(d.partition)], visible: true };
    }
    const a = ANCHORS[id];
    if (!a) return null;
    const panelOf = { moves: 'moves', stick: 'stick', tree: 'tree', panel: null };
    const kind = id.split('.')[0];
    const visible = kind === 'panel' ? cur.panel !== 'none' : kind in panelOf ? cur.panel === panelOf[kind] : true;
    return { p: a.p, visible };
  }
}
