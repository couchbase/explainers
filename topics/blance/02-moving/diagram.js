// The 02-moving explainer's diagram, a triangle of panels. Top left, the
// partition map now, as a board at a moment of a run (a copy being
// built fills in place; a copy being deleted fades), each node's mover
// under its column. Top right, the map after: blance's next partition
// map, which slides out of the map now when the story gets to it. Bottom,
// each partition's moves, or the movers' timeline. Built once; main.js
// draws it at a run's time t, or partway between two runs.
//
// The map after has its own look (indigo: its frame, its nodes, a ring
// around each copy). As the moves land, the map now takes it on: a copy
// in its final place gets the ring, and a node whose column matches the
// map after gets its header; so the map now comes to look like the map
// after.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { NODES, PARTITIONS, STATES, RUNS, BEGIN, END, stateAt } from './scenarios.js';
import {
  CANVAS, BOARDS, BOARD, PANEL, TL, ANCHORS, ARROW, colX, rowY, chipX, HEAD_Y, MOVER_Y, PLAN_X, planY, laneY, timeX,
} from './layout.js';

const op = (e, o) => { e.setAttribute('opacity', clamp01(o).toFixed(3)); };
const seg = (q, a, b) => clamp01((q - a) / (b - a));
const moveLabel = (m) => (m.op === 'del' ? `del ${m.node}` : `${m.op} ${m.node} as ${m.state}`);
const CW = 30, CH = 22;

// Is a copy in its final place: in the map after, on that node, as that
// state?
const isFinal = (p, n, s) => END[p][s].includes(n);
// Does a node's column match the map after, on a board?
const nodeDone = (board, n) => PARTITIONS.every((p) => STATES.every((s) => board[p][s].includes(n) === END[p][s].includes(n)));
const movesTotal = Object.values(RUNS.one.plans).reduce((k, ms) => k + ms.length, 0);

