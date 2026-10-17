// The 03-boxed explainer's ORDER BY and JOIN panels, each in the lanes'
// place, animated like GROUP BY's: cbq's column left, n1k1's right,
// row by row, each engine's measured costs falling as parcels onto its
// own heap, whose bar grows by each as it lands. Part of the diagram
// (see diagram.js), which builds them once and draws them each frame.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { PANEL, GROUP as G } from './layout.js';
import { ROWS, ORDER, JOIN, WINDOW, WINDOW_ROWS } from '../lib/boxed.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const at = (e, x, y) => e.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
const seg = (q, a, b) => clamp01((q - a) / (b - a));
const fmt = (n) => n.toLocaleString('en-US');
const SIDES = ['cbq', 'n1k1'];
const MAXW = G.w - 40;
const BAR_Y = G.heapY + 38;

// The frame both panels share: two columns, a dashed line between them,
// and a heap at the bottom of each, with its bar and its captions.
function frame(root, titles) {
  el('rect', { x: PANEL.x, y: PANEL.y, width: PANEL.w, height: PANEL.h, rx: 10, class: 'lane' }, root);
  const midX = (G.cols.cbq + G.w + G.cols.n1k1) / 2;
  el('line', { x1: midX, x2: midX, y1: PANEL.y + 14, y2: PANEL.y + PANEL.h - 12, class: 'col-divider' }, root);
  const H = {};
  for (const side of SIDES) {
    const x = G.cols[side];
    txt(root, x + 12, PANEL.y + 26, titles[side], 'lane-title');
    el('rect', { x: x + 6, y: G.heapY, width: G.w - 12, height: G.heapH - 10, rx: 8, class: 'heap' }, root);
    txt(root, x + 18, G.heapY + 22, `the Go heap for ${side}`, 'lane-title');
    H[side] = {
      bar: el('rect', { x: x + 18, y: BAR_Y, width: 0, height: 30, rx: 3, class: 'block' }, root),
      count: txt(root, x + 18, BAR_Y + 56, '', 'tally-label'),
      notes: [0, 1, 2].map((k) => txt(root, x + 18, BAR_Y + 78 + k * 17, '', 'node-sub')),
    };
  }
  return H;
}

// A parcel: what a step left on its engine's heap, falling to the end
// of its bar.
function parcel(root, side) {
  const g = el('g', { opacity: 0 }, root);
  el('rect', { x: 0, y: 0, width: 92, height: 28, rx: 5, class: side === 'cbq' ? 'node node-heap' : 'node node-slice' }, g);
  const t = txt(g, 6, 12, '', `node-title ${side === 'cbq' ? 'node-heap' : 'node-slice'}`);
  const b = txt(g, 6, 24, '', 'node-sub');
  return { g, t, b };
}

// Draws a parcel partway (u, 0..1) from (x0, y0) to its side's bar's end.
function fall(P, side, u, x0, y0, landedBytes, total, title, bytes) {
  const p = P.parcels[side];
  if (u <= 0 || u >= 1) { op(p.g, 0); return; }
  const endX = G.cols[side] + 18 + Math.min(MAXW - 92, (MAXW * landedBytes) / total);
  const w = easeQuad(u);
  at(p.g, lerp(x0, endX, w), lerp(y0, BAR_Y + 1, w));
  setText(p.t, title);
  setText(p.b, `+${fmt(bytes)} bytes`);
  op(p.g, 1);
}

function setBar(H, side, bytes, total) {
  H[side].bar.setAttribute('width', ((MAXW * bytes) / total).toFixed(1));
}

// ---- ORDER BY total DESC ----

const OS = Object.fromEntries(ORDER.cbqStages.map((x) => [x.stage, x]));
// (each row's measured costs, and the total, for the bars' scale)
const O_KEY = OS.SortKey.bytes, O_CMP = OS.SortCompare.bytes, O_PUSH = ORDER.n1k1PushBytes;
const O_TOTAL = ROWS.length * (O_KEY + O_CMP);
// the rows' places once sorted, by total, descending
const RANK = (() => {
  const idx = ROWS.map((r, i) => i).sort((a, b) => parseFloat(ROWS[b].order.total.bytes) - parseFloat(ROWS[a].order.total.bytes) || a - b);
  const rank = [];
  idx.forEach((i, k) => (rank[i] = k));
  return rank;
})();
const O_ROW = { y: PANEL.y + 54, dy: 15.5 };

