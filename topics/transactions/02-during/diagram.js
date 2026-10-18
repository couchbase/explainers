// The 02-during explainer's diagram: the transfer (T1), paused, while
// another client reads and writes the same docs. Each request travels
// as a ball, red for the transfer's and violet for the other client's,
// from its line of code (or the auditor's table) to the doc it reads or
// writes, and back with what it found. What the server holds in each
// state is the real runs' (model.js). Built once; main.js draws it
// partway between two neighboring states (states.js).
//
// A change plays as a timeline (plan, below): the line's highlight
// moves; the balls travel, one trip at a time; then what changed on the
// server lands, or a read's value fills its cell.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import {
  CANVAS, T1P, T2P, CODE, CHAR_W, lineY, codeX, lineEnd, T1_LINES, T2_LINES, T2_READ_X, TABLE, COLS, rowY, rowStart,
  CLUSTER, CARD, CARD_X, BODY, XATTR, xattrRowY, VAL_DX, ANCHORS,
} from './layout.js';
import { STATE, changed, T2_WAITS } from './states.js';
import { KEYS, serverOf, AUDIT, T2_READS, GHOST } from './model.js';
import { ATRS, VB } from '../lib/during.js';

const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
const at = (e, x, y) => e.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
const seg = (q, a, b) => clamp01((q - a) / (b - a));
const E = easeQuad;
const [ATR1, ATR2] = ATRS;

const CHIP_FONT = 12, CHIP_H = 20;
const chipW = (s) => s.length * CHIP_FONT * 0.6 + 12;
// a chip's class, by what it says
const chipCls = (s) => (/^(PENDING|COMMITTED|ABORTED)$/.test(s) ? `chip-${s.toLowerCase()}` : s.startsWith('{') ? 'chip-staged' : 'chip-read');

// A chip, its text and width set as it's drawn.
function chip(parent) {
  const g = el('g', { opacity: 0 }, parent);
  const r = el('rect', { x: 0, y: 0, width: 10, height: CHIP_H, rx: 4, class: 'chip-box' }, g);
  const t = txt(g, 6, 14.5, '', 'chip-text');
  return { g, set(s) { if (t.textContent === s) return; setText(t, s); r.setAttribute('width', chipW(s)); const c = chipCls(s); r.setAttribute('class', `chip-box ${c}`); t.setAttribute('class', `chip-text ${c}`); } };
}

// A cubic, from p0 to p1, bowed.
function curve(p0, p1, t) {
  const down = p1[1] > p0[1] + 20, up = p1[1] < p0[1] - 20;
  const c1 = down ? [p0[0] + 40, p0[1] + 70] : up ? [p0[0], p0[1] - 90] : [p0[0], p0[1] - 50];
  const c2 = down ? [p1[0], p1[1] - 110] : up ? [p1[0] + 40, p1[1] + 60] : [p1[0], p1[1] - 50];
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p1[k]);
}

// where things are, for the balls: a chip's top left is the ball's
// place plus CHIP_OFF
const CHIP_OFF = [9, -10];
const forChip = (slot) => [slot[0] - CHIP_OFF[0], slot[1] - CHIP_OFF[1]];
const P = {
  body: (k) => [CARD_X[k] + VAL_DX - 12, CARD.y + BODY.dy + 18],
  xattr: (k) => [CARD_X[k] + CARD.w / 2, CARD.y + XATTR.dy + XATTR.h / 2],
  stgdSlot: (k) => [CARD_X[k] + VAL_DX, xattrRowY(2) - 14.5],
  bodySlot: (k) => [CARD_X[k] + VAL_DX - 6, CARD.y + BODY.dy + 8],
  stSlot: (a) => [CARD_X[a] + VAL_DX, xattrRowY(1) - 14.5],
  entry: (a) => [CARD_X[a] + CARD.w / 2, CARD.y + XATTR.dy + XATTR.h / 2],
  t1: (i) => lineEnd(T1P, T1_LINES, i),
  t2: (i) => lineEnd(T2P, T2_LINES, i),
  // (a Replace's value, where it's written in its line)
  literal: (i) => [codeX(T2P) + T2_LINES[i].indexOf('{') * CHAR_W - 6, lineY(i) - 14.5],
};
// (where T2 waits, polling: at the transfer's ATR entry)
const PARK = [P.stSlot(ATR1)[0] - 18, P.stSlot(ATR1)[1] + 10];

