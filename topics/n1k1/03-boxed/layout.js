// The 03-boxed explainer's geometry, with no DOM, so the build can check
// the narrative's references (anchors) against it.
//
// The picture: the filter and the row (top); two lanes side by side,
// the boxed lane (cbq's Evaluate) left and the byte lane (n1k1's native
// code) right, each in four stages; under each lane, the Go heap, where
// each allocation the lane makes lands, as a block as wide as its bytes;
// and, later, the twenty rows' tallies, and the totals table.

import { ALLOCS, STAGES } from '../lib/boxed.js';

export const CANVAS = [0, 0, 1000, 720];

export const EXPR = { x: 30, y: 22, w: 250, h: 62 };
export const BUF = { x: 300, y: 22, w: 670, h: 62, font: 11, line: 19 };
export const CHAR_W = BUF.font * 0.6;
export const charX = (i) => BUF.x + 12 + i * CHAR_W;

// the lanes, and their stages' rows
export const LANES = { y: 108, h: 362, w: 455, x: { boxed: 30, bytes: 515 } };
export const STAGE_Y = [148, 262, 334, 404];
export const NODE = { w: 141, h: 38, gap: 6, dy: 44 };
// a node's place: its stage, and its index in that stage (three to a row)
export const nodeXY = (lane, stage, k) => [LANES.x[lane] + 10 + (k % 3) * (NODE.w + NODE.gap), STAGE_Y[stage] + 10 + Math.floor(k / 3) * NODE.dy];

// the heaps: a block per allocation, as wide as its bytes
export const HEAP = { y: 486, h: 220, blockY: 524, blockH: 30 };
export const BYTE_W = 0.25;
// the hero's blocks: each one's x offset, in the order made
export const BLOCKS = [];
{
  let x = 0;
  for (const [i, a] of ALLOCS.entries()) {
    BLOCKS.push({ i, x, w: a.bytes * BYTE_W, stage: STAGES.indexOf(a.stage) });
    x += a.bytes * BYTE_W + 2;
  }
}
// the twenty rows' tallies, under the blocks
export const TALLY = { y: 580, h: 100, w: 12, gap: 3 };

// the panels in the lanes' and heaps' place: GROUP BY, ORDER BY and
// JOIN, and the stats
export const PANEL = { x: 30, y: 108, w: 940, h: 598 };
export const GROUP = { cols: { cbq: 30, n1k1: 515 }, w: 455, rowY: 236, dy: 50, heapY: 486, heapH: 220 };

// the totals table, in the lanes' place
export const TABLE = { x: 30, y: 108, w: 940, h: 362, dy: 30 };

export const LIDS = {};
export const BUBBLES = {};
export const CAMERAS = { overview: { rect: [0, 10, 1000, 710], label: '', section: null } };

export const ANCHORS = {
  expr: { p: [EXPR.x, EXPR.y + 22], needs: [] },
  row: { p: [BUF.x, BUF.y + 22], needs: [] },
  'lane.boxed': { p: [LANES.x.boxed, LANES.y + 20], needs: [] },
  'lane.bytes': { p: [LANES.x.bytes, LANES.y + 20], needs: [] },
  ...Object.fromEntries([0, 1, 2, 3].flatMap((s) => ['boxed', 'bytes'].map((l) => [`${l}.${s}`, { p: [LANES.x[l] + 4, STAGE_Y[s] + 4], needs: [] }]))),
  'heap.boxed': { p: [LANES.x.boxed, HEAP.y + 18], needs: [] },
  'heap.bytes': { p: [LANES.x.bytes, HEAP.y + 18], needs: [] },
  tally: { p: [LANES.x.boxed, TALLY.y + 20], needs: [] },
  table: { p: [TABLE.x, TABLE.y + 20], needs: [] },
  'group.cbq': { p: [GROUP.cols.cbq, PANEL.y + 60], needs: [] },
  'group.n1k1': { p: [GROUP.cols.n1k1, PANEL.y + 60], needs: [] },
  'group.heap': { p: [GROUP.cols.cbq, GROUP.heapY + 20], needs: [] },
  others: { p: [PANEL.x, PANEL.y + 20], needs: [] },
  fallback: { p: [PANEL.x, PANEL.y + 20], needs: [] },
};

export const SECTION_COLORS = ['query', 'plan', 'push', 'out', 'neutral'];