export function buildOrder(g) {
  const P = { g: el('g', { opacity: 0 }, g), rows: {}, parcels: {} };
  const root = P.g;
  P.heaps = frame(root, { cbq: "cbq: rows boxed; each one's sort key, a boxed copy", n1k1: "n1k1: each row copied into its sort heap's bytes" });
  for (const side of SIDES) {
    const x0 = G.cols[side] + 14;
    // (each row's path in the sort, drawn as it travels, and left, faint)
    P.trails = P.trails || {};
    P.trails[side] = ROWS.map(() => el('path', { class: 'sort-trail', opacity: 0, pathLength: 1 }, root));
    P.rows[side] = ROWS.map((r) => {
      const rg = el('g', {}, root);
      el('rect', { x: x0 - 6, y: -11, width: 340, height: 15, rx: 3, class: 'sort-hl', opacity: 0 }, rg);
      txt(rg, x0, 0, r.file.replace('.json', ''), 'sort-row');
      // (its total, aligned on the decimal point: the whole part to its
      // left, the rest from it)
      const [whole, frac] = r.order.total.bytes.split('.');
      txt(rg, x0 + 132, 0, whole, 'sort-total', 'end');
      if (frac !== undefined) txt(rg, x0 + 132, 0, `.${frac}`, 'sort-total');
      const chip = el('g', { opacity: 0 }, rg);
      if (side === 'cbq') {
        el('rect', { x: x0 + 170, y: -10, width: 150, height: 13, rx: 3, class: 'node node-heap' }, chip);
        txt(chip, x0 + 176, 0, `key: ${r.totalBoxed}, a boxed copy`, 'sort-chip node-heap');
      } else {
        el('rect', { x: x0 + 170, y: -10, width: 150, height: 13, rx: 3, class: 'node node-slice' }, chip);
        txt(chip, x0 + 176, 0, 'key and row, as bytes', 'sort-chip node-slice');
      }
      return { g: rg, chip };
    });
    P.parcels[side] = parcel(root, side);
  }
  return P;
}