// the line each client is on, in a state
function t1Line(s) {
  if (s.clean) return null;
  return s.t1 >= 4 ? 4 : 3;
}
const T2_LINE = [0, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 3, 4, 4, 4, 4];
function t2Line(s) {
  if (s.part !== 2 || s.clean || s.t2 === 0) return null;
  return T2_LINE[s.t2];
}
const parked = (s) => s.part === 2 && s.t2 === T2_WAITS;

const bal = (n) => `{"balance":${n}}`;

// The plan of a change, from A to B: its timeline, in order. Each piece
// has a kind: hl (a client's line highlight moves), go (a ball travels,
// maybe carrying a chip), land (the server changes), fill (cells fill),
// swap (the other client's panel changes), x (a write is refused), park
// (a waiting ball checks again).
function plan(A, B, field) {
  const S = serverOf(A);
  const out = [];
  const go = (ball, from, to, chip = null, w = 1) => out.push({ k: 'go', ball, from, to, chip, w });
  const hl = (who, from, to) => out.push({ k: 'hl', who, from, to, w: 0.5 });
  const land = (w = 1) => out.push({ k: 'land', w });
  const fill = (cells) => out.push({ k: 'fill', cells, w: 0.4 });
  if (field === 'audit') {
    const k = B.audit, m = Math.floor((k - 1) / 2), kind = (k - 1) % 2 ? 'txn' : 'plain', a = AUDIT[m];
    const start = rowStart(m, kind);
    for (const d of KEYS) {
      go(2, start, P.body(d));
      const doc = S.docs[d];
      if (kind === 'txn' && doc.txn) {
        // (a doc staged by another transaction: the reader looks up the
        // ATR its xattr points to, and reads its state)
        go(2, P.body(d), start, `${doc.balance} · stgd ${doc.txn.stgdBalance}`);
        go(2, start, forChip(P.stSlot(ATR1)));
        go(2, forChip(P.stSlot(ATR1)), start, a.atrState);
      } else go(2, P.body(d), start, `${kind === 'txn' ? a.txn[d] : a.plain[d]}`);
      fill([`${m}.${kind}.${d}`]);
    }
    fill([`${m}.${kind}.total`]);
  } else if (field === 't1') {
    const from = P.t1(4);
    if (t1Line(A) !== 4) hl(1, t1Line(A), 4);
    if (B.t1 === 4) go(1, from, forChip(P.stSlot(ATR1)), 'COMMITTED');
    else if (B.t1 === 5) go(1, from, P.xattr('alice'));
    else if (B.t1 === 6) go(1, from, P.xattr('bob'));
    else go(1, from, P.entry(ATR1));
    land(1.2);
  } else if (field === 'verdict') {
    fill(['verdict']);
  } else if (field === 'part') {
    out.push({ k: 'swap', w: 1 });
    land(1);
  } else if (field === 't2') {
    const n = B.t2, la = t2Line(A), lb = t2Line(B);
    const reads = (attempt) => {
      [['bob', 0], ['alice', 1]].forEach(([d, i]) => {
        if (i === 1 || la !== 0) hl(2, i === 1 ? 0 : la, i);
        const doc = S.docs[d];
        go(2, P.t2(i), P.body(d));
        if (doc.txn) {
          go(2, P.body(d), P.t2(i), `${doc.balance} · stgd ${doc.txn.stgdBalance}`);
          go(2, P.t2(i), forChip(P.stSlot(ATR1)));
          go(2, forChip(P.stSlot(ATR1)), P.t2(i), S.atrs[ATR1][0].st);
        } else go(2, P.body(d), P.t2(i), `${doc.balance}`);
        fill([`t2.${attempt}.${d}`]);
      });
    };
    if (n === 1) reads(1);
    else if (n === 8) reads(2);
    else {
      if (la !== lb) hl(2, la, lb);
      const from = P.t2(lb);
      if (n === 2) go(2, from, PARK);
      else if (n === 3) {
        out.push({ k: 'park', w: 0.8 });
        go(2, PARK, from);
      } else if (n === 4 || n === 9) { go(2, from, forChip(P.stSlot(ATR2)), 'PENDING'); land(); }
      else if (n === 5) {
        // (bob's new value, refused: bob's CAS isn't the one T2 read)
        go(2, forChip(P.literal(2)), forChip(P.stgdSlot('bob')), bal(T2_READS[0].bob - 5));
        out.push({ k: 'x', w: 1.2 });
        go(2, forChip(P.stgdSlot('bob')), from);
      } else if (n === 6) { go(2, from, forChip(P.stSlot(ATR2)), 'ABORTED'); land(); }
      else if (n === 10) { go(2, forChip(P.literal(2)), forChip(P.stgdSlot('bob')), bal(T2_READS[1].bob - 5)); land(); }
      else if (n === 11) { go(2, forChip(P.literal(3)), forChip(P.stgdSlot('alice')), bal(T2_READS[1].alice + 5)); land(); }
      else if (n === 12) { go(2, from, forChip(P.stSlot(ATR2)), 'COMMITTED'); land(); }
      else if (n === 13) { go(2, from, P.xattr('bob')); land(1.2); }
      else if (n === 14) { go(2, from, P.xattr('alice')); land(1.2); }
      else { go(2, from, P.entry(ATR2)); land(); }
    }
  } else if (field === 'clean') {
    out.push({ k: 'hl', who: 1, from: t1Line(A), to: null, w: 1 });
  }
  return out;
}

