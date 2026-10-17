// The 03-boxed explainer's later panels, each in the lanes' place: GROUP
// BY in both engines, row by row; ORDER BY and JOIN, compared; and which
// lane a query took, as n1k1's stats say. Part of the diagram (see
// diagram.js), which builds them once and draws them each frame.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { PANEL, GROUP as G } from './layout.js';
import { GROUP, CUSTOMERS, ORDER, JOIN } from '../lib/boxed.js';
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

// ---- each later section's query, at the top, its key terms marked ----

// a query, as runs of text: [text, marked?]
const QUERIES = {
  group: [['SELECT customer, ', 0], ['SUM(total)', 1], [', ', 0], ['COUNT(*)', 1], [' FROM orders ', 0], ['GROUP BY customer', 1]],
  order: [['SELECT * FROM orders ', 0], ['ORDER BY total DESC', 1]],
  join: [['SELECT * FROM orders o ', 0], ['JOIN', 1], [' customers c ', 0], ['ON o.customer = c.id', 1]],
  fallback: [['SELECT id FROM orders WHERE ', 0], ['STR_TO_MILLIS(ts) > STR_TO_MILLIS("2026-02-15")', 1]],
};
const QUERY_NOTES = {
  group: 'over the 20 orders: 4 groups',
  order: 'over the 20 orders',
  join: '20 orders, 4 customers: 20 joined rows',
  fallback: 'a function n1k1 can\'t yet run natively',
};
const QUERY = { x: 30, y: 22, w: 940, h: 62 };

export function buildQueries(g) {
  return Object.fromEntries(Object.entries(QUERIES).map(([name, runs]) => {
    const qg = el('g', { opacity: 0 }, g);
    el('rect', { x: QUERY.x, y: QUERY.y, width: QUERY.w, height: QUERY.h, rx: 8, class: 'expr' }, qg);
    const t = el('text', { x: QUERY.x + 16, y: QUERY.y + 27, class: 'query-text' }, qg);
    for (const [text, marked] of runs) {
      const ts = el('tspan', marked ? { class: 'query-mark' } : {}, t);
      ts.textContent = text;
    }
    txt(qg, QUERY.x + 16, QUERY.y + 48, QUERY_NOTES[name], 'expr-sub');
    return [name, qg];
  }));
}

export function drawQueries(Q, vis) {
  for (const [name, qg] of Object.entries(Q)) op(qg, vis(name));
}

// ---- GROUP BY ----

export function buildGroup(g) {
  const P = { g: el('g', { opacity: 0 }, g) };
  const root = P.g;
  el('rect', { x: PANEL.x, y: PANEL.y, width: PANEL.w, height: PANEL.h, rx: 10, class: 'lane' }, root);
  // (a dashed line between the two columns, from below the row's ticker
  // down through their heaps)
  const midX = (G.cols.cbq + G.w + G.cols.n1k1) / 2;
  el('line', { x1: midX, x2: midX, y1: PANEL.y + 62, y2: PANEL.y + PANEL.h - 12, class: 'col-divider' }, root);
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
  // the heaps
  for (const side of ['cbq', 'n1k1']) {
    const x = G.cols[side];
    el('rect', { x: x + 6, y: G.heapY, width: G.w - 12, height: G.heapH - 10, rx: 8, class: 'heap' }, root);
    txt(root, x + 18, G.heapY + 22, `the Go heap for ${side}`, 'lane-title');
  }
  P.bar = el('rect', { x: G.cols.cbq + 14, y: G.heapY + 40, width: 0, height: 34, rx: 3, class: 'block' }, root);
  P.cbqCount = txt(root, G.cols.cbq + 14, G.heapY + 100, '', 'tally-label');
  P.cbqEach = txt(root, G.cols.cbq + 14, G.heapY + 120, '', 'node-sub');
  P.cbqStages = txt(root, G.cols.cbq + 14, G.heapY + 138, '', 'node-sub');
  txt(root, G.cols.n1k1 + 14, G.heapY + 62, `${fmt(GROUP.n1k1Setup)} allocations, once, at setup`, 'tally-label');
  P.n1k1Count = txt(root, G.cols.n1k1 + 14, G.heapY + 100, '', 'tally-label');
  // each row's garbage, by stage, falling to the heap: the key it made
  // to look up its group, and the SUM and COUNT it replaced, each with
  // what that stage left behind (made last, so they're drawn over the
  // heap's panel)
  P.parcels = PARCELS.map((pc) => {
    const pg = el('g', { opacity: 0 }, root);
    el('rect', { x: 0, y: 0, width: pc.w, height: 30, rx: 5, class: 'node node-heap' }, pg);
    const t = txt(pg, 6, 13, '', 'node-title node-heap');
    txt(pg, 6, 25, `+${fmt(pc.bytes)} bytes`, 'node-sub');
    return { ...pc, g: pg, t };
  });
  txt(root, G.cols.n1k1 + 14, G.heapY + 120, 'each row updates its group\'s 16 bytes, in place', 'node-sub');
  return P;
}

