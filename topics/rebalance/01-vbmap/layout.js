// The 01-vbmap explainer's geometry, with no DOM, so the build can
// check the narrative's references (cameras, anchors) against it.
//
// The picture: the document card (top left); the bucket's vbuckets as
// a grid of tiles; the racks, East (left) and West (right), each with
// its nodes' bins; and below, when comparing, a copy of the naive deal.

import { RUNS } from '../lib/maps.js';

export const NODES = RUNS.story4.nodes;
export const RACKS = { East: ['a', 'b', 'e'], West: ['c', 'd'] };
export const rackOf = (n) => Object.keys(RACKS).find((r) => RACKS[r].includes(n));
export const NUM_VBUCKETS = RUNS.story4.numVBuckets;

export const CANVAS = [0, 0, 1000, 700];

// a copy: a rounded rect
// (a playing card's proportions, 2.5 : 3.5)
export const CHIP = { w: 14, h: 19.6, rx: 2.5 };

// the vbuckets, as a grid of tiles: 8 across
export const GRID = { x0: 300, y0: 150, dx: 64, dy: 48, cols: 8, tileW: 22, tileH: 16 };
export const tileXY = (v) => [GRID.x0 + (v % GRID.cols) * GRID.dx, GRID.y0 + Math.floor(v / GRID.cols) * GRID.dy];

// the clusters: the story's four nodes, and five once node e joins
// rack East. Each lays out its racks left to right (East, then West),
// each rack's bins side by side.
export const ALL_NODES = ['a', 'b', 'c', 'd', 'e'];
export const CLUSTERS = {
  four: { racks: { East: ['a', 'b'], West: ['c', 'd'] }, binW: 200, gap: 22, pad: 14 },
  five: { racks: { East: ['a', 'b', 'e'], West: ['c', 'd'] }, binW: 150, gap: 17, pad: 7 },
};
export const BIN = { h: 140, y: 170, cols: 8 };
const RACK_Y = 120, RACK_H = 230;
// a cluster's geometry: each node's bin x, each rack's box
export const LAYOUT = Object.fromEntries(Object.entries(CLUSTERS).map(([name, c]) => {
  const binX = {}, rack = {};
  let x = 30;
  for (const [r, ns] of Object.entries(c.racks)) {
    const w = 20 + ns.length * c.binW + (ns.length - 1) * 20 + 10;
    ns.forEach((n, i) => (binX[n] = x + 20 + i * (c.binW + 20)));
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
export const CHART = { x0: 420, cell: 70, yDown: 400, yUp: 150 };
export const chartCellXY = (i, j, up) => [CHART.x0 + j * CHART.cell, (up ? CHART.yUp : CHART.yDown) + i * CHART.cell];
// a seat's pairs: 2 x 2, an active and its replica side by side
export const seatPairXY = (i, j, k, up) => { const [x, y] = chartCellXY(i, j, up); return [x + 19 + (k % 2) * 32, y + 21 + Math.floor(k / 2) * 27]; };

// the network: nodes on the left (their actives), on the right (their
// replicas), a source and a sink
export const NET = { lx: 330, rx: 690, y0: 170, dy: 95, sx: 140, tx: 880 };
NET.midY = NET.y0 + 1.5 * NET.dy;

export const LIDS = {};
export const BUBBLES = {};
export const CAMERAS = {
  overview: { rect: [0, 20, 1000, 680], label: '', section: null },
};

export const ANCHORS = {
  doc: { p: [DOC.x, DOC.y + 20], needs: [] },
  grid: { p: [GRID.x0 - 20, GRID.y0], needs: [] },
  'rack.East': { p: [RACK_BOX.East[0] + 10, RACK_BOX.East[1] + 18], needs: [] },
  'rack.West': { p: [RACK_BOX.West[0] + 10, RACK_BOX.West[1] + 18], needs: [] },
  // (a node's: where it is in the four-node cluster, or for e, the five;
  // the page moves them with the cluster)
  ...Object.fromEntries(ALL_NODES.map((n) => { const L = n === 'e' ? LAYOUT.five : LAYOUT.four; return [`node.${n}`, { p: [L.binX[n] + 6, BIN.y - 8], needs: [] }]; })),
  ...Object.fromEntries(ALL_NODES.map((n) => { const L = n === 'e' ? LAYOUT.five : LAYOUT.four; return [`count.${n}`, { p: [L.binX[n] + L.binW / 2 - 40, BIN.y + BIN.h - 16], needs: [] }]; })),
  ghost: { p: [RACK_BOX.East[0] + 10, RACK_BOX.East[1] + GHOST_DY - 8], needs: [] },
  'chart.title': { p: [CHART.x0 - 40, CHART.yUp - 46], needs: [] },
  'net.left': { p: [NET.lx - 26, NET.y0], needs: [] },
  'net.right': { p: [NET.rx - 26, NET.y0], needs: [] },
  'pipe.ac': { p: [(NET.lx + NET.rx) / 2 - 20, NET.y0 - 8], needs: [] },
  source: { p: [NET.sx - 24, NET.midY], needs: [] },
  sink: { p: [NET.tx - 24, NET.midY], needs: [] },
};

export const SECTION_COLORS = ['story', 'trouble', 'fix', 'flow', 'neutral'];
