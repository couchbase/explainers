// The 02-moving explainer's diagram geometry, with no DOM, so the build
// can validate narrative references (cameras, anchors) against it.
//
// The picture, a triangle of panels: top left, the partition map now, as
// a board, as in 01-planning, with each copy being built or deleted shown
// in place, and under each node, its mover: what it's doing now. Top
// right, the map after: blance's next partition map, where the moves
// end up (it slides out of the map now, once the story gets to it).
// Bottom, centered: each partition's moves (its plan), or the movers'
// timeline, a lane per node.

import { NODES, PARTITIONS } from './scenarios.js';

export const CANVAS = [0, 0, 1080, 960];

// A board: its rows, a partition each, and its columns, a node each.
const board = (x0) => {
  const b = { x0, labelX: x0 + 12, col0: x0 + 110, colW: 80, y0: 96, rowH: 36, titleY: 40 };
  b.y1 = b.y0 + PARTITIONS.length * b.rowH;
  b.x1 = b.col0 + NODES.length * b.colW;
  return b;
};
export const BOARDS = { now: board(40), after: board(600) };
export const BOARD = BOARDS.now;
export const colX = (node, B = BOARD) => B.col0 + NODES.indexOf(node) * B.colW + B.colW / 2;
export const rowY = (p, B = BOARD) => B.y0 + PARTITIONS.indexOf(p) * B.rowH + B.rowH / 2;
export const chipX = (node, state, B = BOARD) => colX(node, B) + (state === 'primary' ? -16 : 16);
export const HEAD_Y = BOARD.y0 - 22;
// (the movers: under the map now, outside its frame)
export const MOVER_Y = BOARD.y1 + 42;
// (between the two maps: the arrow from now to after)
export const ARROW = { x0: BOARDS.now.x1 + 28, x1: BOARDS.after.x0 - 20, y: (BOARD.y0 + BOARD.y1) / 2 };

// the bottom panel, centered under the two maps
export const PANEL = { x0: 240, x1: 840, y0: 470, y1: 944, titleY: 500 };
// the plans: a partition's moves, a row each
export const PLAN_X = PANEL.x0 + 110;
export const planY = (p) => PANEL.y0 + 66 + PARTITIONS.indexOf(p) * 46;
// the timeline: a lane per node, time across
export const TL = { x0: PANEL.x0 + 104, x1: PANEL.x1 - 20, laneY0: 600, laneH: 72, ctlY: 548, maxT: 1400 };
TL.axisY = TL.laneY0 + NODES.length * TL.laneH - 10;
export const laneY = (n) => TL.laneY0 + NODES.indexOf(n) * TL.laneH;
export const timeX = (t) => TL.x0 + (t / TL.maxT) * (TL.x1 - TL.x0);

export const LIDS = {};
export const BUBBLES = {};

export const CAMERAS = {
  overview: { rect: [0, 0, 1080, 960], label: '', section: null },
};

const A = BOARDS.after;
export const ANCHORS = {
  'board.title': { p: [BOARD.x0, BOARD.titleY - 6], needs: [] },
  'after.title': { p: [A.x0, A.titleY - 6], needs: [] },
  ...Object.fromEntries(NODES.map((n) => [`node.${n}`, { p: [colX(n) - 18, HEAD_Y - 6], needs: [] }])),
  ...Object.fromEntries(NODES.map((n) => [`after.node.${n}`, { p: [colX(n, A) - 18, HEAD_Y - 6], needs: [] }])),
  ...Object.fromEntries(NODES.map((n) => [`mover.${n}`, { p: [colX(n) - 36, MOVER_Y], needs: [] }])),
  ...Object.fromEntries(PARTITIONS.map((p) => [`row.${p}`, { p: [BOARD.labelX - 8, rowY(p)], needs: [] }])),
  'panel.title': { p: [PANEL.x0 + 10, PANEL.titleY - 6], needs: [] },
  ...Object.fromEntries(PARTITIONS.map((p) => [`plan.${p}`, { p: [PANEL.x0 + 12, planY(p)], needs: [] }])),
  ...Object.fromEntries(NODES.map((n) => [`lane.${n}`, { p: [PANEL.x0 + 12, laneY(n)], needs: [] }])),
  'controller': { p: [PANEL.x0 + 12, TL.ctlY], needs: [] },
};

export const SECTION_COLORS = ['map', 'primary', 'replica', 'change', 'groups', 'neutral'];
