// The 03-boxed explainer's later panels, each in the lanes' place: GROUP
// BY in both engines, row by row; ORDER BY and JOIN, compared; and which
// lane a query took, as n1k1's stats say. Part of the diagram (see
// diagram.js), which builds them once and draws them each frame.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { PANEL, GROUP as G } from './layout.js';
import { GROUP, CUSTOMERS } from '../lib/boxed.js';
import { RUN } from '../lib/query.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const at = (e, x, y) => e.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
const seg = (q, a, b) => clamp01((q - a) / (b - a));
const fmt = (n) => n.toLocaleString('en-US');
const STEPS = GROUP.steps;
const N = STEPS.length;

// each group's last step, after the first n rows (-1: not yet seen)
const lastStep = (n, c) => {
  let k = -1;
  for (let i = 0; i < n; i++) if (STEPS[i].customer === c) k = i;
  return k;
};

// ---- GROUP BY ----

export function buildGroup(g) {
  const P = { g: el('g', { opacity: 0 }, g) };
  const root = P.g;
  el('rect', { x: PANEL.x, y: PANEL.y, width: PANEL.w, height: G.heapY - PANEL.y - 16, rx: 10, class: 'lane' }, root);
  txt(root, PANEL.x + 14, PANEL.y + 24, 'SELECT customer, SUM(total), COUNT(*) FROM orders GROUP BY customer', 'group-query');
  P.ticker = txt(root, PANEL.x + 14, PANEL.y + 50, '', 'group-ticker');
  const heads = {
    cbq: ["cbq's groups: a Go map; each aggregate, a boxed value", ['key: a string', 'SUM', 'COUNT']],
    n1k1: ["n1k1's groups: an rhmap of bytes", ['key: bytes', 'SUM: a float64, 8 bytes', 'COUNT: 8 bytes']],
  };
  const colX = { cbq: [0, 150, 300], n1k1: [0, 80, 245] };
  P.rows = {};
  for (const side of ['cbq', 'n1k1']) {
    const x0 = G.cols[side] + 12;
    txt(root, x0, PANEL.y + 84, heads[side][0], 'lane-title');
    heads[side][1].forEach((h, k) => txt(root, x0 + colX[side][k], PANEL.y + 108, h, 'stage-name'));
    P.rows[side] = CUSTOMERS.map((c, i) => {
      const y = G.rowY + i * G.dy;
      const rg = el('g', { opacity: 0 }, root);
      const hl = el('rect', { x: G.cols[side] + 4, y: y - 26, width: G.w - 8, height: G.dy - 6, rx: 6, class: 'group-hl', opacity: 0 }, rg);
      const r = { g: rg, hl, c };
      if (side === 'cbq') {
        txt(rg, x0, y, `{"0":${c}}`, 'group-key');
        r.sumBox = el('rect', { x: x0 + colX.cbq[1] - 6, y: y - 18, width: 136, height: 30, rx: 5, class: 'node node-heap' }, rg);
        r.sum = txt(rg, x0 + colX.cbq[1], y - 3, '', 'node-title node-heap');
        txt(rg, x0 + colX.cbq[1], y + 9, 'a floatValue', 'node-sub');
        el('rect', { x: x0 + colX.cbq[2] - 6, y: y - 18, width: 92, height: 30, rx: 5, class: 'node node-heap' }, rg);
        r.count = txt(rg, x0 + colX.cbq[2], y - 3, '', 'node-title node-heap');
        txt(rg, x0 + colX.cbq[2], y + 9, 'an intValue', 'node-sub');
      } else {
        txt(rg, x0, y, c, 'group-key');
        r.sum = txt(rg, x0 + colX.n1k1[1], y - 3, '', 'group-hex');
        r.sumV = txt(rg, x0 + colX.n1k1[1], y + 10, '', 'node-sub');
        r.count = txt(rg, x0 + colX.n1k1[2], y - 3, '', 'group-hex');
        r.countV = txt(rg, x0 + colX.n1k1[2], y + 10, '', 'node-sub');
      }
      return r;
    });
  }
  // the old boxed values, as they're replaced: falling to the heap
  P.ghost = el('g', { opacity: 0 }, root);
  el('rect', { x: 0, y: 0, width: 136, height: 30, rx: 5, class: 'node node-heap' }, P.ghost);
  P.ghostText = txt(P.ghost, 6, 15, '', 'node-title node-heap');
  // the heaps
  for (const side of ['cbq', 'n1k1']) {
    const x = G.cols[side];
    el('rect', { x, y: G.heapY, width: G.w, height: G.heapH, rx: 10, class: 'heap' }, root);
    txt(root, x + 12, G.heapY + 22, 'the Go heap', 'lane-title');
  }
  P.bar = el('rect', { x: G.cols.cbq + 14, y: G.heapY + 40, width: 0, height: 34, rx: 3, class: 'block' }, root);
  P.cbqCount = txt(root, G.cols.cbq + 14, G.heapY + 100, '', 'tally-label');
  P.cbqEach = txt(root, G.cols.cbq + 14, G.heapY + 120, '', 'node-sub');
  P.cbqStages = txt(root, G.cols.cbq + 14, G.heapY + 138, '', 'node-sub');
  txt(root, G.cols.n1k1 + 14, G.heapY + 62, `${fmt(GROUP.n1k1Setup)} allocations, once, at setup`, 'tally-label');
  P.n1k1Count = txt(root, G.cols.n1k1 + 14, G.heapY + 100, '', 'tally-label');
  txt(root, G.cols.n1k1 + 14, G.heapY + 120, 'each row updates its group\'s 16 bytes, in place', 'node-sub');
  return P;
}

