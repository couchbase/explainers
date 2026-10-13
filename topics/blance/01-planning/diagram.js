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
import { NODES, PARTITIONS, STATES, GROUPS, STICKINESS, SCENARIOS, STAGES, tally, sourcesOf } from './scenarios.js';
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
// the board's width, to its last node's column, in a scenario
const boardW = (scn) => colX(NODES.filter((n) => scn.nodes.includes(n)).pop()) + BOARD.colW / 2 - BOARD.x0 + 10;
// what each stage of a decision adds to the strip
const STAGE_NOTE = {
  row: 'every node starts at 0',
  count: (st) => `+ the ${st === 'primary' ? 'primaries' : 'replicas'} each node already holds`,
  spread: '+ how often it already backs the same primary',
  fill: '+ a tie-breaker: all the partitions it holds',
  sticky: '− stickiness, for the node that holds it now',
  pick: 'the lowest wins',
};

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
    this.strip = this._buildStrip(g);
    this.arcG = el('g', {}, g);
    this.arcs = new Map(); // key -> {path, head, len}
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
    // rows (as wide as the scenario's nodes)
    this.rowRects = [];
    for (const p of PARTITIONS) {
      const y = rowY(p);
      if (PARTITIONS.indexOf(p) % 2 === 0) this.rowRects.push(el('rect', { x: BOARD.x0, y: y - BOARD.rowH / 2, width: BOARD.x1 - BOARD.x0 + 10, height: BOARD.rowH, class: 'brow' }, g));
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
      for (const [k, s] of Object.entries({ joining: 'joining', leaving: 'leaving' })) {
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
    // the winner's chip, ringed once it's picked
    const picked = (f) => (f.decision ? clamp01((f.stage ?? 5) - 4) : 0);
    const ra = picked(FA) * (1 - q), rb = picked(FB) * q;
    const chosen = ra > rb ? da : db;
    if (chosen && Math.max(ra, rb) > 0) {
      this.chosenRing.setAttribute('x', chipX(chosen.chosen[0], chosen.state) - 20);
      this.chosenRing.setAttribute('y', rowY(chosen.partition) - 14);
      op(this.chosenRing, da === db ? lerp(picked(FA), picked(FB), q) : Math.max(ra, rb));
    } else op(this.chosenRing, 0);

    // nodes: in the cluster or not, joining, leaving
    const sa = SCENARIOS[FA.scenario], sb = SCENARIOS[FB.scenario];
    const ta = tally(FA.board), tb = tally(FB.board);
    for (const n of NODES) {
      const col = this.cols[n];
      const st = (s, f) => nodeStatus(s, n, f);
      // (a node not in the cluster isn't shown; one that's left, dimmed)
      const dim = (x) => (x === 'absent' ? 0 : x === 'gone' ? 0.3 : 1);
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
    const w = lerp(boardW(sa), boardW(sb), q).toFixed(1);
    for (const r of this.rowRects) r.setAttribute('width', w);
    this.band.setAttribute('width', w);
    this.boardW = +w;
    setText(this.subA, sa.title);
    setText(this.subB, sb.title);
    op(this.subA, sa === sb ? 1 : 1 - q);
    op(this.subB, sa === sb ? 0 : q);
  }

  // ---- the panel: one <g> per content, built when first shown ----

  _content(kind, frame) {
    if (kind === 'none' || kind === 'score') return null;
    const key = kind === 'moves' ? `moves:${frame.key}`
        : kind === 'tree' ? `tree:${SCENARIOS[frame.scenario].id === 'groups' ? 'rule' : 'plain'}`
          : kind;
    let g = this.panels.get(key);
    if (!g) {
      g = el('g', { opacity: 0 }, this.panelG);
      el('rect', { x: PANEL.x0, y: PANEL.y0, width: PANEL.x1 - PANEL.x0, height: 470, rx: 10, class: 'panel' }, g);
      if (kind === 'moves') this._moves(g, frame);
      else if (kind === 'tree') this._tree(g, key === 'tree:rule');
      else this._stick(g);
      this.panels.set(key, g);
    }
    return { key, g };
  }

  // ---- the score strip: built once, drawn each frame ----

  _buildStrip(g) {
    const S = { g: el('g', { opacity: 0 }, g) };
    const sg = S.g;
    S.titleA = txt(sg, BOARD.x0, STRIP.titleY, '', 'ptitle');
    S.titleB = txt(sg, BOARD.x0, STRIP.titleY, '', 'ptitle');
    S.subA = txt(sg, BOARD.x1 + 10, STRIP.titleY, '', 'pnote', 'end');
    S.subB = txt(sg, BOARD.x1 + 10, STRIP.titleY, '', 'pnote', 'end');
    S.noteA = txt(sg, BOARD.x0, STRIP.titleY + 26, '', 'pnote');
    S.noteB = txt(sg, BOARD.x0, STRIP.titleY + 26, '', 'pnote');
    S.axis = el('g', {}, sg);
    S.grid = [0, 1, 2, 3].map((v) => {
      const line = el('line', { x1: BOARD.col0, y1: scoreY(v), x2: BOARD.x1, y2: scoreY(v), class: v ? 'pgrid' : 'paxis' }, S.axis);
      txt(S.axis, BOARD.col0 - 8, scoreY(v) + 4, String(v), 'paxis-label', 'end');
      return line;
    });
    txt(S.axis, BOARD.x0, scoreY(1.5) + 4, 'score', 'brow-label');
    const W = STRIP.barW;
    S.cols = {};
    for (const n of NODES) {
      const x = colX(n);
      const cg = el('g', {}, sg);
      const ring = el('rect', { x: x - 34, width: 68, rx: 8, class: 'swon', opacity: 0 }, cg);
      const bar = (cls) => el('rect', { x: x - W / 2, width: W, height: 0, y: STRIP.zeroY, class: cls }, cg);
      const col = {
        g: cg, ring,
        count: bar('pbar pbar-count pbar-primary'), spread: bar('pbar pbar-spread'), fill: bar('pbar pbar-fill'), taken: bar('staken'),
        sticky: el('path', { class: 'psticky', d: '' }, cg),
        stickyLabel: txt(cg, x + W / 2 + 12, 0, '', 'pterm pterm-sticky'),
        line: el('line', { x1: x - W / 2 - 4, x2: x + W / 2 + 4, y1: STRIP.zeroY, y2: STRIP.zeroY, class: 'pscore-line' }, cg),
        num: txt(cg, x, STRIP.labelY, '', 'pscore', 'middle'),
        lowest: txt(cg, x, STRIP.labelY + 16, 'lowest', 'pwon', 'middle'),
        why: txt(cg, x, STRIP.zeroY - 12, '', 'pterm', 'middle'),
      };
      S.cols[n] = col;
    }
    const ky = STRIP.labelY + 42;
    let kx = BOARD.x0;
    S.keyCount = null;
    for (const [cls, label] of [['pbar-count pbar-primary', 'held, in this state'], ['pbar-spread', 'backing the same primary'], ['pbar-fill', 'all partitions (tie-breaker)']]) {
      const r = el('rect', { x: kx, y: ky - 9, width: 14, height: 10, class: `pbar ${cls}` }, sg);
      if (!S.keyCount) S.keyCount = r;
      txt(sg, kx + 20, ky, label, 'pkey');
      kx += 20 + label.length * 6.4 + 22;
    }
    return S;
  }

  // One node's bar, for decision d at stage s (0..5, partway through
  // the stages): its parts' tops, its score so far, and whether it won.
  static barAt(d, s, n) {
    const c = d && d.scored.find((x) => x.node === n);
    if (!c) return null;
    const g = (k) => clamp01(s - k);
    const w = c.weight;
    const count = (c.count / w) * g(0);
    const spread = count + (c.lowerPriorityBalanceFactor / w) * g(1);
    const fill = spread + (c.filledFactor / w) * g(2);
    // (the tie-breaker's sliver, at least visible)
    const fillShown = spread + Math.max(c.filledFactor / w, 0.04) * g(2);
    const taken = c.currentFactor * g(3);
    return { count, spread, fill, fillShown, taken, score: fill - taken, won: d.chosen.includes(n) ? g(4) : 0, sticky: c.currentFactor };
  }

  // What can't take it, and why.
  static whyNot(f, d, n) {
    const scn = SCENARIOS[f.scenario];
    if (!scn.nodes.includes(n) || d.scored.some((c) => c.node === n)) return '';
    if (d.state === 'replica' && f.board[d.partition].primary.includes(n)) return 'its primary';
    return scn.leaving.includes(n) ? 'leaving' : '';
  }

  _drawStrip(FA, FB, q) {
    const S = this.strip;
    const da = FA.decision, db = FB.decision;
    const sa = FA.stage ?? 5, sb = FB.stage ?? 5;
    // the same decision: one state, partway through its stages; else
    // the bars go from one decision's to the other's
    const same = da && da === db;
    const sNow = same ? lerp(sa, sb, q) : null;
    const scn = SCENARIOS[(q < 0.5 ? FA : FB).scenario];
    const text = (f, d, s) => {
      if (!d) {
        const sc = SCENARIOS[f.scenario];
        return ['the planner\'s scores', f.done ? `pass ${sc.iterations} changed nothing: done, in ${sc.iterations} passes`
          : f.k < 0 ? (sc.id === 'add' ? `nodes to add: ${sc.joining.join(', ')}` : sc.leaving.length ? `nodes to remove: ${sc.leaving.join(', ')}` : 'one decision at a time: a partition, a state')
            : `${sc.leaving.join(', ')} taken out of every partition`, ''];
      }
      const st = STAGES[Math.min(5, Math.round(s))];
      const note = typeof STAGE_NOTE[st] === 'function' ? STAGE_NOTE[st](d.state) : STAGE_NOTE[st];
      return [`scoring partition ${d.partition}'s ${d.state}`, note, d.state === 'replica' ? `its primary is on ${d.topPriorityNode}` : ''];
    };
    const [ta, na, ua] = text(FA, da, same ? sNow : sa), [tb, nb, ub] = text(FB, db, same ? sNow : sb);
    setText(S.titleA, ta); setText(S.titleB, tb);
    setText(S.noteA, na); setText(S.noteB, nb);
    setText(S.subA, ua); setText(S.subB, ub);
    const cross = (eA, eB, a, b) => { op(eA, a === b ? 1 : 1 - q * 2); op(eB, a === b ? 0 : q * 2 - 1); };
    cross(S.titleA, S.titleB, ta, tb); cross(S.noteA, S.noteB, na, nb); cross(S.subA, S.subB, ua, ub);
    // the axis, as wide as the board
    for (const l of S.grid) l.setAttribute('x2', (BOARD.x0 + (this.boardW || BOARD.x1 - BOARD.x0)).toFixed(1));
    const state = (same ? da : q < 0.5 ? da || db : db || da);
    S.keyCount.setAttribute('class', `pbar pbar-count pbar-${state ? state.state : 'primary'}`);
    this.stripTops = {};
    for (const n of NODES) {
      const col = S.cols[n];
      const A = da ? Diagram.barAt(da, same ? sNow : sa, n) : null;
      const B = same ? A : db ? Diagram.barAt(db, sb, n) : null;
      const zero = { count: 0, spread: 0, fill: 0, fillShown: 0, taken: 0, score: 0, won: 0, sticky: 0 };
      const a = A || zero, b = B || zero;
      const v = Object.fromEntries(Object.keys(zero).map((k) => [k, same ? a[k] : lerp(a[k], b[k], q)]));
      const shown = same ? (A ? 1 : 0) : lerp(A ? 1 : 0, B ? 1 : 0, q);
      const st = (same ? da : q < 0.5 ? da : db) || da || db;
      col.count.setAttribute('class', `pbar pbar-count pbar-${st ? st.state : 'primary'}`);
      const seg = (r, lo, hi) => { r.setAttribute('y', scoreY(hi).toFixed(1)); r.setAttribute('height', Math.max(0, scoreY(lo) - scoreY(hi)).toFixed(1)); };
      seg(col.count, 0, v.count); seg(col.spread, v.count, v.spread); seg(col.fill, v.spread, v.fillShown);
      seg(col.taken, Math.max(v.score, 0), v.fill);
      op(col.taken, v.taken > 0.001 ? 1 : 0);
      const stickyOn = v.taken > 0.001;
      col.sticky.setAttribute('d', stickyOn ? `M${colX(n) + STRIP.barW / 2 + 6},${scoreY(v.fill).toFixed(1)} V${scoreY(v.score).toFixed(1)}` : '');
      col.stickyLabel.setAttribute('y', ((scoreY(v.fill) + scoreY(v.score)) / 2 + 4).toFixed(1));
      setText(col.stickyLabel, stickyOn ? `−${+v.sticky.toFixed(3)}` : '');
      for (const e of [col.count, col.spread, col.fill, col.line, col.num]) op(e, shown);
      col.line.setAttribute('y1', scoreY(v.score).toFixed(1));
      col.line.setAttribute('y2', scoreY(v.score).toFixed(1));
      const near = (same || q < 0.5 ? A : B) || A || B;
      setText(col.num, near ? (same ? v.score : near.score).toFixed(4) : '');
      col.num.setAttribute('class', v.won > 0.5 ? 'pscore pscore-won' : 'pscore');
      const top = Math.max(v.fillShown, v.score, 0.3);
      col.ring.setAttribute('y', (scoreY(top) - 10).toFixed(1));
      col.ring.setAttribute('height', (STRIP.labelY + 22 - scoreY(top) + 10).toFixed(1));
      op(col.ring, v.won); op(col.lowest, v.won);
      const wa = da ? Diagram.whyNot(FA, da, n) : '', wb = db ? Diagram.whyNot(FB, db, n) : '';
      setText(col.why, (q < 0.5 ? wa : wb) || wa || wb);
      op(col.why, same ? (wa ? 1 : 0) : lerp(wa ? 1 : 0, wb ? 1 : 0, q));
      // (a node not in the cluster has no column at all)
      op(col.g, scn.nodes.includes(n) ? 1 : 0);
      if (shown > 0.5) this.stripTops[n] = [colX(n) - STRIP.barW / 2, scoreY(Math.max(v.fillShown, v.score))];
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

  // ---- arrows: where each term comes from ----

  _arc(key, from, to, bow, cls) {
    let a = this.arcs.get(key);
    if (!a) {
      const [x0, y0] = from, [x1, y1] = to;
      const d = `M${x0},${y0} C${x0 + bow},${y0 + (y1 - y0) * 0.35} ${x1 + bow},${y1 - (y1 - y0) * 0.35} ${x1},${y1}`;
      const path = el('path', { d, class: `sarc ${cls}` }, this.arcG);
      // a triangle, pointing along the path (see _drawArcs)
      const head = el('path', { d: 'M0,0 L-9,-4.5 L-9,4.5 Z', class: `sarc-head ${cls}` }, this.arcG);
      a = { path, head, len: path.getTotalLength() };
      path.setAttribute('stroke-dasharray', `${a.len} ${a.len}`);
      this.arcs.set(key, a);
    }
    return a;
  }

  // Decision d at stage s (0..5): each stage's arrows draw along their
  // path as it goes, stay while it's settled, and fade in the next.
  _drawArcs(scnId, d, s, o) {
    const shown = new Set();
    if (d && o > 0.001) {
      const scn = SCENARIOS[scnId];
      const src = sourcesOf(scn, d, d.before);
      const W = STRIP.barW;
      const stageArcs = [];
      for (const n of NODES) {
        const c = d.scored.find((x) => x.node === n);
        if (!c) continue;
        const b = Diagram.barAt(d, 5, n);
        const chipAt = ([p, nn, st]) => [chipX(nn, st), rowY(p) + 12];
        // count: chip i to the bar's ith unit
        src[n].count.forEach((ch, i) => stageArcs.push([0, `c:${ch}`, chipAt(ch), [colX(n) - W / 2 + 4, scoreY(i + 0.5)], -44 - 12 * i, `sarc-count sarc-${d.state}`]));
        src[n].spread.forEach((ch, i) => stageArcs.push([1, `s:${n}:${ch}`, chipAt(ch), [colX(n) + W / 2 - 4, scoreY((b.count + b.spread) / 2)], 44 + 12 * i, 'sarc-spread']));
        src[n].fill.forEach((ch, i) => stageArcs.push([2, `f:${ch}`, chipAt(ch), [colX(n), scoreY(b.fillShown) - 2], 30 + 8 * i, 'sarc-fill']));
        src[n].sticky.forEach((ch) => stageArcs.push([3, `k:${ch}`, chipAt(ch), [colX(n) + W / 2 + 6, scoreY(b.fill)], 56, 'sarc-sticky']));
      }
      // pick: from the winner's bar up to where its chip goes
      const wn = d.chosen[0], wb = Diagram.barAt(d, 5, wn);
      stageArcs.push([4, `p:${d.partition}:${wn}`, [colX(wn), scoreY(Math.max(wb.fillShown, wb.score, 0.3)) - 12], [chipX(wn, d.state), rowY(d.partition) + 14], -40, 'sarc-pick']);
      for (const [k, key0, from, to, bow, cls] of stageArcs) {
        const key = `${d.k}:${key0}`;
        const t = clamp01(s - k);
        const fade = s <= k + 1 ? 1 : clamp01(1 - (s - (k + 1)) * 2);
        if (t <= 0.001 || fade <= 0.001) continue;
        const a = this._arc(key, from, to, bow, cls);
        a.path.setAttribute('stroke-dashoffset', (a.len * (1 - t)).toFixed(1));
        const h = a.path.getPointAtLength(a.len * t);
        const b = a.path.getPointAtLength(Math.max(0, a.len * t - 2));
        const angle = Math.atan2(h.y - b.y, h.x - b.x) * 180 / Math.PI;
        a.head.setAttribute('transform', `translate(${h.x.toFixed(1)} ${h.y.toFixed(1)}) rotate(${angle.toFixed(1)})`);
        op(a.path, o * fade); op(a.head, o * fade);
        shown.add(key);
      }
    }
    for (const [key, a] of this.arcs) if (!shown.has(key)) { op(a.path, 0); op(a.head, 0); }
  }

  // ---- what main.js calls ----

  // Frames FA to FB (scenarios.js), partway (q); panels kindA to kindB,
  // partway (pq).
  draw(FA, FB, q, kindA, kindB, pq, PA = FA, PB = FB) {
    this._drawBoard(FA, FB, q);
    this._drawPanel(kindA, PA, kindB, PB, pq);
    const so = lerp(kindA === 'score' ? 1 : 0, kindB === 'score' ? 1 : 0, pq);
    op(this.strip.g, so);
    this._drawStrip(FA, FB, q);
    // the arrows: of the decision in hand, or the one before, fading
    const da = FA.decision, db = FB.decision;
    if (da && da === db) this._drawArcs(FA.scenario, da, lerp(FA.stage ?? 5, FB.stage ?? 5, q), so);
    else if (da) this._drawArcs(FA.scenario, da, FA.stage ?? 5, so * clamp01(1 - q * 2));
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
    if (id === 'deciding') return d ? { p: [BOARD.x0 + 4, rowY(d.partition)], visible: true } : { p: [0, 0], visible: false };
    if (id === 'chosen') return d ? { p: [chipX(d.chosen[0], d.state) - 20, rowY(d.partition)], visible: true } : { p: [0, 0], visible: false };
    const a = ANCHORS[id];
    if (!a) return null;
    const panelOf = { moves: 'moves', stick: 'stick', tree: 'tree', scores: 'score' };
    const kind = id.split('.')[0];
    return { p: a.p, visible: kind in panelOf ? cur.panel === panelOf[kind] : true };
  }
}
