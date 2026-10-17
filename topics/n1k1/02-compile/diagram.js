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
      return {
        r, tint, no, level: interLevel(r),
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
    op(this.srcHead[0], 1 - f('inter', interOn(A), interOn(B)));
    op(this.srcHead[1], f('inter', interOn(A), interOn(B)));
    this.srcRows.forEach((R, i) => {
      const own = seg(q, (i / n) * 0.5, (i / n) * 0.5 + 0.5);
      const ma = marked(A, R.r) ? 1 : 0, mb = marked(B, R.r) ? 1 : 0;
      op(R.tint, (field === 'kinds' ? lerp(ma, mb, easeQuad(own)) : mb) * 0.9);
      const ta = R.level && A.inter >= R.level ? 1 : 0, tb = R.level && B.inter >= R.level ? 1 : 0;
      const u = field === 'inter' ? lerp(ta, tb, easeQuad(own)) : tb;
      // (a line that changes dips out, then comes back as its new self)
      op(R.a, ta === tb ? 1 - tb : clamp01(1 - 2 * u));
      op(R.b, ta === tb ? tb : clamp01(2 * u - 1));
      if (R.level === 0) { op(R.a, 1); op(R.b, 0); }
      op(R.no, 1 - f('inter', interOn(A), interOn(B)));
    });

    // the plan: the operator the compiler's at, as it prints
    const atOp = (s) => (s.panel === 'emit' && s.emit >= 1 && s.emit <= 5 && !s.rows ? AT_OP[GROUP_ORDER[s.emit - 1]] : null);
    const oa = atOp(A), ob = atOp(B);
    for (const [id, o] of Object.entries(this.ops)) {
      const on = (x) => (x === id ? 1 : 0);
      const v = field === 'emit' || field === 'rows' ? lerp(on(oa), on(ob), eq) : on(ob);
      o.box.style.strokeWidth = (1.5 + 1.5 * v).toFixed(2);
      setCls(o.box, `op${v > 0.5 ? ' at' : ''}`);
    }

    // the emitted Go: items take their slots (those after a new one move
    // down to make room, then it fades in; a hole fades, then its code
    // comes)
    let slotsA = 0, slotsB = 0;
    this.items.forEach((I, k) => {
      const onA = itemOn(A, I.it), onB = itemOn(B, I.it);
      const ya = emitRowY(slotOf(A, k) + 1), yb = emitRowY(slotOf(B, k) + 1);
      if (onA) slotsA++;
      if (onB) slotsB++;
      let y = yb, o = onB ? 1 : 0;
      if (field === 'emit' || field === 'panel') {
        const u = easeQuad(seg(q, 0, 0.5));
        y = onA && onB ? lerp(ya, yb, u) : onB ? yb : ya;
        if (onB && !onA) o = field === 'panel' ? seg(q, 0.55, 1) : seg(q, 0.45 + 0.4 * (k / ITEMS.length), 0.6 + 0.4 * (k / ITEMS.length));
        else if (onA && !onB) o = 1 - seg(q, 0, 0.35);
      }
      at(I.g, 0, y);
      op(I.g, o);
      if (I.m) op(I.m, f('done', +A.done, +B.done));
      if (!I.it.hole) this.rowAt[k] = [CODE.x + 26 + I.it.depth * 2 * CHAR.emit, y];
      else this.rowAt[`hole.${I.it.hole}`] = [CODE.x + 70, y];
    });
    // the Run frame, around them
    const headY = emitRowY(0), tailA = emitRowY(slotsA + 1), tailB = emitRowY(slotsB + 1);
    const tailY = field === 'emit' ? lerp(tailA, tailB, easeQuad(seg(q, 0, 0.5))) : tailB;
    this.runHead.setAttribute('y', headY.toFixed(1));
    this.runTail.setAttribute('y', tailY.toFixed(1));
    this.emitBox.setAttribute('height', (tailY - CODE.y + 12).toFixed(1));

    // the project's code, held: it waits, then goes into the filter's
    // hole
    const heldOn = (s) => (s.panel === 'emit' && groupShown(s, 'project') && !groupShown(s, 'fuse') ? 1 : 0);
    const hole = this.rowAt['hole.fuse'] || [CODE.x + 70, emitRowY(30)];
    let hx = HELD.x, hy = HELD.y, ho = f('emit', heldOn(A), heldOn(B));
    if (field === 'emit' && heldOn(A) && !heldOn(B)) {
      const u = easeQuad(seg(q, 0, 0.5));
      hx = lerp(HELD.x, hole[0], u); hy = lerp(HELD.y, hole[1] - 12, u);
      ho = 1 - seg(q, 0.4, 0.6);
    }
    at(this.held, hx, hy);
    op(this.held, ho);

    // the rows
    op(this.rows, f('rows', +A.rows, +B.rows));
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
