// The 01-life explainer's geometry, with no DOM, so the build can check
// the narrative's references (anchors) against it.
//
// The picture: the app and its transaction's code (top left); the
// transaction's writes, in order, on a track (top right); and the
// cluster (below): alice's doc, bob's, and the ATR, each a card with
// its body and its xattr.

export const CANVAS = [0, 0, 1000, 640];

// the app, and its code, a line at a time
export const APP = { x: 30, y: 20, w: 420, h: 200 };
export const CODE = { x: APP.x + 36, y: APP.y + 62, dy: 28, font: 13 };
export const CHAR_W = CODE.font * 0.6;
export const lineY = (i) => CODE.y + i * CODE.dy;
export const charX = (c) => CODE.x + c * CHAR_W;
export const LINES = [
  'a := txn.Get("alice")',
  'b := txn.Get("bob")',
  'txn.Replace(a, {"balance":70})',
  'txn.Replace(b, {"balance":80})',
  'txn.Commit()',
];
// where a read's copy sits, beside its line
export const READ_X = charX(22) + 12;

// the track: each write, a station
export const TRACK = { x: 470, y: 20, w: 500, h: 200, x0: 500, dx: 70, sy: 96 };
export const stationX = (i) => TRACK.x0 + i * TRACK.dx;

// the cluster, and its three cards
export const CLUSTER = { x: 30, y: 244, w: 940, h: 384 };
export const CARD = { y: 290, w: 290, h: 256, x: { alice: 50, bob: 355, atr: 660 } };
// a card's parts, from its top
export const BODY = { dy: 44, h: 40 };
export const XATTR = { dy: 112, h: 132, row0: 26, rowDy: 25 };
export const xattrRowY = (r) => CARD.y + XATTR.dy + XATTR.row0 + r * XATTR.rowDy;
// (the docs' pointers to the ATR run under the cards)
export const POINTER_Y = { alice: 592, bob: 572 };

export const LIDS = {};
export const BUBBLES = {};
export const CAMERAS = { overview: { rect: [0, 0, 1000, 640], label: '', section: null } };

const card = (k) => ({ p: [CARD.x[k] + 4, CARD.y + 18], needs: [] });
export const ANCHORS = {
  app: { p: [APP.x + 4, APP.y + 24], needs: [] },
  ...Object.fromEntries(LINES.map((_, i) => [`line.${i}`, { p: [CODE.x - 6, lineY(i) - 4], needs: [] }])),
  read: { p: [READ_X, lineY(0) - 4], needs: [] },
  track: { p: [TRACK.x + 4, TRACK.y + 24], needs: [] },
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [`station.${i}`, { p: [stationX(i), TRACK.sy], needs: [] }])),
  halves: { p: [TRACK.x + 4, TRACK.y + 172], needs: [] },
  cluster: { p: [CLUSTER.x + 4, CLUSTER.y + 22], needs: [] },
  alice: card('alice'),
  bob: card('bob'),
  atr: card('atr'),
  'alice.body': { p: [CARD.x.alice + 4, CARD.y + BODY.dy + 20], needs: [] },
  'bob.body': { p: [CARD.x.bob + 4, CARD.y + BODY.dy + 20], needs: [] },
  'alice.txn': { p: [CARD.x.alice + 4, CARD.y + XATTR.dy + 10], needs: [] },
  'bob.txn': { p: [CARD.x.bob + 4, CARD.y + XATTR.dy + 10], needs: [] },
  'atr.entry': { p: [CARD.x.atr + 4, CARD.y + XATTR.dy + 10], needs: [] },
};

export const SECTION_COLORS = ['app', 'stage', 'commit', 'done', 'neutral'];