// The steps: 1, the rows, unsorted; 2, each row taken in (row by row);
// 3, the sort.
export function drawOrder(P, A, B, q, field, vis) {
  op(P.g, vis);
  const N = ROWS.length;
  const lvl = (s) => Math.max(0, s.order - 1); // (its level 1 is the query alone)
  let taken = lvl(B) >= 2 ? N : 0, cur = -1, u = 0, sortU = lvl(B) >= 3 ? 1 : 0;
  if (field === 'order' && lvl(A) === 1 && lvl(B) === 2) {
    const x = q * N;
    cur = Math.min(N - 1, Math.floor(x));
    u = x - cur;
    taken = cur;
  }
  if (field === 'order' && lvl(A) === 2 && lvl(B) === 3) sortU = q;
  // The sort, as insertions, one sorted place at a time: for place k,
  // the rows between the next row and place k move down one, making
  // room, then that row travels into place on an arc, like a right
  // paren, out to the right and back (the farther, the wider).
  const k = sortU >= 1 ? N : Math.min(N - 1, Math.floor(sortU * N)), v = sortU >= 1 ? 1 : sortU * N - k;
  const room = easeQuad(seg(v, 0, 0.25)), move = easeQuad(seg(v, 0.25, 0.6));
  // (a row's slot: placed rows at their ranks; the rest after them, in
  // their first order)
  const slotAt = (i, placed) => {
    if (RANK[i] < placed) return RANK[i];
    return placed + ROWS.filter((_, j) => RANK[j] >= placed && j < i).length;
  };
  const m = k < N ? RANK.indexOf(k) : -1;
  // (a row's arc into place k: its x and slot at progress t)
  const arc = (i, from, to, t) => [Math.min(110, 0.5 * Math.abs(from - to) * O_ROW.dy) * Math.sin(Math.PI * t), lerp(from, to, t)];
  const place = (i) => {
    if (sortU <= 0) return [0, i];
    if (k >= N || RANK[i] < k) return [0, RANK[i]];
    if (i === m) return arc(i, slotAt(i, k), k, move);
    // (a row the moving one passes: down one, making room)
    const from = slotAt(i, k), to = from < slotAt(m, k) ? from + 1 : from;
    return [0, lerp(from, to, room)];
  };
  const rowY = (slot) => O_ROW.y + slot * O_ROW.dy;
  let cbqBytes = taken * O_KEY, n1k1Bytes = taken * O_PUSH;
  for (const side of SIDES) {
    P.rows[side].forEach((r, i) => {
      const [x, slot] = place(i);
      at(r.g, x, rowY(slot));
      op(r.chip, i < taken || (i === cur && u >= 0.25) ? 1 : 0);
      // (the moving row, lit; and its path: drawn behind it as it goes,
      // then left, faint, once it's in place)
      op(r.g.firstChild, i === m && sortU > 0 && sortU < 1 ? Math.sin(Math.PI * move) : 0);
      const tr = P.trails[side][i];
      if (sortU > 0 && RANK[i] <= k && RANK[i] < N) {
        // (traced from the row's right end, past its chip, in the clear)
        const from = slotAt(i, RANK[i]), to = RANK[i], x0 = G.cols[side] + 14 + 170 + 154;
        const pts = Array.from({ length: 25 }, (_, j) => arc(i, from, to, j / 24)).map(([px, sl]) => `${(x0 + px).toFixed(1)},${(rowY(sl) - 4).toFixed(1)}`);
        tr.setAttribute('d', `M${pts.join(' L')}`);
        const drawn = i === m ? move : 1;
        tr.style.strokeDashoffset = (1 - drawn).toFixed(3);
        op(tr, from === to ? 0 : i === m ? 0.9 : 0.3);
      } else op(tr, 0);
    });
  }
  // the row being taken in: its key (or copy) made, then its parcel
  // falls
  if (cur >= 0) {
    const y = rowY(cur) - 12;
    fall(P, 'cbq', seg(u, 0.35, 0.95), G.cols.cbq + 184, y, cbqBytes, O_TOTAL, 'its sort key', O_KEY);
    fall(P, 'n1k1', seg(u, 0.35, 0.95), G.cols.n1k1 + 184, y, n1k1Bytes, O_TOTAL, 'its []byte header', O_PUSH);
    if (u >= 0.95) { cbqBytes += O_KEY; n1k1Bytes += O_PUSH; }
  } else if (sortU > 0 && sortU < 1) {
    // (the sort: cbq's compares leave a little for each place, once its
    // row's in it; n1k1's leave nothing)
    cbqBytes += k * O_CMP;
    fall(P, 'cbq', seg(v, 0.6, 0.95), G.cols.cbq + 184, rowY(k) - 12, cbqBytes, O_TOTAL, 'compares', O_CMP);
    op(P.parcels.n1k1.g, 0);
    if (v >= 0.95) cbqBytes += O_CMP;
  } else {
    op(P.parcels.cbq.g, 0); op(P.parcels.n1k1.g, 0);
    if (sortU >= 1) cbqBytes += N * O_CMP;
  }
  setBar(P.heaps, 'cbq', cbqBytes, O_TOTAL);
  setBar(P.heaps, 'n1k1', n1k1Bytes, O_TOTAL);
  const rows = cur >= 0 ? cur + (u >= 0.95 ? 1 : 0) : taken;
  setText(P.heaps.cbq.count, `${rows} rows${sortU > 0 ? ', sorted' : ''}: ${fmt(cbqBytes)} bytes`);
  setText(P.heaps.n1k1.count, `${rows} rows${sortU > 0 ? ', sorted' : ''}: ${fmt(n1k1Bytes)} bytes`);
  [`each sort key: ${OS.SortKey.count} allocations, about ${fmt(O_KEY)} bytes`, `compares, with Collate: ${OS.SortCompare.count} more, about ${O_CMP} bytes per row`, '']
    .forEach((t, k) => setText(P.heaps.cbq.notes[k], t));
  [`${fmt(ORDER.n1k1Setup)} allocations, once, at setup;`, `then ${Math.round(ORDER.n1k1PerRow)} per row: ${O_PUSH} bytes, Go boxing the row's`, "[]byte header for container/heap's Push; compares, 0"]
    .forEach((t, k) => setText(P.heaps.n1k1.notes[k], t));
}

// ---- the hash JOIN of orders and customers ----

