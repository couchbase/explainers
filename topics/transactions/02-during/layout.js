// The 02-during explainer's geometry, with no DOM, so the build can
// check the narrative's references (anchors) against it.
//
// The picture: the transfer (T1) and its code (top left); the other
// client (top right): the auditor and its table of reads, then T2 and
// its code; and the cluster (below): alice, bob, and the two ATRs, for
// alice's vbucket (the transfer's) and bob's (T2's).

import { ATRS } from '../lib/during.js';

export const CANVAS = [0, 0, 1000, 560];

// the two clients' panels, and their code, a line at a time
export const T1P = { x: 30, y: 20, w: 420, h: 196 };
export const T2P = { x: 470, y: 20, w: 500, h: 196 };
export const CODE = { dy: 28, font: 13, y: 84 };
export const CHAR_W = CODE.font * 0.6;
export const lineY = (i) => CODE.y + i * CODE.dy;
export const codeX = (p) => p.x + 36;
export const T1_LINES = [
  'a := txn.Get("alice")',
  'b := txn.Get("bob")',
  'txn.Replace(a, {"balance":70})',
  'txn.Replace(b, {"balance":80})',
  'txn.Commit()',
];
export const T2_LINES = [
  'b := txn.Get("bob")',
  'a := txn.Get("alice")',
  'txn.Replace(b, {"balance":b-5})',
  'txn.Replace(a, {"balance":a+5})',
  'txn.Commit()',
];
export const lineEnd = (p, lines, i) => [codeX(p) + lines[i].length * CHAR_W + 10, lineY(i) - 4];
// where T2's reads sit, beside their lines
export const T2_READ_X = codeX(T2P) + 24 * CHAR_W;

// the auditor's table: a row per moment; plain reads, then a
// transaction's
export const TABLE = { label: T2P.x + 14, head: 62, sub: 80, row0: 110, dy: 32 };
export const COLS = { plain: [636, 686, 740], txn: [816, 866, 920] };
export const rowY = (m) => TABLE.row0 + m * TABLE.dy;
// (where a row's reads start: its group's left)
export const rowStart = (m, kind) => [COLS[kind][0] - 34, rowY(m) - 4];

// the cluster, and its four cards
export const CLUSTER = { x: 30, y: 236, w: 940, h: 312 };
export const CARD = { y: 282, w: 218, h: 250 };
export const CARD_X = { alice: 46, bob: 276, [ATRS[0]]: 506, [ATRS[1]]: 736 };
export const BODY = { dy: 46, h: 36 };
export const XATTR = { dy: 106, h: 132, row0: 24, rowDy: 26 };
export const xattrRowY = (r) => CARD.y + XATTR.dy + XATTR.row0 + r * XATTR.rowDy;
export const VAL_DX = 64;

export const LIDS = {};
export const BUBBLES = {};
export const CAMERAS = { overview: { rect: [0, 0, 1000, 560], label: '', section: null } };

const card = (k) => ({ p: [CARD_X[k] + 4, CARD.y + 18], needs: [] });
export const ANCHORS = {
  t1: { p: [T1P.x + 4, T1P.y + 24], needs: [] },
  't1.paused': { p: [codeX(T1P) - 6, lineY(3) - 4], needs: [] },
  right: { p: [T2P.x + 4, T2P.y + 24], needs: [] },
  ...Object.fromEntries([0, 1, 2].map((m) => [`row.${m}`, { p: [TABLE.label - 6, rowY(m) - 4], needs: [] }])),
  'col.plain': { p: [COLS.plain[1], TABLE.head - 4], needs: [] },
  'col.txn': { p: [COLS.txn[1], TABLE.head - 4], needs: [] },
  ...Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`t2.line.${i}`, { p: [codeX(T2P) - 6, lineY(i) - 4], needs: [] }])),
  alice: card('alice'),
  bob: card('bob'),
  'atr.t1': card(ATRS[0]),
  'atr.t2': card(ATRS[1]),
  'atr.t1.entry': { p: [CARD_X[ATRS[0]] + 4, CARD.y + XATTR.dy + 10], needs: [] },
  'atr.t2.entry': { p: [CARD_X[ATRS[1]] + 4, CARD.y + XATTR.dy + 10], needs: [] },
  'bob.body': { p: [CARD_X.bob + 4, CARD.y + BODY.dy + 18], needs: [] },
  'bob.cas': { p: [CARD_X.bob + 4, CARD.y + 36], needs: [] },
  cluster: { p: [CLUSTER.x + 4, CLUSTER.y + 22], needs: [] },
};

export const SECTION_COLORS = ['app', 'stage', 'commit', 'done', 'neutral'];