export class Diagram {
  constructor(svg) {
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    const g = el('g', {}, svg);
    // the map after, under the map now: it slides out from under it
    this._after(g);
    this._now(g);
    this.panelG = el('g', {}, g);
    this.panels = {};
    for (const id of Object.keys(RUNS)) this.panels[`plans:${id}`] = this._plans(id);
    for (const id of Object.keys(RUNS)) this.panels[`timeline:${id}`] = this._timeline(id);
    this.target = el('circle', { r: 13, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this.cur = null;
  }

  // ---- a board's frame: its rows and columns ----

  _frame(g, B, cls, extra = 0) {
    el('rect', { x: B.x0 - 14, y: B.titleY - 28, width: B.x1 - B.x0 + 34, height: B.y1 - B.titleY + 40 + extra, rx: 12, class: `bframe ${cls}` }, g);
    for (const p of PARTITIONS) {
      const y = rowY(p, B);
      if (PARTITIONS.indexOf(p) % 2 === 0) el('rect', { x: B.x0, y: y - B.rowH / 2, width: B.x1 - B.x0 + 6, height: B.rowH, class: 'brow' }, g);
      txt(g, B.labelX, y + 5, `partition ${p}`, 'brow-label');
    }
    for (const n of NODES) {
      const x = colX(n, B);
      el('line', { x1: x - B.colW / 2, y1: B.y0, x2: x - B.colW / 2, y2: B.y1, class: 'bcol-line' }, g);
    }
  }

  // a copy, as a chip: its fill (clipped, to fill in as it's built), its
  // outline while it's built, and the after look's ring
  _chipEl(parent, state, id) {
    const c = el('g', { opacity: 0 }, parent);
    const ring = el('rect', { x: -CW / 2 - 4, y: -CH / 2 - 4, width: CW + 8, height: CH + 8, rx: 8, class: 'chip-ring', opacity: 0 }, c);
    const clip = el('clipPath', { id }, c);
    const clipRect = el('rect', { x: -CW / 2, y: -CH / 2, width: CW, height: CH }, clip);
    el('rect', { x: -CW / 2, y: -CH / 2, width: CW, height: CH, rx: 6, class: `chip chip-${state}`, 'clip-path': `url(#${id})` }, c);
    txt(c, 0, 5, state === 'primary' ? 'P' : 'R', `chip-label chip-label-${state}`, 'middle');
    const ghost = el('rect', { x: -CW / 2, y: -CH / 2, width: CW, height: CH, rx: 6, class: `chip-ghost chip-ghost-${state}`, opacity: 0 }, c);
    return { g: c, ring, clipRect, ghost };
  }

  // ---- the map after ----

  _after(g) {
    const B = BOARDS.after;
    // (it's drawn at its place; while it slides out, it's shifted left,
    // to the map now's)
    const ag = this.afterG = el('g', { opacity: 0 }, g);
    this._frame(ag, B, 'bframe-after');
    txt(ag, B.x0, B.titleY, 'the map after', 'btitle btitle-after');
    txt(ag, B.x1 + 10, B.titleY, "blance's next partition map", 'bsub', 'end');
    for (const n of NODES) txt(ag, colX(n, B), HEAD_Y, `node ${n}`, 'bnode bnode-after', 'middle');
    // as it slides out it shows the map now's copies, and then turns
    // into the map after's
    this.afterBegin = el('g', {}, ag);
    this.afterEnd = el('g', {}, ag);
    const place = (layer, map, ringed, tag) => {
      for (const p of PARTITIONS) for (const s of STATES) for (const n of map[p][s]) {
        const c = this._chipEl(layer, s, `after-${tag}-${p}-${n}`);
        c.g.setAttribute('transform', `translate(${chipX(n, s, B)} ${rowY(p, B)})`);
        op(c.g, 1);
        op(c.ring, ringed ? 1 : 0);
      }
    };
    place(this.afterBegin, BEGIN, false, 'b');
    place(this.afterEnd, END, true, 'e');
    // the arrow, from the map now to the map after
    this.arrow = el('g', { opacity: 0 }, g);
    el('line', { x1: ARROW.x0, y1: ARROW.y, x2: ARROW.x1 - 4, y2: ARROW.y, class: 'arrow' }, this.arrow);
    el('path', { d: `M${ARROW.x1 - 14},${ARROW.y - 8} L${ARROW.x1},${ARROW.y} L${ARROW.x1 - 14},${ARROW.y + 8}`, class: 'arrow' }, this.arrow);
    txt(this.arrow, (ARROW.x0 + ARROW.x1) / 2, ARROW.y - 14, `${movesTotal} moves`, 'arrow-label', 'middle');
  }

  // ---- the map now ----

  _now(g) {
    const B = BOARDS.now;
    // (its frame takes in the movers, under the board)
    this._frame(g, B, 'bframe-now', MOVER_Y - B.y1 + 8);
    txt(g, B.x0, B.titleY, 'the map now', 'btitle');
    this.subA = txt(g, B.x1 + 10, B.titleY, '', 'bsub', 'end');
    this.subB = txt(g, B.x1 + 10, B.titleY, '', 'bsub', 'end');
    this.noPrimary = {};
    for (const p of PARTITIONS) {
      this.noPrimary[p] = el('rect', { x: B.x0, y: rowY(p) - B.rowH / 2 + 2, width: B.x1 - B.x0 + 6, height: B.rowH - 4, rx: 6, class: 'bnoprimary', opacity: 0 }, g);
    }
    // each node's header: as now, and, once its column matches the map
    // after, as there
    this.heads = {};
    for (const n of NODES) {
      const x = colX(n);
      const plain = txt(g, x, HEAD_Y, `node ${n}`, 'bnode', 'middle');
      const after = txt(g, x, HEAD_Y, `node ${n}`, 'bnode bnode-after', 'middle');
      this.heads[n] = { plain, after };
    }
    this.dTag = txt(g, colX('d'), HEAD_Y + 15, 'joining', 'btag btag-joining', 'middle');
    this.dTagDone = txt(g, colX('d'), HEAD_Y + 15, 'joined', 'btag btag-after', 'middle');
    // the movers: what each is doing
    txt(g, B.labelX, MOVER_Y + 4, 'mover', 'brow-label');
    this.movers = {};
    for (const n of NODES) {
      const x = colX(n);
      const mg = el('g', {}, g);
      el('rect', { x: x - 36, y: MOVER_Y - 13, width: 72, height: 26, rx: 6, class: 'mover' }, mg);
      const fill = el('rect', { x: x - 36, y: MOVER_Y - 13, width: 0, height: 26, rx: 6, class: 'mover-fill' }, mg);
      const label = txt(mg, x, MOVER_Y + 4, '', 'mover-label', 'middle');
      this.movers[n] = { fill, label };
    }
    this.chipG = el('g', {}, g);
    this.chips = new Map();
  }

  _chip(key, state) {
    let c = this.chips.get(key);
    if (!c) {
      c = this._chipEl(this.chipG, state, `clip-${key.replace(/[^a-z0-9]/g, '_')}`);
      this.chips.set(key, c);
    }
    return c;
  }

  // The board for run r at time t: {key: {x, y, state, fill (0..1 of
  // a copy built), o (opacity), final (in its place in the map after)}}
  _chipsAt(runId, t) {
    const { board, flying } = stateAt(runId, t);
    const out = {};
    for (const p of PARTITIONS) for (const s of STATES) for (const n of board[p][s]) out[`${p}:${n}`] = { x: chipX(n, s), y: rowY(p), state: s, fill: 1, o: 1, final: isFinal(p, n, s) ? 1 : 0 };
    for (const f of flying) {
      const k = `${f.p}:${f.node}`;
      if (f.op === 'add') out[k] = { x: chipX(f.node, f.state), y: rowY(f.p), state: f.state, fill: f.progress, o: 1, final: 0 };
      else if (f.op === 'del' && out[k]) out[k] = { ...out[k], o: 1 - 0.75 * f.progress, final: 0 };
    }
    return out;
  }

  // (look: how much the map after's look shows on the map now, 0..1:
  // none until the map after has split off)
  _drawBoard(A, B, q, look = 1) {
    const ca = this._chipsAt(A.run, A.t), cb = this._chipsAt(B.run, B.t);
    const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
    for (const k of keys) {
      const a = ca[k], b = cb[k];
      const s = (b || a).state;
      const c = this._chip(`${k}:${s}`, s);
      const x = a && b ? lerp(a.x, b.x, q) : (a || b).x, y = (a || b).y;
      const o = lerp(a ? a.o : 0, b ? b.o : 0, q);
      const fill = lerp(a ? a.fill : 0, b ? b.fill : 0, q);
      c.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y})`);
      op(c.g, o);
      c.clipRect.setAttribute('width', (CW * fill).toFixed(1));
      op(c.ghost, fill < 0.999 ? 1 : 0);
      op(c.ring, look * lerp(a ? a.final : 0, b ? b.final : 0, q));
    }
    for (const [k, c] of this.chips) if (!keys.has(k.split(':').slice(0, 2).join(':'))) op(c.g, 0);
    // stale chips of another state on the same cell
    for (const [k, c] of this.chips) {
      const [p, n, s] = k.split(':');
      const want = (cb[`${p}:${n}`] || ca[`${p}:${n}`]);
      if (!want || want.state !== s) op(c.g, 0);
    }
    // partitions with no primary
    const sa = stateAt(A.run, A.t).board, sb = stateAt(B.run, B.t).board;
    for (const p of PARTITIONS) op(this.noPrimary[p], lerp(sa[p].primary.length ? 0 : 1, sb[p].primary.length ? 0 : 1, q));
    // the nodes: each takes on the map after's look once its column
    // matches it
    for (const n of NODES) {
      const d = look * lerp(nodeDone(sa, n) ? 1 : 0, nodeDone(sb, n) ? 1 : 0, q);
      op(this.heads[n].plain, 1 - d);
      op(this.heads[n].after, d);
      if (n === 'd') { op(this.dTag, 1 - d); op(this.dTagDone, d); }
    }
    // movers
    const fa = stateAt(A.run, A.t).flying, fb = stateAt(B.run, B.t).flying;
    for (const n of NODES) {
      const m = this.movers[n];
      const xa = fa.filter((f) => f.node === n), xb = fb.filter((f) => f.node === n);
      const cur = q < 0.5 ? xa : xb;
      setText(m.label, cur.length ? `${cur[0].op} ${cur.map((f) => f.p).join(',')}` : 'idle');
      const pa = xa.length ? xa[0].progress : 0, pb = xb.length ? xb[0].progress : 0;
      m.fill.setAttribute('width', (72 * (xa.length && xb.length && xa[0].batch === xb[0].batch ? lerp(pa, pb, q) : q < 0.5 ? pa : pb)).toFixed(1));
    }
    const ra = RUNS[A.run], rb = RUNS[B.run];
    setText(this.subA, ra.title);
    setText(this.subB, rb.title);
    op(this.subA, ra === rb ? 1 : 1 - q);
    op(this.subB, ra === rb ? 0 : q);
  }

  // The map after splitting off the map now: s, 0 (not yet) to 1 (in
  // its place). It slides out from under the map now, showing the map
  // now's copies; then its copies turn into the map after's; then the
  // arrow between them.
  _drawSplit(s) {
    const slide = easeQuad(seg(s, 0, 0.5)), turn = easeQuad(seg(s, 0.5, 0.85));
    const dx = (BOARDS.now.x0 - BOARDS.after.x0) * (1 - slide);
    this.afterG.setAttribute('transform', `translate(${dx.toFixed(1)} 0)`);
    op(this.afterG, s > 0 ? 1 : 0);
    op(this.afterBegin, 1 - turn);
    op(this.afterEnd, turn);
    op(this.arrow, seg(s, 0.85, 1));
  }

  // ---- the panel ----

  _panelFrame(g, title) {
    el('rect', { x: PANEL.x0, y: PANEL.y0, width: PANEL.x1 - PANEL.x0, height: PANEL.y1 - PANEL.y0, rx: 10, class: 'panel' }, g);
    txt(g, PANEL.x0 + 20, PANEL.titleY, title, 'ptitle');
  }

  _plans(id) {
    const r = RUNS[id];
    const g = el('g', { opacity: 0 }, this.panelG);
    this._panelFrame(g, 'each partition\'s moves (CalcPartitionMoves)');
    const rows = {};
    for (const p of PARTITIONS) {
      const y = planY(p);
      txt(g, PANEL.x0 + 20, y + 5, `partition ${p}`, r.plans[p].length ? 'prow-node' : 'prow-node prow-out');
      if (!r.plans[p].length) { txt(g, PLAN_X, y + 5, 'stays', 'pterm'); continue; }
      let x = PLAN_X;
      rows[p] = r.plans[p].map((m, i) => {
        const label = moveLabel(m);
        const w = label.length * 7.4 + 18;
        if (i) txt(g, x - 6, y + 5, '→', 'pterm', 'end');
        const box = el('rect', { x, y: y - 11, width: w, height: 22, rx: 11, class: `pmove pmove-${m.op}` }, g);
        const prog = el('rect', { x, y: y - 11, width: 0, height: 22, rx: 11, class: `pmove-prog pmove-prog-${m.op}` }, g);
        txt(g, x + w / 2, y + 5, label, 'pmove-label', 'middle');
        const item = { box, prog, x, w };
        x += w + 18;
        return item;
      });
    }
    txt(g, PANEL.x0 + 20, PANEL.y1 - 22, `${Object.values(r.plans).reduce((n, ms) => n + ms.length, 0)} moves, over ${PARTITIONS.filter((p) => r.plans[p].length).length} partitions`, 'ptotal');
    return { g, rows, run: id };
  }

  _timeline(id) {
    const r = RUNS[id];
    const g = el('g', { opacity: 0 }, this.panelG);
    this._panelFrame(g, `the movers, over time: ${r.title}`);
    txt(g, PANEL.x0 + 20, TL.ctlY + 4, 'controller', 'prow-node');
    el('line', { x1: TL.x0, y1: TL.ctlY, x2: TL.x1, y2: TL.ctlY, class: 'pgrid' }, g);
    const rounds = r.rounds.map((rd) => el('circle', { cx: timeX(rd.t), cy: TL.ctlY, r: 4, class: 'tround', opacity: 0 }, g));
    for (const n of NODES) {
      const y = laneY(n);
      txt(g, PANEL.x0 + 20, y + 4, `node ${n}`, 'prow-node');
      el('line', { x1: TL.x0, y1: y + 18, x2: TL.x1, y2: y + 18, class: 'pgrid' }, g);
    }
    for (let t = 0; t <= TL.maxT; t += 200) {
      el('line', { x1: timeX(t), y1: TL.axisY - 4, x2: timeX(t), y2: TL.axisY + 4, class: 'paxis' }, g);
      txt(g, timeX(t), TL.axisY + 18, `${t}`, 'paxis-label', 'middle');
    }
    txt(g, TL.x1, TL.axisY + 34, 'ms', 'paxis-label', 'end');
    el('line', { x1: TL.x0, y1: TL.axisY, x2: TL.x1, y2: TL.axisY, class: 'paxis' }, g);
    const labelEnds = {}; // per lane, where its labels above end, by line
    const bars = r.batches.map((b) => {
      const y = laneY(b.node);
      const bar = el('rect', { x: timeX(b.start), y: y - 12, width: 0, height: 24, rx: 4, class: `tbar tbar-${b.ops[0]}` }, g);
      // its label inside it if it fits (11px mono: 6.6px a char), else above
      const text = `${b.ops[0]} ${b.partitions.join(',')}`;
      const fits = timeX(b.end) - timeX(b.start) >= text.length * 6.6 + 10;
      // (above, on the first line it doesn't overlap a label on)
      const ends = (labelEnds[b.node] ||= [-1e9, -1e9]);
      const line = fits ? -1 : ends[0] < timeX(b.start) ? 0 : 1;
      if (line >= 0) ends[line] = timeX(b.start) + text.length * 6.6 + 4;
      const label = txt(g, timeX(b.start) + (fits ? 6 : 0), fits ? y + 5 : y - 16 - 12 * line, text, 'tbar-label');
      op(label, 0);
      return { b, bar, label };
    });
    const now = el('line', { x1: TL.x0, y1: TL.ctlY - 16, x2: TL.x0, y2: TL.axisY, class: 'tnow' }, g);
    const nowLabel = txt(g, TL.x0, TL.ctlY - 22, '', 'tnow-label', 'middle');
    const endLabel = txt(g, timeX(r.end) + 6, TL.axisY - 12, `done: ${r.end} ms`, 'ptotal');
    return { g, run: id, rounds, bars, now, nowLabel, endLabel };
  }

  _drawPlans(P, t) {
    const { flying, done } = stateAt(P.run, t);
    for (const [p, items] of Object.entries(P.rows)) {
      items.forEach((it, i) => {
        const f = flying.find((x) => x.p === p) && i === done[p] ? flying.find((x) => x.p === p) : null;
        const frac = i < done[p] ? 1 : f ? f.progress : 0;
        it.prog.setAttribute('width', (it.w * frac).toFixed(1));
        it.box.setAttribute('class', `pmove pmove-${RUNS[P.run].plans[p][i].op}${i < done[p] ? ' pmove-done' : f ? ' pmove-flying' : ''}`);
      });
    }
  }

  _drawTimeline(T, t) {
    const r = RUNS[T.run];
    T.rounds.forEach((c, i) => op(c, r.rounds[i].t <= t ? 1 : 0));
    for (const { b, bar, label } of T.bars) {
      const w = Math.max(0, timeX(Math.min(t, b.end)) - timeX(b.start));
      bar.setAttribute('width', w.toFixed(1));
      op(label, t >= b.end ? 1 : t > b.start ? 0.6 : 0);
    }
    const x = timeX(t);
    T.now.setAttribute('x1', x.toFixed(1));
    T.now.setAttribute('x2', x.toFixed(1));
    T.nowLabel.setAttribute('x', x.toFixed(1));
    setText(T.nowLabel, `${Math.round(t)} ms`);
    op(T.endLabel, t >= r.end ? 1 : 0);
  }

  _drawPanel(A, B, q, pq) {
    const ka = A.panel === 'none' ? null : `${A.panel}:${A.run}`, kb = B.panel === 'none' ? null : `${B.panel}:${B.run}`;
    for (const [key, P] of Object.entries(this.panels)) {
      let o = 0;
      if (ka === kb && key === ka) o = 1;
      else {
        if (key === ka) o = Math.max(o, 1 - pq * 2);
        if (key === kb) o = Math.max(o, pq * 2 - 1);
      }
      op(P.g, o);
      P.g.style.display = o > 0.001 ? '' : 'none';
      if (o <= 0.001) continue;
      // its run's time: between A's and B's, when they're the same run
      const t = A.run === B.run ? lerp(A.t, B.t, q) : P.run === B.run ? B.t : A.t;
      if (key.startsWith('plans')) this._drawPlans(P, t); else this._drawTimeline(P, t);
    }
  }

  // ---- what main.js calls ----

  // Scenes A to B (story.js sceneAt), partway: q for the board and time,
  // pq for the panel and the split.
  draw(A, B, q, pq) {
    const t = A.run === B.run ? lerp(A.t, B.t, q) : null;
    const two = (s) => (s.split === 'two' ? 1 : 0);
    const split = A.split === B.split ? two(B) : lerp(two(A), two(B), pq);
    // (the map after's look comes to the map now as the map after's own
    // copies turn into its)
    const look = easeQuad(seg(split, 0.6, 1));
    if (t !== null) this._drawBoard({ run: A.run, t }, { run: A.run, t }, 0, look);
    else this._drawBoard(A, B, q, look);
    this._drawSplit(split);
    this._drawPanel(A, B, q, pq);
    this.cur = { run: q < 0.5 ? A.run : B.run, t: t ?? (q < 0.5 ? A.t : B.t), panel: pq < 0.5 ? A.panel : B.panel, split: pq < 0.5 ? A.split : B.split };
  }

  setTarget(p) {
    if (!p) { this.target.setAttribute('cx', -9999); return; }
    this.target.setAttribute('cx', p[0]);
    this.target.setAttribute('cy', p[1]);
  }

  anchor(id) {
    const cur = this.cur;
    if (!cur) return null;
    if (id === 'now') return { p: [timeX(cur.t), TL.ctlY - 16], visible: cur.panel === 'timeline' };
    const a = ANCHORS[id];
    if (!a) return null;
    const kind = id.split('.')[0];
    const visible = kind === 'plan' ? cur.panel === 'plans' : kind === 'lane' || id === 'controller' ? cur.panel === 'timeline' : kind === 'panel' ? cur.panel !== 'none' : kind === 'after' ? cur.split === 'two' : true;
    return { p: a.p, visible };
  }
}