const JS = Object.fromEntries(JOIN.cbqStages.map((x) => [x.stage, x]));
const J_BUILD = JS.Build.bytes, J_PROBE = JS.Probe.bytes, J_JOINED = JS.Joined.bytes;
// the customers, as the probe side reads them; each one's orders
const CUST = ['"alice"', '"bob"', '"carol"', '"dave"'];
const BUCKET = ROWS.map((r) => CUST.indexOf(r.order.customer.bytes));
// the probe's events: each customer looked up, then each of its matches
// joined
const PROBE = CUST.flatMap((c, k) => [{ k }, ...ROWS.map((r, i) => i).filter((i) => BUCKET[i] === k).map((i) => ({ k, i }))]);
const J_TOTAL = ROWS.length * J_BUILD + CUST.length * J_PROBE + ROWS.length * J_JOINED;
const J = { inY: PANEL.y + 62, chip: 19, gap: 2, bY: PANEL.y + 112, bdy: 42, outY: PANEL.y + 318 };
const inXY = (side, i) => [G.cols[side] + 14 + i * (J.chip + J.gap), J.inY];
const slot = (i) => ROWS.slice(0, i).filter((_, j) => BUCKET[j] === BUCKET[i]).length;
const bucketXY = (side, i) => [G.cols[side] + 96 + slot(i) * (J.chip + J.gap), J.bY + BUCKET[i] * J.bdy];
const outXY = (side, n) => [G.cols[side] + 14 + n * (J.chip + J.gap), J.outY];

export function buildJoin(g) {
  const P = { g: el('g', { opacity: 0 }, g), parcels: {}, sides: {} };
  const root = P.g;
  P.heaps = frame(root, { cbq: 'cbq: boxed rows, a hash table of entries', n1k1: "n1k1: an rhmap, keyed by the key's bytes" });
  for (const side of SIDES) {
    const x0 = G.cols[side] + 14, S = { orders: [], cust: [], out: [] };
    txt(root, x0, J.inY - 14, 'the build side: the 20 orders', 'stage-name');
    txt(root, x0, J.bY - 22, side === 'cbq' ? 'the hash table: a boxed key, marshaled to hash it' : 'the rhmap: the key\'s canonical bytes', 'stage-name');
    txt(root, x0, J.outY - 14, side === 'cbq' ? 'joined rows: each a new boxed value' : 'joined rows: two rows\' slices, side by side', 'stage-name');
    CUST.forEach((c, k) => {
      const cg = el('g', {}, root);
      const r = el('rect', { x: x0, y: J.bY + k * J.bdy - 2, width: 70, height: 20, rx: 4, class: 'cust' }, cg);
      txt(cg, x0 + 6, J.bY + k * J.bdy + 12, c, 'cust-text');
      S.cust.push({ g: cg, r });
    });
    ROWS.forEach((row, i) => {
      const og = el('g', {}, root);
      el('rect', { x: 0, y: 0, width: J.chip, height: 16, rx: 3, class: side === 'cbq' ? 'node node-heap' : 'node node-slice' }, og);
      txt(og, J.chip / 2, 12, row.order.id.bytes.slice(-3, -1), `chip-text ${side === 'cbq' ? 'node-heap' : 'node-slice'}`, 'middle');
      S.orders.push(og);
      const jg = el('g', { opacity: 0 }, root);
      el('rect', { x: 0, y: 0, width: J.chip, height: 16, rx: 3, class: side === 'cbq' ? 'node node-heap' : 'node joined-slice' }, jg);
      txt(jg, J.chip / 2, 12, row.order.id.bytes.slice(-3, -1), `chip-text ${side === 'cbq' ? 'node-heap' : 'node-slice'}`, 'middle');
      S.out.push(jg);
    });
    P.sides[side] = S;
    P.parcels[side] = parcel(root, side);
  }
  return P;
}

