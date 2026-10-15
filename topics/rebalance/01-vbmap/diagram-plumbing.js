// Act 3's drawing, for diagram.js: the seating chart (a row per node's
// actives, a column per node's replicas), each vbucket's thread from
// its row through its seat to its column, the turn that pulls the
// threads straight into a network, the pipes they bundle into, the
// source and the sink, and max-flow's paths filling the pipes.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { NODES, NUM_VBUCKETS, CHART, chartAt, chartCellXY, seatPairXY, NET, rackOf } from './layout.js';
import { MAPS } from './deals.js';
import { LEFT, RIGHT, EDGES, PATHS, flowAfter } from './plumbing.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const nodeColor = (n) => `var(--node-${n})`;

// each vbucket's seat, by vbmap's deal: (row i, column j), and its
// place among the seat's vbuckets
const SEAT = {};
{
  const fill = {};
  MAPS.vbmap.forEach(([a, r], v) => {
    const key = `${a}>${r}`;
    SEAT[v] = { i: LEFT.indexOf(a), j: NODES.indexOf(r), a, r, k: (fill[key] = (fill[key] || 0) + 1) - 1 };
  });
  for (const s of Object.values(SEAT)) s.n = fill[`${s.a}>${s.r}`];
}
export const leftXY = (n) => [NET.lx, NET.y0 + LEFT.indexOf(n) * NET.dy];
export const rightXY = (n) => [NET.rx, NET.y0 + RIGHT.indexOf(n) * NET.dy];
// a pair's middle: in its seat, or as a bead on its thread
export function pairXY(v, view, up) {
  const s = SEAT[v];
  if (view === 'chart') return seatPairXY(s.i, s.j, s.k, up);
  const [x1, y1] = leftXY(s.a), [x2, y2] = rightXY(s.r), t = (s.k + 1) / (s.n + 1);
  return [lerp(x1, x2, t), lerp(y1, y2, t)];
}
// where a row's label goes, and a column's: on the chart, or as nodes
// (up: how far up the chart is, 0..1)
const rowLabelXY = (n, up) => { const [x, y] = chartCellXY(LEFT.indexOf(n), 0, up), k = chartAt(+up).k; return [x - 26 * k, y + (CHART.cell * k) / 2]; };
const colLabelXY = (n, up) => { const [x, y] = chartCellXY(0, NODES.indexOf(n), up), k = chartAt(+up).k; return [x + (CHART.cell * k) / 2, y - 16 * k]; };
// the chart's frame and sums are drawn full size, up; this places them
const chartTransform = (up) => { const { k, y } = chartAt(up); return `translate(${CHART.x0} ${y.toFixed(1)}) scale(${k.toFixed(4)}) translate(${-CHART.x0} ${-CHART.yUp})`; };
const vertexXY = (v) => (v === 'S' ? [NET.sx, NET.midY] : v === 'T' ? [NET.tx, NET.midY] : v[0] === 'L' ? leftXY(v.slice(2)) : rightXY(v.slice(2)));
const pipeW = (cap) => 5 + cap * 2;

