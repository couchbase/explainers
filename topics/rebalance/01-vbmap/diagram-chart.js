// Act 3's drawing, for diagram.js: the seating chart (a row per node's
// actives, a column per node's replicas), with its labels, its racks,
// and its sums. It waits below the cluster, smaller, then rises into
// the cluster's place, growing as it goes.

import { svgEl as el, svgText as txt } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { NODES, CHART, chartAt, chartCellXY, seatPairXY, rackOf } from './layout.js';
import { MAPS } from './deals.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const nodeColor = (n) => `var(--node-${n})`;

// each vbucket's seat, by vbmap's deal: (row i, column j), and its
// place among the seat's vbuckets
const SEAT = {};
{
  const fill = {};
  MAPS.vbmap.forEach(([a, r], v) => {
    const key = `${a}>${r}`;
    SEAT[v] = { i: NODES.indexOf(a), j: NODES.indexOf(r), k: (fill[key] = (fill[key] || 0) + 1) - 1 };
  });
}
// a pair's middle, in its seat (up: how far up the chart is, 0..1)
export const pairXY = (v, up) => seatPairXY(SEAT[v].i, SEAT[v].j, SEAT[v].k, up);

// The chart's parts are drawn full size, up; this places them.
const chartTransform = (up) => {
  const { k, y } = chartAt(up);
  return `translate(${CHART.x0} ${y.toFixed(1)}) scale(${k.toFixed(4)}) translate(${-CHART.x0} ${-CHART.yUp})`;
};

export function buildChart(d, g) {
  const P = (d.chart = {}), top = CHART.yUp, c = CHART.cell;
  // the frame: seats, greyed where it's the same rack
  P.frame = el('g', { opacity: 0 }, g);
  for (const a of NODES) for (const r of NODES) {
    const [x, y] = chartCellXY(NODES.indexOf(a), NODES.indexOf(r), true);
    el('rect', { x: x + 2, y: y + 2, width: c - 4, height: c - 4, rx: 6, class: rackOf(a) === rackOf(r) ? 'seat seat-none' : 'seat' }, P.frame);
  }
  // the rows' and columns' nodes
  for (const n of NODES) {
    const [rx, ry] = chartCellXY(NODES.indexOf(n), 0, true), [cx, cy] = chartCellXY(0, NODES.indexOf(n), true);
    txt(P.frame, rx - 26, ry + c / 2 + 5, n, 'chart-label', 'middle').style.fill = nodeColor(n);
    txt(P.frame, cx + c / 2, cy - 12, n, 'chart-label', 'middle').style.fill = nodeColor(n);
  }
  // its racks, over the columns and beside the rows; and in its corner,
  // which way is which
  for (const [r, i] of [['West', 0], ['East', 2]]) {
    txt(P.frame, CHART.x0 + (i + 1) * c, top - 36, `rack ${r}`, 'rack-tag', 'middle');
    txt(P.frame, 0, 0, `rack ${r}`, 'rack-tag', 'middle').setAttribute('transform', `translate(${CHART.x0 - 50} ${top + (i + 1) * c}) rotate(-90)`);
  }
  el('line', { x1: CHART.x0 - 70, y1: top - 44, x2: CHART.x0, y2: top, class: 'chart-corner' }, P.frame);
  txt(P.frame, CHART.x0 - 4, top - 30, 'replica', 'chart-corner-label', 'end');
  txt(P.frame, CHART.x0 - 66, top - 4, 'active', 'chart-corner-label');
  txt(P.frame, CHART.x0 - 40, top - 62, 'the seating chart: a vbucket sits at row (its active’s node), column (its replica’s node)', 'chart-title');
  // the sums: each row's, each column's
  P.sums = el('g', { opacity: 0 }, g);
  for (const a of NODES) {
    const [x, y] = chartCellXY(NODES.indexOf(a), NODES.length, true);
    txt(P.sums, x + 14, y + c / 2 + 5, String(MAPS.vbmap.filter((ch) => ch[0] === a).length), 'chart-sum');
  }
  for (const r of NODES) {
    const [x, y] = chartCellXY(NODES.length, NODES.indexOf(r), true);
    txt(P.sums, x + c / 2, y + 18, String(MAPS.vbmap.filter((ch) => ch[1] === r).length), 'chart-sum', 'middle');
  }
}

// From state A to B, partway (q), changing `field`.
export function drawChart(d, A, B, q, field) {
  const P = d.chart, eq = easeQuad(q);
  const f = (k, va, vb) => (field === k ? lerp(va, vb, eq) : vb);
  const up = f('chartUp', A.chartUp ? 1 : 0, B.chartUp ? 1 : 0);
  // (the sums go when the chart does)
  op(P.frame, f('chart', A.chart ? 1 : 0, B.chart ? 1 : 0));
  op(P.sums, f(field === 'chart' ? 'chart' : 'sums', A.sums && A.chart ? 1 : 0, B.sums && B.chart ? 1 : 0));
  for (const part of [P.frame, P.sums]) part.setAttribute('transform', chartTransform(up));
}
