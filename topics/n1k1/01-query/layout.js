// The 01-query explainer's geometry, with no DOM, so the build can
// check the narrative's references (cameras, anchors) against it.
//
// The picture: the query (top left); the data directory, as n1k1 sees
// it (left); the plan, its operators stacked bottom (the scan) to top
// (center); the heap and the output (right); and along the bottom,
// the record buffer: the bytes of the doc the scan read last.

import { ORDERS } from '../lib/query.js';

export const CANVAS = [0, 0, 1000, 700];

// the query card
export const QUERY = { x: 30, y: 22, w: 600, h: 58 };

// the data directory: its tree's lines, then a row per order file
export const FILES = { x: 30, y: 112, w: 210, dy: 21, top: 132 };
export const TREE = [
  { text: 'examples/shop/', indent: 0 },
  { text: 'default/', indent: 1, tag: 'namespace' },
  { text: 'customers/', indent: 2, tag: 'keyspace', note: '4 files' },
  { text: 'orders/', indent: 2, tag: 'keyspace', note: '20 files' },
];
export const fileY = (i) => FILES.top + (TREE.length + i) * FILES.dy;
export const treeY = (j) => FILES.top + j * FILES.dy;

// the plan: five slots, top to bottom (slot 4, the bottom, is the scan)
export const OP = { x: 280, w: 404, h: 78, top: 104, gap: 16 };
export const opY = (slot) => OP.top + slot * (OP.h + OP.gap);
// a register chip: up to four in a row, along the bottom of its box
export const CHIP = { w: 92, h: 30, gap: 4, x0: 10, dy: 42 };
export const chipXY = (slot, k) => [OP.x + CHIP.x0 + k * (CHIP.w + CHIP.gap), opY(slot) + CHIP.dy];

// the right column: the output (beside the top op), the heap below it
export const OUT = { x: 704, y: 104, w: 284, h: 92 };
export const HEAP = { x: 704, y: 214, w: 284, h: 168, dy: 34 };
export const heapRowY = (i) => HEAP.y + 44 + i * HEAP.dy;

// the record buffer: one doc's bytes, in a row; a character's x
export const BUF = { x: 270, y: 590, w: 715, h: 62, font: 10.5 };
export const CHAR_W = BUF.font * 0.6;
export const charX = (i) => BUF.x + 14 + i * CHAR_W;

export const LIDS = {};
export const BUBBLES = {};
export const CAMERAS = {
  overview: { rect: [0, 10, 1000, 680], label: '', section: null },
};

export const ANCHORS = {
  query: { p: [QUERY.x, QUERY.y + 20], needs: [] },
  'query.where': { p: [QUERY.x + 16, QUERY.y + 46], needs: [] },
  files: { p: [FILES.x, treeY(0) - 4], needs: [] },
  keyspace: { p: [FILES.x + 40, treeY(3) - 4], needs: [] },
  ...Object.fromEntries(ORDERS.map((o, i) => [`file.${o.stem}`, { p: [FILES.x, fileY(i) - 4], needs: [] }])),
  buffer: { p: [BUF.x, BUF.y + 14], needs: [] },
  plan: { p: [OP.x, opY(0) + 16], needs: [] },
  ...Object.fromEntries([0, 1, 2, 3, 4].map((s) => [`op.${s}`, { p: [OP.x, opY(s) + 16], needs: [] }])),
  ...Object.fromEntries([0, 1, 2, 3, 4].map((s) => [`chips.${s}`, { p: [OP.x + CHIP.x0, opY(s) + CHIP.dy + CHIP.h / 2], needs: [] }])),
  'filter.test': { p: [OP.x + OP.w - 150, opY(3) + 32], needs: [] },
  'scan.count': { p: [OP.x + OP.w - 90, opY(4) + 16], needs: [] },
  yields: { p: [OP.x - 14, opY(3) + OP.h + OP.gap / 2], needs: [] },
  heap: { p: [HEAP.x, HEAP.y + 18], needs: [] },
  out: { p: [OUT.x, OUT.y + 18], needs: [] },
  whole: { p: [OP.x - 20, opY(2) + 30], needs: [] },
};

export const SECTION_COLORS = ['query', 'plan', 'push', 'out', 'neutral'];
