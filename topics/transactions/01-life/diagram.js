// The 01-life explainer's diagram: one transaction, alice pays bob 30,
// as gocbcore ran it against the mock server. Each request leaves a line
// of the app's code as a red ball, travels to the one doc it reads or
// writes, and lands there; what it carries (a staged value, the ATR's
// new state) rides with it, and becomes part of that doc. What each doc
// holds after each write is the real run's (../lib/txn.js). Built once;
// main.js draws it partway between two neighboring states (states.js),
// which differ in one field.
//
// Colors (see ../README.md): amber, staged (in a doc's "txn" xattr);
// blue, the ATR; green, unstaged, done; red, the request in flight.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import {
  CANVAS, APP, CODE, LINES, lineY, charX, READ_X, TRACK, stationX, CLUSTER, CARD, BODY, XATTR, xattrRowY, POINTER_Y, ANCHORS,
} from './layout.js';
import { STATE, changed } from './states.js';
import { TXN, WRITES, COMMIT, serverAt, docView, atrView } from '../lib/txn.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const at = (e, x, y, s = 1) => e.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})${s !== 1 ? ` scale(${s.toFixed(3)})` : ''}`);
const seg = (q, a, b) => clamp01((q - a) / (b - a));
const E = easeQuad;

// a request's phases, over its change: the line's highlight moves to
// it; the ball travels; it lands; the track's dot moves on
const PH = { hl: [0, 0.12], fly: [0.12, 0.5], land: [0.5, 0.86], dot: [0.86, 1] };
// (a read's: there, a pause, and back with the copy)
const RD = { hl: [0, 0.12], out: [0.12, 0.42], back: [0.52, 0.88], settle: [0.88, 1] };

// the line each request comes from: the reads, from theirs; the ATR's
// PENDING, from the first Replace (it's written just before alice is
// staged); the commit and what follows, from Commit
const WRITE_LINE = [2, 2, 3, 4, 4, 4, 4];
function lineOf(s) {
  if (s.clean) return null;
  if (s.writes > 0) return WRITE_LINE[s.writes - 1];
  if (s.reads > 0) return s.reads - 1;
  return null;
}
const lineEnd = (i) => [charX(LINES[i].length) + 10, lineY(i) - 4];

// A cubic, from p0 down (or up) to p1.
function curve(p0, p1, t) {
  const down = p1[1] > p0[1];
  const c1 = down ? [p0[0] + 50, p0[1] + 60] : [p0[0], p0[1] - 80];
  const c2 = down ? [p1[0], p1[1] - 110] : [p1[0] + 50, p1[1] + 50];
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p1[k]);
}

// A polyline, drawn to fraction t of its length.
function partial(pts, t) {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = t * lens.reduce((s, x) => s + x, 0);
  const out = [pts[0]];
  for (let i = 1; i < pts.length && left > 0; i++) {
    const f = Math.min(1, left / lens[i - 1]);
    out.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]);
    left -= lens[i - 1];
  }
  return out.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

const CHIP_FONT = 12, CHIP_H = 20;
const chipW = (s) => s.length * CHIP_FONT * 0.6 + 12;
function chip(parent, s, cls) {
  const g = el('g', { opacity: 0 }, parent);
  el('rect', { x: 0, y: 0, width: chipW(s), height: CHIP_H, rx: 4, class: `chip-box ${cls}` }, g);
  txt(g, 6, 14.5, s, `chip-text ${cls}`);
  return g;
}

// the docs' writes, by doc: which write stages it, and which unstages it
const WRITE_OF = (key) => WRITES.findIndex((w) => w.key === key) + 1;
const DOCS = ['alice', 'bob'].map((k) => {
  const stageN = WRITE_OF(`stage.${k}`), unstageN = WRITE_OF(`unstage.${k}`);
  return {
    k, stageN, unstageN,
    before: docView(serverAt(stageN - 1), k),
    staged: docView(serverAt(stageN), k),
    after: docView(serverAt(unstageN), k),
  };
});
const docPhase = (D, s) => (s.writes >= D.unstageN ? 2 : s.writes >= D.stageN ? 1 : 0);
// the ATR: not there (0), PENDING (1), COMMITTED (2), its entry gone (3)
const ATR_N = { pending: WRITE_OF('atr.pending'), commit: WRITE_OF('commit'), done: WRITE_OF('atr.done') };
const atrPhase = (s) => (s.writes >= ATR_N.done ? 3 : s.writes >= ATR_N.commit ? 2 : s.writes >= ATR_N.pending ? 1 : 0);
const ATR_V = { pending: atrView(serverAt(ATR_N.pending)), commit: atrView(serverAt(ATR_N.commit)), done: atrView(serverAt(ATR_N.done)) };

