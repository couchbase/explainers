// The 01-planning explainer's diagram geometry, with no DOM, so the
// build can validate narrative references (cameras, anchors) against
// it.
//
// The picture: on the left, the partition map as a board, a row per
// partition and a column per node, with a chip in a cell for each
// primary (P) and replica (R); under each column, its tallies. On the
// right, a panel: the planner's scores for the decision at hand, or the
// moves a plan takes, or the server groups' tree, or the stickiness
// table. There are no lids or bubbles.

import { NODES, PARTITIONS, STICKINESS } from './scenarios.js';

export const CANVAS = [0, 0, 1220, 640];

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

// ---- the panel ----

export const PANEL = { x0: 640, x1: 1190, y0: 60, titleY: 84, rowY0: 150, rowH: 52, zeroX: 850, unit: 74 };
// (a score's bar: zero at zeroX, `unit` px per partition's worth)
export const scoreX = (v) => PANEL.zeroX + v * PANEL.unit;
export const movesRowY = (p) => PANEL.rowY0 - 20 + PARTITIONS.indexOf(p) * 34;
export const stickRowY = (i) => PANEL.rowY0 + i * 46;
export const TREE = { y0: 150, x0: PANEL.x0 + 40 };

// ---- the engine's names ----

export const LIDS = {};
export const BUBBLES = {};

export const CAMERAS = {
  overview: { rect: [0, 20, 1220, 620], label: '', section: null },
  board: { rect: [20, 20, 640, 620], label: 'the partition map', section: null },
  panel: { rect: [600, 40, 1210, 520], label: 'the planner', section: null },
};

// Static callout ends (the page computes `winner` and `chosen`).
export const ANCHORS = {
  'board.title': { p: [BOARD.x0, 46], needs: [] },
  ...Object.fromEntries(NODES.map((n) => [`node.${n}`, { p: [colX(n) - 18, HEAD_Y - 6], needs: [] }])),
  ...Object.fromEntries(NODES.map((n) => [`tally.${n}`, { p: [colX(n) - 30, TALLY_Y], needs: [] }])),
  ...Object.fromEntries(PARTITIONS.map((p) => [`row.${p}`, { p: [BOARD.labelX - 8, rowY(p)], needs: [] }])),
  'groups': { p: [BOARD.col0 + 10, GROUP_Y], needs: [] },
  'panel.title': { p: [PANEL.x0 + 10, PANEL.titleY - 6], needs: [] },
  ...Object.fromEntries(PARTITIONS.map((p) => [`moves.${p}`, { p: [PANEL.x0 + 10, movesRowY(p)], needs: [] }])),
  'moves.total': { p: [PANEL.x0 + 10, movesRowY(PARTITIONS[PARTITIONS.length - 1]) + 46], needs: [] },
  ...Object.fromEntries(STICKINESS.map((s, i) => [`stick.${s.key}`, { p: [PANEL.x0 + 10, stickRowY(i)], needs: [] }])),
  'tree': { p: [TREE.x0, TREE.y0 + 4], needs: [] },
};

export const SECTION_COLORS = ['map', 'primary', 'replica', 'change', 'groups', 'neutral'];