const MAXW = G.w - 28;

export function drawGroup(P, A, B, q, field, vis) {
  op(P.g, vis);
  // rows applied: none, or all; or, sweeping, one at a time
  let n = B.group >= 2 ? N : 0, cur = -1, u = 0;
  if (field === 'group' && A.group === 1 && B.group === 2) {
    const x = q * N;
    cur = Math.min(N - 1, Math.floor(x));
    u = x - cur;
    n = cur + (u >= 0.5 ? 1 : 0);
  }
  const st = cur >= 0 ? STEPS[cur] : null;
  setText(P.ticker, st ? `row ${cur + 1} of ${N}: ${st.customer}, total ${st.total}` : n === N ? `all ${N} rows done` : '');
  for (const side of ['cbq', 'n1k1']) {
    P.rows[side].forEach((r) => {
      const k = lastStep(n, r.c);
      op(r.g, k >= 0 || (st && st.customer === r.c && u >= 0.3) ? 1 : 0);
      op(r.hl, st && st.customer === r.c ? Math.sin(Math.PI * u) : 0);
      const s = k >= 0 ? STEPS[k] : null;
      if (side === 'cbq') {
        setText(r.sum, s ? s.sum : '');
        setText(r.count, s ? s.count : '');
      } else {
        setText(r.sum, s ? s.sumHex : '');
        setText(r.sumV, s ? `= ${s.sum}` : '');
        setText(r.count, s ? s.countHex : '');
        setText(r.countV, s ? `= ${s.count}` : '');
      }
    });
  }
  // (the boxed SUM it replaced, falling to the heap)
  const prev = st ? lastStep(cur, st.customer) : -1;
  if (st && prev >= 0 && u >= 0.5) {
    const i = CUSTOMERS.indexOf(st.customer), w = easeQuad(seg(u, 0.5, 1));
    at(P.ghost, lerp(G.cols.cbq + 156, G.cols.cbq + 14 + MAXW * (cur / N), w), lerp(G.rowY + i * G.dy - 18, G.heapY + 42, w));
    setText(P.ghostText, STEPS[prev].sum);
    op(P.ghost, 1 - w * 0.8);
  } else op(P.ghost, 0);
  // the heaps: cbq's grows by each row's garbage; n1k1's doesn't
  const rows = cur >= 0 ? cur + u : n;
  P.bar.setAttribute('width', (MAXW * (rows / N)).toFixed(1));
  setText(P.cbqCount, `${Math.round(rows)} rows: ${fmt(Math.round(rows * GROUP.cbqPerRowBytes))} bytes`);
  setText(P.cbqEach, `about ${Math.round(GROUP.cbqPerRow)} allocations and ${fmt(GROUP.cbqPerRowBytes)} bytes a row`);
  const S = Object.fromEntries(GROUP.cbqStages.map((x) => [x.stage, x]));
  setText(P.cbqStages, `the key ${fmt(S.key.bytes)} · SUM ${fmt(S.sum.bytes)} · COUNT ${fmt(S.count.bytes)}`);
  setText(P.n1k1Count, `${Math.round(rows)} rows: ${GROUP.n1k1PerRow} allocations a row`);
}

// ---- ORDER BY and JOIN, compared ----