// The steps: 1, the orders, waiting; 2, the build (order by order); 3,
// the probe (customer by customer, each match joined).
export function drawJoin(P, A, B, q, field, vis) {
  op(P.g, vis);
  const N = ROWS.length, E = PROBE.length, lvl = (s) => Math.max(0, s.join - 1); // (its level 1 is the query alone)
  let built = lvl(B) >= 2 ? N : 0, bcur = -1, bu = 0, done = lvl(B) >= 3 ? E : 0, pcur = -1, pu = 0;
  if (field === 'join' && lvl(A) === 1 && lvl(B) === 2) {
    const x = q * N;
    bcur = Math.min(N - 1, Math.floor(x)); bu = x - bcur; built = bcur;
  }
  if (field === 'join' && lvl(A) === 2 && lvl(B) === 3) {
    const x = q * E;
    pcur = Math.min(E - 1, Math.floor(x)); pu = x - pcur; done = pcur;
  }
  // (bytes landed so far: the build's, the probes', the joined rows')
  const evs = PROBE.slice(0, done);
  let cbqBytes = built * J_BUILD + evs.filter((e) => e.i === undefined).length * J_PROBE + evs.filter((e) => e.i !== undefined).length * J_JOINED;
  const joinedBefore = (n) => PROBE.slice(0, n).filter((e) => e.i !== undefined).length;
  for (const side of SIDES) {
    const S = P.sides[side];
    // the orders: waiting, or in their buckets (the one being built, on
    // its way)
    S.orders.forEach((og, i) => {
      let w = i < built ? 1 : 0;
      if (i === bcur) w = easeQuad(seg(bu, 0, 0.4));
      const [ax, ay] = inXY(side, i), [bx, by] = bucketXY(side, i);
      at(og, lerp(ax, bx, w), lerp(ay, by, w));
    });
    // the customers: the one being looked up, lit
    S.cust.forEach((c, k) => op(c.r, pcur >= 0 && PROBE[pcur].k === k ? 1 : 0.45));
    // the joined rows: each, as its match is made, from its bucket
    S.out.forEach((jg) => op(jg, 0));
    PROBE.forEach((e, n) => {
      if (e.i === undefined || n > (pcur >= 0 ? pcur : done - 1)) return;
      const jg = S.out[e.i], m = joinedBefore(n);
      const w = n === pcur ? easeQuad(seg(pu, 0, 0.4)) : 1;
      const [bx, by] = bucketXY(side, e.i), [ox, oy] = outXY(side, m);
      at(jg, lerp(bx, ox, w), lerp(by, oy, w));
      op(jg, 1);
    });
  }
  // the parcels: cbq's, for each order put in, each customer looked up,
  // and each row joined; n1k1's heap stays as it is
  op(P.parcels.n1k1.g, 0);
  if (bcur >= 0) {
    const [bx, by] = bucketXY('cbq', bcur);
    fall(P, 'cbq', seg(bu, 0.45, 0.95), bx, by, cbqBytes, J_TOTAL, 'an entry', J_BUILD);
    if (bu >= 0.95) cbqBytes += J_BUILD;
  } else if (pcur >= 0) {
    const e = PROBE[pcur];
    const [x, y] = e.i === undefined ? [G.cols.cbq + 14, J.bY + e.k * J.bdy] : outXY('cbq', joinedBefore(pcur));
    const b = e.i === undefined ? J_PROBE : J_JOINED;
    fall(P, 'cbq', seg(pu, 0.45, 0.95), x, y, cbqBytes, J_TOTAL, e.i === undefined ? 'a lookup' : 'a joined row', b);
    if (pu >= 0.95) cbqBytes += b;
  } else op(P.parcels.cbq.g, 0);
  setBar(P.heaps, 'cbq', cbqBytes, J_TOTAL);
  setBar(P.heaps, 'n1k1', 0, J_TOTAL);
  const joined = joinedBefore(pcur >= 0 ? pcur + (pu >= 0.4 ? 1 : 0) : done);
  setText(P.heaps.cbq.count, `${fmt(cbqBytes)} bytes`);
  setText(P.heaps.n1k1.count, '0 bytes');
  [`per order put in: ${JS.Build.count} allocations, about ${fmt(J_BUILD)} bytes`, `per customer looked up: ${JS.Probe.count}, about ${fmt(J_PROBE)} bytes`, `per joined row: ${JS.Joined.count}, about ${fmt(J_JOINED)} bytes (${joined} so far)`]
    .forEach((t, k) => setText(P.heaps.cbq.notes[k], t));
  [`${fmt(JOIN.n1k1Setup)} allocations, once, at setup;`, `then ${Math.round(JOIN.n1k1PerRow)} per row: orders copied into chunks,`, `and a joined row is slices (${joined} so far)`]
    .forEach((t, k) => setText(P.heaps.n1k1.notes[k], t));
}

// ---- a window function: SUM(total) OVER (PARTITION BY customer ORDER BY id) ----