// A field that crossfades from one value to the next: the old slides
// out to the left as the new comes in.
function field(parent, x, y, cls, isChip = false, anchor) {
  const layers = [0, 1].map(() => {
    const g = el('g', {}, parent);
    if (isChip) {
      const c = chip(g);
      op(c.g, 1);
      at(c.g, 0, -14.5);
      return { g, set: (s) => c.set(s) };
    }
    const t = txt(g, 0, 0, '', cls, anchor);
    return { g, set: (s) => setText(t, s) };
  });
  return {
    draw(a, b, t) {
      const [L0, L1] = layers;
      if (a === b || t >= 1 || t <= 0) {
        const v = t >= 1 ? b : a === b ? b : a;
        L0.set(v || '');
        at(L0.g, x, y);
        op(L0.g, v ? 1 : 0);
        op(L1.g, 0);
        return;
      }
      const out = E(seg(t, 0, 0.55)), inn = E(seg(t, 0.45, 1));
      L0.set(a || '');
      at(L0.g, x - 16 * out, y);
      op(L0.g, a ? 1 - out : 0);
      L1.set(b || '');
      at(L1.g, x + 16 * (1 - inn), y);
      op(L1.g, b ? inn : 0);
    },
  };
}

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    const g = el('g', {}, svg);

    // the cluster, and its cards
    el('rect', { x: CLUSTER.x, y: CLUSTER.y, width: CLUSTER.w, height: CLUSTER.h, rx: 12, class: 'cluster' }, g);
    txt(g, CLUSTER.x + 16, CLUSTER.y + 24, 'the cluster', 'panel-title');
    txt(g, CLUSTER.x + 100, CLUSTER.y + 24, 'bucket "default"', 'panel-sub');
    this.docs = {};
    for (const k of KEYS) this.docs[k] = this.buildDoc(g, k);
    this.atrs = {};
    ATRS.forEach((a, i) => { this.atrs[a] = this.buildAtr(g, a, i); });

    // the transfer, T1
    el('rect', { x: T1P.x, y: T1P.y, width: T1P.w, height: T1P.h, rx: 12, class: 'app' }, g);
    txt(g, T1P.x + 16, T1P.y + 24, 'T1: alice pays bob 30', 'panel-title');
    txt(g, T1P.x + 16, T1P.y + 42, "01's transfer, paused by a test hook", 'panel-sub');
    this.hl1 = el('rect', { x: T1P.x + 12, y: 0, width: T1P.w - 24, height: 24, rx: 5, class: 'line-hl', opacity: 0 }, g);
    this.code(g, T1P, T1_LINES);
    this.paused = el('g', { opacity: 0 }, g);
    const px = codeX(T1P) + T1_LINES[3].length * CHAR_W + 14;
    el('rect', { x: px, y: lineY(3) - 15, width: 92, height: 20, rx: 10, class: 'paused-box' }, this.paused);
    txt(this.paused, px + 46, lineY(3) - 1, '❚❚ paused here', 'paused-text', 'middle');

    // the other client: the auditor, then T2
    el('rect', { x: T2P.x, y: T2P.y, width: T2P.w, height: T2P.h, rx: 12, class: 'app app-2' }, g);
    this.auditor = el('g', {}, g);
    this.buildAuditor(this.auditor);
    this.t2 = el('g', { opacity: 0 }, g);
    this.hl2 = el('rect', { x: T2P.x + 12, y: 0, width: T2P.w - 24, height: 24, rx: 5, class: 'line-hl line-hl-2', opacity: 0 }, this.t2);
    txt(this.t2, T2P.x + 16, T2P.y + 24, 'T2: bob pays alice 5', 'panel-title');
    this.attempt = txt(this.t2, T2P.x + T2P.w - 16, T2P.y + 24, '', 'attempt-text', 'end');
    txt(this.t2, T2P.x + 16, T2P.y + 42, 'another app, at the same time', 'panel-sub');
    this.code(this.t2, T2P, T2_LINES);
    this.t2reads = {};
    [1, 2].forEach((n) => [['bob', 0], ['alice', 1]].forEach(([d, i]) => {
      const c = chip(this.t2);
      c.set(`${T2_READS[n - 1][d]}`);
      const x = T2_READ_X + (n - 1) * 92;
      at(c.g, x, lineY(i) - 14.5);
      const cas = txt(this.t2, x + chipW(`${T2_READS[n - 1][d]}`) + 5, lineY(i) - 1, `@${T2_READS[n - 1].cas[d]}`, 'cas-tag');
      const strike = el('line', { x1: x - 2, x2: x + chipW(`${T2_READS[n - 1][d]}`) + 2, y1: lineY(i) - 4.5, y2: lineY(i) - 4.5, class: 'strike', opacity: 0 }, this.t2);
      this.t2reads[`${n}.${d}`] = { c, cas, strike };
    }));

    // a write refused: bob's CAS isn't the one T2 read
    this.refused = el('g', { opacity: 0 }, g);
    const bx = CARD_X.bob + CARD.w / 2, by = CARD.y + XATTR.dy + XATTR.h - 26;
    txt(this.refused, bx, by, `✕ refused: T2 read ${T2_READS[0].cas.bob},`, 'refused-text', 'middle');
    txt(this.refused, bx, by + 14, `but bob's CAS is now ${serverOf(STATE['t2.cas']).docs.bob.cas}`, 'refused-text', 'middle');
    this.refusedX = txt(g, 0, 0, '✕', 'refused-x', 'middle');
    op(this.refusedX, 0);

    // in flight: the chips the balls carry, and the balls; T2's waiting
    // ring
    this.ring = el('g', { opacity: 0 }, g);
    el('circle', { cx: PARK[0], cy: PARK[1], r: 13, class: 'wait-ring' }, this.ring);
    txt(this.ring, CARD_X[ATR1] + 18, xattrRowY(3) + 4, 'T2 waits here: is T1 done yet?', 'wait-text');
    this.carry = { 1: chip(g), 2: chip(g) };
    this.rise = { alice: chip(g), bob: chip(g) };
    this.balls = { 1: el('circle', { r: 6.5, class: 'ball', opacity: 0 }, g), 2: el('circle', { r: 6.5, class: 'ball ball-2', opacity: 0 }, g) };

    this.target = el('circle', { r: 13, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this.cur = null;
  }

  code(parent, p, lines) {
    lines.forEach((s, i) => {
      txt(parent, p.x + 18, lineY(i), String(i + 1), 'line-no');
      const t = txt(parent, codeX(p), lineY(i), '', 'code');
      const b = s.indexOf('{');
      if (b < 0) t.textContent = s;
      else {
        const e = s.indexOf('}') + 1;
        for (const [part, cls] of [[s.slice(0, b), ''], [s.slice(b, e), 'code-staged'], [s.slice(e), '']]) el('tspan', { class: cls }, t).textContent = part;
      }
    });
  }

  buildAuditor(g) {
    txt(g, T2P.x + 16, T2P.y + 24, 'the auditor', 'panel-title');
    txt(g, T2P.x + 100, T2P.y + 24, 'reads alice and bob: their total should be 150', 'panel-sub');
    txt(g, (COLS.plain[0] + COLS.plain[2]) / 2, TABLE.head, 'plain reads', 'col-head', 'middle');
    txt(g, (COLS.txn[0] + COLS.txn[2]) / 2, TABLE.head, "a transaction's reads", 'col-head', 'middle');
    for (const kind of ['plain', 'txn']) ['alice', 'bob', 'total'].forEach((h, j) => txt(g, COLS[kind][j], TABLE.sub, h, 'col-sub', 'middle'));
    const labels = ['both staged', 'COMMITTED', 'alice unstaged'];
    this.cells = {};
    AUDIT.forEach((a, m) => {
      txt(g, TABLE.label, rowY(m), `${m + 1}. ${labels[m]}`, 'row-label');
      for (const kind of ['plain', 'txn']) {
        KEYS.forEach((d, j) => {
          const c = txt(g, COLS[kind][j], rowY(m), `${a[kind][d]}`, `cell ${kind === 'txn' && a.staged[d] ? 'cell-staged' : ''}`, 'middle');
          this.cells[`${m}.${kind}.${d}`] = c;
        });
        const ok = a.total[kind] === 150;
        const hlr = el('rect', { x: COLS[kind][2] - 26, y: rowY(m) - 15, width: 52, height: 21, rx: 4, class: ok ? 'verdict-ok' : 'verdict-bad', opacity: 0 }, g);
        const tc = txt(g, COLS[kind][2], rowY(m), `${a.total[kind]}`, 'cell cell-total', 'middle');
        const mark = txt(g, COLS[kind][2] + 30, rowY(m), ok ? '✓' : '✗', ok ? 'mark-ok' : 'mark-bad');
        this.cells[`${m}.${kind}.total`] = tc;
        this.cells[`verdict.${m}.${kind}`] = { hlr, mark, ok };
      }
    });
  }

  buildDoc(g, k) {
    const x = CARD_X[k], y = CARD.y;
    const c = el('g', {}, g);
    el('rect', { x, y, width: CARD.w, height: CARD.h, rx: 10, class: 'card' }, c);
    txt(c, x + 12, y + 22, k, 'card-key');
    txt(c, x + CARD.w - 12, y + 22, `vbucket ${VB[k]}`, 'card-vb', 'end');
    el('rect', { x: x + 8, y: y + BODY.dy, width: CARD.w - 16, height: BODY.h, rx: 6, class: 'body-box' }, c);
    txt(c, x + 16, y + BODY.dy + 22, 'body', 'field-label');
    txt(c, x + 12, y + 38, 'CAS', 'field-label');
    el('rect', { x: x + 8, y: y + XATTR.dy, width: CARD.w - 16, height: XATTR.h, rx: 6, class: 'xattr-box' }, c);
    txt(c, x + 16, y + XATTR.dy - 6, 'xattr "txn"', 'field-label');
    const F = {
      body: field(c, x + VAL_DX, y + BODY.dy + 23, 'body-text'),
      cas: field(c, x + 38, y + 38, 'cas-text'),
      ghost: field(c, x + CARD.w - 12, y + BODY.dy + BODY.h + 16, 'ghost-text', false, 'end'),
      none: field(c, x + CARD.w / 2 - 20, y + XATTR.dy + XATTR.h / 2 + 4, 'none-text'),
      keys: [0, 1, 2].map((r) => field(c, x + 18, xattrRowY(r), 'xattr-key')),
      atr: field(c, x + VAL_DX, xattrRowY(0), 'xattr-val'),
      atmpt: field(c, x + VAL_DX, xattrRowY(1), 'xattr-val'),
      stgd: field(c, x + VAL_DX, xattrRowY(2), '', true),
    };
    return F;
  }

  buildAtr(g, a, i) {
    const x = CARD_X[a], y = CARD.y;
    const whose = i === 0 ? "alice's" : "bob's";
    txt(g, x + 4, y - 7, `the ATR for ${whose} vbucket`, 'atr-title');
    const none = el('g', {}, g);
    el('rect', { x, y, width: CARD.w, height: CARD.h, rx: 10, class: 'card-none' }, none);
    txt(none, x + CARD.w / 2, y + CARD.h / 2, 'not written yet', 'none-text', 'middle');
    const c = el('g', {}, g);
    el('rect', { x, y, width: CARD.w, height: CARD.h, rx: 10, class: 'card card-atr' }, c);
    txt(c, x + 12, y + 22, a, 'card-key atr-key');
    txt(c, x + CARD.w - 12, y + 40, `vbucket ${VB[i === 0 ? 'alice' : 'bob']}`, 'card-vb', 'end');
    el('rect', { x: x + 8, y: y + XATTR.dy, width: CARD.w - 16, height: XATTR.h, rx: 6, class: 'xattr-box xattr-atr' }, c);
    txt(c, x + 16, y + XATTR.dy - 6, 'xattr "attempts"', 'field-label');
    const F = {
      none: field(c, x + CARD.w / 2 - 34, y + XATTR.dy + XATTR.h / 2 + 4, 'none-text'),
      keys: [0, 1, 2].map((r) => field(c, x + 18, xattrRowY(r), 'xattr-key')),
      id: field(c, x + VAL_DX, xattrRowY(0), 'xattr-val'),
      st: field(c, x + VAL_DX, xattrRowY(1), '', true),
      rep: field(c, x + VAL_DX, xattrRowY(2), 'xattr-val'),
    };
    return { none, c, F };
  }

  // From state a to its neighbor b, partway (q, 0..1).
  draw(a, b, q) {
    const A = STATE[a], B = STATE[b] || A;
    this.cur = { key: q < 0.5 ? a : b, state: q < 0.5 ? A : B };
    const f = a === b ? null : changed(A, B)[0];
    const pieces = f ? plan(A, B, f) : [];
    // (each piece's share of the change, and where q is in it)
    const total = pieces.reduce((s, p) => s + p.w, 0) || 1;
    let acc = 0;
    for (const p of pieces) { p.t = seg(q, acc / total, (acc + p.w) / total); acc += p.w; }
    const tOf = (k) => { const p = pieces.find((x) => x.k === k); return p ? p.t : 1; };
    const landT = tOf('land'), swapT = tOf('swap');

    // the server
    const SA = serverOf(A), SB = serverOf(B), GA = GHOST[a] || {}, GB = GHOST[b] || GA;
    for (const k of KEYS) this.drawDoc(k, SA.docs[k], SB.docs[k], GA[k], GB[k], landT);
    for (const atr of ATRS) this.drawAtr(atr, SA.atrs[atr], SB.atrs[atr], landT);

    // the line highlights
    const hlDraw = (rect, who, lineOf) => {
      const p = pieces.filter((x) => x.k === 'hl' && x.who === who);
      let la = lineOf(A), lb = lineOf(B), t = 1;
      const cur = p.find((x) => x.t > 0 && x.t < 1) || [...p].reverse().find((x) => x.t >= 1) || p[0];
      if (cur) { la = cur.from; lb = cur.to; t = cur.t; }
      if (!cur && la !== lb) t = q;
      const ya = la == null ? (lb == null ? 0 : lineY(lb)) : lineY(la), yb = lb == null ? ya : lineY(lb);
      rect.setAttribute('y', (lerp(ya, yb, E(t)) - 17).toFixed(1));
      op(rect, lerp(la == null ? 0 : 1, lb == null ? 0 : 1, E(t)));
    };
    hlDraw(this.hl1, 1, t1Line);
    hlDraw(this.hl2, 2, t2Line);
    const pausedOn = (s) => (s.t1 === 3 && !s.clean ? 1 : 0);
    op(this.paused, f === 'part' ? 1 : f === 't1' && A.t1 === 3 ? 1 - E(seg(q, 0, 0.15)) : pausedOn(B));

    // the other client's panel: the auditor, or T2
    const isT2 = (s) => (s.part === 2 ? 1 : 0);
    const sw = f === 'part' ? E(swapT) : isT2(B);
    op(this.auditor, 1 - sw);
    op(this.t2, sw);
    const fillT = (id) => { const p = pieces.find((x) => x.k === 'fill' && x.cells.includes(id)); return p ? p.t : null; };
    AUDIT.forEach((_, m) => {
      for (const kind of ['plain', 'txn']) {
        const n = 2 * m + (kind === 'txn' ? 2 : 1);
        const has = (s) => (s.part === 1 && s.audit >= n ? 1 : 0);
        for (const id of [...KEYS, 'total'].map((d) => `${m}.${kind}.${d}`)) {
          const t = fillT(id);
          op(this.cells[id], f === 'part' ? has(A) : t != null && !has(A) ? E(t) : has(B));
        }
        const V = this.cells[`verdict.${m}.${kind}`];
        const vt = f === 'verdict' ? E(fillT('verdict')) : B.verdict ? 1 : 0;
        op(V.mark, vt);
        op(V.hlr, V.ok ? 0 : vt);
      }
    });
    setText(this.attempt, B.t2 >= 8 ? 'attempt 2' : B.t2 >= 5 ? 'attempt 1: failed' : B.t2 >= 1 ? 'attempt 1' : '');
    for (const [id, R] of Object.entries(this.t2reads)) {
      const [n, d] = id.split('.');
      const from = n === '1' ? 1 : 8;
      const has = (s) => (s.part === 2 && s.t2 >= from ? 1 : 0);
      const t = fillT(`t2.${n}.${d}`);
      const v = t != null && !has(A) ? E(t) : has(B);
      // (attempt 1's reads, struck through once attempt 2 reads again)
      const old = n === '1' ? (f === 't2' && B.t2 === 8 ? E(seg(q, 0, 0.1)) : B.t2 >= 8 ? 1 : 0) : 0;
      op(R.c.g, v * (1 - 0.6 * old));
      op(R.cas, v * (1 - 0.6 * old));
      op(R.strike, v * old);
    }
    const refusedOn = (s) => (s.part === 2 && s.t2 >= 5 && s.t2 <= 7 ? 1 : 0);
    op(this.refused, f === 't2' && B.t2 === 5 ? E(tOf('x')) : f === 't2' && B.t2 === 8 ? 1 - E(seg(q, 0, 0.1)) : refusedOn(B));

    // the balls, and what they carry
    const shown = { 1: false, 2: false };
    for (const p of pieces.filter((x) => x.k === 'go')) {
      if (p.t <= 0 || p.t >= 1) continue;
      const pos = curve(p.from, p.to, E(p.t));
      this.balls[p.ball].setAttribute('cx', pos[0].toFixed(1));
      this.balls[p.ball].setAttribute('cy', pos[1].toFixed(1));
      shown[p.ball] = true;
      const C = this.carry[p.ball];
      if (p.chip) {
        C.set(p.chip);
        at(C.g, pos[0] + CHIP_OFF[0], pos[1] + CHIP_OFF[1]);
      }
      op(C.g, p.chip ? 1 : 0);
    }
    for (const n of [1, 2]) if (!shown[n]) op(this.carry[n].g, 0);
    // (a chip that's just landed in its slot stays until the server
    // shows it)
    for (const p of pieces.filter((x) => x.k === 'go' && x.chip && x.t >= 1)) {
      const next = pieces[pieces.indexOf(p) + 1];
      if (next && (next.k === 'land' || next.k === 'x') && next.t < 1 && !shown[p.ball]) {
        const C = this.carry[p.ball];
        C.set(p.chip);
        at(C.g, p.to[0] + CHIP_OFF[0], p.to[1] + CHIP_OFF[1]);
        op(C.g, next.k === 'x' ? 1 - E(seg(next.t, 0.5, 1)) : 1 - E(seg(next.t, 0.4, 0.7)));
      }
    }
    // T2, waiting: its ball parked at the transfer's ATR entry
    const parkP = pieces.find((x) => x.k === 'park');
    const goes = pieces.filter((x) => x.k === 'go');
    const parkedNow = (parked(A) && parked(B)) || (parked(B) && goes.length && goes[goes.length - 1].t >= 1) || (parked(A) && goes.length && goes[0].t <= 0);
    if (parkedNow && !shown[2]) {
      this.balls[2].setAttribute('cx', PARK[0]);
      this.balls[2].setAttribute('cy', PARK[1]);
      shown[2] = true;
    }
    op(this.ring, parkedNow ? (parkP ? 1 - E(seg(parkP.t, 0.5, 1)) : 1) : 0);
    for (const n of [1, 2]) op(this.balls[n], shown[n] ? 1 : 0);

    // the refused write's ✕, at bob's xattr
    const xP = pieces.find((x) => x.k === 'x');
    if (xP) {
      const s = P.stgdSlot('bob');
      this.refusedX.setAttribute('x', s[0] + 40);
      this.refusedX.setAttribute('y', s[1] + 18);
    }
    op(this.refusedX, xP ? Math.sin(Math.PI * xP.t) : 0);
  }

  drawDoc(k, a, b, ga, gb, t) {
    const F = this.docs[k];
    const both = (fn) => [fn(a), fn(b)];
    // unstaging: the staged value rises into the body
    const rising = a.txn && !b.txn && a.txn.stgd === b.body;
    const R = this.rise[k];
    if (rising && t > 0 && t < 1) {
      const r = E(seg(t, 0, 0.45));
      const s0 = P.stgdSlot(k), s1 = P.bodySlot(k);
      R.set(a.txn.stgd);
      at(R.g, lerp(s0[0], s1[0], r), lerp(s0[1], s1[1], r));
      op(R.g, 1 - seg(t, 0.5, 0.6));
    } else op(R.g, 0);
    const bt = rising ? seg(t, 0.4, 0.6) : t;
    F.body.draw(a.body, b.body, bt);
    F.cas.draw(a.cas, b.cas, t);
    F.ghost.draw(ga != null ? `was ${ga}` : '', gb != null ? `was ${gb}` : '', rising ? seg(t, 0.5, 0.7) : t);
    const xt = rising ? seg(t, 0.6, 1) : t;
    const [na, nb] = both((v) => (v.txn ? '' : '(none)'));
    F.none.draw(na, nb, xt);
    ['atr', 'atmpt', 'stgd'].forEach((key, r) => F.keys[r].draw(a.txn ? key : '', b.txn ? key : '', xt));
    F.atr.draw(a.txn && a.txn.atr, b.txn && b.txn.atr, xt);
    F.atmpt.draw(a.txn && a.txn.atmpt, b.txn && b.txn.atmpt, xt);
    // (the staged value: when it rises, the rising chip is it)
    if (rising && t > 0 && t < 1) F.stgd.draw('', '', 1);
    else F.stgd.draw(a.txn && a.txn.stgd, b.txn && b.txn.stgd, xt);
  }

  drawAtr(atr, a, b, t) {
    const R = this.atrs[atr];
    const on = (v) => (v ? 1 : 0);
    const ct = a === b || JSON.stringify(a) === JSON.stringify(b) ? on(b) : lerp(on(a), on(b), E(seg(t, 0, 0.6)));
    op(R.c, ct);
    op(R.none, 1 - ct);
    const e = (v) => (v && v[0]) || null;
    const ea = e(a), eb = e(b);
    R.F.none.draw(a && !ea ? '(no attempts)' : '', b && !eb ? '(no attempts)' : '', t);
    ['atmpt', 'st', 'rep'].forEach((key, r) => R.F.keys[r].draw(ea && (key !== 'rep' || ea.rep) ? key : '', eb && (key !== 'rep' || eb.rep) ? key : '', t));
    R.F.id.draw(ea && ea.id, eb && eb.id, t);
    R.F.st.draw(ea && ea.st, eb && eb.st, t);
    R.F.rep.draw(ea && ea.rep && ea.rep.join(', '), eb && eb.rep && eb.rep.join(', '), t);
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

// A change's size, for its share of the scroll: its pieces' weights.
export function sizeOf(a, b) {
  const A = STATE[a], B = STATE[b];
  return Math.max(1, plan(A, B, changed(A, B)[0]).reduce((s, p) => s + p.w, 0) * 0.55);
}