// slots: where a chip sits, by its top left
const SLOT = {
  stgd: (k) => [CARD.x[k] + 72, xattrRowY(3) - 14.5],
  body: (k) => [CARD.x[k] + 62, CARD.y + BODY.dy + 10],
  st: () => [CARD.x.atr + 72, xattrRowY(0) - 14.5],
  read: (i) => [READ_X, lineY(i) - 14.5],
  // (a Replace's value, where it's written in its line)
  literal: (i) => [charX(LINES[i].indexOf('{')) - 6, lineY(i) - 14.5],
};
const STATION_KIND = (w) => (w.doc === 'atr' ? 'atr' : w.key.startsWith('stage') ? 'staged' : 'done');

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    const g = el('g', {}, svg);

    // the cluster, and its cards
    el('rect', { x: CLUSTER.x, y: CLUSTER.y, width: CLUSTER.w, height: CLUSTER.h, rx: 12, class: 'cluster' }, g);
    txt(g, CLUSTER.x + 16, CLUSTER.y + 24, 'the cluster', 'panel-title');
    txt(g, CLUSTER.x + 100, CLUSTER.y + 24, `bucket "default": its docs, spread over ${TXN.vbuckets.toLocaleString('en-US')} vbuckets`, 'panel-sub');

    // the docs' pointers to the ATR, under the cards
    this.pointers = {};
    for (const D of DOCS) {
      const sx = CARD.x[D.k] + CARD.w / 2, ex = D.k === 'alice' ? CARD.x.atr + 210 : CARD.x.atr + 100;
      const pts = [[sx, CARD.y + CARD.h], [sx, POINTER_Y[D.k]], [ex, POINTER_Y[D.k]], [ex, CARD.y + CARD.h + 6]];
      const path = el('path', { d: '', class: 'pointer' }, g);
      const head = el('path', { d: `M${ex - 5},${CARD.y + CARD.h + 13} L${ex},${CARD.y + CARD.h + 5} L${ex + 5},${CARD.y + CARD.h + 13}`, class: 'pointer-head', opacity: 0 }, g);
      const label = txt(g, (sx + ex) / 2, POINTER_Y[D.k] - 5, `${D.k}'s txn.atr`, 'pointer-label', 'middle');
      this.pointers[D.k] = { pts, path, head, label };
    }

    this.cards = {};
    for (const D of DOCS) this.cards[D.k] = this.buildDoc(g, D);
    this.atr = this.buildAtr(g);

    // the app
    el('rect', { x: APP.x, y: APP.y, width: APP.w, height: APP.h, rx: 12, class: 'app' }, g);
    txt(g, APP.x + 16, APP.y + 24, 'the app', 'panel-title');
    txt(g, APP.x + 76, APP.y + 24, `gocbcore ${TXN.gocbcore}, running the transaction`, 'panel-sub');
    this.lineHl = el('rect', { x: APP.x + 12, y: 0, width: APP.w - 24, height: 24, rx: 5, class: 'line-hl', opacity: 0 }, g);
    LINES.forEach((s, i) => {
      txt(g, APP.x + 18, lineY(i), String(i + 1), 'line-no');
      const t = txt(g, CODE.x, lineY(i), '', 'code');
      const b = s.indexOf('{');
      if (b < 0) t.textContent = s;
      else {
        const e = s.indexOf('}') + 1;
        for (const [part, cls] of [[s.slice(0, b), ''], [s.slice(b, e), 'code-staged'], [s.slice(e), '']]) el('tspan', { class: cls }, t).textContent = part;
      }
    });

    // the track: the writes, in order, each a station
    this.track = el('g', { opacity: 0 }, g);
    el('rect', { x: TRACK.x, y: TRACK.y, width: TRACK.w, height: TRACK.h, rx: 12, class: 'app' }, this.track);
    txt(this.track, TRACK.x + 16, TRACK.y + 24, `the transaction's ${WRITES.length} writes, in order`, 'panel-title');
    txt(this.track, TRACK.x + 16, TRACK.y + 42, 'each one a write to one doc', 'panel-sub');
    this.halves = ['back', 'forward'].map((side, j) => {
      const hg = el('g', { opacity: 0 }, this.track);
      const xa = j ? stationX(COMMIT) + 14 : TRACK.x + 12, xb = j ? TRACK.x + TRACK.w - 12 : stationX(COMMIT) - 14;
      el('rect', { x: xa, y: TRACK.y + 150, width: xb - xa, height: 40, rx: 6, class: `half half-${side}` }, hg);
      txt(hg, (xa + xb) / 2, TRACK.y + 167, j ? 'a crash after it:' : 'a crash before it:', 'half-text', 'middle');
      txt(hg, (xa + xb) / 2, TRACK.y + 182, j ? 'rolled forward' : 'rolled back', `half-text half-${side}-text`, 'middle');
      return hg;
    });
    el('line', { x1: stationX(0), x2: stationX(WRITES.length - 1), y1: TRACK.sy, y2: TRACK.sy, class: 'rail' }, this.track);
    this.progress = el('line', { x1: stationX(0), x2: stationX(0), y1: TRACK.sy, y2: TRACK.sy, class: 'rail-done' }, this.track);
    this.stations = WRITES.map((w, i) => {
      const sg = el('g', { opacity: 0 }, this.track);
      const x = stationX(i), big = i === COMMIT;
      const ring = el('circle', { cx: x, cy: TRACK.sy, r: big ? 11 : 8, class: 'station' }, sg);
      const fill = el('circle', { cx: x, cy: TRACK.sy, r: big ? 11 : 8, class: `station-fill st-${STATION_KIND(w)}`, opacity: 0 }, sg);
      txt(sg, x, TRACK.sy + 30, w.label[0], 'station-label', 'middle');
      txt(sg, x, TRACK.sy + 44, w.label[1], 'station-label', 'middle');
      if (big) txt(sg, x, TRACK.sy - 22, '★ the commit point', 'commit-label', 'middle');
      return { g: sg, ring, fill };
    });

    // in flight: chips, and the ball, over everything
    this.reads = DOCS.map((D) => chip(g, D.before.body, 'chip-read'));
    this.stgd = {};
    for (const D of DOCS) this.stgd[D.k] = chip(g, D.staged.txn.stgd, 'chip-staged');
    this.st = { pending: chip(g, ATR_V.pending.entry.st, 'chip-pending'), committed: chip(g, ATR_V.commit.entry.st, 'chip-committed') };
    this.ball = el('circle', { r: 6.5, class: 'ball', opacity: 0, cx: 0, cy: 0 }, g);

    this.target = el('circle', { r: 13, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this.cur = null;
  }

  buildDoc(g, D) {
    const x = CARD.x[D.k], y = CARD.y;
    const c = el('g', {}, g);
    el('rect', { x, y, width: CARD.w, height: CARD.h, rx: 10, class: 'card' }, c);
    txt(c, x + 14, y + 24, D.k, 'card-key');
    txt(c, x + CARD.w - 14, y + 24, `vbucket ${TXN.vb[D.k]}`, 'card-vb', 'end');
    el('rect', { x: x + 10, y: y + BODY.dy, width: CARD.w - 20, height: BODY.h, rx: 6, class: 'body-box' }, c);
    txt(c, x + 20, y + BODY.dy + 25, 'body', 'field-label');
    const body = txt(c, x + 68, y + BODY.dy + 25, D.before.body, 'body-text');
    const newBody = txt(c, x + 68, y + BODY.dy + 25, D.after.body, 'body-text');
    const ghost = txt(c, x + CARD.w - 20, y + BODY.dy + 25, `was ${JSON.parse(D.before.body).balance}`, 'ghost-text', 'end');
    // the xattr, and its fields
    el('rect', { x: x + 10, y: y + XATTR.dy, width: CARD.w - 20, height: XATTR.h, rx: 6, class: 'xattr-box' }, c);
    txt(c, x + 20, y + XATTR.dy - 6, 'xattr "txn": only transactions look here', 'field-label');
    const none = txt(c, x + CARD.w / 2, y + XATTR.dy + XATTR.h / 2 + 4, '(none)', 'none-text', 'middle');
    const T = D.staged.txn;
    const rows = [['atr', T.atr], ['atmpt', T.atmpt], ['type', T.type], ['stgd', '']].map(([k, v], r) => {
      const rg = el('g', { opacity: 0 }, c);
      txt(rg, x + 22, xattrRowY(r), k, 'xattr-key');
      if (v) txt(rg, x + 78, xattrRowY(r), v, 'xattr-val');
      return rg;
    });
    return { body, newBody, ghost, none, rows };
  }

  buildAtr(g) {
    const x = CARD.x.atr, y = CARD.y, P = ATR_V.commit.entry;
    const c = el('g', { opacity: 0 }, g);
    el('rect', { x, y, width: CARD.w, height: CARD.h, rx: 10, class: 'card card-atr' }, c);
    txt(c, x + 14, y + 24, TXN.atr, 'card-key atr-key');
    txt(c, x + CARD.w - 14, y + 24, `vbucket ${TXN.vb.alice}`, 'card-vb', 'end');
    el('rect', { x: x + 10, y: y + BODY.dy, width: CARD.w - 20, height: BODY.h, rx: 6, class: 'body-box' }, c);
    txt(c, x + 20, y + BODY.dy + 25, 'body', 'field-label');
    txt(c, x + 68, y + BODY.dy + 25, 'one zero byte: unused', 'none-text');
    el('rect', { x: x + 10, y: y + XATTR.dy, width: CARD.w - 20, height: XATTR.h, rx: 6, class: 'xattr-box xattr-atr' }, c);
    txt(c, x + 20, y + XATTR.dy - 6, `xattr "attempts", by attempt: ${P.id}`, 'field-label');
    const entry = el('g', {}, c);
    const rows = [['st', ''], ['tid', P.tid], ['exp', `${P.exp / 1000} s from its start`], ['rep', P.rep.join(', ')]].map(([k, v], r) => {
      const rg = el('g', {}, entry);
      txt(rg, x + 22, xattrRowY(r), k, 'xattr-key');
      if (v) txt(rg, x + 78, xattrRowY(r), v, 'xattr-val');
      return rg;
    });
    const gone = el('rect', { x: x + 14, y: y + XATTR.dy + 6, width: CARD.w - 28, height: XATTR.h - 12, rx: 5, class: 'gone-box', opacity: 0 }, c);
    const goneText = txt(c, x + CARD.w - 22, y + XATTR.dy + XATTR.h - 12, `${P.id}: deleted`, 'gone-text', 'end');
    return { g: c, entry, rows, gone, goneText };
  }

  // From state a to its neighbor b, partway (q, 0..1).
  draw(a, b, q) {
    const A = STATE[a], B = STATE[b] || A;
    this.cur = { key: q < 0.5 ? a : b, state: q < 0.5 ? A : B };
    const field = a === b ? null : changed(A, B)[0];
    const ph = (k) => (field ? seg(q, ...PH[k]) : 1);
    const rd = (k) => (field ? seg(q, ...RD[k]) : 1);

    // the current line: its highlight moves from line to line
    const la = lineOf(A), lb = lineOf(B);
    const hlT = field === 'reads' || field === 'writes' ? E(field === 'reads' ? rd('hl') : ph('hl')) : field === 'clean' ? E(q) : 1;
    const ya = la == null ? (lb == null ? 0 : lineY(lb)) : lineY(la), yb = lb == null ? ya : lineY(lb);
    this.lineHl.setAttribute('y', (lerp(ya, yb, hlT) - 17).toFixed(1));
    op(this.lineHl, lerp(la == null ? 0 : 1, lb == null ? 0 : 1, hlT));

    // the ball, in flight
    let ball = null;

    // the reads: each copy comes back to its line
    DOCS.forEach((D, i) => {
      const R = this.reads[i];
      const from = SLOT.body(D.k), to = SLOT.read(i);
      if (field === 'reads' && B.reads === i + 1) {
        const out = E(rd('out')), back = E(rd('back'));
        if (out > 0 && out < 1) ball = curve(lineEnd(i), [from[0] - 8, from[1] + 10], out);
        else if (out >= 1 && back <= 0) ball = [from[0] - 8, from[1] + 10];
        if (back > 0) {
          const p = curve(from, to, back);
          at(R, p[0], p[1]);
          op(R, 1);
          if (back < 1) ball = [p[0] - 8, p[1] + 10];
        } else op(R, 0);
      } else {
        at(R, to[0], to[1]);
        op(R, B.reads > i ? 1 : 0);
      }
    });

    // the writes: the one in flight, and what it lands
    const w = field === 'writes' ? WRITES[B.writes - 1] : null;
    const fly = E(ph('fly')), land = ph('land');

    // the docs
    for (const D of DOCS) {
      const C = this.cards[D.k], S = this.stgd[D.k];
      const pa = docPhase(D, A), pb = docPhase(D, B);
      const moving = field === 'writes' && pa !== pb;
      const P = this.pointers[D.k];
      let rows = pb >= 1 && pb < 2 ? 1 : 0, ptr = rows, oldBody = pb < 2 ? 1 : 0, ghost = pb >= 2 ? 1 : 0;
      let chipAt = pb === 1 ? SLOT.stgd(D.k) : null, chipOp = pb === 1 ? 1 : 0, newBody = pb >= 2 ? 1 : 0;
      if (moving && pb === 1) {
        // staging: the value leaves its line, rides the ball to the
        // xattr's stgd; the xattr's other fields fill in; the pointer
        // to the ATR is drawn
        const line = WRITE_LINE[B.writes - 1];
        const p = curve(SLOT.literal(line), SLOT.stgd(D.k), fly);
        chipAt = p;
        chipOp = fly > 0 ? 1 : 0;
        if (fly > 0 && fly < 1) ball = [p[0] - 8, p[1] + 10];
        rows = E(seg(land, 0, 0.55));
        ptr = seg(land, 0.55, 1);
      } else if (moving && pb === 2) {
        // unstaging: the ball comes from Commit to the xattr; then the
        // staged value rises into the body, and the old body goes, as
        // a ghost; the xattr and its pointer go
        const target = [CARD.x[D.k] + CARD.w / 2, CARD.y + XATTR.dy + XATTR.h / 2];
        if (fly > 0 && fly < 1) ball = curve(lineEnd(4), target, fly);
        const rise = E(seg(land, 0, 0.45));
        chipAt = [lerp(SLOT.stgd(D.k)[0], SLOT.body(D.k)[0], rise), lerp(SLOT.stgd(D.k)[1], SLOT.body(D.k)[1], rise)];
        // (the old body makes way as the new one arrives, and stays as
        // a ghost)
        oldBody = 1 - seg(land, 0.36, 0.52);
        chipOp = 1 - seg(land, 0.5, 0.62);
        newBody = seg(land, 0.48, 0.6);
        ghost = seg(land, 0.5, 0.68);
        rows = 1 - seg(land, 0.6, 0.85);
        ptr = 1 - seg(land, 0.6, 0.85);
      }
      C.rows.forEach((r, j) => op(r, clamp01(rows * 4 - j)));
      op(C.none, pb === 0 && !moving ? 1 : moving && pb === 1 ? 1 - seg(land, 0, 0.3) : moving && pb === 2 ? seg(land, 0.82, 1) : pb === 2 ? 1 : 0);
      op(C.body, oldBody);
      at(C.body, -14 * (1 - oldBody), 0);
      op(C.newBody, newBody);
      op(C.ghost, ghost);
      if (chipAt) at(S, chipAt[0], chipAt[1]);
      op(S, chipOp);
      P.path.setAttribute('d', partial(P.pts, moving && pb === 1 ? ptr : 1));
      op(P.path, moving && pb === 1 ? (ptr > 0 ? 1 : 0) : ptr);
      op(P.head, moving && pb === 1 ? seg(ptr, 0.9, 1) : ptr);
      op(P.label, moving && pb === 1 ? seg(ptr, 0.6, 1) : ptr);
    }

    // the ATR
    {
      const R = this.atr, pa = atrPhase(A), pb = atrPhase(B);
      const moving = field === 'writes' && pa !== pb;
      let card = pb >= 1 ? 1 : 0, scale = 1;
      let pend = pb === 1 ? 1 : 0, pendAt = SLOT.st(), com = pb >= 2 ? 1 : 0, comAt = SLOT.st();
      let rep = pb >= 2 ? 1 : 0, entry = pb === 3 ? 0.35 : 1, gone = pb === 3 ? 1 : 0;
      if (moving && pb === 1) {
        // PENDING rides the ball from the first Replace to where the ATR
        // will be; then the ATR is written around it
        pendAt = curve(lineEnd(2), SLOT.st(), fly);
        pend = fly > 0 ? 1 : 0;
        if (fly > 0 && fly < 1) ball = [pendAt[0] - 8, pendAt[1] + 10];
        card = E(seg(land, 0, 0.6));
        scale = lerp(0.92, 1, card);
      } else if (moving && pb === 2) {
        // COMMITTED rides the ball from Commit; PENDING slides out as it
        // arrives; then the docs' list, in the same write
        comAt = curve(lineEnd(4), SLOT.st(), fly);
        com = fly > 0 ? 1 : 0;
        if (fly > 0 && fly < 1) ball = [comAt[0] - 8, comAt[1] + 10];
        const out = E(seg(fly, 0.75, 1));
        pend = 1 - out;
        pendAt = [SLOT.st()[0] + 70 * out, SLOT.st()[1]];
        rep = seg(land, 0.1, 0.6);
      } else if (moving && pb === 3) {
        // the entry's deleted: what it said stays, as a ghost
        const target = [CARD.x.atr + CARD.w / 2, CARD.y + XATTR.dy + XATTR.h / 2];
        if (fly > 0 && fly < 1) ball = curve(lineEnd(4), target, fly);
        entry = 1 - 0.65 * E(seg(land, 0, 0.5));
        gone = seg(land, 0.4, 0.9);
      }
      op(R.g, card);
      const cx = CARD.x.atr + CARD.w / 2, cy = CARD.y + CARD.h / 2;
      R.g.setAttribute('transform', `translate(${(cx * (1 - scale)).toFixed(1)} ${(cy * (1 - scale)).toFixed(1)}) scale(${scale.toFixed(3)})`);
      op(R.entry, entry);
      op(R.rows[3], rep);
      op(R.gone, gone);
      op(R.goneText, gone);
      at(this.st.pending, pendAt[0], pendAt[1]);
      op(this.st.pending, pend * (pb === 3 ? entry : 1));
      at(this.st.committed, comAt[0], comAt[1]);
      op(this.st.committed, com * entry);
    }

    // the ball
    if (ball) {
      this.ball.setAttribute('cx', ball[0].toFixed(1));
      this.ball.setAttribute('cy', ball[1].toFixed(1));
    }
    op(this.ball, ball ? 1 : 0);

    // the track: it comes, station by station; each write lands, and
    // the dot moves on
    const tOn = (s) => (s.track ? 1 : 0);
    op(this.track, field === 'track' ? E(seg(q, 0, 0.3)) : tOn(B));
    this.stations.forEach((S, i) => {
      op(S.g, field === 'track' ? E(seg(q, 0.3 + (i / WRITES.length) * 0.7, 0.3 + ((i + 1) / WRITES.length) * 0.7)) : tOn(B));
      const landed = (s) => (s.writes > i ? 1 : 0);
      op(S.fill, field === 'writes' && B.writes === i + 1 ? E(ph('dot')) : landed(B));
    });
    const reach = (s) => (s.writes > 0 ? stationX(s.writes - 1) : stationX(0));
    const rx = field === 'writes' ? lerp(reach(A), reach(B), E(ph('dot'))) : reach(B);
    this.progress.setAttribute('x2', rx.toFixed(1));
    this.halves.forEach((h, j) => op(h, field === 'halves' ? E(seg(q, j * 0.5, j * 0.5 + 0.5)) : B.halves ? 1 : 0));

  }

  setTarget(p) {
    if (!p) { this.target.setAttribute('cx', -9999); return; }
    this.target.setAttribute('cx', p[0]);
    this.target.setAttribute('cy', p[1]);
  }

  anchor(id) {
    const a = ANCHORS[id];
    return a ? { p: a.p, visible: true } : null;
  }
}