const WS = Object.fromEntries(WINDOW.cbqStages.map((x) => [x.stage, x]));
const W_ROW = WS.WindowRow.bytes;
const W_TOTAL = WINDOW_ROWS.length * W_ROW;
const W = { y: PANEL.y + 56, dy: 14.5 };
// (a partition's first row: where a gap goes above it)
const W_NEW = WINDOW_ROWS.map((r, i) => i === 0 || r.customer !== WINDOW_ROWS[i - 1].customer);
const W_Y = (() => {
  let gaps = 0;
  return WINDOW_ROWS.map((r, i) => {
    if (i > 0 && W_NEW[i]) gaps++;
    return W.y + i * W.dy + gaps * 6;
  });
})();
// a number's text, aligned on its decimal point at x
function decimal(g, x, y, t, cls) {
  const [whole, frac] = String(t).split('.');
  txt(g, x, y, whole, cls, 'end');
  if (frac !== undefined) txt(g, x, y, `.${frac}`, cls);
}

export function buildWindow(g) {
  const P = { g: el('g', { opacity: 0 }, g), rows: {}, parcels: {} };
  const root = P.g;
  P.heaps = frame(root, { cbq: 'cbq: a boxed running sum, per row', n1k1: 'n1k1: an 8-byte running sum, in place' });
  for (const side of SIDES) {
    const x0 = G.cols[side] + 14;
    P.rows[side] = WINDOW_ROWS.map((r, i) => {
      const y = W_Y[i];
      const rg = el('g', {}, root);
      el('rect', { x: x0 - 6, y: y - 11, width: 420, height: 15, rx: 3, class: 'sort-hl', opacity: 0 }, rg);
      txt(rg, x0, y, r.id, 'sort-row');
      txt(rg, x0 + 40, y, r.customer, 'sort-row');
      decimal(rg, x0 + 128, y, r.totalText, 'sort-total');
      const chip = el('g', { opacity: 0 }, rg);
      el('rect', { x: x0 + 176, y: y - 10, width: 220, height: 13, rx: 3, class: side === 'cbq' ? 'node node-heap' : 'node node-slice' }, chip);
      txt(chip, x0 + 182, y, `running: ${r.runningText}${side === 'cbq' ? ', boxed' : ', bytes'}`, `sort-chip ${side === 'cbq' ? 'node-heap' : 'node-slice'}`);
      return { g: rg, chip };
    });
    P.parcels[side] = parcel(root, side);
  }
  return P;
}

// The steps: 1, the rows, in their partitions; 2, row by row, each one's
// running total.
export function drawWindow(P, A, B, q, field, vis) {
  op(P.g, vis);
  const N = WINDOW_ROWS.length, lvl = (s) => Math.max(0, s.window - 1); // (its level 1 is the query alone)
  let done = lvl(B) >= 2 ? N : 0, cur = -1, u = 0;
  if (field === 'window' && lvl(A) === 1 && lvl(B) === 2) {
    const x = q * N;
    cur = Math.min(N - 1, Math.floor(x)); u = x - cur; done = cur;
  }
  let cbqBytes = done * W_ROW;
  for (const side of SIDES) {
    P.rows[side].forEach((r, i) => {
      op(r.g.firstChild, i === cur ? Math.sin(Math.PI * u) : 0);
      op(r.chip, i < done || (i === cur && u >= 0.3) ? 1 : 0);
    });
  }
  op(P.parcels.n1k1.g, 0);
  if (cur >= 0) {
    fall(P, 'cbq', seg(u, 0.4, 0.95), G.cols.cbq + 190, W_Y[cur] - 12, cbqBytes, W_TOTAL, 'a running sum', W_ROW);
    if (u >= 0.95) cbqBytes += W_ROW;
  } else op(P.parcels.cbq.g, 0);
  setBar(P.heaps, 'cbq', cbqBytes, W_TOTAL);
  setBar(P.heaps, 'n1k1', 0, W_TOTAL);
  const rows = cur >= 0 ? cur + (u >= 0.95 ? 1 : 0) : done;
  setText(P.heaps.cbq.count, `${rows} rows: ${fmt(cbqBytes)} bytes`);
  setText(P.heaps.n1k1.count, `${rows} rows: 0 bytes`);
  ['per row: the row\'s map, the new running sum, its', `copy, its final value: ~${WS.WindowRow.count} allocations, ~${fmt(W_ROW)} bytes`, '']
    .forEach((t, k) => setText(P.heaps.cbq.notes[k], t));
  ['each partition\'s rows copied once, as bytes; the sum', `folded in place: ${WINDOW.n1k1WindowPerRow} allocations per row, for the window`, '(its query with the window, less without)']
    .forEach((t, k) => setText(P.heaps.n1k1.notes[k], t));
}
