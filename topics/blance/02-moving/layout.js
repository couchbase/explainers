// The 03-moving explainer's diagram geometry, with no DOM, so the build
// can validate narrative references (cameras, anchors) against it.
//
// The picture: on the left, the partition map as a board, as in
// 01-planning, with each copy being built or deleted shown in place,
// and under each node, its mover: what it's doing now. On the right, a
// panel: each partition's moves (its plan, at the same rows as the
// board), or the movers' timeline, a lane per node.

import { NODES, PARTITIONS } from './scenarios.js';

export const CANVAS = [0, 0, 1240, 640];

export const BOARD = { x0: 40, labelX: 70, y0: 112, rowH: 50, colW: 104, col0: 200 };
BOARD.y1 = BOARD.y0 + PARTITIONS.length * BOARD.rowH;
BOARD.x1 = BOARD.col0 + NODES.length * BOARD.colW;
export const colX = (node) => BOARD.col0 + NODES.indexOf(node) * BOARD.colW + BOARD.colW / 2;
export const rowY = (p) => BOARD.y0 + PARTITIONS.indexOf(p) * BOARD.rowH + BOARD.rowH / 2;
export const chipX = (node, state) => colX(node) + (state === 'primary' ? -20 : 20);
export const HEAD_Y = BOARD.y0 - 26;
export const MOVER_Y = BOARD.y1 + 34;

export const PANEL = { x0: 640, x1: 1210, y0: 60, titleY: 84 };
// the plans: a partition's moves, at its board row
export const PLAN_X = PANEL.x0 + 110;
// the timeline: a lane per node, time across
export const TL = { x0: PANEL.x0 + 104, x1: PANEL.x1 - 20, laneY0: 170, laneH: 74, ctlY: 132, maxT: 1400 };
TL.axisY = TL.laneY0 + NODES.length * TL.laneH - 10;
export const laneY = (n) => TL.laneY0 + NODES.indexOf(n) * TL.laneH;
export const timeX = (t) => TL.x0 + (t / TL.maxT) * (TL.x1 - TL.x0);

export const LIDS = {};
export const BUBBLES = {};

export const CAMERAS = {
  overview: { rect: [0, 20, 1240, 620], label: '', section: null },
  board: { rect: [20, 20, 640, 620], label: 'the partition map', section: null },
  panel: { rect: [600, 40, 1230, 560], label: 'the movers', section: null },
};

export const ANCHORS = {
  'board.title': { p: [BOARD.x0, 46], needs: [] },
  ...Object.fromEntries(NODES.map((n) => [`node.${n}`, { p: [colX(n) - 18, HEAD_Y - 6], needs: [] }])),
  ...Object.fromEntries(NODES.map((n) => [`mover.${n}`, { p: [colX(n) - 40, MOVER_Y], needs: [] }])),
  ...Object.fromEntries(PARTITIONS.map((p) => [`row.${p}`, { p: [BOARD.labelX - 8, rowY(p)], needs: [] }])),
  'panel.title': { p: [PANEL.x0 + 10, PANEL.titleY - 6], needs: [] },
  ...Object.fromEntries(PARTITIONS.map((p) => [`plan.${p}`, { p: [PANEL.x0 + 12, rowY(p)], needs: [] }])),
  ...Object.fromEntries(NODES.map((n) => [`lane.${n}`, { p: [PANEL.x0 + 12, laneY(n)], needs: [] }])),
  'controller': { p: [PANEL.x0 + 12, TL.ctlY], needs: [] },
};

export const SECTION_COLORS = ['map', 'primary', 'replica', 'change', 'groups', 'neutral'];
