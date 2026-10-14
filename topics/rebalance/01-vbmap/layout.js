// The 01-vbmap explainer's geometry, with no DOM, so the build can
// check the narrative's references (cameras, anchors) against it.
//
// The picture: the document card (top left); the bucket's vbuckets as
// a grid of tiles; the racks, East (left) and West (right), each with
// its nodes' bins; and below, when comparing, a copy of the naive deal.

import { RUNS } from '../lib/maps.js';

export const NODES = RUNS.story4.nodes;
export const RACKS = { East: ['a', 'b'], West: ['c', 'd'] };
export const rackOf = (n) => Object.keys(RACKS).find((r) => RACKS[r].includes(n));
export const NUM_VBUCKETS = RUNS.story4.numVBuckets;

export const CANVAS = [0, 0, 1000, 700];

// a copy: a rounded rect
// (a playing card's proportions, 2.5 : 3.5)
export const CHIP = { w: 14, h: 19.6, rx: 2.5 };

// the vbuckets, as a grid of tiles: 8 across
export const GRID = { x0: 300, y0: 150, dx: 64, dy: 48, cols: 8, tileW: 22, tileH: 16 };
export const tileXY = (v) => [GRID.x0 + (v % GRID.cols) * GRID.dx, GRID.y0 + Math.floor(v / GRID.cols) * GRID.dy];

// racks and bins
export const RACK_BOX = { East: [30, 120, 450, 230], West: [520, 120, 450, 230] };
export const BIN = { w: 200, h: 140, y: 170, cols: 8, pad: 14, gap: 22 };
export const BIN_X = { a: 50, b: 270, c: 540, d: 760 };
// a copy's place in a bin: actives on the first row, replicas on the
// second (and a third row, if a node holds more than 8 of one kind)
export const binChipXY = (n, row, i) => [BIN_X[n] + BIN.pad + (i % BIN.cols) * BIN.gap + CHIP.w / 2, BIN.y + 36 + (row + 2 * Math.floor(i / BIN.cols)) * 25];
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
  ...Object.fromEntries(NODES.map((n) => [`node.${n}`, { p: [BIN_X[n] + 6, BIN.y - 8], needs: [] }])),
  ...Object.fromEntries(NODES.map((n) => [`count.${n}`, { p: [BIN_X[n] + BIN.w / 2 - 40, BIN.y + BIN.h - 16], needs: [] }])),
  ghost: { p: [RACK_BOX.East[0] + 10, RACK_BOX.East[1] + GHOST_DY - 8], needs: [] },
  'chart.title': { p: [CHART.x0 - 40, CHART.yUp - 46], needs: [] },
  'net.left': { p: [NET.lx - 26, NET.y0], needs: [] },
  'net.right': { p: [NET.rx - 26, NET.y0], needs: [] },
  'pipe.ac': { p: [(NET.lx + NET.rx) / 2 - 20, NET.y0 - 8], needs: [] },
  source: { p: [NET.sx - 24, NET.midY], needs: [] },
  sink: { p: [NET.tx - 24, NET.midY], needs: [] },
};

export const SECTION_COLORS = ['story', 'trouble', 'fix', 'flow', 'neutral'];
