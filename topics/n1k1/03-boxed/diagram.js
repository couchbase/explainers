// The 03-boxed explainer's diagram: one filter, one row, two lanes. The
// boxed lane (cbq's Evaluate) builds Go values and leaves allocations
// on the heap, block by block; the byte lane (n1k1's native code) points
// into the row's bytes and leaves none. Then the twenty rows' tallies,
// and what boxing does to the totals. Built once; main.js draws it
// partway between two neighboring states (states.js), which differ in
// one field.
//
// Colors (see ../README.md): amber is the heap: a boxed value, and the
// block it leaves there; teal is the record buffer's bytes, and a slice
// of them; grey is a value with no heap cost (on the stack, a constant
// made at setup, or a reused buffer).

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import {
  CANVAS, EXPR, BUF, charX, LANES, STAGE_Y, NODE, nodeXY, HEAP, BLOCKS, TALLY, TABLE, ANCHORS, BYTE_W,
} from './layout.js';
import { STATE, changed, panelOf } from './states.js';
import { reveal, buildQueries, drawQueries, buildGroup, drawGroup, buildFallback, drawFallback, buildSummary, drawSummary } from './diagram-panels.js';
import { buildOrder, drawOrder, buildJoin, drawJoin, buildWindow, drawWindow } from './diagram-sortjoin.js';
import { ROWS, HERO, ALLOCS, STAGES, CHANGED, bytesOf } from '../lib/boxed.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const at = (e, x, y) => e.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
const seg = (q, a, b) => clamp01((q - a) / (b - a));
const fmt = (n) => n.toLocaleString('en-US');

const O = HERO.order;
// the doc's two lines, broken after the comma that follows its total
const BREAK = O.total.end + 1;

// each boxed allocation, as a node: a short name, and its cost
const SHORT = {
  'the row, as a map': 'the row: a map',
  'the map\'s room for "orders"': 'room for "orders"',
  "a parsedValue, around the doc's bytes": 'parsedValue: the doc',
  "an annotatedValue, to carry the doc's META": 'an annotatedValue',
  'the META map, for the id': 'META: a map',
  'the id, parsed and boxed': 'the id, boxed',
  'a scanner, to find "total" in the doc': 'a scanner for "total"',
  'the total, parsed and boxed': `total: ${HERO.totalType.replace('value.', '')} ${HERO.totalBoxed}`,
  "the comparison's working value": 'a working value',
};
const cost = (a) => `${a.count > 1 ? `${a.count} allocations · ` : ''}${a.bytes} B`;

// The lanes' nodes, by stage: each a title, a cost line, a kind (heap,
// slice, free), and, if it points into the row's bytes, which.
export const NODES = {
  boxed: [
    ...ALLOCS.map((a, i) => ({ stage: STAGES.indexOf(a.stage), title: SHORT[a.what] || a.what, sub: cost(a), kind: 'heap', alloc: i, buf: /parsedValue/.test(a.what) ? 'doc' : /total, parsed/.test(a.what) ? 'total' : null })),
    { stage: 2, title: 'the answer: a boolValue', sub: 'a value · 0 B', kind: 'free' },
    { stage: 3, title: '"true", as JSON', sub: 'a reused buffer · 0 B', kind: 'free' },
  ],
  bytes: [
    { stage: 0, title: 'register 0: the doc', sub: 'a slice · 0 B', kind: 'slice', buf: 'doc' },
    { stage: 1, title: `total: ${O.total.bytes}`, sub: `a slice [${O.total.start}:${O.total.end}] · 0 B`, kind: 'slice', buf: 'total' },
    { stage: 2, title: `${parseFloat(O.total.bytes)}: a float64`, sub: 'on the stack · 0 B', kind: 'free' },
    { stage: 2, title: '200: a float64', sub: 'parsed at setup · 0 B', kind: 'free' },
    { stage: 3, title: 'the answer: true', sub: 'a Val made at setup · 0 B', kind: 'free' },
  ],
};
for (const lane of ['boxed', 'bytes']) {
  const n = [0, 0, 0, 0];
  for (const nd of NODES[lane]) nd.k = n[nd.stage]++;
}

