// The 01-planning explainer's diagram: the partition map as a board
// (a row per partition, a column per node, a chip per primary and
// replica), each node's tallies, the score strip (for the decision at
// hand, each node's score, under its own column), and the panel on the
// right: the moves a plan takes, the server groups' tree, or the
// stickiness table. Built once; main.js draws it partway between
// two frames, as the scroll says.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01 } from '../../../engine/js/ui/util/anim.js';
import { calcPartitionMoves } from '../lib/moves.js';
import { NODES, PARTITIONS, STATES, GROUPS, STICKINESS, SCENARIOS, tally } from './scenarios.js';
import {
  CANVAS, BOARD, PANEL, TREE, STRIP, ANCHORS, colX, rowY, chipX, HEAD_Y, GROUP_Y, TALLY_Y,
  scoreY, movesRowY, stickRowY,
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
      if (kind !== 'score') el('rect', { x: PANEL.x0, y: PANEL.y0, width: PANEL.x1 - PANEL.x0, height: 470, rx: 10, class: 'panel' }, g);
      if (kind === 'score') this._strip(g, frame);
      else if (kind === 'moves') this._moves(g, frame);
      else if (kind === 'tree') this._tree(g, key === 'tree:rule');
      else this._stick(g);
      this.panels.set(key, g);
    }
    return { key, g };
  }

  // The score strip, for frame f's decision: each node's score, as a
  // bar up from zero in its own column (lowest wins), its terms
  // stacked, stickiness an arrow down to the score, and the number
  // under it.
  _strip(g, f) {
    const d = f.decision;
    const scn = SCENARIOS[f.scenario];
    const x0 = BOARD.col0, x1 = BOARD.x1;
    if (!d) {
      txt(g, BOARD.x0, STRIP.titleY, 'the planner\'s scores', 'ptitle');
      const msg = f.done ? `pass ${scn.iterations} changed nothing: done, in ${scn.iterations} passes`
        : f.k < 0 ? (scn.id === 'add' ? `nodes to add: ${scn.joining.join(', ')}` : scn.leaving.length ? `nodes to remove: ${scn.leaving.join(', ')}` : 'one decision at a time: a partition, a state')
          : `${scn.leaving.join(', ')} taken out of every partition`;
      txt(g, BOARD.x0, STRIP.titleY + 30, msg, 'pnote');
      return;
    }
    txt(g, BOARD.x0, STRIP.titleY, `scoring partition ${d.partition}'s ${d.state}: lowest wins`, 'ptitle');
    if (d.state === 'replica') txt(g, x1 + 10, STRIP.titleY, `its primary is on ${d.topPriorityNode}`, 'pnote', 'end');
    // the axis: partitions' worth
    for (const v of [0, 1, 2, 3]) {
      el('line', { x1: x0, y1: scoreY(v), x2: x1, y2: scoreY(v), class: v ? 'pgrid' : 'paxis' }, g);
      txt(g, x0 - 8, scoreY(v) + 4, String(v), 'paxis-label', 'end');
    }
    txt(g, BOARD.x0, scoreY(1.5) + 4, 'score', 'brow-label');
    const W = STRIP.barW;
    const scored = Object.fromEntries(d.scored.map((c) => [c.node, c]));
    const excluded = d.state === 'replica' ? f.board[d.partition].primary : [];
    for (const n of NODES) {
      const x = colX(n);
      const c = scored[n];
      if (!c) {
        const why = excluded.includes(n) ? 'its primary' : scn.leaving.includes(n) ? 'leaving' : 'not in it';
        txt(g, x, STRIP.zeroY - 12, why, 'pterm', 'middle');
        continue;
      }
      const won = d.chosen.includes(n);
      const w = c.weight;
      const h0 = c.count / w, h1 = (c.count + c.lowerPriorityBalanceFactor) / w;
      const pre = (c.count + c.lowerPriorityBalanceFactor + c.filledFactor) / w;
      const seg = (a, b, cls) => el('rect', { x: x - W / 2, y: scoreY(b), width: W, height: Math.max(0, scoreY(a) - scoreY(b)), class: cls }, g);
      if (won) el('rect', { x: x - 34, y: scoreY(Math.max(pre, c.score, 0.3)) - 10, width: 68, height: STRIP.labelY + 22 - scoreY(Math.max(pre, c.score, 0.3)) + 10, rx: 8, class: 'swon' }, g);
      seg(0, h0, `pbar pbar-count pbar-${d.state}`);
      seg(h0, h1, 'pbar pbar-spread');
      seg(h1, Math.max(pre, h1 + 0.04), 'pbar pbar-fill');
      if (c.currentFactor) {
        // stickiness, taken off: the stack above the score fades, and
        // an arrow goes down from its top to the score
        const lo = Math.max(c.score, 0);
        el('rect', { x: x - W / 2, y: scoreY(pre), width: W, height: Math.max(0, scoreY(lo) - scoreY(pre)), class: 'staken' }, g);
        el('path', { d: `M${x + W / 2 + 6},${scoreY(pre)} V${scoreY(c.score)}`, class: 'psticky' }, g);
        txt(g, x + 38, (scoreY(pre) + scoreY(c.score)) / 2 + 4, `−${+c.currentFactor.toFixed(3)} sticky`, 'pterm pterm-sticky');
      }
      el('line', { x1: x - W / 2 - 4, y1: scoreY(c.score), x2: x + W / 2 + 4, y2: scoreY(c.score), class: 'pscore-line' }, g);
      txt(g, x, STRIP.labelY, c.score.toFixed(4), won ? 'pscore pscore-won' : 'pscore', 'middle');
      if (won) txt(g, x, STRIP.labelY + 16, 'lowest', 'pwon', 'middle');
    }
    // the key
    const ky = STRIP.labelY + 42;
    let kx = BOARD.x0;
    for (const [cls, label] of [[`pbar-count pbar-${d.state}`, d.state === 'primary' ? 'primaries held' : 'replicas held'], ['pbar-spread', 'backing the same primary'], ['pbar-fill', 'all partitions (tie-breaker)']]) {
      el('rect', { x: kx, y: ky - 9, width: 14, height: 10, class: `pbar ${cls}` }, g);
      txt(g, kx + 20, ky, label, 'pkey');
      kx += 20 + label.length * 6.4 + 22;
    }
  }

  // The top of node n's bar in the strip, for frame f's decision.
  barTop(f, n) {
    const d = f && f.decision;
    const c = d && d.scored.find((x) => x.node === n);
    if (!c) return null;
    const pre = (c.count + c.lowerPriorityBalanceFactor + c.filledFactor) / c.weight;
    return [colX(n) - STRIP.barW / 2, scoreY(Math.max(pre, c.score))];
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
    const strip = cur.panel === 'score';
    if (id === 'winner' || id.startsWith('bar.')) {
      const p = d && this.barTop(cur.frame, id === 'winner' ? d.chosen[0] : id.slice(4));
      return p ? { p, visible: strip } : { p: [0, 0], visible: false };
    }
    if (id === 'deciding') return d ? { p: [BOARD.x0 + 4, rowY(d.partition)], visible: true } : { p: [0, 0], visible: false };
    if (id === 'chosen') return d ? { p: [chipX(d.chosen[0], d.state) - 20, rowY(d.partition)], visible: true } : { p: [0, 0], visible: false };
    const a = ANCHORS[id];
    if (!a) return null;
    const panelOf = { moves: 'moves', stick: 'stick', tree: 'tree', scores: 'score' };
    const kind = id.split('.')[0];
    return { p: a.p, visible: kind in panelOf ? cur.panel === panelOf[kind] : true };
  }
}
