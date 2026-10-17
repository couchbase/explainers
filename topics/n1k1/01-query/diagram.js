// The 01-query explainer's diagram: the query, the data directory, the
// plan (cbq's, then n1k1's), the row in flight, the record buffer it
// points into, the sort's heap and the output. Built once; main.js
// draws it partway between two neighboring states (states.js), which
// differ in one field.
//
// Colors (see ../README.md): teal is bytes in the record buffer (a
// value that's a slice of it, and the bytes it points at); amber is
// bytes copied somewhere else; violet is cbq's planner; red is only
// for a row the filter drops.

import { svgEl as el, svgText as txt, setText, setCls } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import {
  CANVAS, QUERY, FILES, TREE, fileY, treeY, OP, opY, CHIP, chipXY, OUT, HEAP, heapRowY, BUF, charX, ANCHORS,
} from './layout.js';
import { STATE, changed } from './states.js';
import { OPS, OP_IDS, opLook, rowAt, bufferAt, countersAt, filesAt, heapAt, outputAt, short } from './flow.js';
import { ORDERS, RUN } from '../lib/query.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const at = (e, x, y) => e.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
// a stretch of q, as its own 0..1
const seg = (q, a, b) => clamp01((q - a) / (b - a));
const NTOK = 4;
// (the row in flight's values: up to four, and as many again going)
const TOKENS = 8;