const STAGE_NAMES = ['1. get the doc', '2. find total', '3. compare', '4. the answer'];
const LANE_TITLES = { boxed: "the boxed lane: cbq's Evaluate", bytes: "the byte lane: n1k1's native code" };

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    const g = el('g', {}, svg);

    // the filter, and the row (for the filter's sections; the later ones
    // show their own query here: see buildQueries)
    const top = this.top = el('g', {}, g);
    el('rect', { x: EXPR.x, y: EXPR.y, width: EXPR.w, height: EXPR.h, rx: 8, class: 'expr' }, top);
    txt(top, EXPR.x + 14, EXPR.y + 26, 'orders.total > 200', 'expr-text');
    txt(top, EXPR.x + 14, EXPR.y + 47, "01-query's filter, on one row", 'expr-sub');
    el('rect', { x: BUF.x, y: BUF.y, width: BUF.w, height: BUF.h, rx: 8, class: 'buf' }, top);
    this.bufHl = el('rect', { x: charX(O.total.start) - 1, y: BUF.y + 9, width: (O.total.end - O.total.start) * 6.6 + 2, height: 17, rx: 3, class: 'buf-hl', opacity: 0 }, top);
    txt(top, charX(0), BUF.y + 22, O.doc.slice(0, BREAK), 'buf-text');
    txt(top, charX(0), BUF.y + 22 + BUF.line, O.doc.slice(BREAK), 'buf-text');
    txt(top, BUF.x + BUF.w - 10, BUF.y + 22 + BUF.line, `${O.name}, in the record buffer`, 'buf-label', 'end');

    // the lanes, and their heaps
    this.lanes = {};
    for (const lane of ['boxed', 'bytes']) {
      const L = el('g', { opacity: 0 }, g);
      const x = LANES.x[lane];
      el('rect', { x, y: LANES.y, width: LANES.w, height: LANES.h, rx: 10, class: `lane lane-${lane}` }, L);
      txt(L, x + 12, LANES.y + 22, LANE_TITLES[lane], 'lane-title');
      STAGE_Y.forEach((y, s) => txt(L, x + 12, y + 2, STAGE_NAMES[s], 'stage-name'));
      // the heap
      el('rect', { x, y: HEAP.y, width: LANES.w, height: HEAP.h, rx: 10, class: 'heap' }, L);
      txt(L, x + 12, HEAP.y + 22, `the Go heap for ${lane === 'boxed' ? 'cbq' : 'n1k1'}`, 'lane-title');
      const counter = txt(L, x + LANES.w - 12, HEAP.y + 22, '', 'heap-count', 'end');
      const nodes = NODES[lane].map((nd) => {
        const ng = el('g', { opacity: 0 }, g);
        el('rect', { x: 0, y: 0, width: NODE.w, height: NODE.h, rx: 6, class: `node node-${nd.kind}` }, ng);
        txt(ng, 7, 15, nd.title, `node-title node-${nd.kind}`);
        txt(ng, 7, 30, nd.sub, 'node-sub');
        const [nx, ny] = nodeXY(lane, nd.stage, nd.k);
        at(ng, nx, ny);
        // (a line to the bytes it points into)
        let line = null;
        if (nd.buf) {
          // (the doc: the buffer, just above the node's lane; the total:
          // its bytes)
          const bx = nd.buf === 'doc' ? Math.min(Math.max(nx + NODE.w / 2, BUF.x + 30), BUF.x + BUF.w - 30) : charX((O.total.start + O.total.end) / 2);
          const by = BUF.y + (nd.buf === 'doc' ? BUF.h : 27);
          line = el('path', { d: `M${nx + NODE.w / 2},${ny} C${nx + NODE.w / 2},${ny - 40} ${bx},${by + 30} ${bx},${by}`, class: `buf-line line-${nd.kind}`, opacity: 0 }, g);
        }
        return { nd, g: ng, xy: [nx, ny], line };
      });
      this.lanes[lane] = { g: L, counter, nodes };
    }
    // (the lines to the row's bytes, drawn over both lanes' panels: each
    // lane's were made with it, so the next lane's panel would cover
    // them)
    for (const lane of ['boxed', 'bytes']) for (const N of this.lanes[lane].nodes) if (N.line) g.appendChild(N.line);
    // the boxed lane's blocks, each as wide as its bytes
    this.blocks = BLOCKS.map((b) => {
      const bg = el('g', { opacity: 0 }, g);
      el('rect', { x: 0, y: 0, width: b.w, height: HEAP.blockH, rx: 3, class: 'block' }, bg);
      if (b.w > 34) txt(bg, b.w / 2, 19, `${ALLOCS[b.i].bytes}`, 'block-text', 'middle');
      return { b, g: bg };
    });
    this.noBlocks = txt(g, LANES.x.bytes + 14, HEAP.blockY + 19, 'nothing: 0 allocations, 0 bytes', 'heap-none');
    op(this.noBlocks, 0);

    // the twenty rows' tallies
    this.tallies = {};
    const max = Math.max(...ROWS.map(bytesOf));
    for (const lane of ['boxed', 'bytes']) {
      const T = el('g', { opacity: 0 }, g);
      const x0 = LANES.x[lane] + 14, base = TALLY.y + TALLY.h, lx = x0 + 20 * (TALLY.w + TALLY.gap) + 10;
      el('line', { x1: x0 - 4, x2: x0 + 20 * (TALLY.w + TALLY.gap), y1: base, y2: base, class: 'tally-axis' }, T);
      const bars = ROWS.map((r, i) => {
        const h = lane === 'boxed' ? (bytesOf(r) / max) * (TALLY.h - 18) : 0;
        const bar = el('rect', { x: x0 + i * (TALLY.w + TALLY.gap), y: base - h, width: TALLY.w, height: Math.max(h, 0.001), class: `tally ${r.native === '"true"' ? 'pass' : ''}`, opacity: 0 }, T);
        return bar;
      });
      const all = ROWS.reduce((s, r) => s + (lane === 'boxed' ? r.boxedAllocs : r.nativeAllocs), 0);
      const bytes = lane === 'boxed' ? ROWS.reduce((s, r) => s + bytesOf(r), 0) : 0;
      // (the totals, counting up as the bars come: see draw)
      void all; void bytes;
      const labels = [40, 58, 76].map((dy) => txt(T, lx, TALLY.y + dy, '', 'tally-label'));
      this.tallies[lane] = { g: T, bars, labels };
    }

    // the totals that change, boxed: as written, and boxed and written
    // back
    this.table = el('g', { opacity: 0 }, g);
    el('rect', { x: TABLE.x, y: TABLE.y, width: TABLE.w, height: TABLE.h, rx: 10, class: 'lane' }, this.table);
    // (first the question: these totals, as written, and what comes
    // back, boxed?; then the answer)
    this.tableParts = [];
    const head = (t, level, hide) => {
      const hg = el('g', {}, this.table);
      txt(hg, TABLE.x + 24, TABLE.y + 30, t, 'lane-title');
      this.tableParts.push({ el: hg, level, hide });
    };
    head(`${CHANGED.length} of the orders' totals, as written in their files. What comes back, boxed?`, 1, 2);
    head(`the ${CHANGED.length} totals that change, boxed and written back:`, 2);
    const cols = [TABLE.x + 40, TABLE.x + 230, TABLE.x + 340, TABLE.x + 390, TABLE.x + 500];
    const heads = el('g', {}, this.table);
    ['order', 'as written', '', 'boxed', 'as a'].forEach((h, k) => txt(heads, cols[k], TABLE.y + 66, h, 'table-head'));
    this.tableParts.push({ el: heads, level: 1 });
    CHANGED.forEach((r, i) => {
      const y = TABLE.y + 104 + i * 40, n = CHANGED.length;
      const hl = el('rect', { x: cols[0] - 12, y: y - 22, width: 590, height: 32, rx: 5, class: 'diff' }, this.table);
      const a = el('g', {}, this.table);
      txt(a, cols[0], y, r.file, 'table-file');
      txt(a, cols[1], y, r.order.total.bytes, 'table-bytes');
      txt(a, cols[2], y, '→', 'table-arrow');
      const ask = el('g', {}, this.table);
      txt(ask, cols[3], y, '?', 'table-ask');
      const b = el('g', {}, this.table);
      txt(b, cols[3], y, r.totalBoxed, 'table-boxed');
      txt(b, cols[4], y, r.totalType.replace('value.', ''), 'table-type');
      this.tableParts.push({ el: a, level: 1, i, n }, { el: ask, level: 1, hide: 2, i, n }, { el: hl, level: 2, i, n }, { el: b, level: 2, i, n });
    });

    // the later sections' queries, in the filter's place
    this.queries = buildQueries(g);

    // the later panels, in the lanes' place
    this.group = buildGroup(g);
    this.order = buildOrder(g);
    this.join = buildJoin(g);
    this.window = buildWindow(g);
    this.fallback = buildFallback(g);
    this.summary = buildSummary(g);

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

    // the lanes come; and go, for the table
    // the panel in the lanes' place: the last one goes, then the next
    // comes
    const pa = panelOf(A), pb = panelOf(B);
    const vis = (name) => {
      if (!field || pa === pb) return pb === name ? 1 : 0;
      if (pa === name) return 1 - easeQuad(seg(q, 0, 0.45));
      return pb === name ? easeQuad(seg(q, 0.55, 1)) : 0;
    };
    const entering = (name) => field && pa !== name && pb === name;
    const lo = vis('lanes');
    for (const lane of ['boxed', 'bytes']) {
      const L = this.lanes[lane];
      op(L.g, lo);
      // its nodes: each stage's, one at a time; a boxed one drops its
      // block onto the heap
      const n = NODES[lane].length;
      L.nodes.forEach((N) => {
        const ran = (s) => N.nd.stage < s[lane];
        const peers = L.nodes.filter((x) => x.nd.stage === N.nd.stage);
        const j = peers.indexOf(N), m = peers.length;
        let u = ran(B) ? 1 : 0;
        if (field === lane && ran(A) !== ran(B)) u = seg(q, j / m, (j + 1) / m);
        const appear = easeQuad(seg(u, 0, N.nd.kind === 'heap' ? 0.4 : 1));
        at(N.g, N.xy[0] + 30 * (1 - appear), N.xy[1]);
        op(N.g, appear * lo);
        if (N.line) op(N.line, appear * lo * 0.9);
        N.u = u;
      });
      void n;
    }
    // the blocks: each flies from its node down to its place on the heap
    let heapBytes = 0;
    this.blocks.forEach((B_, i) => {
      const N = this.lanes.boxed.nodes.find((x) => x.nd.alloc === i);
      const fly = easeQuad(seg(N.u, 0.4, 1));
      const hx = LANES.x.boxed + 14 + B_.b.x, hy = HEAP.blockY;
      const [nx, ny] = N.xy;
      at(B_.g, lerp(nx + 4, hx, fly), lerp(ny + NODE.h - 8, hy, fly));
      op(B_.g, (fly > 0 ? 1 : 0) * lo);
      if (fly >= 1) heapBytes += ALLOCS[i].bytes;
    });
    const done = (s) => s.boxed >= 4;
    setText(this.lanes.boxed.counter, done(this.cur.state) && heapBytes >= bytesOf(HERO) ? `${HERO.boxedAllocs} allocations · ${fmt(heapBytes)} bytes` : `${fmt(heapBytes)} bytes`);
    setText(this.lanes.bytes.counter, this.cur.state.bytes > 0 ? '0 bytes' : '');
    op(this.noBlocks, (this.cur.state.bytes >= 4 ? 1 : 0) * lo);
    // the bytes total's, marked in the row, while the lanes find it
    const hlOn = (s) => (panelOf(s) === 'lanes' && (s.boxed >= 2 || s.bytes >= 2) ? 1 : 0);
    op(this.bufHl, f(field, hlOn(A), hlOn(B)));

    // the twenty rows: bar by bar
    for (const lane of ['boxed', 'bytes']) {
      const T = this.tallies[lane], on = (s) => (s.twenty ? 1 : 0);
      op(T.g, (field === 'twenty' ? seg(q, 0, 0.1) : on(B) || (A.twenty ? 1 : 0)) * lo);
      let shown = 0;
      T.bars.forEach((bar, i) => {
        const v = field === 'twenty' ? seg(q, 0.1 + (i / 20) * 0.85, 0.1 + ((i + 1) / 20) * 0.85) : on(B);
        op(bar, v);
        if (v > 0) shown = i + 1;
      });
      // (the totals so far: each bar's row counted as it appears)
      const rs = ROWS.slice(0, shown);
      const allocs = rs.reduce((t, r) => t + (lane === 'boxed' ? r.boxedAllocs : r.nativeAllocs), 0);
      const bytes = lane === 'boxed' ? rs.reduce((t, r) => t + bytesOf(r), 0) : 0;
      setText(T.labels[0], `${shown} rows:`);
      setText(T.labels[1], `${fmt(allocs)} allocations`);
      setText(T.labels[2], `${fmt(bytes)} bytes`);
    }

    // the totals table: once the lanes have gone, row by row
    op(this.table, vis('table'));
    reveal(this.tableParts, 'table', A, B, q, field, 1);

    // the top: the filter and its row, or the section's query
    const filterOn = (p) => (['none', 'lanes', 'table'].includes(p) ? 1 : 0);
    const fa = filterOn(pa), fb = filterOn(pb);
    op(this.top, !field || fa === fb ? fb : fa ? 1 - easeQuad(seg(q, 0, 0.45)) : easeQuad(seg(q, 0.55, 1)));
    // (a section's query: shown from its query-alone step on, and held,
    // not faded, as its panel comes in below)
    const base = (p) => p.replace(/-q$/, '');
    const qvis = (name) => {
      const ba = base(pa), bb = base(pb);
      if (!field || ba === bb) return bb === name ? 1 : 0;
      if (ba === name) return 1 - easeQuad(seg(q, 0, 0.45));
      return bb === name ? easeQuad(seg(q, 0.55, 1)) : 0;
    };
    drawQueries(this.queries, qvis);

    // the later panels
    drawGroup(this.group, A, B, q, field, vis('group'));
    drawOrder(this.order, A, B, q, field, vis('order'));
    drawJoin(this.join, A, B, q, field, vis('join'));
    drawWindow(this.window, A, B, q, field, vis('window'));
    drawFallback(this.fallback, A, B, q, field, vis('fallback'));
    drawSummary(this.summary, A, B, q, field, vis('summary'));
  }

  setTarget(p) {
    if (!p) { this.target.setAttribute('cx', -9999); return; }
    this.target.setAttribute('cx', p[0]);
    this.target.setAttribute('cy', p[1]);
  }

  anchor(id) {
    const a = ANCHORS[id];
    return a ? { p: a.p, visible: true } : null;
  }
}

export { BYTE_W };