const ROWS3 = [
  ['ORDER BY', [
    'each row a boxed value; its sort keys', 'evaluated, and kept as boxed copies;', 'compared with Collate; spilled by', 'writing values out, re-boxed on reading',
  ], [
    'each row copied into the heap\'s bytes:', 'its sort key made canonical, the row', 'as is; compared by reading the JSON', 'bytes; the heap spills in chunks',
  ]],
  ['hash JOIN', [
    'boxed keys, marshaled to JSON just to', 'hash them; an entry object per build', 'row, in memory only; a new joined', 'value for every candidate pair',
  ], [
    'the key\'s canonical bytes, in an rhmap;', 'build rows copied once into chunks,', 'which can spill; a joined row is the', 'two rows\' slices, side by side',
  ]],
  ['nested-loop JOIN', [
    'the inner side re-run per outer row;', 'a new joined value for every pair,', 'with the ON clause evaluated boxed',
  ], [
    'the inner side re-run per outer row;', 'a joined row is slices; the ON clause', 'native, if it can be',
  ]],
];

export function buildOthers(g) {
  const P = { g: el('g', { opacity: 0 }, g), rows: [] };
  const root = P.g;
  el('rect', { x: PANEL.x, y: PANEL.y, width: PANEL.w, height: PANEL.h, rx: 10, class: 'lane' }, root);
  const cx = [PANEL.x + 20, PANEL.x + 180, PANEL.x + 570];
  txt(root, cx[1], PANEL.y + 34, 'cbq: boxed values', 'lane-title');
  txt(root, cx[2], PANEL.y + 34, 'n1k1: bytes', 'lane-title');
  let y = PANEL.y + 74;
  for (const [name, a, b] of ROWS3) {
    const rg = el('g', { opacity: 0 }, root);
    txt(rg, cx[0], y, name, 'others-name');
    a.forEach((l, k) => txt(rg, cx[1], y + k * 18, l, 'others-cbq'));
    b.forEach((l, k) => txt(rg, cx[2], y + k * 18, l, 'others-n1k1'));
    P.rows.push(rg);
    y += Math.max(a.length, b.length) * 18 + 36;
  }
  txt(root, cx[0], PANEL.y + PANEL.h - 20, 'From reading both engines\' code (cbq\'s execution/order.go, join_hash.go, join_nl.go; n1k1\'s op_order.go, op_join_hash.go, op_join_nl.go): not measured here.', 'others-note');
  return P;
}

export function drawOthers(P, A, B, q, field, vis, entering) {
  op(P.g, vis);
  P.rows.forEach((r, i) => op(r, entering ? seg(q, 0.55 + i * 0.13, 0.7 + i * 0.13) : vis));
}

// ---- which lane: n1k1's stats ----

export function buildFallback(g) {
  const P = { g: el('g', { opacity: 0 }, g), cards: [] };
  const root = P.g;
  el('rect', { x: PANEL.x, y: PANEL.y, width: PANEL.w, height: PANEL.h, rx: 10, class: 'lane' }, root);
  txt(root, PANEL.x + 20, PANEL.y + 34, 'which lane did a query take? n1k1 -stats final says', 'lane-title');
  RUN.lanes.forEach((l, k) => {
    const cg = el('g', { opacity: 0 }, root);
    const y0 = PANEL.y + 64 + k * 210;
    el('rect', { x: PANEL.x + 20, y: y0, width: PANEL.w - 40, height: 170, rx: 8, class: 'term' }, cg);
    txt(cg, PANEL.x + 36, y0 + 28, `$ n1k1 -stats final -c '${l.query}' examples/shop`, 'term-cmd');
    l.stats.forEach((s, i) => {
      const boxed = s.startsWith('expr:');
      if (boxed) el('rect', { x: PANEL.x + 30, y: y0 + 46 + i * 22, width: 420, height: 22, rx: 4, class: 'term-hl' }, cg);
      txt(cg, PANEL.x + 36, y0 + 62 + i * 22, s, `term-text${boxed ? ' boxed' : ''}`);
    });
    if (!l.stats.some((s) => s.startsWith('expr:'))) txt(cg, PANEL.x + 36, y0 + 62 + l.stats.length * 22, '(no expr line: every expression ran native)', 'term-note');
    P.cards.push(cg);
  });
  return P;
}

export function drawFallback(P, A, B, q, field, vis, entering) {
  op(P.g, vis);
  P.cards.forEach((c, i) => op(c, entering ? seg(q, 0.55 + i * 0.2, 0.75 + i * 0.2) : vis));
}
