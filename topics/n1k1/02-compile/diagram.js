// The 02-compile explainer's diagram: the plan; the filter's source,
// its lines marked by kind, turning line by line into intermed's
// version of it; then the Go the compiler emits for the plan, printed
// group by group as the compiler walks the plan, the filter's holes
// filled; and both engines' rows. Built once; main.js draws it partway
// between two neighboring states (states.js), which differ in one
// field.
//
// Colors (see ../README.md): blue, early-bound (run once, at setup);
// teal, late-bound (per row); grey, the interpreter's only; violet, a
// seam (a call to code from elsewhere, and the hole it leaves). In the
// emitted Go, a line's stripe is the operator that printed it: amber
// the project, teal the filter, violet the filter's expression, slate
// the scan.

import { svgEl as el, svgText as txt, setText, setCls } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import {
  CANVAS, PLAN, planY, CODE, srcRowY, emitRowY, CHAR, KEY, HELD, ROWS, FILTER, ITEMS, itemOn, slotOf, groupShown, ANCHORS,
} from './layout.js';
import { STATE, changed, KINDS, INTER } from './states.js';
import { COMPILE, HOLES } from '../lib/compile.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const at = (e, x, y) => e.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
const seg = (q, a, b) => clamp01((q - a) / (b - a));

// the plan's operators, top to bottom
const PLAN_OPS = [
  { id: 'project', title: 'project', params: 'id, customer, total' },
  { id: 'filter', title: 'filter', params: '200 < total' },
  { id: 'scan', title: 'scan', params: 'the 20 orders, inline' },
];
// which operator the compiler's at, as it prints each group
const AT_OP = { project: 'project', filter: 'filter', expr: 'filter', fuse: 'filter', scan: 'scan' };
const GROUP_ORDER = ['project', 'filter', 'expr', 'fuse', 'scan'];