export function buildPlumbing(d, g) {
  const P = (d.plumb = {});
  // the chart's frame: seats, greyed where it's the same rack
  P.chart = el('g', { opacity: 0 }, g);
  for (const a of LEFT) for (const r of NODES) {
    const [x, y] = chartCellXY(LEFT.indexOf(a), NODES.indexOf(r), true);
    el('rect', { x: x + 2, y: y + 2, width: CHART.cell - 4, height: CHART.cell - 4, rx: 6, class: rackOf(a) === rackOf(r) ? 'seat seat-none' : 'seat' }, P.chart);
  }
  // (its racks, over the columns and beside the rows; and in its corner,
  // which way is which)
  const top = CHART.yUp, c = CHART.cell;
  for (const [r, i] of [['West', 0], ['East', 2]]) {
    txt(P.chart, CHART.x0 + (i + 1) * c, top - 36, `rack ${r}`, 'rack-tag', 'middle');
    const t = txt(P.chart, 0, 0, `rack ${r}`, 'rack-tag', 'middle');
    t.setAttribute('transform', `translate(${CHART.x0 - 50} ${top + (i + 1) * c}) rotate(-90)`);
  }
  el('line', { x1: CHART.x0 - 70, y1: top - 44, x2: CHART.x0, y2: top, class: 'chart-corner' }, P.chart);
  txt(P.chart, CHART.x0 - 4, top - 30, 'replica', 'chart-corner-label', 'end');
  txt(P.chart, CHART.x0 - 66, top - 4, 'active', 'chart-corner-label');
  P.chartTitle = txt(P.chart, CHART.x0 - 40, CHART.yUp - 62, 'the seating chart: a vbucket sits at row (its active’s node), column (its replica’s node)', 'chart-title');
  // sums: each row's, each column's, each seat's count
  P.sums = el('g', { opacity: 0 }, g);
  for (const a of LEFT) {
    const [x, y] = chartCellXY(LEFT.indexOf(a), NODES.length, true);
    txt(P.sums, x + 14, y + CHART.cell / 2 + 5, String(MAPS.vbmap.filter((c) => c[0] === a).length), 'chart-sum');
  }
  for (const r of NODES) {
    const [x, y] = chartCellXY(LEFT.length, NODES.indexOf(r), true);
    txt(P.sums, x + CHART.cell / 2, y + 18, String(MAPS.vbmap.filter((c) => c[1] === r).length), 'chart-sum', 'middle');
  }
  P.netCaptions = el('g', { opacity: 0, 'data-net': 1 }, g);
  // the network's racks: beside each side's nodes (the left's, with the
  // rows; the right's, with the columns)
  P.netRacks = {};
  for (const [side, x, order] of [['left', NET.lx - 50, LEFT], ['right', NET.rx + 50, RIGHT]]) {
    const rg = (P.netRacks[side] = el('g', { opacity: 0, 'data-net': 1 }, g));
    for (const r of ['West', 'East']) {
      const ys = order.filter((n) => rackOf(n) === r).map((n) => NET.y0 + order.indexOf(n) * NET.dy);
      const t = txt(rg, 0, 0, `rack ${r}`, 'rack-tag', 'middle');
      t.setAttribute('transform', `translate(${x} ${(ys[0] + ys.at(-1)) / 2}) rotate(${side === 'left' ? -90 : 90})`);
    }
  }
  txt(P.netCaptions, NET.lx, NET.y0 - 40, 'actives on', 'net-caption', 'middle');
  txt(P.netCaptions, NET.rx, NET.y0 - 40, 'replicas on', 'net-caption', 'middle');
  // the threads, one per vbucket (under the copies)
  P.arcG = el('g', {}, g);
  P.arcs = {};
  for (let v = 0; v < NUM_VBUCKETS; v++) P.arcs[v] = el('path', { class: 'thread', style: `stroke: ${nodeColor(SEAT[v].a)}`, opacity: 0, 'data-net': 1 }, P.arcG);
  // the pipes: the network's edges, a full width for capacity, an inner
  // fill for the flow on it
  P.pipeG = el('g', {}, g);
  P.pipes = {};
  for (const e of EDGES) {
    const key = `${e.from}>${e.to}`, [x1, y1] = vertexXY(e.from), [x2, y2] = vertexXY(e.to);
    const pg = el('g', { opacity: 0, 'data-net': 1 }, P.pipeG);
    const shell = el('line', { x1, y1, x2, y2, class: 'pipe', 'stroke-width': pipeW(e.cap) }, pg);
    const fill = el('line', { x1, y1, x2, y2, class: 'pipe-fill', 'stroke-width': 0 }, pg);
    const hot = el('line', { x1, y1, x2, y2, class: 'pipe-hot', 'stroke-width': pipeW(e.cap) + 6, opacity: 0 }, pg);
    const label = txt(pg, lerp(x1, x2, 0.5), lerp(y1, y2, 0.5) - pipeW(e.cap) / 2 - 5, '', 'pipe-label', 'middle');
    P.pipes[key] = { g: pg, shell, fill, hot, label, e };
  }
  pg_reorder(P);
  // the labels: a row's and a column's, that become the network's nodes
  // (over the threads and pipes)
  P.rows = {}; P.cols = {};
  for (const n of NODES) {
    for (const store of [P.rows, P.cols]) {
      const lg = el('g', { opacity: 0, 'data-net': 1 }, g);
      const dot = el('circle', { r: 17, class: 'net-node', style: `fill: ${nodeColor(n)}` }, lg);
      const t = txt(lg, 0, 5, n, 'net-label', 'middle');
      store[n] = { g: lg, dot, t };
    }
  }
  // the source and the sink
  P.st = {};
  for (const [v, name] of [['S', 'source'], ['T', 'sink']]) {
    const [x, y] = vertexXY(v), sg = el('g', { opacity: 0, 'data-net': 1 }, g);
    el('circle', { cx: x, cy: y, r: 22, class: 'net-end' }, sg);
    txt(sg, x, y + 5, v, 'net-end-label', 'middle');
    txt(sg, x, y + 42, name, 'net-caption', 'middle');
    P.st[v] = sg;
  }
  P.flowNote = txt(g, (NET.lx + NET.rx) / 2, NET.y0 + 3 * NET.dy + 60, '', 'flow-note', 'middle');
  P.flowNote.dataset.net = 1;
}
// (the hot path's glow under each pipe's fill: drawn first)
function pg_reorder(P) { for (const p of Object.values(P.pipes)) p.g.insertBefore(p.hot, p.shell); }

