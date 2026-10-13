// The 01-planning explainer's diagram geometry, with no DOM, so the
// build can validate narrative references (cameras, anchors) against
// it.
//
// The picture: on the left, the partition map as a board, a row per
// partition and a column per node, with a chip in a cell for each
// primary (P) and replica (R); under each column, its tallies, and
// under those, the score strip: for the decision at hand (the outlined
// row), each node's score, as a bar in its own column. On the right, a
// panel: the moves a plan takes, the server groups' tree, or the
// stickiness table. There are no lids or bubbles.

import { NODES, PARTITIONS, STICKINESS } from './scenarios.js';

export const CANVAS = [0, 0, 1220, 920];

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

export const STRIP = { titleY: 612, zeroY: 800, unit: 48, barW: 30 };
STRIP.labelY = STRIP.zeroY + 40;
// (a score's height: `unit` px per partition's worth)
export const scoreY = (v) => STRIP.zeroY - v * STRIP.unit;

// ---- the panel ----

export const PANEL = { x0: 640, x1: 1190, y0: 60, titleY: 84, rowY0: 150 };
export const movesRowY = (p) => PANEL.rowY0 - 20 + PARTITIONS.indexOf(p) * 34;
export const stickRowY = (i) => PANEL.rowY0 + i * 46;
export const TREE = { y0: 150, x0: PANEL.x0 + 40 };

// ---- the engine's names ----

export const LIDS = {};
export const BUBBLES = {};

// (main.js frames the board and strip alone while the panel's empty:
// see cameraFor)
export const CAMERAS = {
  overview: { rect: [0, 10, 1220, 910], label: '', section: null },
  board: { rect: [20, 10, 640, 910], label: 'the partition map', section: null },
};
export const cameraFor = (panel) => (panel === 'none' || panel === 'score' ? CAMERAS.board.rect : CAMERAS.overview.rect);

// Static callout ends (the page computes `winner` and `chosen`).
export const ANCHORS = {
  'board.title': { p: [BOARD.x0, 46], needs: [] },
  ...Object.fromEntries(NODES.map((n) => [`node.${n}`, { p: [colX(n) - 18, HEAD_Y - 6], needs: [] }])),
  ...Object.fromEntries(NODES.map((n) => [`tally.${n}`, { p: [colX(n) - 50, TALLY_Y + 25], needs: [] }])),
  ...Object.fromEntries(PARTITIONS.map((p) => [`row.${p}`, { p: [BOARD.labelX - 8, rowY(p)], needs: [] }])),
  'groups': { p: [BOARD.col0 + 10, GROUP_Y], needs: [] },
  'scores': { p: [BOARD.x0, STRIP.titleY - 6], needs: [] },
  ...Object.fromEntries(PARTITIONS.map((p) => [`moves.${p}`, { p: [PANEL.x0 + 10, movesRowY(p)], needs: [] }])),
  'moves.total': { p: [PANEL.x0 + 10, movesRowY(PARTITIONS[PARTITIONS.length - 1]) + 46], needs: [] },
  ...Object.fromEntries(STICKINESS.map((s, i) => [`stick.${s.key}`, { p: [PANEL.x0 + 10, stickRowY(i)], needs: [] }])),
  'tree': { p: [TREE.x0, TREE.y0 + 4], needs: [] },
};

export const SECTION_COLORS = ['map', 'primary', 'replica', 'change', 'groups', 'neutral'];