// the summary's marks: what's baked into the code (the constant, the
// register, the paths), and the calls that are left per row
export const BAKED = /200|lzVals\[0\]|\[\]string\{"/;
export const CALLS = /^lzYieldVals\(lzValsScan\)$|^lzYieldValsOrig\(lzValsOut\)$/;

// how far a line slides as it goes or comes
const SLIDE = 40;
// the ball's x: in the gutter, just left of the code panel
const BALL_X = CODE.x - 12;
// a turning line's progress: line j of n, each in its own stretch of q
// (overlapping a little, so the eye's carried on to the next)
// (the first part of a line's stretch is the ball's, moving to it and
// settling; the line's change plays only after)
const BALL_SHARE = 0.25;
const turnAt = (q, j, n) => seg(q, (j + BALL_SHARE) / n, (j + 1) / n);

// An emit change's stretches of q: the hole going, the room made, the
// held code flying in, then each new line, printed in turn.
export function timeline(A, B, field) {
  const T = { leave: [0, 0], room: [0, 0], fly: [0, 0], entering: [], printAt: () => [0, 1] };
  if (field !== 'emit') return T;
  const up = A.emit < B.emit, [S0, S1] = up ? [A, B] : [B, A];
  T.entering = ITEMS.map((it, k) => k).filter((k) => itemOn(S1, ITEMS[k]) && !itemOn(S0, ITEMS[k]));
  const holes = ITEMS.some((it) => it.hole && itemOn(S0, it) && !itemOn(S1, it));
  const fusing = S1.emit >= 4 && S0.emit < 4;
  let t = 0;
  T.leave = holes ? [t, (t += 0.1)] : [t, t];
  T.room = [t, (t += 0.14)];
  T.fly = fusing ? [t, (t += 0.12)] : [t, t];
  const p0 = t + 0.04, n = Math.max(1, T.entering.length), w = (1 - p0) / n;
  T.printAt = (j) => [p0 + j * w, p0 + (j + 1) * w];
  if (!up) {
    // (going back: the same, played backwards)
    const f = (r) => [1 - r[1], 1 - r[0]];
    const pa = T.printAt;
    T.leave = f(T.leave); T.room = f(T.room); T.fly = f(T.fly); T.printAt = (j) => f(pa(j));
  }
  return T;
}

// How big a change is, for its share of the scroll: the lines it
// turns or prints, one at a time.
export function changeSize(A, B) {
  const field = changed(A, B)[0];
  if (field === 'inter') return FILTER.filter((r) => interLevel(r) === Math.max(A.inter, B.inter)).length * 0.8;
  if (field === 'emit') return 1 + timeline(A, B, field).entering.length * 0.14;
  return 1;
}

// A source line's level: when its text turns into intermed's (0: never).
const interLevel = (r) => {
  const k = INTER.findIndex((ks) => ks.includes(r.kind));
  if (k >= 0) return k + 1;
  return r.kind !== 'blank' && r.src.trim() !== r.inter.trim() ? INTER.length : 0;
};
// whether a line's kind is marked, in a state
const marked = (s, r) => KINDS.indexOf(r.kind) >= 0 && KINDS.indexOf(r.kind) < s.kinds;

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    const g = el('g', {}, svg);

    // the plan
    txt(g, PLAN.x, PLAN.y - 14, 'the plan', 'panel-title');
    this.ops = Object.fromEntries(PLAN_OPS.map((o, k) => {
      const og = el('g', {}, g);
      const box = el('rect', { x: PLAN.x, y: planY(k), width: PLAN.w, height: PLAN.h, rx: 8, class: 'op' }, og);
      txt(og, PLAN.x + 10, planY(k) + 22, o.title, 'op-title');
      txt(og, PLAN.x + 10, planY(k) + 40, o.params, 'op-params');
      if (k < 2) el('path', { d: `M${PLAN.x + PLAN.w / 2},${planY(k + 1) - 1} V${planY(k) + PLAN.h + 3}`, class: 'yield', 'marker-end': 'url(#n1k1c-arrow)' }, g);
      return [o.id, { g: og, box }];
    }));
    const defs = el('defs', {}, svg);
    const mk = el('marker', { id: 'n1k1c-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head' }, mk);

    // the kinds of line, a key
    this.key = KINDS.map((k, i) => {
      const kg = el('g', { opacity: 0 }, g);
      el('rect', { x: KEY.x, y: KEY.y + i * KEY.dy - 11, width: 14, height: 14, rx: 3, class: `kind-swatch kind-${k}` }, kg);
      txt(kg, KEY.x + 22, KEY.y + i * KEY.dy, { early: 'once, as the plan is set up', late: 'per row', hide: "the interpreter's only", captured: 'a seam: code from elsewhere' }[k], 'key-text');
      return kg;
    });

    // the code panel: the source, then intermed's
    this.src = el('g', { opacity: 0 }, g);
    el('rect', { x: CODE.x, y: CODE.y, width: CODE.w, height: srcRowY(FILTER.length) - CODE.y + 6, rx: 8, class: 'code' }, this.src);
    this.srcHead = [
      txt(this.src, CODE.x + 12, CODE.y + 20, 'engine/op_filter.go: the interpreter', 'code-head'),
      txt(this.src, CODE.x + 12, CODE.y + 20, 'intermed/generated_by_intermed_build.go: made by intermed_build', 'code-head inter'),
    ];
    this.srcRows = FILTER.map((r, i) => {
      const y = srcRowY(i);
      const rg = el('g', {}, this.src);
      const tint = el('rect', { x: CODE.x + 6, y: y - 10.5, width: CODE.w - 12, height: CODE.dy, rx: 2, class: `tint kind-${r.kind}`, opacity: 0 }, rg);
      // (its line number in op_filter.go: gone once it's intermed's line)
      const no = txt(rg, CODE.x + 30, y, String(r.n), 'line-no', 'end');
      // (where its new line waits, beside the old: just past its end,
      // or, if the two don't fit on one line, right-aligned on the
      // blank line above)
      const room = CODE.w - 48, gap = 6 * CHAR.src, ow = r.src.trimEnd().length * CHAR.src, nw = r.inter.length * CHAR.src;
      const wait = ow + gap + nw <= room ? [ow + gap, 0] : [Math.max(0, room - nw), -CODE.dy];
      return {
        r, tint, no, wait, level: interLevel(r),
        a: txt(rg, CODE.x + 38, y, r.src, `src-text kind-${r.kind}`),
        b: txt(rg, CODE.x + 38, y, r.inter, `src-text inter kind-${r.kind}`),
      };
    });

    // the emitted Go
    this.emit = el('g', { opacity: 0 }, g);
    this.emitBox = el('rect', { x: CODE.x, y: CODE.y, width: CODE.w, height: 100, rx: 8, class: 'code' }, this.emit);
    txt(this.emit, CODE.x + 12, CODE.y + 20, 'the compiled query: the Go the compiler prints', 'code-head');
    this.runHead = txt(this.emit, CODE.x + 12, 0, 'func Run(lzVars *base.Vars, lzYieldVals base.YieldVals, lzYieldErr base.YieldErr) {', 'emit-text frame');
    this.runTail = txt(this.emit, CODE.x + 12, 0, '}', 'emit-text frame');
    this.items = ITEMS.map((it) => {
      const ig = el('g', { opacity: 0 }, this.emit);
      if (it.hole) {
        el('rect', { x: CODE.x + 70, y: -10.5, width: 420, height: CODE.edy + 1, rx: 3, class: 'hole' }, ig);
        txt(ig, CODE.x + 80, 0, `⟨ ${HOLES[it.hole]} ⟩`, 'hole-text');
        return { it, g: ig };
      }
      // (in the summary: a mark on what's baked in, or a call that's left)
      const mark = BAKED.test(it.text) ? 'baked' : CALLS.test(it.text) ? 'call' : null;
      const m = mark && el('rect', { x: CODE.x + 20 + it.depth * 2 * CHAR.emit, y: -10.5, width: it.text.length * CHAR.emit + 12, height: CODE.edy, rx: 3, class: `mark mark-${mark}`, opacity: 0 }, ig);
      el('rect', { x: CODE.x + 8, y: -10, width: 4, height: CODE.edy, class: `stripe origin-${it.origin}` }, ig);
      const t = txt(ig, CODE.x + 26 + it.depth * 2 * CHAR.emit, 0, it.text, `emit-text${it.fold ? ' fold' : ''}`);
      return { it, g: ig, t, m };
    });
    // the project's per-row code, held till the filter's hole takes it
    this.held = el('g', { opacity: 0 }, g);
    el('rect', { x: 0, y: 0, width: HELD.w, height: HELD.h, rx: 8, class: 'held' }, this.held);
    txt(this.held, 10, 20, "the project's per-row code:", 'held-title');
    txt(this.held, 10, 38, 'captured as it was printed,', 'held-text');
    txt(this.held, 10, 54, 'waiting for a place', 'held-text');
    // the origins, a key
    this.originKey = el('g', { opacity: 0 }, g);
    ['project', 'filter', 'expr', 'scan'].forEach((o, i) => {
      el('rect', { x: KEY.x, y: KEY.y + i * KEY.dy - 11, width: 6, height: 14, class: `stripe origin-${o}` }, this.originKey);
      txt(this.originKey, KEY.x + 16, KEY.y + i * KEY.dy, { project: "the project's", filter: "the filter's", expr: "the filter's expression's", scan: "the scan's" }[o], 'key-text');
    });
    txt(this.originKey, KEY.x, KEY.y - 22, 'printed by:', 'panel-title');

    // both engines' rows
    this.rows = el('g', { opacity: 0 }, g);
    el('rect', { x: ROWS.x, y: ROWS.y, width: ROWS.w, height: ROWS.h, rx: 8, class: 'panel' }, this.rows);
    [['interpreted', COMPILE.interpreted], ['compiled', COMPILE.compiled]].forEach(([name, rows], k) => {
      const y = ROWS.y + 24 + k * 92;
      txt(this.rows, ROWS.x + 12, y, name, 'panel-title');
      rows.forEach((r, i) => txt(this.rows, ROWS.x + 12, y + 20 + i * 17, r, 'row-text'));
    });

    // the ball: the pen that's writing, to follow
    this.ball = el('g', { opacity: 0 }, g);
    el('circle', { r: 9, class: 'ball-halo' }, this.ball);
    el('circle', { r: 5, class: 'ball' }, this.ball);

    this.focus = el('rect', { rx: 10, class: 'focus', opacity: 0 }, g);
    this.target = el('circle', { r: 13, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this.cur = null;
    this.rowAt = {};
  }

  // From state a to its neighbor b, partway (q, 0..1).
  draw(a, b, q) {
    const A = STATE[a], B = STATE[b] || A;
    this.cur = { key: q < 0.5 ? a : b, state: q < 0.5 ? A : B };
    const field = a === b ? null : changed(A, B)[0];
    const eq = easeQuad(q);
    const f = (k, va, vb) => (field === k ? lerp(va, vb, eq) : vb);

    // the code panel: the source fades first, then the emitted Go comes
    const srcOn = (s) => (s.panel === 'src' ? 1 : 0), emitOn = (s) => (s.panel === 'emit' ? 1 : 0);
    op(this.src, field === 'panel' ? lerp(srcOn(A), srcOn(B), seg(q, 0, 0.45)) : srcOn(B));
    op(this.emit, field === 'panel' ? lerp(emitOn(A), emitOn(B), seg(q, 0.55, 1)) : emitOn(B));
    this.src.style.pointerEvents = srcOn(this.cur.state) ? '' : 'none';

    // the key: the kinds of line (then, for the emitted Go, the origins)
    this.key.forEach((kg, i) => {
      const on = (s) => (s.panel === 'src' && i < s.kinds ? 1 : 0);
      op(kg, field === 'kinds' || field === 'panel' ? lerp(on(A), on(B), field === 'panel' ? seg(q, 0, 0.45) : eq) : on(B));
    });
    const oOn = (s) => (s.panel === 'emit' && s.emit >= 1 ? 1 : 0);
    op(this.originKey, field === 'emit' ? lerp(oOn(A), oOn(B), eq) : oOn(B));

    // the source's lines: marked, kind by kind (one after another, top
    // to bottom); then turned into intermed's
    const n = FILTER.length;
    const interOn = (s) => (s.inter >= 1 ? 1 : 0);
    // (the panel's name: the old slides out left, the new in from the
    // right, before the first line turns)
    const hu = field === 'inter' && A.inter === 0 ? easeQuad(seg(q, 0, 0.08)) : interOn(B);
    const hOut = easeQuad(seg(hu, 0, 0.5)), hIn = easeQuad(seg(hu, 0.5, 1));
    at(this.srcHead[0], -SLIDE * hOut, 0); op(this.srcHead[0], 1 - hOut);
    at(this.srcHead[1], SLIDE * (1 - hIn), 0); op(this.srcHead[1], hIn);
    // (the lines that change in this step, in order: each gets its own
    // stretch of the scroll)
    const turning = field === 'inter' ? this.srcRows.filter((R) => R.level === Math.max(A.inter, B.inter)) : [];
    this.srcRows.forEach((R, i) => {
      const own = seg(q, (i / n) * 0.5, (i / n) * 0.5 + 0.5);
      const ma = marked(A, R.r) ? 1 : 0, mb = marked(B, R.r) ? 1 : 0;
      op(R.tint, (field === 'kinds' ? lerp(ma, mb, easeQuad(own)) : mb) * 0.9);
      const tb = R.level && B.inter >= R.level ? 1 : 0;
      let u = tb;
      const j = turning.indexOf(R);
      if (j >= 0) u = turnAt(A.inter === 0 ? seg(q, 0.08, 1) : q, j, turning.length);
      // (the new line appears way over on the right, beside the old one,
      // and the two wait there side by side, to compare; then the old
      // one slides out left as it fades, and the new one moves in)
      const appear = easeQuad(seg(u, 0, 0.2)), out = easeQuad(seg(u, 0.55, 0.75)), inn = easeQuad(seg(u, 0.75, 1));
      at(R.a, -SLIDE * out, 0);
      at(R.b, R.wait[0] * (1 - inn), R.wait[1] * (1 - inn));
      op(R.a, R.level === 0 ? 1 : 1 - out);
      op(R.b, R.level === 0 ? 0 : appear);
      op(R.no, 1 - f('inter', interOn(A), interOn(B)));
    });
    // the ball: intermed_build's pen, on the line it's turning
    if (turning.length) {
      const x = A.inter === 0 ? seg(q, 0.08, 1) : q;
      const k = Math.min(turning.length - 1, Math.floor(x * turning.length));
      const k0 = Math.max(0, k - 1), local = easeQuad(seg(x * turning.length - k, 0, BALL_SHARE * 0.8));
      const y = lerp(srcRowY(this.srcRows.indexOf(turning[k0])), srcRowY(this.srcRows.indexOf(turning[k])), k === 0 ? 1 : local);
      this._ball(BALL_X, y - 3.5, 1);
    } else if (this.cur.state.panel === 'src' && this.cur.state.inter > 0 && !field) {
      const last = this.srcRows.filter((R) => R.level === this.cur.state.inter).at(-1);
      this._ball(BALL_X, srcRowY(this.srcRows.indexOf(last)) - 3.5, 1);
    } else this._ball(0, 0, 0);

    // the plan: the operator the compiler's at, as it prints
    const atOp = (s) => (s.panel === 'emit' && s.emit >= 1 && s.emit <= 5 && !s.rows ? AT_OP[GROUP_ORDER[s.emit - 1]] : null);
    const oa = atOp(A), ob = atOp(B);
    for (const [id, o] of Object.entries(this.ops)) {
      const on = (x) => (x === id ? 1 : 0);
      const v = field === 'emit' || field === 'rows' ? lerp(on(oa), on(ob), eq) : on(ob);
      o.box.style.strokeWidth = (1.5 + 1.5 * v).toFixed(2);
      setCls(o.box, `op${v > 0.5 ? ' at' : ''}`);
    }

    // the emitted Go, a change at a time: the hole (if any) slides out
    // left; the code below moves down, making room; the project's held
    // code flies in (when fusing); then the new lines are printed, one
    // at a time, each sliding in from the right, the ball on it
    const T = timeline(A, B, field);
    let slotsA = 0, slotsB = 0;
    this.items.forEach((I, k) => {
      const onA = itemOn(A, I.it), onB = itemOn(B, I.it);
      const ya = emitRowY(slotOf(A, k) + 1), yb = emitRowY(slotOf(B, k) + 1);
      if (onA) slotsA++;
      if (onB) slotsB++;
      let y = yb, x = 0, o = onB ? 1 : 0;
      if (field === 'panel') {
        if (onB && !onA) o = seg(q, 0.55, 1);
      } else if (field === 'emit') {
        const room = easeQuad(seg(q, T.room[0], T.room[1]));
        if (onA && onB) y = lerp(ya, yb, room);
        else if (onA && !onB) {
          // (going: out to the left, before anything moves)
          const u = easeQuad(seg(q, T.leave[0], T.leave[1]));
          y = ya; x = -SLIDE * u; o = 1 - u;
        } else if (onB && !onA) {
          const j = T.entering.indexOf(k), [a0, a1] = T.printAt(j), u = easeQuad(seg(q, a0 + (a1 - a0) * BALL_SHARE, a1));
          x = SLIDE * (1 - u); o = u;
        }
      }
      at(I.g, x, y);
      op(I.g, o);
      if (I.m) op(I.m, f('done', +A.done, +B.done));
      if (!I.it.hole) this.rowAt[k] = [CODE.x + 26 + I.it.depth * 2 * CHAR.emit, y];
      else this.rowAt[`hole.${I.it.hole}`] = [CODE.x + 70, y];
    });
    // the Run frame, around them
    const headY = emitRowY(0), tailA = emitRowY(slotsA + 1), tailB = emitRowY(slotsB + 1);
    const tailY = field === 'emit' ? lerp(tailA, tailB, easeQuad(seg(q, T.room[0], T.room[1]))) : tailB;
    this.runHead.setAttribute('y', headY.toFixed(1));
    this.runTail.setAttribute('y', tailY.toFixed(1));
    this.emitBox.setAttribute('height', (tailY - CODE.y + 12).toFixed(1));

    // the ball: the compiler's pen, on the line it's printing (and, when
    // it's done, resting on the last)
    if (field === 'emit' && T.entering.length && A.emit < B.emit) {
      const n = T.entering.length, [p0] = T.printAt(0);
      if (q < p0) {
        // (it waits where it was, then moves to the first new line)
        const from = this.ballRest(A), to = emitRowY(slotOf(B, T.entering[0]) + 1);
        const u = easeQuad(seg(q, T.room[1], p0));
        this._ball(BALL_X, lerp(from ? from[1] : to, to, u) - 3.5, from ? 1 : u);
      } else {
        const x2 = clamp01((q - p0) / (1 - p0)) * n, j = Math.min(n - 1, Math.floor(x2));
        const yj = (i) => emitRowY(slotOf(B, T.entering[i]) + 1);
        const y = j === 0 ? yj(0) : lerp(yj(j - 1), yj(j), easeQuad(seg(x2 - j, 0, BALL_SHARE * 0.8)));
        this._ball(BALL_X, y - 3.5, 1);
      }
    } else if (this.cur.state.panel === 'emit' && !field) {
      const r = this.ballRest(this.cur.state);
      this._ball(BALL_X, r ? r[1] - 3.5 : 0, r && !this.cur.state.rows ? 1 : 0);
    } else if (field === 'emit' || field === 'rows') {
      const r = this.ballRest(B), ra = this.ballRest(A);
      this._ball(BALL_X, (r || ra || [0, 0])[1] - 3.5, field === 'rows' ? 1 - q : r ? 1 : 0);
    } else if (this.cur.state.panel === 'emit' || field === 'panel') this._ball(0, 0, 0);

    // the project's code, held: it waits, then flies into the room made
    // for it in the filter's hole, and the lines it holds are printed
    const heldOn = (s) => (s.panel === 'emit' && groupShown(s, 'project') && !groupShown(s, 'fuse') ? 1 : 0);
    const into = emitRowY(slotOf(B, T.entering[0] ?? 0) + 1);
    let hx = HELD.x, hy = HELD.y, ho = f('emit', heldOn(A), heldOn(B));
    if (field === 'emit' && heldOn(A) && !heldOn(B)) {
      const u = easeQuad(seg(q, T.fly[0], T.fly[1]));
      hx = lerp(HELD.x, CODE.x + 60, u); hy = lerp(HELD.y, into - 12, u);
      ho = 1 - seg(q, T.fly[1] - 0.02, T.fly[1] + 0.08);
    } else if (field === 'emit' && !heldOn(A) && heldOn(B)) ho = seg(q, 0.85, 1);
    at(this.held, hx, hy);
    op(this.held, ho);

    // the rows
    op(this.rows, f('rows', +A.rows, +B.rows));
  }

  _ball(x, y, o) {
    at(this.ball, x, y);
    op(this.ball, o);
  }

  // where the ball rests in a state: on the last line printed
  ballRest(s) {
    if (s.panel !== 'emit' || s.emit < 1) return null;
    const S0 = { ...s, emit: s.emit - 1 };
    const ks = ITEMS.map((it, k) => k).filter((k) => itemOn(s, ITEMS[k]) && !itemOn(S0, ITEMS[k]));
    return ks.length ? [BALL_X, emitRowY(slotOf(s, ks.at(-1)) + 1)] : null;
  }

  setTarget(p) {
    if (!p) { this.target.setAttribute('cx', -9999); return; }
    this.target.setAttribute('cx', p[0]);
    this.target.setAttribute('cy', p[1]);
  }

  setFocus(rect, o) {
    if (!rect || o <= 0) { op(this.focus, 0); return; }
    const [x, y, w, h] = rect;
    this.focus.setAttribute('x', x); this.focus.setAttribute('y', y);
    this.focus.setAttribute('width', w); this.focus.setAttribute('height', h);
    op(this.focus, o);
  }

  // the place of an emitted row: the first that says re
  emittedAt(re) {
    const k = ITEMS.findIndex((it) => !it.hole && re.test(it.text));
    return k >= 0 ? this.rowAt[k] : null;
  }

  anchor(id) {
    const [kind, what] = id.split('.');
    if (kind === 'src') {
      const i = FILTER.findIndex((r) => r.kind === what);
      return i < 0 ? null : { p: [CODE.x + 34, srcRowY(i) - 4], visible: true };
    }
    if (kind === 'emit') {
      const RE = {
        lift: /^var lzValsReuseTop/, expr: /^_, _, _ = lzCmpLT/, fuse: /^lzValsOut := /, scan: /^lzJsonsData := /,
        200: /^if 200 < lzF64/, yield: /^lzYieldVals\(lzValsScan\)$/,
      };
      const p = what === 'hole' ? this.rowAt['hole.expr'] : this.emittedAt(RE[what]);
      return p ? { p: [p[0] - 6, p[1] - 4], visible: true } : null;
    }
    const a = ANCHORS[id];
    return a ? { p: a.p, visible: true } : null;
  }
}
