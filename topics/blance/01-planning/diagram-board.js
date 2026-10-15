// Part of the 01-planning diagram (diagram.js), whose Diagram takes
// these methods. The board: rows, columns, chips, the row being decided, the leaving
// node's ghosts, the greyed column, and the pick's verdict.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01 } from '../../../engine/js/ui/util/anim.js';
import { NODES, PARTITIONS, STATES, SCENARIOS, tally } from './scenarios.js';
import { BOARD, STRIP, SEP_Y, colX, rowY, chipX, HEAD_Y, GROUP_Y, TALLY_Y } from './layout.js';
import { op, chipsOf, nodeStatus, through, pickOf, PICK, within, boardW } from './diagram-shared.js';
import { Diagram } from './diagram.js';

export class BoardPart {
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
    // the phase of the plan, in the board's top-left corner: "assigning
    // primaries", then "assigning replicas", in each state's color
    this.phase = Object.fromEntries(STATES.map((s) => [s, txt(g, BOARD.labelX - 22, HEAD_Y, `assigning ${s === 'primary' ? 'primaries' : 'replicas'}`, `bphase bphase-${s}`)]));
    for (const e of Object.values(this.phase)) op(e, 0);
    // rows (as wide as the scenario's nodes)
    // (the stripes stay put; the labels move with their rows, and under
    // each, while a pass is on, its group in the pass's sort)
    this.rowRects = [];
    this.rowLabels = {};
    // (all the stripes first, so none is over a label that moves onto it)
    for (const p of PARTITIONS) {
      if (PARTITIONS.indexOf(p) % 2 === 0) this.rowRects.push(el('rect', { x: BOARD.x0, y: rowY(p) - BOARD.rowH / 2, width: BOARD.x1 - BOARD.x0 + 10, height: BOARD.rowH, class: 'brow' }, g));
    }
    for (const p of PARTITIONS) {
      const lg = el('g', {}, g);
      txt(lg, BOARD.labelX, 5, `partition ${p}`, 'brow-label');
      // (its group in a sort: diagram-sort.js shows it)
      const tg = el('g', { opacity: 0 }, lg);
      const tag = { g: tg, num: txt(tg, BOARD.labelX - 16, 19, '', 'bsort-num'), text: txt(tg, BOARD.labelX, 19, '', 'bsort-tag') };
      this.rowLabels[p] = { g: lg, tag };
    }
    // the board, apart from the area under it
    this.sep = el('line', { x1: BOARD.x0, y1: SEP_Y, x2: BOARD.x1 + 10, y2: SEP_Y, class: 'bsep' }, g);
    this.band = el('rect', { x: BOARD.x0, y: 0, width: BOARD.x1 - BOARD.x0 + 10, height: BOARD.rowH, rx: 6, class: 'bband', opacity: 0 }, g);
    // what the outlined row is about, to its right, following it down
    this.bandLabel = el('g', { opacity: 0 }, g);
    this.bandLine1 = txt(this.bandLabel, 0, -3, '', 'bband-label');
    this.bandLine2 = txt(this.bandLabel, 0, 12, '', 'bband-label');
    // columns
    this.cols = {};
    this.present = {};
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
    // (a leaving node's copies, as ghosts: under the chips)
    this.leftG = el('g', {}, g);
    this.leftGhosts = new Map();
    this.chipG = el('g', {}, g);
    this.chips = new Map();
    this.chosenRing = el('rect', { width: 40, height: 28, rx: 8, class: 'bchosen', opacity: 0 }, g);
    // what the pick did to a partition that had a place: reassigned (a
    // ghost where it was, an arrow across to where it goes) or stays put
    const vg = el('g', { opacity: 0 }, g);
    this.verdict = {
      g: vg,
      ghost: el('rect', { width: 34, height: 24, rx: 6, class: 'vghost' }, vg),
      ghostLabel: txt(vg, 0, 0, '', 'vghost-label', 'middle'),
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

  // A leaving node's copies, left as ghosts where they were: from when
  // the planner takes the node out of every partition until its column
  // goes, so the partition map before stays in view.
  _drawLeft(FA, FB, q) {
    const on = (f) => { const s = SCENARIOS[f.scenario]; return s.leaving.length && f.k >= 0 ? s : null; };
    const sa = on(FA), sb = on(FB), scn = sb || sa;
    const o = lerp(sa ? 1 : 0, sb ? 1 : 0, q);
    const shown = new Set();
    if (scn && o > 0) for (const { key, p, state, node } of chipsOf(scn.prev)) {
      if (!scn.leaving.includes(node)) continue;
      const k = `${scn.id}:${key}`;
      let gh = this.leftGhosts.get(k);
      if (!gh) {
        gh = el('g', {}, this.leftG);
        el('rect', { x: -21, y: -16, width: 42, height: 32, rx: 9, class: 'mmark-deleted' }, gh);
        txt(gh, 0, 5, state === 'primary' ? 'P' : 'R', 'lghost-label', 'middle');
        this.leftGhosts.set(k, gh);
      }
      gh.setAttribute('transform', `translate(${chipX(node, state).toFixed(1)} ${rowY(p)})`);
      op(gh, o * (this.present[node] ?? 1));
      shown.add(k);
    }
    for (const [k, gh] of this.leftGhosts) if (!shown.has(k)) op(gh, 0);
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

    // the phase: a state's, from its pass's sort until its pass is done
    const phaseOf = (f) => (f.pass ? f.pass.state : f.passDone || null);
    for (const s of STATES) op(this.phase[s], lerp(phaseOf(FA) === s ? 1 : 0, phaseOf(FB) === s ? 1 : 0, q));
    // the rows' labels, where their rows are now
    for (const p of PARTITIONS) this.rowLabels[p].g.setAttribute('transform', `translate(0 ${rowY(p).toFixed(1)})`);

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
      // (in the color of the state being assigned)
      this.band.setAttribute('class', `bband pick-${d.state}`);
      for (const e of [this.bandLine1, this.bandLine2]) e.setAttribute('class', `bband-label pick-${d.state}`);
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
      const qf = this.closing ? clamp01(q * 2) : q;
      op(col.g, lerp(dim(st(sa, FA)), dim(st(sb, FB)), qf));
      // (and how much it's in the cluster at all, for the moves)
      this.present[n] = lerp(st(sa, FA) === 'absent' ? 0 : 1, st(sb, FB) === 'absent' ? 0 : 1, qf);
      const tag = (x) => (x === 'gone' ? 'leaving' : x);
      for (const [k, e] of Object.entries(col.tags)) op(e, lerp(tag(st(sa, FA)) === k ? 1 : 0, tag(st(sb, FB)) === k ? 1 : 0, qf));
      const w = (t, s) => t[n][s] * 14;
      col.pBar.setAttribute('width', lerp(w(ta, 'primary'), w(tb, 'primary'), qc).toFixed(1));
      col.rBar.setAttribute('width', lerp(w(ta, 'replica'), w(tb, 'replica'), qc).toFixed(1));
      const t = qc < 0.5 ? ta : tb;
      setText(col.tText, `${t[n].primary} P · ${t[n].replica} R`);
    }
    op(this.groupG, lerp(sa.groups ? 1 : 0, sb.groups ? 1 : 0, q));
    const w = lerp(boardW(sa, FA), boardW(sb, FB), q).toFixed(1);
    for (const r of this.rowRects) r.setAttribute('width', w);
    this.sep.setAttribute('x2', (BOARD.x0 + +w).toFixed(1));
    this.band.setAttribute('width', w);
    this.boardW = +w;
    // (the scenario's title; once the nodes removed have gone, none,
    // fading with their columns)
    const title = (s, f) => (f.departed ? '' : s.title);
    const tA = title(sa, FA), tB = title(sb, FB), qt = this.closing ? clamp01(q * 2) : q;
    setText(this.subA, tA);
    setText(this.subB, tB);
    op(this.subA, tA === tB ? 1 : 1 - qt);
    op(this.subB, tA === tB ? 0 : qt);
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
      V.ghostLabel.setAttribute('x', x0); V.ghostLabel.setAttribute('y', y + 5);
      V.ghostLabel.setAttribute('class', `vghost-label vghost-${d.state}`);
      setText(V.ghostLabel, d.state === 'primary' ? 'P' : 'R');
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
      V.label.setAttribute('class', `vlabel vlabel-moved pick-${d.state}`);
      V.line.setAttribute('class', `varrow pick-${d.state}`);
      V.head.setAttribute('class', `varrow-head pick-${d.state}`);
      for (const e of [V.ghost, V.ghostLabel, V.line, V.head]) op(e, 1);
    } else {
      for (const e of [V.ghost, V.ghostLabel, V.line, V.head]) op(e, 0);
      V.label.setAttribute('x', (chipX(v.goes, d.state) + (d.state === 'primary' ? -6 : 6)).toFixed(1));
      V.label.setAttribute('y', (y - 14).toFixed(1));
      V.label.setAttribute('text-anchor', 'middle');
      setText(V.label, 'stays put!');
      V.label.setAttribute('class', 'vlabel vlabel-stays');
    }
  }

  // ---- the primary's node, greyed out while its replica is scored ----

  _drawGreyed(FA, FB, q) {
    const on = (f, n) => (f.decision && Diagram.whyNot(f, f.decision, n) === 'its primary' ? 1 : 0);
    const top = HEAD_Y - 28;
    for (const n of NODES) {
      const r = this.greyed[n];
      const a = on(FA, n), b = on(FB, n);
      // (between decisions on the same node, it stays)
      op(r, a === b ? a : lerp(a, b, q));
      r.setAttribute('x', (colX(n) - BOARD.colW / 2 + 3).toFixed(1));
      r.setAttribute('y', top);
      r.setAttribute('width', BOARD.colW - 6);
      r.setAttribute('height', STRIP.labelY + 28 - top);
    }
  }
}