const MAXW = G.w - 28;
// (the stages' bytes, per row, as measured)
const SB = Object.fromEntries(GROUP.cbqStages.map((x) => [x.stage, x.bytes]));
const ROWB = SB.key + SB.sum + SB.count;
// a row's parcels: where each starts (its cell's x, in the cbq table),
// and when it falls, in the row's stretch of the scroll
const PARCELS = [
  { stage: 'key', dx: 0, w: 120, fall: [0.08, 0.36] },
  { stage: 'sum', dx: 144, w: 136, fall: [0.46, 0.7] },
  { stage: 'count', dx: 294, w: 92, fall: [0.62, 0.86] },
].map((p) => ({ ...p, bytes: SB[p.stage] }));
// when a row's values change: after its key's fallen, before the old
// ones fall
const SWAP = 0.42;

export function drawGroup(P, A, B, q, field, vis) {
  op(P.g, vis);
  // rows applied: none, or all; or, sweeping, one at a time
  let n = B.group >= 2 ? N : 0, cur = -1, u = 0;
  if (field === 'group' && A.group === 1 && B.group === 2) {
    const x = q * N;
    cur = Math.min(N - 1, Math.floor(x));
    u = x - cur;
    n = cur + (u >= SWAP ? 1 : 0);
  }
  const st = cur >= 0 ? STEPS[cur] : null;
  setText(P.ticker, st ? `row ${cur + 1} of ${N}: ${st.customer}, total ${st.total}` : n === N ? `all ${N} rows done` : '');
  for (const side of ['cbq', 'n1k1']) {
    P.rows[side].forEach((r) => {
      const k = lastStep(n, r.c);
      op(r.g, k >= 0 || (st && st.customer === r.c && u >= SWAP) ? 1 : 0);
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
  // the row's parcels: each falls to the end of the heap's bar, and the
  // bar grows by its bytes as it lands
  let landed = (cur >= 0 ? cur : n) * ROWB;
  const prev = st ? lastStep(cur, st.customer) : -1;
  P.parcels.forEach((pc) => {
    if (!st) { op(pc.g, 0); return; }
    const w = easeQuad(seg(u, pc.fall[0], pc.fall[1]));
    const i = CUSTOMERS.indexOf(st.customer), x0 = G.cols.cbq + 12 + pc.dx - 6, y0 = G.rowY + i * G.dy - 18;
    const endX = G.cols.cbq + 14 + Math.min(MAXW - pc.w, (MAXW * landed) / (N * ROWB));
    at(pc.g, lerp(x0, endX, w), lerp(y0, G.heapY + 42, w));
    op(pc.g, u < pc.fall[0] ? (pc.stage === 'key' ? seg(u, 0, pc.fall[0]) : 0) : u >= pc.fall[1] ? 0 : 1);
    const old = prev >= 0 ? STEPS[prev] : null;
    setText(pc.t, pc.stage === 'key' ? `{"0":${st.customer}}` : pc.stage === 'sum' ? `SUM was ${old ? old.sum : 'null'}` : `COUNT was ${old ? old.count : '0'}`);
    if (u >= pc.fall[1]) landed += pc.bytes;
  });
  // the heaps: cbq's grows by each row's garbage, as it lands; n1k1's
  // doesn't
  P.bar.setAttribute('width', ((MAXW * landed) / (N * ROWB)).toFixed(1));
  const rowsDone = cur >= 0 ? cur + (u >= PARCELS[2].fall[1] ? 1 : 0) : n;
  setText(P.cbqCount, `${rowsDone} rows: ${fmt(landed)} bytes`);
  setText(P.cbqEach, `about ${Math.round(GROUP.cbqPerRow)} allocations and ${fmt(GROUP.cbqPerRowBytes)} bytes per row`);
  setText(P.cbqStages, `the key ${fmt(SB.key)} · SUM ${fmt(SB.sum)} · COUNT ${fmt(SB.count)}`);
  setText(P.n1k1Count, `${rowsDone} rows: ${GROUP.n1k1PerRow} allocations per row`);
}

// ---- ORDER BY and JOIN, compared ----

// (each one's measured cost, by stage: "n allocations, b bytes")
const cost = (x) => `${x.count} allocations, about ${fmt(x.bytes)} bytes`;
const OS = Object.fromEntries(ORDER.cbqStages.map((x) => [x.stage, x]));
const JS = Object.fromEntries(JOIN.cbqStages.map((x) => [x.stage, x]));
const ROWS3 = [
  ['ORDER BY total DESC', '20 orders', [
    'each row\'s sort key, evaluated, and kept', `as a boxed copy: ${cost(OS.SortKey)} per row;`,
    'compared with Collate, which adds', `${cost(OS.SortCompare)} per row`,
  ], [
    'each row copied into the heap\'s bytes;', `${fmt(ORDER.n1k1Setup)} allocations at setup, then`, `${Math.round(ORDER.n1k1PerRow)} per row: ${ORDER.n1k1PushBytes} bytes, Go boxing the row\'s`, '[]byte header for container/heap\'s Push',
  ]],
  ['hash JOIN on o.customer = c.id', `${JOIN.build} orders, ${JOIN.probe} customers`, [
    `build, per order: ${cost(JS.Build)}`, `probe, per customer: ${cost(JS.Probe)}`, `per joined row: ${cost(JS.Joined)}`,
  ], [
    'keys as canonical bytes, in an rhmap;', `${fmt(JOIN.n1k1Setup)} allocations at setup, then`, `${Math.round(JOIN.n1k1PerRow)} per row; a joined row is two rows\' slices`,
  ]],
];

// One of them, ORDER BY's (k = 0) or the JOIN's (1), as its own panel.
export function buildOthers(g, k) {
  const P = { g: el('g', { opacity: 0 }, g), cards: [], field: k ? 'join' : 'order' };
  const root = P.g;
  el('rect', { x: PANEL.x, y: PANEL.y, width: PANEL.w, height: PANEL.h, rx: 10, class: 'lane' }, root);
  const cx = [PANEL.x + 20, PANEL.x + 180, PANEL.x + 570], cw = 370;
  txt(root, cx[1], PANEL.y + 34, 'cbq: boxed values', 'lane-title');
  txt(root, cx[2], PANEL.y + 34, 'n1k1: bytes', 'lane-title');
  let y = PANEL.y + 70;
  for (const [name, sub, a, b] of [ROWS3[k]]) {
    const h = Math.max(a.length, b.length) * 20 + 22;
    // (the row's name comes with its cbq card)
    const ca = el('g', { opacity: 0 }, root);
    txt(ca, cx[0], y + 22, name.split(' ')[0] === 'hash' ? 'hash JOIN' : 'ORDER BY', 'others-name');
    txt(ca, cx[0], y + 40, name.replace(/^(ORDER BY|hash JOIN) ?(on )?/, ''), 'others-sub');
    txt(ca, cx[0], y + 56, sub, 'others-sub');
    el('rect', { x: cx[1] - 12, y, width: cw, height: h, rx: 8, class: 'card-cbq' }, ca);
    a.forEach((l, k) => txt(ca, cx[1], y + 24 + k * 20, l, 'others-cbq'));
    const cb = el('g', { opacity: 0 }, root);
    el('rect', { x: cx[2] - 12, y, width: cw, height: h, rx: 8, class: 'card-n1k1' }, cb);
    b.forEach((l, k) => txt(cb, cx[2], y + 24 + k * 20, l, 'others-n1k1'));
    P.cards.push(ca, cb);
    y += h + 40;
  }
  txt(root, cx[0], PANEL.y + PANEL.h - 20, k ? 'Measured: cbq\'s steps, as its execution/join_hash.go takes them (beyond boxing the rows); n1k1\'s joinHash op.' : 'Measured: cbq\'s steps, as its execution/order.go takes them (beyond boxing the rows); n1k1\'s order op.', 'others-note');
  return P;
}

// The cards: as many as the state's level, each new one sliding in.
export function drawOthers(P, A, B, q, field, vis, entering) {
  op(P.g, vis);
  P.cards.forEach((c, i) => {
    const on = (s) => (i < s[P.field] ? 1 : 0);
    let u = on(B);
    if (field === P.field && on(A) !== on(B)) u = entering ? seg(q, 0.65, 1) : seg(q, 0.15, 0.85);
    const e = easeQuad(u);
    at(c, 30 * (1 - e), 0);
    op(c, e * vis);
  });
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
