// Part of the 01-planning diagram (diagram.js), whose Diagram takes
// these methods. The score strip: each node's bar, term by term, and the pick.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { NODES, PARTITIONS, SCENARIOS, TERMS, sourcesOf } from './scenarios.js';
import { BOARD, STRIP, colX, scoreY } from './layout.js';
import { op, through, pickOf, grown, PICK, within, boardW, stageNote } from './diagram-shared.js';
import { Diagram } from './diagram.js';

export class StripPart {
  // ---- the score strip: built once, drawn each frame ----

  _buildStrip(g) {
    const S = { g: el('g', { opacity: 0 }, g) };
    const sg = S.g;
    // the title: "the planner's scores:", and after it, the decision in
    // hand ("scoring partition 0's primary"), in its state's color
    S.titlePre = txt(sg, BOARD.x0, STRIP.titleY, 'the planner\u2019s scores:', 'ptitle');
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

  // Whether a scored node is outside the decision's hierarchy rule (its
  // candidates, server groups say, go first: it can't win).
  static ruledOut(d, n) {
    return d.hierarchyPicks.length > 0 && !d.hierarchyPicks.some((h) => h.candidates.includes(n));
  }

  // What can't take it, and why.
  static whyNot(f, d, n) {
    if (d.scored.some((c) => c.node === n) && Diagram.ruledOut(d, n)) return 'same group';
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
        return ['', f.passDone ? `every partition's ${f.passDone} is assigned`
          : f.done ? `pass ${sc.iterations} changed nothing: done, in ${sc.iterations} passes`
          : f.k < 0 ? (sc.id === 'add' ? `nodes to add: ${sc.joining.join(', ')}` : sc.leaving.length ? `nodes to remove: ${sc.leaving.join(', ')}` : 'one decision at a time: a partition, a state')
            : `${sc.leaving.join(', ')} taken out of every partition`, ''];
      }
      // (the stage in progress)
      const x = d.seq[Math.min(d.seq.length - 1, Math.max(0, Math.ceil(s - 1e-9)))];
      return [`scoring partition ${d.partition}'s ${d.state}`, stageNote(d, x), d.state === 'replica' ? `its primary is on ${d.topPriorityNode}` : ''];
    };
    const [ta, na, ua] = text(FA, da, same ? sNow : sa), [tb, nb, ub] = text(FB, db, same ? sNow : sb);
    setText(S.titleA, ta); setText(S.titleB, tb);
    // (the suffix just after the title, in the decision's state's color)
    S.preW = S.preW || S.titlePre.getComputedTextLength();
    for (const [e, d] of [[S.titleA, da], [S.titleB, db]]) {
      e.setAttribute('x', (BOARD.x0 + S.preW + 7).toFixed(1));
      e.setAttribute('class', `ptitle${d ? ` psuffix-${d.state}` : ''}`);
    }
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
      // (in the state's color)
      const stState = st ? st.state : 'primary';
      col.sticky.setAttribute('class', `psticky pick-${stState}`);
      col.stickyLabel.setAttribute('class', `pterm pterm-sticky pick-${stState}`);
      // (a node outside the rule: scored, but it can't win)
      const outA = da && Diagram.ruledOut(da, n), outB = db && Diagram.ruledOut(db, n);
      const dim = same ? (outA ? 0.35 : 1) : lerp(outA ? 0.35 : 1, outB ? 0.35 : 1, q);
      for (const e of [col.count, col.spread, col.fill, col.line]) op(e, shown * dim);
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
    // (the candidates it compares: with a hierarchy rule, the rule's)
    const cands = d.scored.filter((c) => !Diagram.ruledOut(d, c.node));
    const tops = cands.map((c) => { const b = Diagram.barAt(d, L, c.node); return Math.max(b.fillShown, b.score, 0.3); });
    const xs = cands.map((c) => colX(c.node));
    const wide = [Math.min(...xs) - 34, scoreY(Math.max(...tops)) - 10, Math.max(...xs) + 34];
    const w = d.chosen[0], wt = tops[cands.findIndex((c) => c.node === w)];
    const narrow = [colX(w) - 34, scoreY(wt) - 10, colX(w) + 34];
    box.setAttribute('class', `swon pick-${d.state}`);
    const e = easeQuad(within(u, PICK.narrow));
    const [x0, y0, x1] = wide.map((v, k) => lerp(v, narrow[k], e));
    box.setAttribute('x', x0.toFixed(1)); box.setAttribute('y', y0.toFixed(1));
    box.setAttribute('width', (x1 - x0).toFixed(1));
    box.setAttribute('height', (STRIP.labelY + 22 - y0).toFixed(1));
    op(box, o * within(u, PICK.wide));
  }
}
