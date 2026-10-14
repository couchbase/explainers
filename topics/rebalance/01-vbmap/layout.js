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
export const CHIP = { w: 16, h: 11, rx: 3 };

// the vbuckets, as a grid of tiles: 8 across
export const GRID = { x0: 335, y0: 150, dx: 46, dy: 48, cols: 8, tileW: 22, tileH: 16 };
export const tileXY = (v) => [GRID.x0 + (v % GRID.cols) * GRID.dx, GRID.y0 + Math.floor(v / GRID.cols) * GRID.dy];

// racks and bins
export const RACK_BOX = { East: [30, 120, 450, 230], West: [520, 120, 450, 230] };
export const BIN = { w: 200, h: 140, y: 170, cols: 10, pad: 12, gap: 18 };
export const BIN_X = { a: 50, b: 270, c: 540, d: 760 };
export const binChipXY = (n, i) => [BIN_X[n] + BIN.pad + (i % BIN.cols) * BIN.gap + CHIP.w / 2, BIN.y + 22 + Math.floor(i / BIN.cols) * 16];
// the copy of the naive deal, below
export const GHOST_DY = 300;

// the document card
export const DOC = { x: 40, y: 40, w: 230, h: 64 };

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
};

export const SECTION_COLORS = ['story', 'trouble', 'fix', 'neutral'];