// From state A to B, partway (q), changing `field`.
export function drawPlumbing(d, A, B, q, field) {
  const P = d.plumb, eq = easeQuad(q);
  // (the network fades as one, once its story's told)
  const netOn = field === 'network' ? lerp(A.network ? 1 : 0, B.network ? 1 : 0, eq) : B.network ? 1 : 0;
  const op = (e, o) => e.setAttribute('opacity', clamp01(o * (e.dataset.net ? netOn : 1)).toFixed(3));
  const f = (k, va, vb) => (field === k ? lerp(va, vb, eq) : vb);
  const upA = A.chartUp, upB = B.chartUp, up = f('chartUp', upA ? 1 : 0, upB ? 1 : 0);
  // the chart, till the turn
  // (shown till the network's built, and gone with it)
  const chartOn = (s) => (s.chart && s.view !== 'net' && s.network ? 1 : 0);
  op(P.chart, f(field === 'view' ? 'view' : 'chart', chartOn(A), chartOn(B)));
  P.chart.setAttribute('transform', chartTransform(up));
  const sumsOn = (s) => (s.sums && s.view !== 'net' && s.network ? 1 : 0);
  op(P.sums, f(field === 'view' ? 'view' : 'sums', sumsOn(A), sumsOn(B)));
  P.sums.setAttribute('transform', chartTransform(up));
  // the labels: on the chart's edges, then out to the sides as the
  // network's nodes (the rows' first, then the columns')
  const net = f('view', A.view === 'net' ? 1 : 0, B.view === 'net' ? 1 : 0);
  const rowsOut = f('rowsOut', A.rowsOut ? 1 : 0, B.rowsOut ? 1 : 0), colsOut = f('colsOut', A.colsOut ? 1 : 0, B.colsOut ? 1 : 0);
  for (const n of NODES) {
    for (const [store, chartXY, netXY, out] of [[P.rows, rowLabelXY, leftXY, rowsOut], [P.cols, colLabelXY, rightXY, colsOut]]) {
      const [cx, cy] = chartXY(n, up), [nx, ny] = netXY(n);
      const x = lerp(cx, nx, out), y = lerp(cy, ny, out);
      store[n].g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      op(store[n].g, f('chart', A.chart ? 1 : 0, B.chart ? 1 : 0));
      op(store[n].dot, out);
      store[n].t.style.fill = out > 0.5 ? 'var(--panel)' : nodeColor(n);
    }
  }
  op(P.netCaptions, Math.min(rowsOut, colsOut));
  // (till the source's pipes, and the sink's, come in over them)
  op(P.netRacks.left, rowsOut * (1 - f('source', A.source ? 1 : 0, B.source ? 1 : 0)));
  op(P.netRacks.right, colsOut * (1 - f('sink', A.sink ? 1 : 0, B.sink ? 1 : 0)));
  // the threads: row label, through the seat, to the column label; in
  // the network, straight from node to node
  const arcsOn = (s) => (s.arcs && !s.pipes ? 1 : 0);
  for (let v = 0; v < NUM_VBUCKETS; v++) {
    const s = SEAT[v];
    const [r1x, r1y] = rowLabelXY(s.a, up), [c1x, c1y] = colLabelXY(s.r, up), [m1x, m1y] = pairXY(v, 'chart', up);
    const [r2x, r2y] = leftXY(s.a), [c2x, c2y] = rightXY(s.r), [m2x, m2y] = pairXY(v, 'net');
    // (its ends follow the labels out; its middle, the bead, comes last)
    const p0 = [lerp(r1x + 10, r2x, rowsOut), lerp(r1y, r2y, rowsOut)], p2 = [lerp(c1x, c2x, colsOut), lerp(c1y + 10, c2y, colsOut)];
    const m = [lerp(m1x, m2x, net), lerp(m1y, m2y, net)];
    // (two straight runs, through the seat; turned, one straight line)
    P.arcs[v].setAttribute('d', `M${p0[0].toFixed(1)},${p0[1].toFixed(1)} L${m[0].toFixed(1)},${m[1].toFixed(1)} L${p2[0].toFixed(1)},${p2[1].toFixed(1)}`);
    // (they appear one after another)
    const u = field === 'arcs' ? clamp01((q - (v / NUM_VBUCKETS) * 0.6) / 0.4) : 1;
    op(P.arcs[v], field === 'arcs' || field === 'pipes' ? lerp(arcsOn(A), arcsOn(B), field === 'arcs' ? u : eq) * 0.55 : arcsOn(B) * 0.55);
  }
  // the pipes, the source and the sink
  const pipeOn = (s, e) => (e.from === 'S' ? s.source : e.to === 'T' ? s.sink : s.pipes) ? 1 : 0;
  const fa = flowAfter(A.flow), fb = flowAfter(B.flow);
  const path = field === 'flow' && B.flow > A.flow ? PATHS[A.flow] : null;
  const onPath = (key) => path && path.vertices.some((x, i) => i > 0 && `${path.vertices[i - 1]}>${x}` === key);
  for (const [key, p] of Object.entries(P.pipes)) {
    const which = p.e.from === 'S' ? 'source' : p.e.to === 'T' ? 'sink' : 'pipes';
    op(p.g, f(which, pipeOn(A, p.e), pipeOn(B, p.e)));
    const fl = lerp(fa[key], fb[key], field === 'flow' ? eq : 1);
    p.fill.setAttribute('stroke-width', ((fl / p.e.cap) * (pipeW(p.e.cap) - 3)).toFixed(2));
    setText(p.label, `${Math.round(fl)}/${p.e.cap}`);
    op(p.hot, onPath(key) ? Math.sin(Math.PI * clamp01(q)) : 0);
  }
  for (const v of ['S', 'T']) op(P.st[v], f(v === 'S' ? 'source' : 'sink', (v === 'S' ? A.source : A.sink) ? 1 : 0, (v === 'S' ? B.source : B.sink) ? 1 : 0));
  // what max-flow's doing
  const s = q < 0.5 ? A : B, pushed = PATHS.slice(0, s.flow).reduce((t, x) => t + x.push, 0);
  setText(P.flowNote, s.flow === PATHS.length ? `total flow: ${pushed}, every pipe full` : `path ${s.flow} of ${PATHS.length}: total flow ${pushed}`);
  // (from the pipes' emptying on)
  const noteOn = (st) => (st.key.startsWith('flow.') || (st.key === 'beads') ? 1 : 0);
  op(P.flowNote, field === 'flow' && A.key === 'sink' ? eq : lerp(noteOn(A), noteOn(B), eq));
  return { net };
}
