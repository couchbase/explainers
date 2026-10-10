// The diagram: one SVG canvas (see layout.js) built once, then patched
// in place from the simulation. Everything sits in fixed slots, so
// nothing moves around as counts change; only fills, states and labels
// update. Lids cover frame and panel insides until the story opens
// them; detail bubbles pop out of panels into the side gutters. A
// marker for "our batch" travels through it all.
//
// Lid openness, bubble growth and the marker's position are set by the
// page as continuous values (0..1, or a point), so the page can tie
// them to the scroll position.

import { SECTIONS, PANELS, LIDS, BUBBLES, ANCHORS, CANVAS, isAnchorVisible } from './layout.js';
import { fmtBytes, fmtMs, fmtNum } from '../sim/fmt.js';

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}
function txt(parent, x, y, s, cls, anchor) {
  const t = el('text', { x, y, class: cls || '' }, parent);
  if (anchor) t.setAttribute('text-anchor', anchor);
  t.textContent = s;
  return t;
}
const setText = (t, s) => { if (t.textContent !== s) t.textContent = s; };
const setCls = (e, cls) => { if (e.getAttribute('class') !== cls) e.setAttribute('class', cls); };
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Classifies a goroutine's state. "stall" means blocked by
// backpressure, as opposed to idly waiting for work.
const STALL = /herder|flow control|worker busy|paused|persistence \(safe/;
export function procState(p) {
  if (!p) return 'wait';
  if (p.state === 'busy' || p.state === 'running') return 'busy';
  if (p.state === 'sleep') return 'nap';
  if (p.state === 'blocked' && STALL.test(p.label)) return 'stall';
  return 'wait';
}

// A goroutine box: state dot, name, one line of live activity.
// With `header: true`, it's the title row of a bigger panel: the
// activity goes on the same line, after the name.
//
// A box draws a change from one state to another at a progress q in
// 0..1: the old and new borders and dots cross-fade (two overlaid
// copies), and the old label slides out to the left as the new one
// slides in from the right. Who drives q depends on who owns time:
// scrolling (scrub) on paused story steps, or the clock (live) when the
// reader has pressed Play.
const SLIDE = 22;
const gist = (l) => l.replace(/[\d.,]+/g, '#'); // a changed number isn't a new activity

class GNode {
  constructor(parent, x, y, w, h, title, { sub, header } = {}) {
    this.g = el('g', { class: 'gnode' }, parent);
    this.boxCls = header ? 'gbox gbox-header' : 'gbox';
    this.boxes = [0, 1].map(() => el('rect', { x, y, width: w, height: h, rx: 5, class: `${this.boxCls} s-wait` }, this.g));
    this.dots = [0, 1].map(() => el('circle', { cx: x + 14, cy: y + 17, r: 4.5, class: 'gdot s-wait' }, this.g));
    this.title = txt(this.g, x + 26, y + 21, title, 'gtitle');
    const lx = header ? x + 34 + title.length * 8.2 : x + 14;
    const ly = header ? y + 21 : y + h - 11;
    this.labels = [txt(this.g, lx, ly, '', 'glabel'), txt(this.g, lx, ly, '', 'glabel')];
    // characters that fit at the normal and the small label size
    const room = w - (lx - x) - (header ? 46 : 12);
    this.fit = [Math.floor(room / 6.7), Math.floor(room / 6.0)];
    this.since = txt(this.g, x + w - 10, y + 20, '', 'gsince', 'end');
    this.cur = { state: 'wait', label: sub || '' };
    this.tween = null;
    this.lastChange = -Infinity;
    this.drawn = '';
    this.draw(this.cur, this.cur, 1);
  }

  _label(t, st, x, o) {
    const small = st.label.length > this.fit[0];
    setText(t, clip(st.label, small ? this.fit[1] : this.fit[0]));
    setCls(t, `glabel s-${st.state}${small ? ' small' : ''}`);
    t.setAttribute('transform', x ? `translate(${x.toFixed(1)} 0)` : '');
    t.setAttribute('opacity', o.toFixed(3));
  }

  // Draws the change from state a to state b at progress q.
  draw(a, b, q) {
    const key = `${a.state}|${a.label}|${b.state}|${b.label}|${q.toFixed(3)}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const sameState = a.state === b.state;
    setCls(this.boxes[0], `${this.boxCls} s-${a.state}`);
    setCls(this.boxes[1], `${this.boxCls} s-${b.state}`);
    setCls(this.dots[0], `gdot s-${a.state}`);
    setCls(this.dots[1], `gdot s-${b.state}`);
    this.boxes[0].setAttribute('opacity', sameState ? 0 : (1 - q).toFixed(3));
    this.boxes[1].setAttribute('opacity', sameState ? 1 : q.toFixed(3));
    this.dots[0].setAttribute('opacity', sameState ? 0 : (1 - q).toFixed(3));
    this.dots[1].setAttribute('opacity', sameState ? 1 : q.toFixed(3));
    if (gist(a.label) === gist(b.label)) {
      this._label(this.labels[0], { state: b.state, label: b.label }, 0, 1);
      this.labels[1].setAttribute('opacity', 0);
    } else {
      this._label(this.labels[0], a, -SLIDE * q, 1 - q);
      this._label(this.labels[1], b, SLIDE * (1 - q), q);
    }
  }

  // Scroll-driven: the page says exactly where between a and b we are.
  scrub(a, b, q) {
    this.tween = null;
    this.cur = b;
    setText(this.since, '');
    this.draw(a, b, q);
  }

  // Clock-driven, for when the simulation is playing: tween to `want`,
  // holding each state for at least `dwell` ms so nothing flickers.
  live(want, wallNow, dwell) {
    setText(this.since, want.since || '');
    if (this.tween) {
      const q = (wallNow - this.tween.t0) / 400;
      if (q < 1) { this.draw(this.tween.a, this.tween.b, q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2); return; }
      this.cur = this.tween.b;
      this.tween = null;
    }
    const c = this.cur;
    if (want.state === c.state && gist(want.label) === gist(c.label)) {
      this.cur = want;
      this.draw(want, want, 1);
      return;
    }
    if (wallNow - this.lastChange < dwell) { this.draw(c, c, 1); return; }
    this.lastChange = wallNow;
    this.tween = { a: c, b: want, t0: wallNow };
    this.draw(c, want, 0);
  }
}

// Short, plain activity labels for each goroutine box, so they fit
// without clipping. Raw labels come from the simulation's processes.
const SHORT = [
  [/^waiting for DCP mutations/, 'idle: waiting for DCP'],
  [/^batch\.Index/, 'batch.Index(): mapping docs'],
  [/^batchCh-(\d) <- batch/, 'stalled: worker $1 is busy'],
  [/^herder: IndexStart/, 'stalled by the app herder'],
  [/^herder: BatchIntroductionStart/, 'stalled by the app herder'],
  [/^waiting for batches/, 'idle: waiting for batches'],
  [/^waiting for analysis/, 'waiting for analysis'],
  [/^NewUsing/, 'building in-memory segment'],
  [/^prepareSegment/, 'computing obsoletes'],
  [/^introductions <- segment/, 'handing segment over'],
  [/^waiting for introduction to be applied/, 'waiting for the introducer'],
  [/^waiting for persistence/, 'stalled: waiting for persist'],
  [/^select: introductions/, 'idle'],
  [/^introduceSegment/, 'introducing a segment'],
  [/^introducePersist/, 'swapping in files'],
  [/^introduceMerge/, 'introducing a merge'],
  [/^nap /, 'napping (≤2s)'],
  [/^waiting for (\d+) in-memory merge/, 'waiting on $1 workers'],
  [/^writing (\S+)/, 'writing $1'],
  [/^fsync (\S+\.zap)/, 'fsync $1'],
  [/^root\.bolt: commit/, 'committing root.bolt'],
  [/^root\.bolt: fsync/, 'fsync root.bolt'],
  [/^root\.bolt: removed/, 'removing old snapshots'],
  [/^introducerNotifier <- watcher/, 'idle'],
  [/^waiting for a new root epoch/, 'idle: waiting for a new epoch'],
  [/^paused: /, 'paused: waiting for the merger'],
  [/^persists <- new files/, 'introducing new files'],
  [/^waiting for persist introduction/, 'waiting for the introducer'],
  [/^waiting for persister/, 'waiting for the persister'],
  [/^persisterNotifier <- watcher/, 'notifying the persister'],
  [/^MergeUsing: merging (\d+) files/, 'merging $1 files'],
  [/^MergeUsing: (\d+) mem segs/, 'merging $1 segments'],
  [/^merges <- /, 'handing result over'],
  [/^waiting for merge introduction/, 'waiting for the introducer'],
  [/^analyzing/, 'analyzing'],
];
export function shortLabel(label) {
  for (const [re, out] of SHORT) {
    const mm = label.match(re);
    if (mm) return out.replace(/\$(\d)/g, (_, n) => mm[Number(n)]);
  }
  return label;
}

// Assigns stable slots to keys, so items don't shift as others come and go.
class Slots {
  constructor(n) { this.n = n; this.byKey = new Map(); this.free = [...Array(n).keys()]; }
  sync(keys) {
    const want = new Set(keys);
    for (const [k, i] of this.byKey) if (!want.has(k)) { this.byKey.delete(k); this.free.push(i); }
    this.free.sort((a, b) => a - b);
    let overflow = 0;
    for (const k of keys) {
      if (this.byKey.has(k)) continue;
      if (this.free.length === 0) { overflow++; continue; }
      this.byKey.set(k, this.free.shift());
    }
    return overflow;
  }
  get(k) { return this.byKey.get(k); }
}

const SYMBOLS = `
<symbol id="dg-file" viewBox="0 0 12 15"><path d="M0.5,0.5 H8 L11.5,4 V14.5 H0.5 Z" class="ficon-body"/><path d="M8,0.5 V4 H11.5" class="ficon-fold"/></symbol>
<symbol id="dg-del" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" class="del-ring"/><path d="M3,11 L11,3" class="del-slash"/></symbol>
<symbol id="dg-search" viewBox="0 0 12 12"><circle cx="5" cy="5" r="3.6" class="search-ring"/><path d="M7.6,7.6 L11,11" class="search-handle"/></symbol>
<marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker>
<marker id="dg-arrow-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead-up"/></marker>
`;

const MEM_COLS = 26, MEM_ROWS = 8, FILE_SLOTS = 20;
const DIR_COLS = 32, DIR_ROWS = 6;

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    svg.setAttribute('viewBox', CANVAS.join(' '));
    svg.innerHTML = `<defs>${SYMBOLS}</defs>`;
    this.root = el('g', {}, svg);
    this.nodes = {};
    this.lids = {};
    this.panels = {};
    this.bubbles = {};
    this.memSlots = new Slots(MEM_COLS * MEM_ROWS);
    this.fileSlots = new Slots(FILE_SLOTS);
    this.dirSlots = new Slots(DIR_COLS * DIR_ROWS);
    this.positions = {}; // dynamic anchor positions
    this._build();
  }

  // ---------------------------------------------------------------
  _build() {
    const g = this.root;
    // Section frames (always visible) with color tabs.
    for (const [id, s] of Object.entries(SECTIONS)) {
      const [x, y, w, h] = s.frame;
      el('rect', { x, y, width: w, height: h, rx: 10, class: `frame sec-${s.color}` }, g);
    }
    // KV is a separate process, one network hop away.
    el('line', { x1: 120, x2: 880, y1: 179, y2: 179, class: 'network' }, g);
    txt(g, 880, 173, 'network: DCP over TCP', 'note', 'end');
    const flows = el('g', { class: 'flows' }, g);
    this._flows(flows);

    this._kv(el('g', {}, g));
    this._cbft(el('g', {}, g));
    this._scorch(el('g', {}, g));
    this._disk(el('g', {}, g));

    // Lids: nested ones first, so the outer ones sit on top.
    const order = ['introducer', 'persister', 'merger', 'scorch', 'cbft', 'kv', 'disk'];
    for (const id of order) this._lid(g, id);
    for (const id of Object.keys(BUBBLES)) this._bubble(g, id);
    this._docs(g);
    this._token(g);

    // Tabs last so they're never covered; a nested section's tab only
    // shows once its parent's lid is open.
    this.tabs = {};
    for (const [id, s] of Object.entries(SECTIONS)) {
      const [x, y] = s.frame;
      const w = 18 + s.label.length * 7.4;
      const tg = el('g', {}, g);
      el('rect', { x: x + 14, y: y - 10, width: w, height: 20, rx: 10, class: `tab sec-${s.color}` }, tg);
      txt(tg, x + 14 + w / 2, y + 4, s.label, 'tab-text', 'middle');
      this.tabs[id] = tg;
    }
    this.targetRing = el('circle', { r: 9, class: 'target-ring', cx: -9999, cy: -9999 }, g);
  }

  _arrow(parent, d, up = false) {
    return el('path', { d, class: up ? 'flow-up' : 'flow', 'marker-end': `url(#${up ? 'dg-arrow-up' : 'dg-arrow'})` }, parent);
  }

  _flows(f) {
    this._arrow(f, 'M500,94 V120');
    this._arrow(f, 'M500,134 V226');
    this._arrow(f, 'M500,278 V290');
    this._arrow(f, 'M500,304 V330');
    this._arrow(f, 'M500,388 V518');
    this._arrow(f, 'M500,570 V600');
    this._arrow(f, 'M500,702 V740');
    this._arrow(f, 'M280,912 V950');
    this._arrow(f, 'M720,912 V950');
    this._arrow(f, 'M80,1052 H64 Q52,1052 52,1040 V664 Q52,652 64,652 H348', true);
    this._arrow(f, 'M920,1052 H936 Q948,1052 948,1040 V664 Q948,652 936,652 H652', true);
    txt(f, 60, 690, 'introduce ↑', 'note');
    txt(f, 940, 690, 'introduce ↑', 'note', 'end');
    this._arrow(f, 'M280,1152 V1288');
    this._arrow(f, 'M720,1152 V1288');
    // Files being written, shown on the write arrows.
    this.writeP = this._writeBadge(f, 290, 1172);
    this.writeM = this._writeBadge(f, 730, 1172);
  }

  _writeBadge(parent, x, y) {
    const g = el('g', { class: 'write-badge', opacity: 0 }, parent);
    el('use', { href: '#dg-file', x, y, width: 14, height: 18, class: 'ficon ficon-new' }, g);
    const t = txt(g, x + 20, y + 13, '', 'note');
    return { g, t };
  }

  _kv(g) {
    this.nodes.kv = new GNode(g, 390, 42, 220, 52, 'KV engine');
    txt(g, 400, 133, 'flow control', 'note', 'end');
    el('rect', { x: 410, y: 124, width: 140, height: 10, rx: 3, class: 'gauge' }, g);
    this.dcpFill = el('rect', { x: 410, y: 124, width: 0, height: 10, rx: 3, class: 'gauge-fill' }, g);
    this.dcpText = txt(g, 558, 133, '', 'note');
  }

  _cbft(g) {
    this.nodes.dcp = new GNode(g, 390, 228, 220, 50, 'DCP goroutine');
    this.slot = el('rect', { x: 494, y: 292, width: 12, height: 12, rx: 2, class: 'slot' }, g);
    txt(g, 514, 302, 'capacity-1 channel', 'note');
    // Stacked worker panels: the front one is drawn fully.
    this.workerBack = [];
    for (let i = 3; i >= 1; i--) {
      this.workerBack[i] = el('rect', { x: 390 + i * 8, y: 334 - i * 8, width: 220, height: 54, rx: 5, class: 'gbox behind s-wait' }, g);
    }
    this.nodes.worker = new GNode(g, 390, 334, 220, 54, 'batch worker 0');
    el('rect', { x: 640, y: 302, width: 30, height: 18, rx: 9, class: 'badge' }, g);
    txt(g, 655, 315, '×4', 'badge-text', 'middle');
    el('line', { x1: 140, x2: 860, y1: 432, y2: 432, class: 'gate' }, g);
    txt(g, 140, 452, 'app herder: blocks batches when memory > indexing quota', 'note');
    el('rect', { x: 700, y: 441, width: 160, height: 8, rx: 3, class: 'gauge' }, g);
    this.memFill = el('rect', { x: 700, y: 441, width: 0, height: 8, rx: 3, class: 'gauge-fill mem' }, g);
    this.memMark = el('line', { x1: 0, x2: 0, y1: 438, y2: 452, class: 'gauge-mark' }, g);
    this.memText = txt(g, 860, 464, '', 'note', 'end');
  }

  _scorch(g) {
    this.nodes.batch = new GNode(g, 390, 520, 220, 50, 'Scorch.Batch()', { sub: 'analyze → in-memory segment' });
    el('line', { x1: 610, x2: 640, y1: 545, y2: 545, class: 'flow' }, g);
    el('rect', { x: 640, y: 520, width: 200, height: 50, rx: 5, class: 'zone' }, g);
    txt(g, 652, 538, 'analysis queue (CPUs)', 'note-in');
    this.cpus = [];
    for (let i = 0; i < 8; i++) this.cpus.push(el('rect', { x: 652 + i * 22, y: 546, width: 16, height: 14, rx: 2, class: 'cpu' }, g));

    // introducer panel
    const ip = this._panel(g, 'introducer');
    const f = ip.front;
    this.nodes.introducer = new GNode(f, 350, 602, 300, 100, 'introducer', { header: true });
    txt(f, 366, 646, 'select {', 'code-in');
    this.chans = {};
    // Chips sized to their names, so they fit inside the panel.
    let cx = 366;
    for (const c of ['introductions', 'persists', 'merges', 'watchers']) {
      const w = 12 + c.length * 5.6;
      const r = el('rect', { x: cx, y: 654, width: w, height: 18, rx: 3, class: 'chan' }, f);
      txt(f, cx + w / 2, 667, c, 'chan-text', 'middle');
      this.chans[c] = r;
      cx += w + 6;
    }
    txt(f, 366, 690, '} → new root, epoch + 1', 'code-in');

    // queries
    this.queryG = el('g', { opacity: 0 }, g);
    el('rect', { x: 680, y: 714, width: 220, height: 22, rx: 11, class: 'query' }, this.queryG);
    el('use', { href: '#dg-search', x: 690, y: 719, width: 12, height: 12 }, this.queryG);
    this.queryText = txt(this.queryG, 708, 729, '', 'note-in');
    this.queryPin = el('line', { x1: 790, x2: 790, y1: 736, y2: 742, class: 'pin' }, this.queryG);

    // root snapshot
    el('rect', { x: 80, y: 742, width: 840, height: 170, rx: 6, class: 'zone strong' }, g);
    this.rootTitle = txt(g, 96, 762, 'root snapshot', 'zone-title');
    txt(g, 96, 780, 'in-memory segments', 'note-in');
    txt(g, 520, 780, 'file segments (mmapped zap)', 'note-in');
    this.memCells = [];
    for (let i = 0; i < MEM_COLS * MEM_ROWS; i++) {
      const x = 96 + (i % MEM_COLS) * 14, y = 788 + Math.floor(i / MEM_COLS) * 14;
      this.memCells.push(el('rect', { x, y, width: 10, height: 10, rx: 2, class: 'cell' }, g));
    }
    this.memMore = txt(g, 460, 906, '', 'note-in', 'end');
    this.fileBars = [];
    for (let i = 0; i < FILE_SLOTS; i++) {
      const x = 520 + i * 18;
      const bg = el('rect', { x, y: 790, width: 14, height: 100, rx: 2, class: 'cell' }, g);
      const bar = el('rect', { x, y: 890, width: 14, height: 0, rx: 2, class: 'fbar' }, g);
      const del = el('rect', { x, y: 890, width: 14, height: 0, class: 'fdel' }, g);
      this.fileBars.push({ bg, bar, del, x });
    }
    this.fileMore = txt(g, 900, 906, '', 'note-in', 'end');

    this._persister(g);
    this._merger(g);
  }

  _panel(g, id) {
    const [x, y, w, h] = PANELS[id].frame;
    const pg = el('g', { class: 'panel' }, g);
    el('rect', { x, y, width: w, height: h, rx: 6, class: 'panel-frame' }, pg);
    const front = el('g', {}, pg);
    const p = { g: pg, front };
    this.panels[id] = p;
    return p;
  }

  _rows(parent, x, y, labels) {
    return labels.map((label, i) => {
      const yy = y + i * 34;
      const r = el('rect', { x, y: yy, width: 368, height: 26, rx: 4, class: 'row' }, parent);
      txt(parent, x + 10, yy + 17, label, 'row-text');
      return r;
    });
  }

  _persister(g) {
    const p = this._panel(g, 'persister');
    this.nodes.persister = new GNode(p.front, 80, 952, 400, 200, 'persister', { header: true });
    this.pRows = this._rows(p.front, 96, 990, [
      '1 · nap ≤2s (skipped while the herder blocks)',
      '2 · cut in-memory segments into ~20MB flushables',
      '3 · merge → write zap → fsync',
      '4 · introduce ↑, then commit root.bolt + fsync',
    ]);
    this.pWorkers = [];
    for (let i = 0; i < 4; i++) this.pWorkers.push(el('rect', { x: 372 + i * 22, y: 1063, width: 16, height: 16, rx: 3, class: 'pw s-wait' }, p.front));
  }

  _merger(g) {
    const p = this._panel(g, 'merger');
    this.nodes.merger = new GNode(p.front, 520, 952, 400, 200, 'merger', { header: true });
    this.mRows = this._rows(p.front, 536, 990, [
      '1 · wait until a newer epoch is persisted',
      '2 · plan: tiers & budget, over file segments only',
      '3 · each task in turn: merge → write zap → fsync',
      '4 · introduce the merged segment ↑',
    ]);
  }

  // A speech bubble in a side gutter, with a tail to its panel.
  _bubble(g, id) {
    const B = BUBBLES[id];
    const [x, y, w, h] = B.box;
    const [tx, ty] = B.tail;
    const bg = el('g', { class: 'bubble', opacity: 0 }, g);
    if (ty < y) {
      // tail out of the top edge
      el('path', { d: `M${tx - 18},${y} L${tx},${ty + 4} L${tx + 18},${y} Z`, class: 'bubble-tail' }, bg);
      el('rect', { x, y, width: w, height: h, rx: 10, class: 'bubble-box' }, bg);
      el('path', { d: `M${tx - 17},${y} L${tx + 17},${y}`, class: 'bubble-seam' }, bg);
    } else {
      // tail out of the side facing the panel
      const edge = tx > x + w ? x + w : x;
      el('path', { d: `M${edge},${ty - 34} L${tx + (tx > edge ? -4 : 4)},${ty} L${edge},${ty - 6} Z`, class: 'bubble-tail' }, bg);
      el('rect', { x, y, width: w, height: h, rx: 10, class: 'bubble-box' }, bg);
      el('path', { d: `M${edge},${ty - 33} L${edge},${ty - 7}`, class: 'bubble-seam' }, bg);
    }
    txt(bg, x + 18, y + 28, B.title, 'bubble-title');
    const body = el('g', {}, bg);
    if (id === 'persister') this._persisterDetail(body, x + 14, y + 42);
    else this._mergerDetail(body, x + 14, y + 42, w - 28);
    this.bubbles[id] = { g: bg, tail: [tx, ty] };
  }

  _persisterDetail(b, x, y) {
    this.pBack = [
      ['pausePersisterForMergerCatchUp()', 'nap, or pause while files ≥ 1000 and the merger is behind'],
      ['root.epoch > lastPersistedEpoch?', 'take the latest root; intermediate epochs are skipped'],
      ['persistSnapshotMaybeMerge()', '≥2 in-memory segments → ~20MB flushables'],
      ['mergeAndPersistInMemorySegments()', '≤4 workers: MergeUsing, write, fsync, introduce'],
      ['persistSnapshotDirect()', 'root.bolt: tx.Commit() + Sync()'],
      ['removeOldData()', 'when idle: old bolt snapshots, then unlisted zap files'],
    ].map(([fn, note], i) => {
      const yy = y + i * 37;
      const r = el('rect', { x, y: yy, width: 392, height: 33, rx: 4, class: 'row' }, b);
      txt(b, x + 10, yy + 14, fn, 'back-fn');
      txt(b, x + 10, yy + 28, note, 'back-note');
      return r;
    });
  }

  _mergerDetail(b, x, y, w) {
    this.tierText = txt(b, x + w, y + 4, '', 'back-note', 'end');
    const base = y + 190;
    this.tierBase = base;
    this.tierBars = [];
    for (let i = 0; i < 20; i++) {
      this.tierBars.push(el('rect', { x: x + 4 + i * 19, y: base, width: 14, height: 0, rx: 2, class: 'fbar' }, b));
    }
    this.tierLines = [];
    for (let i = 0; i < 3; i++) {
      const l = el('line', { x1: x, x2: x + w, y1: 0, y2: 0, class: 'tier-line' }, b);
      const t = txt(b, x + w, 0, '', 'back-note', 'end');
      this.tierLines.push({ l, t });
    }
    txt(b, x, base + 20, 'file segments by live size (log scale); outlined: being merged', 'back-note');
  }

  // Documents flowing from KV down the DCP arrow, for a batch's birth.
  _docs(g) {
    this.docs = [];
    for (let i = 0; i < 9; i++) {
      const dg = el('g', { class: 'doc', opacity: 0 }, g);
      el('path', { d: 'M-5,-6.5 H2 L5,-3.5 V6.5 H-5 Z', class: 'doc-body' }, dg);
      el('path', { d: 'M-3,-2 H3 M-3,1 H3 M-3,4 H1', class: 'doc-lines' }, dg);
      this.docs.push(dg);
    }
  }

  // t in 0..1 is the birth's progress (<0 hides the docs). Each doc
  // leaves the KV engine a little after the last, comes down the DCP
  // arrow into the DCP goroutine, and shrinks into the marker at `tok`.
  setDocs(t, tok) {
    if (t < 0 || !tok) {
      if (this.docsShown) for (const d of this.docs) d.setAttribute('opacity', 0);
      this.docsShown = false;
      return;
    }
    this.docsShown = true;
    const [tx, ty] = tok.p;
    const pts = [[500, 96], [500, 214], [tx, 214], [tx, ty]];
    const lens = [];
    let total = 0;
    for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); lens.push(d); total += d; }
    const at = (q) => {
      let want = q * total;
      for (let k = 0; k < lens.length; k++) {
        if (want <= lens[k] || k === lens.length - 1) {
          const f = Math.min(1, want / lens[k]);
          return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f];
        }
        want -= lens[k];
      }
      return pts[pts.length - 1];
    };
    this.docs.forEach((d, i) => {
      const start = i * 0.065;
      const q = Math.max(0, Math.min(1, (t - start) / 0.4));
      if (q <= 0 || q >= 1) { d.setAttribute('opacity', 0); return; }
      const [x, y] = at(q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2);
      const sc = q > 0.85 ? 1 - (q - 0.85) / 0.15 * 0.7 : 1;
      d.setAttribute('opacity', q > 0.9 ? ((1 - q) / 0.1).toFixed(3) : 1);
      d.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${sc.toFixed(3)})`);
    });
  }

  // The marker for "our batch": a ringed chip that becomes our segment.
  _token(g) {
    const tg = el('g', { class: 'token', opacity: 0 }, g);
    this.tokenRect = el('rect', { x: -8, y: -8, width: 16, height: 16, rx: 3, class: 'token-chip' }, tg);
    this.tokenLabel = txt(tg, 0, -14, 'our batch', 'token-label', 'middle');
    this.token = tg;
  }

  _disk(g) {
    txt(g, 70, 1278, 'index directory', 'zone-title');
    this.dirIcons = [];
    for (let i = 0; i < DIR_COLS * DIR_ROWS; i++) {
      const x = 70 + (i % DIR_COLS) * 17, y = 1290 + Math.floor(i / DIR_COLS) * 22;
      const ig = el('g', { opacity: 0 }, g);
      const use = el('use', { href: '#dg-file', x, y, width: 12, height: 15, class: 'ficon' }, ig);
      const del = el('use', { href: '#dg-del', x: x - 1, y: y + 1, width: 14, height: 14, opacity: 0 }, ig);
      this.dirIcons.push({ g: ig, use, del, x, y });
    }
    this.dirMore = txt(g, 614, 1430, '', 'note-in', 'end');
    txt(g, 650, 1278, 'root.bolt snapshots', 'zone-title');
    this.boltCards = [];
    for (let i = 0; i < 5; i++) {
      const y = 1290 + i * 30;
      const r = el('rect', { x: 650, y, width: 280, height: 24, rx: 4, class: 'bolt' }, g);
      const t = txt(g, 660, y + 16, '', 'note-in');
      this.boltCards.push({ r, t });
    }
    txt(g, 70, 1460, 'unlinked but still open:', 'note-in');
    this.zombieIcons = [];
    for (let i = 0; i < 12; i++) {
      this.zombieIcons.push(el('use', { href: '#dg-file', x: 232 + i * 17, y: 1448, width: 12, height: 15, class: 'ficon ficon-zombie', opacity: 0 }, g));
    }
    this.zombieText = txt(g, 450, 1460, '', 'note-in');
    el('use', { href: '#dg-del', x: 70, y: 1499, width: 14, height: 14 }, g);
    txt(g, 90, 1510, 'removeOldData() deletes files no root.bolt snapshot lists (the persister runs it when idle)', 'note-in');
    this.legendY = 1530;
    const legend = [['ficon-root', 'in the root'], ['ficon-new', 'new, not yet in root.bolt'], ['ficon-garbage', 'no longer in the root'], ['ficon-zombie', 'unlinked, still open']];
    let x = 70;
    for (const [cls, label] of legend) {
      el('use', { href: '#dg-file', x, y: 1520, width: 10, height: 13, class: `ficon ${cls}` }, g);
      txt(g, x + 14, 1531, label, 'note-in');
      x += 30 + label.length * 6.2;
    }
  }

  _lid(g, id) {
    const L = LIDS[id];
    let x, y, w, h, color, big;
    if (L.section) {
      [x, y, w, h] = SECTIONS[L.section].frame;
      x += 5; y += 5; w -= 10; h -= 10;
      color = SECTIONS[L.section].color;
      big = true;
    } else {
      [x, y, w, h] = PANELS[L.panel].frame;
      x += 3; y += 3; w -= 6; h -= 6;
      color = 'scorch';
      big = false;
    }
    const lg = el('g', { class: `lid sec-${color}` }, g);
    el('rect', { x, y, width: w, height: h, rx: big ? 7 : 5, class: 'lid-bg' }, lg);
    const ty = big ? y + Math.min(h / 2 - 6, 60) : y + 30;
    txt(lg, x + 22, ty, L.title, big ? 'lid-title' : 'lid-title-small');
    txt(lg, x + 22, ty + (big ? 30 : 20), L.sub, big ? 'lid-sub' : 'lid-sub-small');
    const dot = el('circle', { cx: x + 28, cy: ty + (big ? 62 : 40), r: big ? 6 : 4.5, class: 'gdot' }, lg);
    const status = txt(lg, x + (big ? 42 : 38), ty + (big ? 67 : 44), '', big ? 'lid-status' : 'lid-status-small');
    this.lids[id] = { g: lg, status, dot };
  }

  // ---------------------------------------------------------------
  // The goroutine boxes, in the order data meets them.
  static NODE_ORDER = ['kv', 'dcp', 'worker', 'batch', 'introducer', 'persister', 'merger'];

  // Records what the slot grids (in-memory cells, file bars, directory
  // icons) show right now, so the page can blend between two steps.
  captureSlots() {
    return {
      mem: this.memCells.map((c) => c.getAttribute('class')),
      bars: this.fileBars.map((b) => ({
        y: +b.bar.getAttribute('y'), h: +b.bar.getAttribute('height'),
        dy: +b.del.getAttribute('y'), dh: +b.del.getAttribute('height'), bg: b.bg.getAttribute('class'),
      })),
      dir: this.dirIcons.map((ic) => ({ o: ic.g.getAttribute('opacity'), cls: ic.use.getAttribute('class'), del: ic.del.getAttribute('opacity') })),
    };
  }

  // Shows the slot grids partway (q) from snapshot A to snapshot B:
  // things that appear fade in, things that go fade out, bars that
  // change size grow or shrink.
  blendSlots(A, B, q) {
    const fade = (e, o) => { if (o >= 1) e.removeAttribute('opacity'); else e.setAttribute('opacity', o.toFixed(3)); };
    this.memCells.forEach((c, i) => {
      const a = A.mem[i], b = B.mem[i];
      const aOn = a !== 'cell', bOn = b !== 'cell';
      if (a === b) { setCls(c, b); fade(c, 1); } else if (bOn && !aOn) { setCls(c, b); fade(c, q); } else if (aOn && !bOn) { setCls(c, a); fade(c, 1 - q); } else { setCls(c, q < 0.5 ? a : b); fade(c, 1); }
    });
    this.fileBars.forEach((bar, i) => {
      const a = A.bars[i], b = B.bars[i];
      let s = b, o = 1;
      if (a.h === 0 && b.h > 0) o = q;
      else if (a.h > 0 && b.h === 0) { s = a; o = 1 - q; } else if (a.h !== b.h || a.dh !== b.dh) {
        const l = (x, y) => x + (y - x) * q;
        s = { y: l(a.y, b.y), h: l(a.h, b.h), dy: l(a.dy, b.dy), dh: l(a.dh, b.dh), bg: b.bg };
      }
      bar.bar.setAttribute('y', s.y.toFixed(1)); bar.bar.setAttribute('height', s.h.toFixed(1));
      bar.del.setAttribute('y', s.dy.toFixed(1)); bar.del.setAttribute('height', s.dh.toFixed(1));
      setCls(bar.bg, s.bg);
      fade(bar.bar, o); fade(bar.del, o);
    });
    this.dirIcons.forEach((ic, i) => {
      const a = A.dir[i], b = B.dir[i];
      const aOn = a.o === '1', bOn = b.o === '1';
      let s = b, o = bOn ? 1 : 0;
      if (bOn && !aOn) o = q;
      else if (aOn && !bOn) { s = a; o = 1 - q; } else if (aOn && bOn && a.cls !== b.cls) s = q < 0.5 ? a : b;
      ic.g.setAttribute('opacity', o.toFixed(3));
      setCls(ic.use, s.cls);
      ic.del.setAttribute('opacity', s.del);
    });
  }

  // Scroll-driven: frames[k] = {a, b, q} for each box.
  scrubNodes(frames) {
    for (const k of Diagram.NODE_ORDER) if (frames[k]) this.nodes[k].scrub(frames[k].a, frames[k].b, frames[k].q);
  }

  // Clock-driven, while the simulation plays.
  liveNodes(states, wallNow, dwell) {
    for (const k of Diagram.NODE_ORDER) if (states[k]) this.nodes[k].live(states[k], wallNow, dwell);
  }

  // The logical view, for anchor visibility.
  setView(open, bubbles) {
    this.open = open;
    this.shownBubbles = bubbles;
  }

  // 0 = closed, 1 = fully open.
  setLid(id, t) {
    const l = this.lids[id];
    l.g.style.opacity = (1 - t).toFixed(3);
    l.g.style.transform = `translateY(${(-12 * t).toFixed(2)}px)`;
    l.g.style.pointerEvents = t > 0.5 ? 'none' : '';
    l.g.style.visibility = t >= 0.999 ? 'hidden' : '';
    for (const [sid, L] of Object.entries(LIDS)) {
      if (L.parent === id && L.section && this.tabs[sid]) this.tabs[sid].setAttribute('opacity', t.toFixed(3));
    }
  }

  // 0 = hidden, 1 = fully grown out of its panel.
  setBubble(id, t) {
    const b = this.bubbles[id];
    const [tx, ty] = b.tail;
    const s = 0.15 + 0.85 * t;
    b.g.setAttribute('opacity', t.toFixed(3));
    b.g.setAttribute('transform', `translate(${tx} ${ty}) scale(${s.toFixed(3)}) translate(${-tx} ${-ty})`);
    b.g.style.visibility = t <= 0.001 ? 'hidden' : '';
  }

  setTarget(p) {
    if (!p) { this.targetRing.setAttribute('cx', -9999); return; }
    this.targetRing.setAttribute('cx', p[0]);
    this.targetRing.setAttribute('cy', p[1]);
  }

  // Places the marker: {p: [x, y], size, kind: 'batch'|'mem'|'file', label}.
  setToken(t, opacity) {
    if (!t || opacity <= 0.001) { this.token.setAttribute('opacity', 0); return; }
    this.token.setAttribute('opacity', opacity.toFixed(3));
    this.token.setAttribute('transform', `translate(${t.p[0].toFixed(1)} ${t.p[1].toFixed(1)})`);
    const z = t.size;
    this.tokenRect.setAttribute('x', -z / 2); this.tokenRect.setAttribute('y', -z / 2);
    this.tokenRect.setAttribute('width', z); this.tokenRect.setAttribute('height', z);
    setCls(this.tokenRect, `token-chip kind-${t.kind}`);
    setText(this.tokenLabel, t.label);
    this.tokenLabel.setAttribute('y', (-z / 2 - 5).toFixed(1));
  }

  // Where the marker belongs for the current model state. mode 'file'
  // puts it on our file's icon in the index directory.
  tokenTarget(m, mode) {
    const tr = m.trace;
    if (!tr) return null;
    if (mode === 'file' && tr.fileName) {
      const i = this.dirSlots.get(tr.fileName);
      if (i !== undefined) {
        const ic = this.dirIcons[i];
        return { p: [ic.x + 6, ic.y + 7.5], size: 18, kind: 'file', label: 'our file', st: 'icon', key: tr.fileName };
      }
    }
    const fixed = {
      dcp: [372, 253], channel: [500, 298], worker: [372, 361], herder: [478, 432],
      analysis: [372, 545], introducing: [332, 652], persisting: [60, 1067], merging: [940, 1067],
    }[tr.stage];
    if (fixed) {
      const kind = ['persisting', 'merging'].includes(tr.stage) ? (tr.stage === 'persisting' ? 'mem' : 'file') : 'batch';
      const st = tr.stage;
      return { p: fixed, size: st === 'channel' ? 14 : 16, kind, st, label: kind === 'batch' ? 'our batch' : kind === 'mem' ? 'our segment' : 'our file' };
    }
    const seg = this.positions.ourSeg;
    if (seg) {
      const isFile = m.root.segs.some((ss) => ss.seg.id === tr.segId && ss.seg.kind === 'file');
      return isFile
        ? { p: [seg.p[0] + 10, seg.p[1]], size: 18, kind: 'file', label: 'our file', st: 'bar', key: tr.segId }
        : { p: [seg.p[0] + 8, seg.p[1]], size: 14, kind: 'mem', label: 'our segment', st: 'cell', key: tr.segId };
    }
    return null;
  }

  // While the marker is still on its way, the slot it's heading for
  // (our segment's cell or bar, or our file's icon) stays faint, so
  // nothing appears before the marker gets there.
  setArrival(tok, alpha) {
    const els = [];
    if (tok && tok.key !== undefined) {
      if (tok.st === 'cell') { const i = this.memSlots.get(tok.key); if (i !== undefined) els.push(this.memCells[i]); }
      if (tok.st === 'bar') { const i = this.fileSlots.get(tok.key); if (i !== undefined) els.push(this.fileBars[i].bar, this.fileBars[i].del); }
      if (tok.st === 'icon') { const i = this.dirSlots.get(tok.key); if (i !== undefined) els.push(this.dirIcons[i].use); }
    }
    for (const e of this.arrivalEls || []) if (!els.includes(e)) e.style.opacity = '';
    const o = alpha >= 1 ? '' : String(0.15 + 0.85 * alpha);
    for (const e of els) e.style.opacity = o;
    this.arrivalEls = els;
  }

  // Position of a named anchor (static or dynamic) and whether it's visible.
  anchor(id) {
    const open = this.open || new Set(), bubbles = this.shownBubbles || new Set();
    if (ANCHORS[id]) return { p: ANCHORS[id].p, visible: isAnchorVisible(id, open, bubbles) };
    const d = this.positions[id];
    if (!d) return null;
    return { p: d.p, visible: isAnchorVisible(id, open, bubbles, d.needs) };
  }

  // ---------------------------------------------------------------
  update(m) {
    const now = m.now;
    const procs = new Map(m.k.procs.map((p) => [p.name, p]));
    const s = m.stats;
    const tr = m.trace;

    // KV
    const rate = ratePerSec(m);
    const ns = {};
    const st = (p, label) => ({ state: procState(p), label: label ?? (p ? shortLabel(p.label) : ''), since: p && now - p.since >= 100 && this.live ? fmtMs(now - p.since) : '' });
    // A rate only means something while the simulation is running.
    ns.kv = st(procs.get('kv'), m.kvPausedSince !== null ? 'paused: DCP buffer full'
      : this.live ? `sending ${fmtNum(rate)} docs/s` : 'sending mutations');
    const frac = Math.min(1, m.dcpBufUsed / m.cfg.dcpBufferBytes);
    this.dcpFill.setAttribute('width', (140 * frac).toFixed(1));
    setCls(this.dcpFill, frac > 0.8 ? 'gauge-fill warn' : 'gauge-fill');
    setText(this.dcpText, `${fmtBytes(m.dcpBufUsed)} / ${fmtBytes(m.cfg.dcpBufferBytes)}`);

    // cbft
    ns.dcp = st(procs.get('dcp'));
    // The front panel shows our batch's worker while we follow it.
    const front = tr && tr.worker != null && !m.reached('introduced') ? tr.worker : 0;
    setText(this.nodes.worker.title, `batch worker ${front}`);
    ns.worker = st(procs.get(`batchWorker-${front}`));
    const others = [0, 1, 2, 3].filter((i) => i !== front);
    for (let i = 1; i <= 3; i++) setCls(this.workerBack[i], `gbox behind s-${procState(procs.get(`batchWorker-${others[i - 1]}`))}`);
    const ch = m.workerChs[front];
    setCls(this.slot, ch && ch.length > 0 ? 'slot full' : 'slot');
    const mem = m.memUsed(), quota = m.indexQuota(), mmax = Math.max(quota * 1.15, mem);
    this.memFill.setAttribute('width', (160 * mem / mmax).toFixed(1));
    setCls(this.memFill, mem > quota ? 'gauge-fill warn' : 'gauge-fill mem');
    const mx = 700 + 160 * quota / mmax;
    this.memMark.setAttribute('x1', mx.toFixed(1)); this.memMark.setAttribute('x2', mx.toFixed(1));
    setText(this.memText, `memory ${fmtBytes(mem)} of ${fmtBytes(quota)} quota${m.numEventsBlocking ? ' · blocking' : ''}`);

    // scorch
    const bp = [0, 1, 2, 3].map((i) => procs.get(`batchWorker-${i}`)).find((p) => p && /Batch|analy|NewUsing|introduc|obsolete/.test(p.label));
    ns.batch = st(bp, bp ? shortLabel(bp.label) : 'analyze → in-memory segment');
    const q = m.analysisQueue;
    this.cpus.forEach((c, i) => setCls(c, i < q.inUse ? 'cpu busy' : 'cpu'));
    ns.introducer = st(procs.get('introducer'), `epoch ${s.CurRootEpoch}`);
    for (const [k, r] of Object.entries(this.chans)) setCls(r, m.introLast && m.introLast.kind === k ? 'chan lit' : 'chan');

    // queries
    const qs = [...m.queries.values()];
    this.queryG.setAttribute('opacity', qs.length ? 1 : 0);
    if (qs.length) {
      const q0 = qs[0];
      setText(this.queryText, `${q0.label || 'query'} · pins epoch ${q0.epoch} · ${fmtMs(now - q0.startedAt)}${qs.length > 1 ? ` · +${qs.length - 1}` : ''}`);
    }

    this._updateRoot(m);
    this._updatePersister(m, procs);
    this._updateMerger(m, procs);
    ns.persister = st(procs.get('persister'));
    ns.merger = st(procs.get('merger'));
    this.nodeStates = ns;
    this._updateDisk(m);
    this._updateWrites(m);
    this._updateLids(m, procs, rate);
    this._updateDynamicAnchors(m);
  }

  _updateRoot(m) {
    const segs = m.root.segs;
    setText(this.rootTitle, `root snapshot · epoch ${m.stats.CurRootEpoch}`);
    const mems = segs.filter((ss) => ss.seg.kind === 'mem');
    const files = segs.filter((ss) => ss.seg.kind === 'file');
    const memOver = this.memSlots.sync(mems.map((ss) => ss.seg.id));
    const memOn = new Set();
    for (const ss of mems) { const i = this.memSlots.get(ss.seg.id); if (i !== undefined) memOn.add(i); }
    this.memCells.forEach((c, i) => setCls(c, memOn.has(i) ? 'cell mem' : 'cell'));
    setText(this.memMore, memOver ? `+${memOver} more` : '');

    const fileOver = this.fileSlots.sync(files.map((ss) => ss.seg.id));
    const byIdx = new Map();
    for (const ss of files) { const i = this.fileSlots.get(ss.seg.id); if (i !== undefined) byIdx.set(i, ss); }
    const merging = new Set(m.currentMerge ? m.currentMerge.srcs : []);
    this.fileBars.forEach((b, i) => {
      const ss = byIdx.get(i);
      if (!ss) { b.bar.setAttribute('height', 0); b.del.setAttribute('height', 0); setCls(b.bg, 'cell'); return; }
      const h = barHeight(ss.seg.bytes, 100);
      b.bar.setAttribute('y', (890 - h).toFixed(1)); b.bar.setAttribute('height', h.toFixed(1));
      const dh = h * ss.deleted / ss.seg.docs;
      b.del.setAttribute('y', (890 - h).toFixed(1)); b.del.setAttribute('height', dh.toFixed(1));
      setCls(b.bg, merging.has(ss.seg.id) ? 'cell merging' : 'cell');
    });
    setText(this.fileMore, fileOver ? `+${fileOver} more` : '');
  }

  _updatePersister(m, procs) {
    const p = procs.get('persister');

    const label = p ? p.label : '';
    const workers = [...procs.values()].filter((x) => x.name.startsWith('persisterWorker-'));
    let row = -1;
    if (/nap|paused/.test(label)) row = 0;
    else if (workers.length > 0) row = 2;
    else if (/root\.bolt|persists <-|persist introduction|writing|fsync/.test(label)) row = /writing|fsync/.test(label) ? 2 : 3;
    this.pRows.forEach((r, i) => setCls(r, i === row ? (/paused/.test(label) && i === 0 ? 'row lit stall' : 'row lit') : 'row'));
    this.pWorkers.forEach((w, i) => setCls(w, `pw s-${workers[i] ? procState(workers[i]) : 'wait'}`));
    let brow = -1;
    if (/nap|paused/.test(label)) brow = 0;
    else if (workers.length > 0) brow = 3;
    else if (/root\.bolt: commit|root\.bolt: fsync/.test(label)) brow = 4;
    else if (/writing|fsync|persists <-|persist introduction/.test(label)) brow = 4;
    else if (/root\.bolt: removed/.test(label)) brow = 5;
    this.pBack.forEach((r, i) => setCls(r, i === brow ? 'row lit' : 'row'));
  }

  _updateMerger(m, procs) {
    const p = procs.get('merger');

    const label = p ? p.label : '';
    let row = -1;
    if (/waiting for persister|persisterNotifier/.test(label)) row = 0;
    else if (/MergeUsing|writing|fsync/.test(label)) row = 2;
    else if (/merge introduction|merges <-/.test(label)) row = 3;
    this.mRows.forEach((r, i) => setCls(r, i === row ? 'row lit' : 'row'));

    // back: tier staircase of current file segments
    const files = m.root.segs.filter((ss) => ss.seg.kind === 'file')
      .map((ss) => ({ id: ss.seg.id, live: Math.floor(ss.seg.bytes * (ss.seg.docs - ss.deleted) / ss.seg.docs) }))
      .sort((a, b) => b.live - a.live);
    const merging = new Set(m.currentMerge ? m.currentMerge.srcs : []);
    this.tierBars.forEach((b, i) => {
      const f = files[i];
      if (!f) { b.setAttribute('height', 0); return; }
      const h = barHeight(f.live, 150);
      b.setAttribute('y', (this.tierBase - h).toFixed(1)); b.setAttribute('height', h.toFixed(1));
      setCls(b, merging.has(f.id) ? 'fbar merging' : 'fbar');
    });
    const floor = m.cfg.mergePlan.floorSegmentFileSize || 20 * 1024 * 1024;
    this.tierLines.forEach((t, i) => {
      const bytes = floor * Math.pow(m.cfg.mergePlan.tierGrowth, i);
      const y = this.tierBase - barHeight(bytes, 150);
      t.l.setAttribute('y1', y.toFixed(1)); t.l.setAttribute('y2', y.toFixed(1));
      t.t.setAttribute('y', (y - 3).toFixed(1));
      setText(t.t, `tier ${i + 1}: ${fmtBytes(bytes)}`);
    });
    const lp = m.lastMergePlan;
    setText(this.tierText, lp ? `budget ${lp.budget} · ${lp.numSegs} segs · ${lp.tasks} task(s)` : '');
  }

  _updateDisk(m) {
    const inRoot = new Set(m.root.segs.filter((ss) => ss.seg.kind === 'file').map((ss) => ss.seg.fileName));
    const inBolt = new Set();
    for (const b of m.bolt) for (const n of b.files) inBolt.add(n);
    // Recently deleted files keep their slot briefly, with a ⊘.
    const recent = m.recentDeletes.filter((d) => m.now - d.t < 1500);
    const keys = [...m.files.keys(), ...recent.map((d) => d.name)];
    const over = this.dirSlots.sync(keys);
    const shown = new Map();
    for (const name of m.files.keys()) shown.set(this.dirSlots.get(name), { name, kind: 'file' });
    for (const d of recent) if (!m.files.has(d.name)) shown.set(this.dirSlots.get(d.name), { name: d.name, kind: 'deleted' });
    const ours = m.trace ? m.trace.fileName : null;
    this.dirIcons.forEach((ic, i) => {
      const s = shown.get(i);
      if (!s) { ic.g.setAttribute('opacity', 0); return; }
      ic.g.setAttribute('opacity', 1);
      let cls;
      if (s.kind === 'deleted') cls = 'ficon ficon-garbage';
      else if (!inBolt.has(s.name) && m.ineligibleForRemoval.has(s.name)) cls = 'ficon ficon-new';
      else cls = inRoot.has(s.name) ? 'ficon ficon-root' : 'ficon ficon-garbage';
      if (s.name === ours) cls += ' ficon-ours';
      setCls(ic.use, cls);
      ic.del.setAttribute('opacity', s.kind === 'deleted' ? 1 : 0);
    });
    setText(this.dirMore, over ? `+${over} more` : '');
    const prot = m.protected || new Set();
    this.boltCards.forEach((c, i) => {
      const b = m.bolt[i];
      c.r.setAttribute('opacity', b ? 1 : 0.25);
      setCls(c.r, i === 0 ? 'bolt latest' : prot.has(b && b.epoch) ? 'bolt protected' : 'bolt');
      setText(c.t, b ? `epoch ${b.epoch} · ${b.files.size} files${i === 0 ? ' · latest' : prot.has(b.epoch) ? ' · rollback point' : ''}` : '');
    });
    const zs = [...m.zombies.values()];
    this.zombieIcons.forEach((z, i) => z.setAttribute('opacity', i < zs.length ? 1 : 0));
    setText(this.zombieText, zs.length ? `${zs.length} file(s), ${fmtBytes(m.zombieBytes())} not counted by num_bytes_used_disk` : 'none');
  }

  _updateWrites(m) {
    const by = { persister: [], merger: [] };
    for (const [name, w] of m.writing) by[w.by].push(name);
    for (const [k, badge] of [['persister', this.writeP], ['merger', this.writeM]]) {
      const n = by[k].length;
      badge.g.setAttribute('opacity', n ? 1 : 0);
      if (n) setText(badge.t, n === 1 ? `writing ${by[k][0]}` : `writing ${n} files`);
    }
  }

  _updateLids(m, procs, rate) {
    const s = m.stats;
    const set = (id, state, status) => {
      const l = this.lids[id];
      setCls(l.dot, `gdot dot-${state}`);
      l.dot.setAttribute('opacity', status ? 1 : 0);
      setText(l.status, status);
      l.g.classList.toggle('stalled', state === 'stall');
    };
    set('kv', m.kvPausedSince !== null ? 'stall' : 'busy', m.kvPausedSince !== null ? 'paused by DCP flow control' : '');
    const busy = [0, 1, 2, 3].filter((i) => procState(procs.get(`batchWorker-${i}`)) === 'busy').length;
    set('cbft', m.numEventsBlocking ? 'stall' : busy ? 'busy' : 'wait',
      m.numEventsBlocking ? 'blocked by the app herder' : `${busy} of 4 batch workers busy`);
    const mems = m.root.segs.filter((ss) => ss.seg.kind === 'mem').length;
    set('scorch', 'busy', `epoch ${s.CurRootEpoch} · ${mems} in-memory + ${m.root.segs.length - mems} file segments`);
    set('disk', 'busy', `${m.files.size} files · ${fmtBytes(m.diskBytes())}`);
    set('introducer', procState(procs.get('introducer')), `epoch ${s.CurRootEpoch}`);
    const pp = procs.get('persister');
    set('persister', procState(pp), summarize(pp));
    const mp = procs.get('merger');
    set('merger', procState(mp), summarize(mp));
  }

  _updateDynamicAnchors(m) {
    const tr = m.trace;
    this.positions = {};
    if (!tr) return;
    const segPos = (id) => {
      const ss = m.root.segs.find((x) => x.seg.id === id);
      if (!ss) return null;
      if (ss.seg.kind === 'mem') {
        const i = this.memSlots.get(id);
        if (i === undefined) return null;
        const x = 96 + (i % MEM_COLS) * 14, y = 788 + Math.floor(i / MEM_COLS) * 14;
        return [x - 3, y + 5];
      }
      const i = this.fileSlots.get(id);
      if (i === undefined) return null;
      const x = 520 + i * 18;
      return [x - 3, 840];
    };
    const seg = tr.segId != null ? segPos(tr.segId) : null;
    if (seg) this.positions.ourSeg = { p: seg, needs: ['cbft', 'scorch'] };
    const dirPos = (name) => {
      const i = this.dirSlots.get(name);
      if (i === undefined) return null;
      const ic = this.dirIcons[i];
      return [ic.x - 2, ic.y + 8];
    };
    if (tr.fileName) { const p = dirPos(tr.fileName); if (p) this.positions.ourFile = { p, needs: ['disk'] }; }
    if (tr.deletedFile) { const p = dirPos(tr.deletedFile); if (p) this.positions.deletedFile = { p, needs: ['disk'] }; }
    const at = {
      dcp: 'dcp', channel: 'slot', worker: 'workers', herder: 'gate',
      analysis: 'batch', introducing: 'introducer', persisting: 'persister', merging: 'merger',
    }[tr.stage];
    // Callouts about our batch end at its marker.
    const tok = this.tokenTarget(m, 'auto');
    const needs = at ? ANCHORS[at].needs : ['cbft', 'scorch'];
    if (tok) this.positions.ourBatch = { p: [tok.p[0] - tok.size / 2 - 2, tok.p[1]], needs };
  }
}

function summarize(p) {
  if (!p) return '';
  const st = procState(p);
  if (st === 'nap') return 'napping';
  if (st === 'stall') return 'paused';
  if (/MergeUsing|in-memory merge/.test(p.label)) return 'merging';
  if (/writing|fsync|root\.bolt/.test(p.label)) return 'writing';
  if (st === 'busy') return 'busy';
  return 'waiting';
}

// Log-scale bar height for byte sizes: 1MB → small, 2GB → full.
function barHeight(bytes, max) {
  const mb = Math.max(bytes / (1024 * 1024), 0.25);
  const v = (Math.log2(mb) + 2) / 13; // 0.25MB..2GB
  return Math.max(3, Math.min(1, v) * max);
}


function ratePerSec(m) {
  const s = m.series;
  if (s.length < 11) return m.cfg.ingestDocsPerSec;
  const a = s[s.length - 11], b = s[s.length - 1];
  return (b.mutations - a.mutations) / ((b.t - a.t) / 1000);
}
