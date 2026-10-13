// The 01-planning explainer's diagram geometry, with no DOM, so the
// build can validate narrative references (cameras, anchors) against
// it.
//
// The picture: on the left, the partition map as a board, a row per
// partition and a column per node, with a chip in a cell for each
// primary (P) and replica (R); under each column, its tallies, and
// under those, the score strip: for the decision at hand (the outlined
// row), each node's score, as a bar in its own column; or, there too,
// the moves a plan takes (each node's copies built and deleted, with
// the copies marked on the board), the server groups' rule, or the
// stickiness table, as bars. There are no lids or bubbles, and no panel
// beside the board.

import { NODES, PARTITIONS } from './scenarios.js';

export const CANVAS = [0, 0, 780, 960];

// ---- the board ----

export const BOARD = { x0: 40, labelX: 70, y0: 112, rowH: 50, colW: 104, col0: 200 };
BOARD.y1 = BOARD.y0 + PARTITIONS.length * BOARD.rowH;
BOARD.x1 = BOARD.col0 + NODES.length * BOARD.colW;
export const colX = (node) => BOARD.col0 + NODES.indexOf(node) * BOARD.colW + BOARD.colW / 2;
export const rowY = (p) => BOARD.y0 + PARTITIONS.indexOf(p) * BOARD.rowH + BOARD.rowH / 2;
// a cell's chip: primary on the left of the cell, replica on the right
export const chipX = (node, state) => colX(node) + (state === 'primary' ? -20 : 20);
export const HEAD_Y = BOARD.y0 - 26; // node names
export const GROUP_Y = BOARD.y0 - 48; // server group brackets
export const TALLY_Y = BOARD.y1 + 34;

// ---- the score strip: a bar per node column, up from zero ----

export const STRIP = { titleY: 650, zeroY: 838, unit: 48, barW: 30 };
// the faint rule between the board (and its tallies) and the area under it
export const SEP_Y = 612;
STRIP.labelY = STRIP.zeroY + 40;
// (a score's height: `unit` px per partition's worth)
export const scoreY = (v) => STRIP.zeroY - v * STRIP.unit;

// ---- the panel ----

// the moves, under each node: px a move
export const MOVE_UNIT = 36;

// ---- the engine's names ----

export const LIDS = {};
export const BUBBLES = {};

// (the board, and the area under it: all there is)
export const CAMERAS = {
  overview: { rect: [20, 10, 770, 950], label: '', section: null },
};
export const cameraFor = () => CAMERAS.overview.rect;

// Static callout ends (the page computes `winner` and `chosen`).
export const ANCHORS = {
  'board.title': { p: [BOARD.x0, 46], needs: [] },
  ...Object.fromEntries(NODES.map((n) => [`node.${n}`, { p: [colX(n) - 18, HEAD_Y - 6], needs: [] }])),
  ...Object.fromEntries(NODES.map((n) => [`tally.${n}`, { p: [colX(n) - 50, TALLY_Y + 25], needs: [] }])),
  ...Object.fromEntries(PARTITIONS.map((p) => [`row.${p}`, { p: [BOARD.labelX - 8, rowY(p)], needs: [] }])),
  // partition 0's chips in the first map: its primary on a, its replica on c
  'chip.P': { p: [chipX('a', 'primary') - 19, rowY('0')], needs: [] },
  'chip.R': { p: [chipX('c', 'replica') - 19, rowY('0')], needs: [] },
  'groups': { p: [BOARD.col0 + 10, GROUP_Y], needs: [] },
  'scores': { p: [BOARD.x0, STRIP.titleY - 6], needs: [] },
  'moves.total': { p: [BOARD.x0, STRIP.titleY + 20], needs: [] },
  'tree': { p: [BOARD.x0, STRIP.titleY - 6], needs: [] },
};

export const SECTION_COLORS = ['map', 'primary', 'replica', 'change', 'groups', 'neutral'];
