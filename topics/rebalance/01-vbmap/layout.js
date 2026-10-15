// The 01-vbmap explainer's geometry, with no DOM, so the build can
// check the narrative's references (cameras, anchors) against it.
//
// The picture: the document card (top left); the bucket's vbuckets as
// a grid of tiles; the racks, West (left) and East (right), each with
// its nodes' bins; and below, when comparing, a copy of the naive deal.

import { RUNS } from '../lib/maps.js';

export const NODES = RUNS.story4.nodes;
export const RACKS = { West: ['a', 'b', 'e'], East: ['c', 'd'] };
export const rackOf = (n) => Object.keys(RACKS).find((r) => RACKS[r].includes(n));
export const NUM_VBUCKETS = RUNS.story4.numVBuckets;

export const CANVAS = [0, 0, 1000, 700];

// a copy: a rounded rect
// (a playing card's proportions, 2.5 : 3.5)
export const CHIP = { w: 14, h: 19.6, rx: 2.5 };

// the vbuckets, as a grid of tiles: 8 across
export const GRID = { x0: 300, y0: 150, dx: 64, dy: 48, cols: 8, tileW: 22, tileH: 16 };
export const tileXY = (v) => [GRID.x0 + (v % GRID.cols) * GRID.dx, GRID.y0 + Math.floor(v / GRID.cols) * GRID.dy];

// the clusters: the story's four nodes, five once node e joins rack
// West, and six once node f joins rack East. Each lays out its racks
// left to right (West, then East), each rack's bins side by side.
export const ALL_NODES = ['a', 'b', 'c', 'd', 'e', 'f'];
export const CLUSTERS = {
  four: { racks: { West: ['a', 'b'], East: ['c', 'd'] }, binW: 200, gap: 22, pad: 14 },
  five: { racks: { West: ['a', 'b', 'e'], East: ['c', 'd'] }, binW: 150, gap: 17, pad: 7 },
  six: { racks: { West: ['a', 'b', 'e'], East: ['c', 'd', 'f'] }, binW: 130, gap: 15, pad: 5, binGap: 14 },
};
export const BIN = { h: 140, y: 170, cols: 8 };
const RACK_Y = 120, RACK_H = 230;
// a cluster's geometry: each node's bin x, each rack's box
export const LAYOUT = Object.fromEntries(Object.entries(CLUSTERS).map(([name, c]) => {
  const binX = {}, rack = {};
  let x = 30;
  for (const [r, ns] of Object.entries(c.racks)) {
    const bg = c.binGap ?? 20, w = 20 + ns.length * c.binW + (ns.length - 1) * bg + 10;
    ns.forEach((n, i) => (binX[n] = x + 20 + i * (c.binW + bg)));
    rack[r] = [x, RACK_Y, w, RACK_H];
    x += w + 40;
  }
  return [name, { ...c, binX, rack, nodes: Object.values(c.racks).flat() }];
}));
export const RACK_BOX = LAYOUT.four.rack;
export const BIN_X = LAYOUT.four.binX;
// a copy's place in a bin: actives on the first row, replicas on the
// second (and any more than 8 of a kind on a third)
export const binChipXY = (cluster, n, row, i) => {
  const L = LAYOUT[cluster];
  return [L.binX[n] + L.pad + (i % BIN.cols) * L.gap + CHIP.w / 2, BIN.y + 36 + (i < BIN.cols ? row : 2) * 25];
};
// the cluster, before it's lifted into place: below the bucket's grid
export const LOW_DY = 230;
// the copy of the naive deal, below
export const GHOST_DY = 300;

// the document card
export const DOC = { x: 40, y: 40, w: 230, h: 64 };

// the seating chart: a row per node (its actives), a column per node
// (the replicas it holds); below the cluster at first, then up
// (below, it's smaller, so it fits; it grows as it rises)
export const CHART = { x0: 420, cell: 84, yDown: 440, yUp: 150, kDown: 70 / 84 };
// the chart partway up (u, 0..1): its scale, and its top
export const chartAt = (u) => ({ k: CHART.kDown + (1 - CHART.kDown) * u, y: CHART.yDown + (CHART.yUp - CHART.yDown) * u });
export const chartCellXY = (i, j, up) => { const { k, y } = chartAt(+up); return [CHART.x0 + j * CHART.cell * k, y + i * CHART.cell * k]; };
// a seat's pairs: 2 x 2, an active and its replica side by side
export const seatPairXY = (i, j, k, up) => {
  const [x, y] = chartCellXY(i, j, up), c = CHART.cell * chartAt(+up).k;
  return [x + c / 4 + (k % 2) * (c / 2), y + 0.31 * c + Math.floor(k / 2) * 0.38 * c];
};


// the first cluster a node's in
export const firstLayout = (n) => Object.values(LAYOUT).find((L) => n in L.binX);
// the table of ns_server's tries, below the cluster
export const TRIES = { x0: 50, y0: 420, dy: 22 };

export const LIDS = {};
export const BUBBLES = {};
export const CAMERAS = {
  overview: { rect: [0, 20, 1000, 680], label: '', section: null },
};

export const ANCHORS = {
  doc: { p: [DOC.x, DOC.y + 20], needs: [] },
  grid: { p: [GRID.x0 - 20, GRID.y0], needs: [] },
  'rack.West': { p: [RACK_BOX.West[0] + 10, RACK_BOX.West[1] + 18], needs: [] },
  'rack.East': { p: [RACK_BOX.East[0] + 10, RACK_BOX.East[1] + 18], needs: [] },
  // (a node's: where it is in the cluster it first appears in; the page
  // moves them with the cluster)
  ...Object.fromEntries(ALL_NODES.map((n) => { const L = firstLayout(n); return [`node.${n}`, { p: [L.binX[n] + 6, BIN.y - 8], needs: [] }]; })),
  ...Object.fromEntries(ALL_NODES.map((n) => { const L = firstLayout(n); return [`count.${n}`, { p: [L.binX[n] + L.binW / 2 - 40, BIN.y + BIN.h - 16], needs: [] }]; })),
  ghost: { p: [RACK_BOX.West[0] + 10, RACK_BOX.West[1] + GHOST_DY - 8], needs: [] },
  'chart.title': { p: [CHART.x0 - 40, CHART.yUp - 62], needs: [] },
  tries: { p: [TRIES.x0 - 10, TRIES.y0 - 26], needs: [] },
};

export const SECTION_COLORS = ['story', 'trouble', 'fix', 'flow', 'neutral'];
