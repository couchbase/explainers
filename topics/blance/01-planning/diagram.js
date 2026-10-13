// The 01-planning explainer's diagram: the partition map as a board
// (a row per partition, a column per node, a chip per primary and
// replica), each node's tallies, and under them one area that shows,
// as the story needs: the scores for the decision at hand (each node's,
// under its own column), the moves a plan takes (on the board, the
// copies built and deleted; below, each node's counts), the server
// groups' rule, or the stickiness table, as bars. Built once; main.js draws it partway between
// two frames, as the scroll says.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { calcPartitionMoves } from '../lib/moves.js';
import { NODES, PARTITIONS, STATES, GROUPS, STICKINESS, SCENARIOS, TERMS, tally, sourcesOf } from './scenarios.js';
import {
  CANVAS, BOARD, STRIP, ANCHORS, colX, rowY, chipX, HEAD_Y, GROUP_Y, TALLY_Y, scoreY, MOVE_UNIT, stickBarX, STICK_UNIT,
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
// A decision's stages run from 0 to L (its seq's last, the pick); stage
// j plays over (j - 1, j], and u is how far through it.
const through = (s, j) => clamp01(s - (j - 1));
const pickOf = (d) => d.seq.length - 1;
// Cause, then effect, one at a time: within a stage (u from 0 to 1)
// with n arrows, the ith flies, lands, and only then grows its part of
// the bar, before the next one leaves.
const FLY = 0.7;
const flight = (u, i, n) => clamp01((u - i / n) / (FLY / n));
const grown = (u, i, n) => clamp01((u - (i + FLY) / n) / ((1 - FLY) / n));
export { FLY, flight, grown, through };
// the pick: the winner's ring, then its arrow up to the board, then its chip
// (a box around every candidate's score appears, then narrows onto the
// lowest, which is then marked; then its arrow flies, then its chip)
const PICK = { wide: [0, 0.08], narrow: [0.12, 0.38], ring: [0.36, 0.42], flight: [0.42, 0.72], chip: [0.72, 0.92] };
const within = (t, [a, b]) => clamp01((t - a) / (b - a));

// An arrow's thickness, by what it adds to the score: by its square
// root, so the tie-breaker's (0.000125) still shows beside stickiness's
// (1.5): about 0.8px to 3.7px.
const arcWidth = (adds) => 0.8 + 2.4 * Math.sqrt(Math.max(0, adds));

// A dash pattern that draws `drawn` px of a path of length `len` as
// dashes, and leaves the rest blank.
const DASH = 6, GAP = 4;
function dashesTo(drawn, len) {
  const out = [];
  let x = 0;
  while (x + DASH + GAP <= drawn) { out.push(DASH, GAP); x += DASH + GAP; }
  const last = Math.min(DASH, drawn - x);
  out.push(last.toFixed(1), (len + DASH).toFixed(1));
  return out.join(' ');
}

// the board's width, to its last node's column, in a scenario
const boardW = (scn) => colX(NODES.filter((n) => scn.nodes.includes(n)).pop()) + BOARD.colW / 2 - BOARD.x0 + 10;
// what each stage of a decision adds to the strip
const TERM_NOTE = {
  count: (st) => `+ the ${st === 'primary' ? 'primaries' : 'replicas'} it already holds`,
  spread: () => '+ how often it already backs the same primary',
  fill: () => '+ a tie-breaker: all the partitions it holds',
  sticky: () => '− stickiness: it holds this partition now',
};
const stageNote = (d, x) => (x.stage === 'row' ? 'every node starts at 0, and they\'re scored one at a time'
  : x.stage === 'pick' ? 'the lowest wins' : `node ${x.node}: ${TERM_NOTE[x.term](d.state)}`);

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
    this.strip = this._buildStrip(g);
    this.movesArea = this._buildMoves(g);
    this.stickArea = this._buildStick(g);
    this.treeArea = this._buildTree(g);
    this.focusBox = el('rect', { rx: 14, class: 'sfocus', opacity: 0 }, g);
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
    // what the outlined row is about, to its right, following it down
    this.bandLabel = el('g', { opacity: 0 }, g);
    this.bandLine1 = txt(this.bandLabel, 0, -3, '', 'bband-label');
    this.bandLine2 = txt(this.bandLabel, 0, 12, '', 'bband-label');
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
    // what the pick did to a partition that had a place: reassigned (a
    // ghost where it was, an arrow across to where it goes) or stays put
    const vg = el('g', { opacity: 0 }, g);
    this.verdict = {
      g: vg,
      ghost: el('rect', { width: 34, height: 24, rx: 6, class: 'vghost' }, vg),
      line: el('path', { class: 'varrow' }, vg),
      head: el('path', { d: 'M0,0 L-10,-5 L-10,5 Z', class: 'varrow-head' }, vg),
      label: txt(vg, 0, 0, '', 'vlabel', 'middle'),
    };
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

  _drawBoard(FA, FB, q, sNow = null) {
    // (within a decision, the board changes only once its pick's arrow
    // lands: chips move, or appear, then)
    const qc = sNow !== null ? within(through(sNow, pickOf(FA.decision)), PICK.chip) : q;
    const A = chipsOf(FA.board), B = chipsOf(FB.board);
    const byKey = new Map();
    for (const c of A) byKey.set(c.key, { a: c });
    for (const c of B) byKey.set(c.key, { ...(byKey.get(c.key) || {}), b: c });
    const shown = new Set();
    for (const [key, { a, b }] of byKey) {
      const c = this._chip(key, (a || b).state);
      shown.add(key);
      let x, y, o;
      if (a && b) { x = lerp(chipX(a.node, a.state), chipX(b.node, b.state), qc); y = rowY(b.p); o = 1; }
      else if (a) { x = chipX(a.node, a.state); y = rowY(a.p); o = 1 - qc; }
      else { x = chipX(b.node, b.state); y = rowY(b.p); o = qc; }
      c.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y})`);
      op(c.g, o);
    }
    for (const [key, c] of this.chips) if (!shown.has(key)) op(c.g, 0);

    // the partition being decided
    const da = FA.decision, db = FB.decision;
    if (da || db) {
      const ya = da ? rowY(da.partition) : rowY(db.partition), yb = db ? rowY(db.partition) : ya;
      const y = lerp(ya, yb, q);
      this.band.setAttribute('y', (y - BOARD.rowH / 2).toFixed(1));
      const o = lerp(da ? 1 : 0, db ? 1 : 0, q);
      op(this.band, o);
      // the label: "assigning", then once the pick's chip lands, where to
      const d = q < 0.5 ? da || db : db || da;
      const f = q < 0.5 ? FA : FB;
      const landed = sNow !== null ? within(through(sNow, pickOf(d)), PICK.chip) > 0.5 : f.stage === undefined || f.stage === pickOf(d);
      setText(this.bandLine1, `${landed ? 'assigned' : 'assigning'} ${d.state}`);
      setText(this.bandLine2, `for partition ${d.partition}${landed ? ` → ${d.chosen[0]}` : '…'}`);
      this.bandLabel.setAttribute('transform', `translate(${(BOARD.x0 + (this.boardW || BOARD.x1 - BOARD.x0) + 10).toFixed(1)} ${y.toFixed(1)})`);
      op(this.bandLabel, o);
    } else { op(this.band, 0); op(this.bandLabel, 0); }
    // the winner's chip, ringed once it's picked
    // (as its chip: once the pick's arrow lands)
    const picked = (d, st) => within(through(st, pickOf(d)), PICK.chip);
    const ra = da ? picked(da, FA.stage ?? pickOf(da)) * (1 - q) : 0, rb = db ? picked(db, FB.stage ?? pickOf(db)) * q : 0;
    const chosen = ra > rb ? da : db;
    if (chosen && (sNow !== null || Math.max(ra, rb) > 0)) {
      this.chosenRing.setAttribute('class', `bchosen pick-${chosen.state}`);
      this.chosenRing.setAttribute('x', chipX(chosen.chosen[0], chosen.state) - 20);
      this.chosenRing.setAttribute('y', rowY(chosen.partition) - 14);
      op(this.chosenRing, sNow !== null ? picked(chosen, sNow) : Math.max(ra, rb));
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
      col.pBar.setAttribute('width', lerp(w(ta, 'primary'), w(tb, 'primary'), qc).toFixed(1));
      col.rBar.setAttribute('width', lerp(w(ta, 'replica'), w(tb, 'replica'), qc).toFixed(1));
      const t = qc < 0.5 ? ta : tb;
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
    // the pick's box: around all the candidates' scores, then the lowest's
    S.select = el('rect', { rx: 8, class: 'swon', opacity: 0 }, sg);
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
    const at = (term) => d.seq.findIndex((x) => x.node === n && x.term === term);
    const u = (term) => (at(term) < 0 ? 0 : through(s, at(term)));
    const w = c.weight, np = PARTITIONS.length;
    // each term's sources (see sourcesOf), each adding its part once its
    // arrow lands
    const nCount = c.count, nSpread = Math.round(c.lowerPriorityBalanceFactor * np), nFill = Math.round((c.filledFactor * np) / 0.001);
    let count = 0;
    for (let i = 0; i < nCount; i++) count += (1 / w) * grown(u('count'), i, nCount);
    let spread = count;
    for (let i = 0; i < nSpread; i++) spread += (1 / np / w) * grown(u('spread'), i, nSpread);
    let fillT = 0;
    for (let i = 0; i < nFill; i++) fillT += grown(u('fill'), i, nFill) / nFill;
    if (!nFill) fillT = u('fill');
    const fill = spread + (c.filledFactor / w) * fillT;
    const fillShown = spread + Math.max(c.filledFactor / w, 0.04) * fillT;
    const taken = c.currentFactor * grown(u('sticky'), 0, 1);
    // (once all its terms are in, its exact score, as blance has it,
    // rather than the sum of its parts in floating point)
    const last = Math.max(...TERMS.map((t) => at(t)));
    const done = through(s, last) >= 1;
    // how computed its score is, for its number: not yet (0), being
    // added up (0.5), all its terms in (1)
    const first = Math.min(...TERMS.map((t) => at(t)).filter((j) => j >= 0));
    const computed = done ? 1 : through(s, first) > 0 ? 0.5 : 0;
    return { count, spread, fill: done ? (c.count + c.lowerPriorityBalanceFactor + c.filledFactor) / w : fill, fillShown, taken, score: done ? c.score : fill - taken, won: d.chosen.includes(n) ? within(through(s, pickOf(d)), PICK.ring) : 0, sticky: c.currentFactor, computed };
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
    const sa = FA.stage ?? (da ? pickOf(da) : 0), sb = FB.stage ?? (db ? pickOf(db) : 0);
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
      // (the stage in progress)
      const x = d.seq[Math.min(d.seq.length - 1, Math.max(0, Math.ceil(s - 1e-9)))];
      return [`scoring partition ${d.partition}'s ${d.state}`, stageNote(d, x), d.state === 'replica' ? `its primary is on ${d.topPriorityNode}` : ''];
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
      const zero = { count: 0, spread: 0, fill: 0, fillShown: 0, taken: 0, score: 0, won: 0, sticky: 0, computed: 0 };
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
      for (const e of [col.count, col.spread, col.fill, col.line]) op(e, shown);
      // its number: faint till it's being computed, solid once it is
      op(col.num, shown * (0.15 + 0.85 * v.computed));
      col.line.setAttribute('y1', scoreY(v.score).toFixed(1));
      col.line.setAttribute('y2', scoreY(v.score).toFixed(1));
      const near = (same || q < 0.5 ? A : B) || A || B;
      setText(col.num, near ? (same ? v.score : near.score).toFixed(4) : '');
      col.num.setAttribute('class', v.won > 0.5 ? `pscore pscore-won pick-${st ? st.state : 'primary'}` : 'pscore');
      col.lowest.setAttribute('class', `pwon pick-${st ? st.state : 'primary'}`);
      const top = Math.max(v.fillShown, v.score, 0.3);
      col.ring.setAttribute('y', (scoreY(top) - 10).toFixed(1));
      col.ring.setAttribute('height', (STRIP.labelY + 22 - scoreY(top) + 10).toFixed(1));
      op(col.ring, 0); op(col.lowest, v.won);
      const wa = da ? Diagram.whyNot(FA, da, n) : '', wb = db ? Diagram.whyNot(FB, db, n) : '';
      setText(col.why, (q < 0.5 ? wa : wb) || wa || wb);
      op(col.why, same ? (wa ? 1 : 0) : lerp(wa ? 1 : 0, wb ? 1 : 0, q));
      // (a node not in the cluster has no column at all)
      op(col.g, scn.nodes.includes(n) ? 1 : 0);
      if (shown > 0.5) this.stripTops[n] = [colX(n) - STRIP.barW / 2, scoreY(Math.max(v.fillShown, v.score))];
    }
    this._drawSelect(FA, FB, q, same ? sNow : null);
  }

  // The pick's box: it appears around every candidate's score, then
  // narrows onto the lowest's.
  _drawSelect(FA, FB, q, sNow) {
    const box = this.strip.select;
    // (this decision at its pick; or the one before, settled, fading)
    let d, u, o = 1;
    if (sNow !== null) { d = FA.decision; u = through(sNow, pickOf(d)); }
    else if (FA.decision && (FA.stage ?? pickOf(FA.decision)) === pickOf(FA.decision)) { d = FA.decision; u = 1; o = clamp01(1 - q * 2); }
    if (!d || u <= 0) { op(box, 0); return; }
    const L = pickOf(d);
    const tops = d.scored.map((c) => { const b = Diagram.barAt(d, L, c.node); return Math.max(b.fillShown, b.score, 0.3); });
    const xs = d.scored.map((c) => colX(c.node));
    const wide = [Math.min(...xs) - 34, scoreY(Math.max(...tops)) - 10, Math.max(...xs) + 34];
    const w = d.chosen[0], wt = tops[d.scored.findIndex((c) => c.node === w)];
    const narrow = [colX(w) - 34, scoreY(wt) - 10, colX(w) + 34];
    box.setAttribute('class', `swon pick-${d.state}`);
    const e = easeQuad(within(u, PICK.narrow));
    const [x0, y0, x1] = wide.map((v, k) => lerp(v, narrow[k], e));
    box.setAttribute('x', x0.toFixed(1)); box.setAttribute('y', y0.toFixed(1));
    box.setAttribute('width', (x1 - x0).toFixed(1));
    box.setAttribute('height', (STRIP.labelY + 22 - y0).toFixed(1));
    op(box, o * within(u, PICK.wide));
  }

  // ---- the pick's verdict: reassigned, or stays put ----

  // For decision d of scenario scn: where its partition was in d's state
  // before the plan (the map it started from), and where it goes.
  static verdictOf(scn, d) {
    const was = scn.prev[d.partition][d.state][0];
    const goes = d.chosen[0];
    if (!was || !goes) return null;
    return { was, goes, moved: was !== goes };
  }

  _drawVerdict(FA, FB, q, sNow) {
    const V = this.verdict;
    // the decision whose pick shows: this one, once its chip lands; or
    // the one before, fading as the next begins
    let d, f, o;
    if (sNow !== null) { d = FA.decision; f = FA; o = within(through(sNow, pickOf(d)), PICK.chip); }
    else if (FA.decision && (FA.stage ?? pickOf(FA.decision)) === pickOf(FA.decision)) { d = FA.decision; f = FA; o = clamp01(1 - q * 2); }
    else if (FB.decision && FB.stage === undefined) { d = FB.decision; f = FB; o = clamp01(q * 2 - 1); }
    const v = d && Diagram.verdictOf(SCENARIOS[f.scenario], d);
    if (!v || o <= 0.001) { op(V.g, 0); return; }
    op(V.g, o);
    const y = rowY(d.partition);
    if (v.moved) {
      const x0 = chipX(v.was, d.state), x1 = chipX(v.goes, d.state);
      const dir = Math.sign(x1 - x0);
      V.ghost.setAttribute('x', x0 - 17); V.ghost.setAttribute('y', y - 12);
      V.ghost.setAttribute('class', `vghost vghost-${d.state}`);
      // across the row, just under the chips
      const ya = y + 17, xa = x0 + dir * 10, xb = x1 - dir * 12;
      V.line.setAttribute('d', `M${x0},${y + 12} Q${x0},${ya} ${xa + dir * 6},${ya} L${xb},${ya}`);
      V.head.setAttribute('transform', `translate(${xb + dir * 4} ${ya}) rotate(${dir > 0 ? 0 : 180})`);
      // Level with the chip where it lands, on a side that's free: away
      // from the arrow if it can, else the other; failing both, above.
      const W = 84; // "reassigned!", 14px
      const after = f.decision === d && f.stage === undefined ? f.board : null;
      const board = after || (() => { const b = JSON.parse(JSON.stringify(d.before)); for (const st of STATES) b[d.partition][st] = b[d.partition][st].filter((n) => !d.chosen.includes(n)); b[d.partition][d.state] = [...d.chosen]; return b; })();
      const taken = STATES.flatMap((st) => board[d.partition][st].map((n) => [chipX(n, st) - 18, chipX(n, st) + 18]))
        .filter(([a]) => Math.abs(a + 18 - x1) > 1)
        // (and the row's label, and past the board's right edge, where
        // the outlined row's label goes)
        .concat([[x0 - 18, x0 + 18], [BOARD.x0, BOARD.col0 - 4], [BOARD.x0 + (this.boardW || BOARD.x1 - BOARD.x0), Infinity]]);
      const free = ([a, b]) => taken.every(([u, v]) => b <= u || a >= v);
      const right = [x1 + 23, x1 + 23 + W], left = [x1 - 23 - W, x1 - 23];
      const sides = dir > 0 ? [[right, 'start', x1 + 23], [left, 'end', x1 - 23]] : [[left, 'end', x1 - 23], [right, 'start', x1 + 23]];
      const side = sides.find(([span]) => free(span));
      if (side) {
        V.label.setAttribute('x', side[2].toFixed(1)); V.label.setAttribute('y', (y + 5).toFixed(1));
        V.label.setAttribute('text-anchor', side[1]);
      } else {
        V.label.setAttribute('x', x1.toFixed(1)); V.label.setAttribute('y', (y - 14).toFixed(1));
        V.label.setAttribute('text-anchor', 'middle');
      }
      setText(V.label, 'reassigned!');
      V.label.setAttribute('class', 'vlabel vlabel-moved');
      for (const e of [V.ghost, V.line, V.head]) op(e, 1);
    } else {
      for (const e of [V.ghost, V.line, V.head]) op(e, 0);
      V.label.setAttribute('x', (chipX(v.goes, d.state) + (d.state === 'primary' ? -6 : 6)).toFixed(1));
      V.label.setAttribute('y', (y - 14).toFixed(1));
      V.label.setAttribute('text-anchor', 'middle');
      setText(V.label, 'stays put!');
      V.label.setAttribute('class', 'vlabel vlabel-stays');
    }
  }

  // ---- the moves: on the board, and each node's counts below ----

  _buildMoves(g) {
    const M = { g: el('g', { opacity: 0 }, g), cols: {} };
    M.title = txt(M.g, BOARD.x0, STRIP.titleY, '', 'ptitle');
    M.note = txt(M.g, BOARD.x0, STRIP.titleY + 26, '', 'pnote');
    M.axis = el('line', { x1: BOARD.col0, y1: STRIP.zeroY, x2: BOARD.x1, y2: STRIP.zeroY, class: 'paxis' }, M.g);
    for (const n of NODES) {
      const x = colX(n);
      const cg = el('g', {}, M.g);
      M.cols[n] = {
        g: cg,
        add: el('rect', { x: x - 18, width: 16, y: STRIP.zeroY, height: 0, class: 'mbar-add' }, cg),
        del: el('rect', { x: x + 2, width: 16, y: STRIP.zeroY, height: 0, class: 'mbar-del' }, cg),
        label: txt(cg, x, STRIP.labelY, '', 'pscore', 'middle'),
      };
    }
    const ky = STRIP.labelY + 42;
    el('rect', { x: BOARD.x0, y: ky - 9, width: 14, height: 10, class: 'mbar-add' }, M.g);
    txt(M.g, BOARD.x0 + 20, ky, 'copies built on it (add)', 'pkey');
    el('rect', { x: BOARD.x0 + 220, y: ky - 9, width: 14, height: 10, class: 'mbar-del' }, M.g);
    txt(M.g, BOARD.x0 + 240, ky, 'copies deleted from it (del)', 'pkey');
    return M;
  }

  // The moves from frame f's scenario's map before to f's: per chip,
  // built or deleted.
  static movesOf(f) {
    const scn = SCENARIOS[f.scenario];
    const has = (b, p, s, n) => b[p][s].includes(n);
    const built = [], deleted = [];
    for (const p of PARTITIONS) for (const s of STATES) {
      for (const n of f.board[p][s]) if (!has(scn.prev, p, s, n)) built.push([p, s, n]);
      for (const n of scn.prev[p][s]) if (!has(f.board, p, s, n)) deleted.push([p, s, n]);
    }
    return { built, deleted };
  }

  _drawMoves(F, o) {
    const M = this.movesArea;
    op(M.g, o);
    const scn = SCENARIOS[F.scenario];
    const { built, deleted } = Diagram.movesOf(F);
    // (a copy moving from one node to another in the same state is two
    // moves, an add and a del, as CalcPartitionMoves counts them; one
    // changing state on its node, a promote or demote, one)
    const moved = new Set([...built, ...deleted].map(([p]) => p));
    setText(M.title, `the moves: ${scn.title}`);
    setText(M.note, built.length + deleted.length ? `${built.length + deleted.length} moves: ${built.length} copies built, ${deleted.length} deleted, over ${moved.size} partitions` : 'none yet');
    M.axis.setAttribute('x2', (BOARD.x0 + (this.boardW || BOARD.x1 - BOARD.x0)).toFixed(1));
    for (const n of NODES) {
      const c = M.cols[n];
      const a = built.filter((x) => x[2] === n).length, d = deleted.filter((x) => x[2] === n).length;
      c.add.setAttribute('y', (STRIP.zeroY - a * MOVE_UNIT).toFixed(1)); c.add.setAttribute('height', (a * MOVE_UNIT).toFixed(1));
      c.del.setAttribute('y', (STRIP.zeroY - d * MOVE_UNIT).toFixed(1)); c.del.setAttribute('height', (d * MOVE_UNIT).toFixed(1));
      setText(c.label, a || d ? `+${a} −${d}` : '');
      op(c.g, scn.nodes.includes(n) ? 1 : 0);
    }
    // on the board: copies built ringed green, deleted ones left as ghosts
    const shown = new Set();
    const mark = ([p, s, n], kind) => {
      const key = `${kind}:${p}:${s}:${n}`;
      let m = this.moveMarks.get(key);
      if (!m) {
        m = el('rect', { x: chipX(n, s) - 21, y: rowY(p) - 16, width: 42, height: 32, rx: 9, class: `mmark-${kind}` }, this.movesOnBoard);
        this.moveMarks.set(key, m);
      }
      op(m, o);
      shown.add(key);
    };
    built.forEach((x) => mark(x, 'built'));
    deleted.forEach((x) => mark(x, 'deleted'));
    for (const [key, m] of this.moveMarks) if (!shown.has(key)) op(m, 0);
  }

  // ---- stickiness: moves for each setting, as bars ----

  _buildStick(g) {
    const S = { g: el('g', { opacity: 0 }, g) };
    txt(S.g, BOARD.x0, STRIP.titleY, 'adding d to the first map: how many moves', 'ptitle');
    el('line', { x1: BOARD.col0, y1: STRIP.zeroY, x2: BOARD.x1, y2: STRIP.zeroY, class: 'paxis' }, S.g);
    // (two short rows under the bars: each setting's stickiness, and its PartitionWeights)
    const labels = [['1.5', 'nil'], ['100000', 'nil'], ['100000', '{}'], ['0', '{}']];
    txt(S.g, BOARD.x0, STRIP.labelY - 6, 'stickiness', 'pkey');
    txt(S.g, BOARD.x0, STRIP.labelY + 10, 'PartitionWeights', 'pkey');
    STICKINESS.forEach((x, i) => {
      const cx = stickBarX(i), h = x.moves * STICK_UNIT;
      el('rect', { x: cx - 15, y: STRIP.zeroY - h, width: 30, height: h, class: 'pbar pbar-moves' }, S.g);
      txt(S.g, cx, STRIP.zeroY - h - 8, String(x.moves), 'pscore', 'middle');
      txt(S.g, cx, STRIP.labelY - 6, labels[i][0], 'pterm', 'middle');
      txt(S.g, cx, STRIP.labelY + 10, labels[i][1], 'pterm', 'middle');
    });
    return S;
  }

  // ---- server groups: the rule, in words, under the board's brackets ----

  _buildTree(g) {
    const T = { g: el('g', { opacity: 0 }, g) };
    txt(T.g, BOARD.x0, STRIP.titleY, 'server groups, to blance: each node\'s parent', 'ptitle');
    const lines = [
      ['a, b → g1;  c, d → g2;  g1, g2 → dc', 'pnote'],
      ['a rule for replicas: include level 2, exclude level 1', 'pnote'],
      ['from a: up 2 levels, to dc: a, b, c, d', 'pterm'],
      ['minus up 1 level, to g1: a, b', 'pterm'],
      ['= c, d: the other group', 'pterm pterm-strong'],
    ];
    lines.forEach(([t, cls], i) => txt(T.g, BOARD.x0, STRIP.titleY + 34 + i * 26, t, cls));
    return T;
  }

  // ---- arrows: where each term comes from ----

  _arc(key, from, to, bow, cls, width = 1.8) {
    let a = this.arcs.get(key);
    if (!a) {
      const [x0, y0] = from, [x1, y1] = to;
      const d = `M${x0},${y0} C${x0 + bow},${y0 + (y1 - y0) * 0.35} ${x1 + bow},${y1 - (y1 - y0) * 0.35} ${x1},${y1}`;
      // (a halo under it, in the background's color, so it shows even
      // over a bar of its own color)
      const halo = el('path', { d, class: 'sarc-halo', 'stroke-width': (width + 2.6).toFixed(2) }, this.arcG);
      const path = el('path', { d, class: `sarc ${cls}`, 'stroke-width': width.toFixed(2) }, this.arcG);
      // a triangle, pointing along the path (see _drawArcs)
      // (as big as the arrow is thick)
      const hl = 6 + 1.6 * width, hw = 3 + 0.9 * width;
      const head = el('path', { d: `M0,0 L${-hl},${-hw} L${-hl},${hw} Z`, class: `sarc-head ${cls}` }, this.arcG);
      // (styled as the part of the bar it adds to: solid for the count
      // and the tie-breaker, dashed for the hatched spread, the dashed
      // stickiness line, and the pick)
      a = { halo, path, head, len: path.getTotalLength(), solid: /sarc-(count|fill)/.test(cls) };
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
      const L = pickOf(d);
      const at = (n, term) => d.seq.findIndex((x) => x.node === n && x.term === term);
      for (const n of NODES) {
        const c = d.scored.find((x) => x.node === n);
        if (!c) continue;
        const b = Diagram.barAt(d, L, n);
        const w = c.weight, np = PARTITIONS.length;
        const chipAt = ([p, nn, st]) => [chipX(nn, st), rowY(p) + 12];
        // each lands on the top of the bar as it is when it arrives
        const cn = src[n].count.length, sn = src[n].spread.length, fn = src[n].fill.length;
        // (each with what it adds to the score, for its thickness; and,
        // counter-clockwise, every arrow down bows west, as the pick's
        // up bows east, by more for each so they don't overlap)
        src[n].count.forEach((ch, i) => stageArcs.push([at(n, 'count'), i, cn, `c:${ch}`, chipAt(ch), [colX(n), scoreY(i / w) - 3], -44 - 12 * i, `sarc-count sarc-${d.state}`, 1 / w]));
        src[n].spread.forEach((ch, i) => stageArcs.push([at(n, 'spread'), i, sn, `s:${n}:${ch}`, chipAt(ch), [colX(n), scoreY(b.count + i / np / w) - 3], -38 - 10 * i, 'sarc-spread', 1 / np / w]));
        src[n].fill.forEach((ch, i) => stageArcs.push([at(n, 'fill'), i, fn, `f:${ch}`, chipAt(ch), [colX(n), scoreY(b.spread) - 3], -30 - 8 * i, 'sarc-fill', 0.001 / np / w]));
        src[n].sticky.forEach((ch) => stageArcs.push([at(n, 'sticky'), 0, 1, `k:${ch}`, chipAt(ch), [colX(n) + W / 2 + 6, scoreY(b.fill) - 2], -56, 'sarc-sticky', c.currentFactor]));
      }
      // pick: from the winner's bar up to where its chip goes
      const wn = d.chosen[0], wb = Diagram.barAt(d, L, wn);
      stageArcs.push([L, -1, 1, `p:${d.partition}:${wn}`, [colX(wn), scoreY(Math.max(wb.fillShown, wb.score, 0.3)) - 12], [chipX(wn, d.state), rowY(d.partition) + 14], 40, `sarc-pick pick-${d.state}`, 1]);
      for (const [j, i, n, key0, from, to, bow, cls, adds] of stageArcs) {
        if (j < 0) continue;
        const key = `${d.k}:${key0}`;
        const u = through(s, j);
        // its flight: the ith of n, one at a time (the pick's, after the ring)
        const t = i < 0 ? within(u, PICK.flight) : flight(u, i, n);
        // (they stay while their stage is settled, and fade in the next)
        const fade = s <= j ? 1 : clamp01(1 - (s - j) * 2);
        if (t <= 0.001 || fade <= 0.001) continue;
        const a = this._arc(key, from, to, bow, cls, arcWidth(adds));
        // drawn up to its head
        a.path.setAttribute('stroke-dasharray', a.solid ? `${(a.len * t).toFixed(1)} ${(a.len + 10).toFixed(1)}` : dashesTo(a.len * t, a.len));
        a.halo.setAttribute('stroke-dasharray', `${(a.len * t).toFixed(1)} ${(a.len + 10).toFixed(1)}`);
        const h = a.path.getPointAtLength(a.len * t);
        const b = a.path.getPointAtLength(Math.max(0, a.len * t - 2));
        const angle = Math.atan2(h.y - b.y, h.x - b.x) * 180 / Math.PI;
        a.head.setAttribute('transform', `translate(${h.x.toFixed(1)} ${h.y.toFixed(1)}) rotate(${angle.toFixed(1)})`);
        // once it lands and its part has grown, it's absorbed: its head
        // goes, and its line stays only as a faint trace of the source
        const absorbed = i < 0 ? 0 : grown(u, i, n);
        op(a.path, o * fade * (1 - 0.75 * absorbed)); op(a.halo, o * fade * (1 - 0.75 * absorbed));
        op(a.head, o * fade * (1 - absorbed));
        shown.add(key);
      }
    }
    for (const [key, a] of this.arcs) if (!shown.has(key)) { op(a.path, 0); op(a.head, 0); op(a.halo, 0); }
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
    const sameD = FA.decision && FA.decision === FB.decision;
    const stageOf = (f) => f.stage ?? (f.decision ? pickOf(f.decision) : 0);
    this._drawBoard(FA, FB, q, sameD ? lerp(stageOf(FA), stageOf(FB), q) : null);
    this._drawVerdict(FA, FB, q, sameD ? lerp(stageOf(FA), stageOf(FB), q) : null);
    // what the area under the board shows: one fades out as the next fades in
    const w = (k) => clamp01(kindA === k ? (kindB === k ? 1 : 1 - pq * 2) : kindB === k ? pq * 2 - 1 : 0);
    this._drawMoves(pq < 0.5 ? PA : PB, w('moves'));
    op(this.stickArea.g, w('stick'));
    op(this.treeArea.g, w('tree'));
    const so = w('score');
    op(this.strip.g, so);
    this._drawStrip(FA, FB, q);
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
    if (id === 'deciding') return d ? { p: [BOARD.x0 + 4, rowY(d.partition)], visible: true } : { p: [0, 0], visible: false };
    if (id === 'chosen') return d ? { p: [chipX(d.chosen[0], d.state) - 20, rowY(d.partition)], visible: true } : { p: [0, 0], visible: false };
    const a = ANCHORS[id];
    if (!a) return null;
    const panelOf = { moves: 'moves', stick: 'stick', tree: 'tree', scores: 'score' };
    if (id === 'moves.total' || id === 'tree' || id.startsWith('stick.')) return { p: a.p, visible: cur.panel === panelOf[id.split('.')[0]] };
    const kind = id.split('.')[0];
    return { p: a.p, visible: kind in panelOf ? cur.panel === panelOf[kind] : true };
  }
}