// the regions a step's `focus` can box: [x, y, w, h]
export const FOCUS = {
  query: [QUERY.x - 6, QUERY.y - 6, QUERY.w + 12, QUERY.h + 12],
  'query.where': [QUERY.x + 6, QUERY.y + 31, 168, 22],
  files: [FILES.x - 8, FILES.y - 18, FILES.w + 8, fileY(19) - FILES.y + 28],
  dir: [FILES.x - 8, FILES.y - 18, FILES.w + 8, treeY(3) - FILES.y + 28],
  buffer: [BUF.x - 6, BUF.y - 6, BUF.w + 12, BUF.h + 32],
  plan: [OP.x - 8, opY(0) - 22, OP.w + 16, opY(4) + OP.h - opY(0) + 30],
  heap: [HEAP.x - 6, HEAP.y - 6, HEAP.w + 12, HEAP.h + 12],
  out: [OUT.x - 6, OUT.y - 6, OUT.w + 12, OUT.h + 12],
  prepared: [OP.x + OP.w + 8, opY(3) + 2, 296, 78],
  ...Object.fromEntries([0, 1, 2, 3, 4].map((s) => [`op.${s}`, [OP.x - 6, opY(s) - 6, OP.w + 12, OP.h + 12]])),
};

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    const g = el('g', {}, svg);

    // the query
    el('rect', { x: QUERY.x, y: QUERY.y, width: QUERY.w, height: QUERY.h, rx: 8, class: 'query' }, g);
    const sql = RUN.query.replace(' WHERE', '\nWHERE').split('\n');
    sql.forEach((l, i) => txt(g, QUERY.x + 14, QUERY.y + 24 + i * 21, l, 'query-text'));

    // the data directory
    txt(g, FILES.x, FILES.y, 'the data directory', 'panel-title');
    this.tags = TREE.map((t, j) => {
      const x = FILES.x + t.indent * 14;
      txt(g, x, treeY(j), t.text, 'tree-text');
      if (t.note) txt(g, x + t.text.length * 6.6 + 8, treeY(j), t.note, 'tree-note');
      if (!t.tag) return null;
      const tg = el('g', { opacity: 0 }, g);
      el('rect', { x: FILES.x + 150, y: treeY(j) - 11, width: 62, height: 15, rx: 7.5, class: `tag tag-${t.tag}` }, tg);
      txt(tg, FILES.x + 181, treeY(j) - 0.5, t.tag, 'tag-text', 'middle');
      return tg;
    }).filter(Boolean);
    this.fileHl = el('rect', { x: FILES.x + 26, width: FILES.w - 22, height: FILES.dy - 3, rx: 4, class: 'file-hl', opacity: 0 }, g);
    this.files = ORDERS.map((o, i) => {
      const y = fileY(i);
      return {
        name: txt(g, FILES.x + 42, y, o.name, 'file-name'),
        total: txt(g, FILES.x + FILES.w - 4, y, o.total.bytes, 'file-total', 'end'),
        mark: txt(g, FILES.x + 32, y, '', 'file-mark', 'middle'),
      };
    });

    // the record buffer
    this.bufLabel = txt(g, BUF.x, BUF.y + BUF.h + 18, '', 'panel-title');
    this.buf = el('g', { opacity: 0 }, g);
    this.bufBox = el('rect', { x: BUF.x, y: BUF.y, width: BUF.w, height: BUF.h, rx: 8, class: 'buf' }, this.buf);
    this.bufHls = [0, 1].map(() => el('rect', { y: BUF.y + 15, height: 19, rx: 3, class: 'buf-hl', opacity: 0 }, this.buf));
    this.bufText = txt(this.buf, charX(0), BUF.y + 29, '', 'buf-text');
    this.bufIdx = [0, 1].map(() => txt(this.buf, 0, BUF.y + 50, '', 'buf-idx', 'middle'));
    this.bufEnds = [txt(this.buf, charX(0), BUF.y + 50, '0', 'buf-end'), txt(this.buf, 0, BUF.y + 50, '', 'buf-end', 'end')];

    // the lines from a value that's a slice to the bytes it points at
    // (under the plan's boxes: they show in the gaps)
    this.slices = Array.from({ length: TOKENS + 1 }, () => el('path', { class: 'slice-line', opacity: 0 }, g));

    // the plan
    this.planTitle = txt(g, OP.x, OP.top - 9, '', 'panel-title');
    this.ops = {};
    for (const id of OP_IDS) {
      const og = el('g', { opacity: 0 }, g);
      const o = {
        g: og,
        box: el('rect', { x: OP.x, y: 0, width: OP.w, height: OP.h, rx: 9, class: 'op' }, og),
        title: txt(og, OP.x + 12, 20, '', 'op-title'),
        params: txt(og, OP.x + 12, 36, '', 'op-params'),
        count: txt(og, OP.x + OP.w - 10, 20, '', 'op-count', 'end'),
        chips: Array.from({ length: NTOK }, (_, k) => {
          const cg = el('g', { opacity: 0 }, og);
          const x = OP.x + CHIP.x0 + k * (CHIP.w + CHIP.gap);
          el('rect', { x, y: CHIP.dy, width: CHIP.w, height: CHIP.h, rx: 5, class: 'chip' }, cg);
          return { g: cg, label: txt(cg, x + 6, CHIP.dy + 10, '', 'chip-label') };
        }),
      };
      if (id === 'filter') o.test = txt(og, OP.x + OP.w - 10, 36, '', 'op-test', 'end');
      this.ops[id] = o;
    }
    // the push arrows: from each operator up to its parent
    this.yields = el('g', { opacity: 0 }, g);
    const gx = OP.x - 16;
    for (let s = 1; s <= 4; s++) {
      el('path', { d: `M${OP.x},${opY(s) + 30} H${gx} V${opY(s - 1) + 50} H${OP.x - 3}`, class: 'yield', 'marker-end': 'url(#n1k1-arrow)' }, this.yields);
    }
    const defs = el('defs', {}, svg);
    const mk = el('marker', { id: 'n1k1-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head' }, mk);

    // the filter's setup, beside it
    this.prepared = el('g', { opacity: 0 }, g);
    const px = OP.x + OP.w + 16, py = opY(3) + 18;
    txt(this.prepared, px, py, 'set up once, before any row:', 'note-title');
    txt(this.prepared, px, py + 18, '200  →  a float64, parsed now', 'note-text');
    txt(this.prepared, px, py + 36, '`orders`.`total`  →  a path into', 'note-text');
    txt(this.prepared, px + 132, py + 52, 'register .["orders"]', 'note-text');

    // the row in flight: its values, in the registers of the operator
    // that holds it
    this.tokens = Array.from({ length: TOKENS }, () => {
      const tg = el('g', { opacity: 0 }, g);
      return {
        g: tg,
        rect: el('rect', { x: 0, y: 12, width: CHIP.w - 8, height: 15, rx: 3, class: 'tok' }, tg),
        text: txt(tg, 4, 23.5, '', 'tok-text'),
      };
    });
    this.drop = txt(g, 0, 0, '✕', 'drop-mark', 'middle');

    // the end of input, as it goes up
    this.eof = el('g', { opacity: 0 }, g);
    el('rect', { x: -48, y: -9, width: 96, height: 18, rx: 9, class: 'eof' }, this.eof);
    txt(this.eof, 0, 4, 'yieldErr(nil)', 'eof-text', 'middle');

    // the heap
    this.heap = el('g', { opacity: 0 }, g);
    el('rect', { x: HEAP.x, y: HEAP.y, width: HEAP.w, height: HEAP.h, rx: 8, class: 'panel' }, this.heap);
    txt(this.heap, HEAP.x + 12, HEAP.y + 20, "the sort's heap: rows, copied in", 'panel-title');
    txt(this.heap, HEAP.x + 12, HEAP.y + HEAP.h - 10, 'chunk 0, in memory (more would spill to files)', 'heap-note');
    this.heapRows = Object.fromEntries(ORDERS.filter((o) => o.pass).map((o) => {
      const rg = el('g', { opacity: 0 }, this.heap);
      el('rect', { x: HEAP.x + 10, y: -12, width: 52, height: 22, rx: 4, class: 'heap-key' }, rg);
      txt(rg, HEAP.x + 36, 3, o.total.bytes, 'heap-key-text', 'middle');
      el('rect', { x: HEAP.x + 66, y: -12, width: HEAP.w - 76, height: 22, rx: 4, class: 'heap-row' }, rg);
      txt(rg, HEAP.x + 72, 3, `${o.id.bytes} ${o.customer.bytes} ${o.total.bytes} ${short(o.doc, 9)}`, 'heap-row-text');
      return [o.stem, rg];
    }));

    // the output
    this.out = el('g', { opacity: 0 }, g);
    el('rect', { x: OUT.x, y: OUT.y, width: OUT.w, height: OUT.h, rx: 8, class: 'panel' }, this.out);
    txt(this.out, OUT.x + 12, OUT.y + 20, 'the output', 'panel-title');
    this.outRows = [0, 1, 2].map((i) => txt(this.out, OUT.x + 10, OUT.y + 42 + i * 17, '', 'out-text'));

    // the summary: where the bytes are copied, numbered
    this.copies = el('g', { opacity: 0 }, g);
    const badge = (x, y, n) => {
      el('circle', { cx: x, cy: y, r: 8, class: 'badge' }, this.copies);
      txt(this.copies, x, y + 3.5, String(n), 'badge-text', 'middle');
    };
    badge(BUF.x + BUF.w - 4, BUF.y + 4, 1);
    badge(OP.x + OP.w - 4, opY(4) + 4, 2);
    badge(OP.x + OP.w - 4, opY(2) + 4, 3);
    badge(HEAP.x + HEAP.w - 12, HEAP.y + 14, 4);
    badge(OUT.x + OUT.w - 12, OUT.y + 14, 5);

    // the focus box (a reading aid), and the callout's target ring
    this.focus = el('rect', { rx: 12, class: 'focus', opacity: 0 }, g);
    this.target = el('circle', { r: 13, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this.cur = null;
  }

  // From state a to its neighbor b, partway (q, 0..1).
  draw(a, b, q) {
    const A = STATE[a], B = STATE[b] || A;
    this.cur = { key: q < 0.5 ? a : b, state: q < 0.5 ? A : B };
    const field = a === b ? null : changed(A, B)[0];
    const eq = easeQuad(q);
    const f = (k, va, vb) => (field === k ? lerp(va, vb, eq) : vb);
    const S = q < 0.5 ? A : B;

    // the directory's tags, one after another
    this.tags.forEach((tg, j) => op(tg, field === 'ns' ? lerp(+A.ns, +B.ns, easeQuad(seg(q, j * 0.25, 0.5 + j * 0.25))) : +B.ns));

    // the files: the one the scan's on; each one's total, once read,
    // and whether it passed, once tested
    const fa = filesAt(A), fb = filesAt(B);
    ORDERS.forEach((o, i) => {
      const F = this.files[i], s = field === 'ev' ? (q < 0.5 ? fa[i] : fb[i]) : fb[i];
      op(F.total, field === 'ev' && fa[i].read !== fb[i].read ? eq : s.read ? 1 : 0);
      setCls(F.name, `file-name${s.tested ? (o.pass ? ' pass' : ' dropped') : ''}`);
      setCls(F.total, `file-total${s.tested ? (o.pass ? ' pass' : ' dropped') : ''}`);
      setText(F.mark, s.tested ? (o.pass ? '✓' : '✕') : '');
      setCls(F.mark, `file-mark${o.pass ? ' pass' : ' dropped'}`);
    });
    const cur = (s) => { const k = filesAt(s).findIndex((x) => x.current); return k >= 0 ? k : (s.peek && s.ev < 0 ? 0 : -1); };
    const ca = cur(A), cb = cur(B);
    const hy = (k) => fileY(k) - FILES.dy + 6;
    if (ca >= 0 && cb >= 0) { this.fileHl.setAttribute('y', lerp(hy(ca), hy(cb), eq).toFixed(1)); op(this.fileHl, 1); }
    else if (cb >= 0 || ca >= 0) { this.fileHl.setAttribute('y', hy(cb >= 0 ? cb : ca).toFixed(1)); op(this.fileHl, cb >= 0 ? (field ? eq : 1) : 1 - eq); }
    else op(this.fileHl, 0);

    // the record buffer: the doc it holds (a new file's bytes replace
    // the last one's, halfway)
    const ba = bufferAt(A), bb = bufferAt(B), bs = q < 0.5 ? ba || bb : bb || ba;
    const swap = ba && bb && ba.order !== bb.order;
    op(this.buf, swap ? 1 : f(field, ba ? 1 : 0, bb ? 1 : 0));
    op(this.bufText, swap ? Math.abs(1 - 2 * q) : 1);
    op(this.bufLabel, swap ? 1 : f(field, ba ? 1 : 0, bb ? 1 : 0));
    if (bs) {
      setText(this.bufText, bs.order.doc);
      setText(this.bufLabel, bs.read ? `the record buffer: ${bs.order.name}'s doc, held till the scan's next file` : `${bs.order.name}, as it is on disk: ${bs.order.doc.length} bytes`);
      setText(this.bufEnds[1], String(bs.order.doc.length));
      this.bufEnds[1].setAttribute('x', charX(bs.order.doc.length).toFixed(1));
    }

    // the plan: each operator's place, name and params
    const pa = A.plan, pb = B.plan;
    setText(this.planTitle, (field === 'plan' ? (q < 0.5 ? pa : pb) : pb) === 'cbq' || (field === 'plan' && pb === 'nofetch' && q < 0.5) || pb === 'nofetch' ? "cbq's plan" : "n1k1's plan");
    op(this.planTitle, f('plan', pa === 'none' ? 0 : 1, pb === 'none' ? 0 : 1));
    const order = ['scan', 'fetch', 'filter', 'proj', 'order', 'strip'];
    for (const id of OP_IDS) {
      const o = this.ops[id], la = opLook(A, id), lb = opLook(B, id);
      // (a box that leaves fades first; the others then slide over)
      let u = 1, oo = lb.o, slot = lb.slot, renaming = false;
      if (field === 'plan') {
        if (pb === 'nofetch') { oo = lerp(la.o, lb.o, seg(q, 0, 0.45)); slot = lerp(la.slot, lb.slot, easeQuad(seg(q, 0.5, 1))); }
        else if (pb === 'cbq') { oo = lerp(la.o, lb.o, easeQuad(seg(q, order.indexOf(id) * 0.12, 0.4 + order.indexOf(id) * 0.12))); }
        else if (pb === 'strip') { oo = lerp(la.o, lb.o, eq); u = eq; }
        else if (pb === 'n1k1') {
          // (renamed one after another, from the scan up)
          u = seg(q, order.indexOf(id) * 0.15, 0.4 + order.indexOf(id) * 0.15);
          renaming = la.title !== lb.title;
        } else if (pb === 'aug') { u = q; renaming = id === 'proj'; }
      }
      const y = opY(slot) - (id === 'strip' && field === 'plan' && pb === 'strip' ? (1 - u) * 24 : 0);
      at(o.g, 0, y);
      op(o.g, oo);
      const L = renaming ? (u < 0.5 ? la : lb) : lb;
      setText(o.title, L.title || '');
      setText(o.params, L.params || '');
      setCls(o.title, `op-title${L.n1k1 ? '' : ' cbq'}`);
      setCls(o.box, `op${L.n1k1 ? '' : ' cbq'}`);
      const dip = renaming ? Math.abs(1 - 2 * u) : 1;
      op(o.title, id === 'proj' && pb === 'aug' && field === 'plan' ? 1 : dip);
      op(o.params, dip);
      // its registers
      const labelsOn = (s, l) => (s.labels ? l.labels.length : 0);
      o.chips.forEach((c, k) => {
        const on = (s, l) => (k < labelsOn(s, l) ? 1 : 0);
        op(c.g, field === 'labels' ? on(B, lb) * easeQuad(seg(q, 0.1 * (4 - lb.slot), 0.5 + 0.1 * (4 - lb.slot))) : on(B, lb));
        setText(c.label, lb.labels[k] || '');
      });
    }

    // the counters (n1k1's stats), once the rows can flow
    const cA = countersAt(A), cB = countersAt(B), cS = field === 'ev' || field === 'out' ? (q < 0.85 ? cA : cB) : cB;
    const countText = { scan: (c) => `out ${c.out}`, filter: (c) => `in ${c.in} · out ${c.out}`, order: (c) => `in ${c.in} · out ${c.out}` };
    for (const id of OP_IDS) {
      const o = this.ops[id];
      setText(o.count, countText[id] ? countText[id](cS[id]) : '');
      op(o.count, f('yields', A.yields ? 1 : 0, B.yields ? 1 : 0));
    }
    op(this.yields, field === 'yields' ? lerp(+A.yields, +B.yields, easeQuad(seg(q, 0, 0.6))) : +B.yields);
    const panels = (s) => (s.yields ? 1 : 0);
    op(this.heap, field === 'yields' ? lerp(panels(A), panels(B), easeQuad(seg(q, 0.5, 1))) : panels(B));
    op(this.out, field === 'yields' ? lerp(panels(A), panels(B), easeQuad(seg(q, 0.6, 1))) : panels(B));
    op(this.prepared, f('prepared', +A.prepared, +B.prepared));

    // the row in flight
    this._drawRow(A, B, q, field);

    // the end of input: up from the scan to the sort
    const eofY = (s) => (s.eof ? opY(1) : opY(4));
    const ey = field === 'eof' ? lerp(eofY(A), eofY(B), easeQuad(seg(q, 0.25, 1))) : eofY(B);
    at(this.eof, OP.x + OP.w - 150, ey);
    const eofOn = (s) => (s.eof && !s.copies ? 1 : 0);
    op(this.eof, field === 'eof' ? seg(q, 0, 0.25) : f('copies', eofOn(A), eofOn(B)));

    // the heap: rows as pushed, then sorted
    const ha = heapAt(A), hb = heapAt(B);
    for (const [stem, rg] of Object.entries(this.heapRows)) {
      const ia = ha.findIndex((o) => o.stem === stem), ib = hb.findIndex((o) => o.stem === stem);
      const pushing = ia < 0 && ib >= 0;
      // (a pushed row slides in from the sort's box)
      const v = pushing ? easeQuad(seg(q, 0.35, 1)) : 1;
      const y = heapRowY(ib >= 0 ? (ia >= 0 ? lerp(ia, ib, field === 'sorted' ? eq : 1) : ib) : Math.max(ia, 0));
      at(rg, pushing ? (1 - v) * -60 : 0, y);
      op(rg, ib >= 0 ? v : ia >= 0 ? 1 - eq : 0);
    }

    // the output's rows
    const oa = outputAt(A), ob = outputAt(B);
    this.outRows.forEach((t, i) => {
      setText(t, ob[i] || oa[i] || '');
      op(t, i < oa.length ? 1 : i < ob.length ? seg(q, 0.85, 1) : 0);
    });

    // the summary
    op(this.copies, f('copies', +A.copies, +B.copies));
  }

  // The row in flight: its values move up as an operator passes it to
  // its parent; a new row (the next file's) replaces a dropped one, the
  // old fading first.
  _drawRow(A, B, q, field) {
    const ra = A.copies ? null : rowAt(A), rb = B.copies ? null : rowAt(B);
    const place = (r, k) => {
      const slot = opLook(B, r.op).slot;
      const [x, y] = chipXY(slot, k);
      return [x + 4, y];
    };
    // the phases: one row moving up, or one going and another coming
    const sameRow = ra && rb && ra.order === rb.order && field === 'ev';
    let show = [];
    if (field === 'out' && rb) {
      // (out of the heap into the sort's registers; up to the last
      // project, which leaves the doc behind; then out)
      const u1 = seg(q, 0, 0.3), u2 = easeQuad(seg(q, 0.35, 0.8));
      if (ra) show.push(...ra.vals.map((v, k) => ({ v, p: place(ra, k), o: 1 - u1 })));
      show.push(...rb.from.vals.map((v, k) => {
        const p0 = place(rb.from, k), p1 = k < 3 ? place(rb, k) : p0;
        return { v, p: [lerp(p0[0], p1[0], u2), lerp(p0[1], p1[1], u2)], o: seg(q, 0.25, 0.4) * (k < 3 ? 1 : 1 - seg(q, 0.4, 0.6)) };
      }));
    } else if (sameRow) {
      // (the project makes three values afresh, and passes the doc on;
      // the scan's ^id goes no further)
      const made = ra.op === 'filter' && rb.op === 'proj';
      const from = made ? { 3: 0 } : null;
      show = rb.vals.map((v, k) => {
        const j = from ? from[k] : k, pb = place(rb, k);
        if (j === undefined) return { v, p: pb, o: easeQuad(seg(q, 0.35 + 0.15 * k, 0.65 + 0.15 * k)) };
        const pa = place(ra, j), u = easeQuad(made ? seg(q, 0, 0.5) : q);
        return { v, p: [lerp(pa[0], pb[0], u), lerp(pa[1], pb[1], u)], o: 1 };
      });
      if (made) show.push({ v: ra.vals[1], p: place(ra, 1), o: 1 - seg(q, 0, 0.3) });
    } else {
      const r = q < 0.5 ? ra : rb;
      if (r) show = r.vals.map((v, k) => ({ v, p: place(r, k), o: field && ra !== rb ? Math.abs(1 - 2 * q) : 1 }));
    }
    // (the dropped row's mark, and the row greyed)
    const dropped = (r) => !!(r && r.op === 'filter' && !r.pass);
    const dr = q < 0.5 ? ra : rb;
    let dropO = 0;
    if (sameRow && dropped(rb)) dropO = seg(q, 0.6, 1);
    else if (dropped(dr)) dropO = field && ra !== rb ? Math.abs(1 - 2 * q) : 1;
    if (dropO > 0) {
      const [x, y] = place(dr, 1);
      this.drop.setAttribute('x', (x + CHIP.w + 4).toFixed(1));
      this.drop.setAttribute('y', (y + 24).toFixed(1));
    }
    op(this.drop, dropO);
    const shown = show.filter((x) => x.o > 0.001);
    this.tokens.forEach((t, k) => {
      const s = shown[k];
      if (!s) { op(t.g, 0); return; }
      at(t.g, s.p[0], s.p[1]);
      setText(t.text, s.v.t);
      setCls(t.rect, `tok ${s.v.kind}`);
      setCls(t.text, `tok-text ${s.v.kind}`);
      op(t.g, s.o * (dropped(dr) ? 1 - 0.45 * dropO : 1));
    });
    // the filter's test
    const ft = this.ops.filter.test, tr = q < 0.5 ? ra : rb;
    const testOn = (r) => (r && r.op === 'filter' ? 1 : 0);
    setText(ft, tr && tr.test ? tr.test : (ra && ra.test) || (rb && rb.test) || '');
    setCls(ft, `op-test${tr && tr.op === 'filter' ? (tr.pass ? ' pass' : ' dropped') : ''}`);
    const fresh = field === 'ev' && testOn(rb) && !testOn(ra);
    op(ft, fresh ? seg(q, 0.5, 0.9) : field === 'ev' && testOn(ra) && !testOn(rb) ? 1 - seg(q, 0, 0.4) : testOn(rb));

    // the slices: a line from each value that's a slice to its bytes,
    // and those bytes marked (with the filter's: the total it reads)
    const lines = [];
    shown.forEach((s, k) => { if (s.v.kind === 'slice') lines.push({ from: [s.p[0] + (CHIP.w - 8) / 2, s.p[1] + 27], range: s.v.range, o: s.o }); });
    if (tr && tr.reads) {
      const y = opY(3) + 40;
      lines.push({ from: [OP.x + OP.w - 70, y], range: tr.reads, o: field === 'ev' && !(ra && ra.reads) ? seg(q, 0.5, 0.9) : 1 });
    }
    let hl = 0;
    this.slices.forEach((p, i) => {
      const l = lines[i];
      if (!l) { op(p, 0); return; }
      const [s0, s1] = l.range, whole = s0 === 0 && s1 === (tr || rb || ra).order.doc.length;
      const x1 = whole ? charX(0) + 30 : (charX(s0) + charX(s1)) / 2, y1 = BUF.y + 15;
      const [x0, y0] = l.from;
      p.setAttribute('d', `M${x0.toFixed(1)},${y0.toFixed(1)} C${x0.toFixed(1)},${(y0 + 60).toFixed(1)} ${x1.toFixed(1)},${(y1 - 70).toFixed(1)} ${x1.toFixed(1)},${y1}`);
      op(p, l.o * 0.9);
      if (!whole && hl < 2) {
        const r = this.bufHls[hl], idx = this.bufIdx[hl++];
        r.setAttribute('x', (charX(s0) - 1).toFixed(1));
        r.setAttribute('width', (charX(s1) - charX(s0) + 2).toFixed(1));
        op(r, l.o);
        setText(idx, `[${s0}:${s1}]`);
        idx.setAttribute('x', x1.toFixed(1));
        op(idx, l.o);
      }
    });
    for (; hl < 2; hl++) { op(this.bufHls[hl], 0); op(this.bufIdx[hl], 0); }
    // (the whole doc: the buffer's frame, in the slice's color)
    const wholeOn = lines.some((l) => l.range[0] === 0);
    setCls(this.bufBox, `buf${wholeOn ? ' held' : ''}`);
  }

  setTarget(p) {
    if (!p) { this.target.setAttribute('cx', -9999); return; }
    this.target.setAttribute('cx', p[0]);
    this.target.setAttribute('cy', p[1]);
  }

  // The focus box: around a region, or none (o: its opacity).
  setFocus(region, o) {
    const r = region && FOCUS[region];
    if (!r || o <= 0) { op(this.focus, 0); return; }
    const [x, y, w, h] = r;
    this.focus.setAttribute('x', x); this.focus.setAttribute('y', y);
    this.focus.setAttribute('width', w); this.focus.setAttribute('height', h);
    op(this.focus, o);
  }

  anchor(id) {
    const a = ANCHORS[id];
    if (!a) return null;
    // (an operator's: where its slot is now)
    return { p: a.p, visible: true };
  }
}

export { OPS };
