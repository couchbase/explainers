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

import { SECTIONS, PANELS, LIDS, BUBBLES, ANCHORS, CANVAS, STATIONS, isAnchorVisible } from './layout.js';
import { fmtBytes, fmtMs, fmtNum } from '../sim/fmt.js';
import { svgEl as el, svgText as txt, setText, setCls } from './util/dom.js';
import { along, clamp01, easeQuad, lerp } from './util/anim.js';
import { GNode, procState, shortLabel } from './gnode.js';
import { Slots } from './slots.js';
import { Staircase } from './staircase.js';
import { stairScene } from './stairs-scene.js';
import { planInput } from '../sim/procs/merger.js';
import { stackOf, stackFrame, stackKey, MAX_BACK, SHEET_DX, SHEET_DY, swapPart, swapShift, ADD_TRAVEL, COMMIT_PHASES } from './snapstack.js';

const SYMBOLS = `
<symbol id="dg-file" viewBox="0 0 12 15"><path d="M0.5,0.5 H8 L11.5,4 V14.5 H0.5 Z" class="ficon-body"/><path d="M8,0.5 V4 H11.5" class="ficon-fold"/></symbol>
<symbol id="dg-del" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" class="del-ring"/><path d="M3,11 L11,3" class="del-slash"/></symbol>
<symbol id="dg-search" viewBox="0 0 12 12"><circle cx="5" cy="5" r="3.6" class="search-ring"/><path d="M7.6,7.6 L11,11" class="search-handle"/></symbol>
<marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker>
<marker id="dg-arrow-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead-up"/></marker>
`;

const MEM_COLS = 26, MEM_ROWS = 8, FILE_SLOTS = 20;
const FILE_BASE = 990; // the root's file bars stand on this line
const ROOT = [80, 842, 810, 170]; // the front sheet: the current root snapshot
const STACK_POOL = 6; // sheet elements, enough for a blend between two stacks
const STACK_TWEEN_MS = 350;
const EPOCH_X = 246; // where the root title's epoch number starts
const DIR_COLS = 32, DIR_ROWS = 6;
const ON_ROOT = ['root', 'rootR', 'rootEpoch', 'rootMem', 'ourSeg']; // anchors on the front sheet

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
      el('path', { d: framePath(s.frame, 10, s.notch), class: `frame sec-${s.color}` }, g);
    }
    // KV is a separate process, one network hop away.
    el('line', { x1: 120, x2: 880, y1: 179, y2: 179, class: 'network' }, g);
    txt(g, 880, 173, 'network: DCP over TCP', 'note', 'end');
    const flows = el('g', { class: 'flows' }, g);
    this._flows(flows);

    this._kv(el('g', {}, g));
    this._cbft(el('g', {}, g));
    this._bleve(el('g', {}, g));
    this._scorch(el('g', {}, g));
    this._disk(el('g', {}, g));

    // Lids: nested ones first, so the outer ones sit on top.
    const order = ['introducer', 'persister', 'merger', 'scorch', 'bleve', 'cbft', 'kv', 'disk'];
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
    this._arrow(f, 'M500,388 V610');
    this._arrow(f, 'M500,662 V700');
    this._arrow(f, 'M500,802 V840');
    txt(f, 492, 826, 'swaps in a new root snapshot', 'note', 'end');
    this._arrow(f, 'M80,1152 H78 Q70,1152 70,1144 V760 Q70,752 78,752 H348', true);
    this._arrow(f, 'M920,1152 H922 Q930,1152 930,1144 V760 Q930,752 922,752 H652', true);
    txt(f, 76, 790, 'introduce ↑', 'note');
    txt(f, 924, 790, 'introduce ↑', 'note', 'end');
    this._arrow(f, 'M280,1252 V1388');
    this._arrow(f, 'M720,1252 V1388');
    // Files being written, shown on the write arrows.
    this.writeP = this._writeBadge(f, 290, 1268);
    this.writeM = this._writeBadge(f, 730, 1268);
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

  // bleve's own parts: its API layer above scorch, and the shared
  // analysis queue in the notch beside Scorch.Batch().
  _bleve(g) {
    txt(g, 62, 544, 'the index API, document mapping, analysis', 'note');
    txt(g, 62, 560, 'scorch below is one index implementation', 'note');
    el('rect', { x: 700, y: 600, width: 240, height: 80, rx: 5, class: 'zone' }, g);
    txt(g, 712, 618, 'analysis queue', 'note-in');
    txt(g, 712, 634, 'shared by all indexes', 'note-in');
    this.cpus = [];
    for (let i = 0; i < 8; i++) this.cpus.push(el('rect', { x: 712 + i * 22, y: 650, width: 16, height: 16, rx: 2, class: 'cpu' }, g));
    txt(g, 930, 663, 'NumCPU', 'note-in', 'end');
  }

  _scorch(g) {
    this.nodes.batch = new GNode(g, 390, 612, 220, 50, 'Scorch.Batch()', { sub: 'analyze → in-memory segment' });
    // Scorch.Batch() calls across to bleve's shared analysis queue, and
    // waits for the results to come back. (The arrows show once
    // scorch's lid is open.)
    this.queueArrows = el('g', {}, g);
    this._arrow(this.queueArrows, 'M610,628 H698');
    this._arrow(this.queueArrows, 'M700,646 H612');

    // introducer panel
    const ip = this._panel(g, 'introducer');
    const f = ip.front;
    this.nodes.introducer = new GNode(f, 350, 702, 300, 100, 'introducer', { header: true });
    txt(f, 366, 746, 'select {', 'code-in');
    this.chans = {};
    // Chips sized to their names, so they fit inside the panel.
    let cx = 366;
    for (const c of ['introductions', 'persists', 'merges', 'watchers']) {
      const w = 12 + c.length * 5.6;
      const r = el('rect', { x: cx, y: 754, width: w, height: 18, rx: 3, class: 'chan' }, f);
      txt(f, cx + w / 2, 767, c, 'chan-text', 'middle');
      this.chans[c] = r;
      cx += w + 6;
    }
    txt(f, 366, 790, '} → new root, epoch + 1', 'code-in');

    // queries
    this.queryG = el('g', { opacity: 0 }, g);
    el('rect', { x: 600, y: 814, width: 280, height: 22, rx: 11, class: 'query' }, this.queryG);
    el('use', { href: '#dg-search', x: 610, y: 819, width: 12, height: 12 }, this.queryG);
    this.queryText = txt(this.queryG, 628, 829, '', 'note-in');

    // Older root snapshots that are still held, behind the current one,
    // each tagged with its epoch where it peeks out on the right.
    this.sheets = [];
    this.sheetTags = [];
    const sg = el('g', {}, g);
    for (let i = 0; i < STACK_POOL; i++) {
      this.sheets.push(el('rect', { x: ROOT[0], y: ROOT[1], width: ROOT[2], height: ROOT[3], rx: 6, class: 'zone strong sheet', opacity: 0 }, sg));
    }
    for (let i = 0; i < STACK_POOL; i++) this.sheetTags.push(txt(sg, 0, 0, '', 'note sheet-tag'));

    // The old root while a new one is swapped in over it (drawSwap).
    this.ghost = this._rootFace(el('g', { opacity: 0 }, g));

    // root snapshot: the front sheet
    this.rootG = el('g', {}, g);
    const face = this._rootFace(this.rootG);
    this.memCells = face.cells;
    this.fileBars = face.bars;
    this.rootContent = face.content;
    this.rootRect = face.rect;
    setText(face.title, 'root snapshot · ');
    // "epoch" on its own, so "epoch N (copy)" can be set in italics
    this.epochWord = el('tspan', {}, face.title);
    this.epochWord.textContent = 'epoch';
    // The epoch number on its own, so a change can roll over (old one
    // up and out, new one up and in) as the reader scrolls.
    this.epochOld = txt(this.rootG, EPOCH_X, 862, '', 'zone-title epoch-num', 'start');
    this.epochOldNum = el('tspan', {}, this.epochOld);
    this.epochCopy = el('tspan', { 'fill-opacity': 0 }, this.epochOld);
    this.epochCopy.textContent = ' (copy)';
    this.epochNew = txt(this.rootG, EPOCH_X, 862, '', 'zone-title epoch-num', 'start');
    this.epochPlus = txt(this.rootG, EPOCH_X + 32, 862, '+1', 'zone-title epoch-num lit', 'start');
    this.epochPlus.setAttribute('opacity', 0);
    this.memMore = txt(face.content, 460, 1006, '', 'note-in', 'end');
    this.fileMore = txt(face.content, ROOT[0] + ROOT[2] - 10, 1006, '', 'note-in', 'end');

    // The persister and merger don't receive from the root: each takes
    // a ref on a root snapshot, reads its segments, then lets go.
    this.readers = {};
    // A query pins one too: its chip points at the sheet it holds.
    for (const [who, x] of [['persister', 280], ['merger', 720], ['query', 0]]) {
      const rg = el('g', { opacity: 0 }, g);
      const path = el('path', { d: '', class: 'flow-read', 'marker-end': 'url(#dg-arrow)' }, rg);
      const label = who === 'query' ? null : txt(rg, x + 8, 1047, '', 'note');
      this.readers[who] = { g: rg, path, label, x };
    }

    this._persister(g);
    this._merger(g);
  }

  // One root snapshot sheet: its box, title, in-memory cells and file
  // bars, drawn into parent.
  _rootFace(parent) {
    const rect = el('rect', { x: ROOT[0], y: ROOT[1], width: ROOT[2], height: ROOT[3], rx: 6, class: 'zone strong' }, parent);
    const title = txt(parent, 96, 862, '', 'zone-title');
    // the epoch number, placed as on the front sheet
    const num = txt(parent, EPOCH_X, 862, '', 'zone-title epoch-num', 'start');
    const content = el('g', {}, parent);
    parent = content;
    txt(parent, 96, 880, 'in-memory segments', 'note-in');
    txt(parent, 520, 880, 'file segments (mmapped zap)', 'note-in');
    const cells = [];
    for (let i = 0; i < MEM_COLS * MEM_ROWS; i++) {
      const x = 96 + (i % MEM_COLS) * 14, y = 888 + Math.floor(i / MEM_COLS) * 14;
      cells.push(el('rect', { x, y, width: 10, height: 10, rx: 2, class: 'cell' }, parent));
    }
    const bars = [];
    for (let i = 0; i < FILE_SLOTS; i++) {
      const x = 520 + i * 18;
      const bar = el('rect', { x, y: FILE_BASE, width: 14, height: 0, rx: 2, class: 'fbar' }, parent);
      const del = el('rect', { x, y: FILE_BASE, width: 14, height: 0, class: 'fdel' }, parent);
      bars.push({ bar, del, x });
    }
    return { g: parent.parentNode, rect, title, num, cells, bars, content };
  }

  // The old front sheet (captured slots S), k sheets deep, at opacity o.
  _drawGhost(S, k, o) {
    const gh = this.ghost;
    gh.g.setAttribute('opacity', o.toFixed(3));
    if (o <= 0.001) return;
    gh.g.setAttribute('transform', `translate(${(SHEET_DX * k).toFixed(1)} ${(SHEET_DY * k).toFixed(1)})`);
    setText(gh.title, 'root snapshot · epoch');
    setText(gh.num, String(S.epoch));
    gh.cells.forEach((c, i) => setCls(c, S.mem[i]));
    gh.bars.forEach((b, i) => {
      const s = S.bars[i];
      b.bar.setAttribute('y', s.y.toFixed(1)); b.bar.setAttribute('height', s.h.toFixed(1));
      b.del.setAttribute('y', s.dy.toFixed(1)); b.del.setAttribute('height', s.dh.toFixed(1));
      setCls(b.bar, s.cls);
    });
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
    this.nodes.persister = new GNode(p.front, 80, 1052, 400, 200, 'persister', { header: true });
    this.pRows = this._rows(p.front, 96, 1090, [
      '1 · nap ≤2s (skipped while the herder blocks)',
      '2 · cut in-memory segments into ~20MB flushables',
      '3 · merge → write zap → fsync',
      '4 · introduce ↑, then commit root.bolt + fsync',
    ]);
    this.pWorkers = [];
    for (let i = 0; i < 4; i++) this.pWorkers.push(el('rect', { x: 372 + i * 22, y: 1163, width: 16, height: 16, rx: 3, class: 'pw s-wait' }, p.front));
  }

  _merger(g) {
    const p = this._panel(g, 'merger');
    this.nodes.merger = new GNode(p.front, 520, 1052, 400, 200, 'merger', { header: true });
    this.mRows = this._rows(p.front, 536, 1090, [
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
    const bg = el('g', { class: 'bubble', 'data-bubble': id, opacity: 0 }, g);
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
    else if (id === 'analysis') this._analysisDetail(body, x + 18, y + 52);
    else this.stairs = new Staircase(body);
    this.bubbles[id] = { g: bg, tail: [tx, ty] };
  }

  // What an analyzer does to one field of one doc: bleve's "en"
  // analyzer, roughly. Struck-out tokens are dropped.
  _analysisDetail(b, x, y) {
    txt(b, x, y, 'field "desc": "The Quick Foxes Jumped"', 'back-fn');
    const rows = [
      ['unicode tokenizer', ['The', 'Quick', 'Foxes', 'Jumped']],
      ['to_lower', ['the', 'quick', 'foxes', 'jumped']],
      ['stop_en', ['-the', 'quick', 'foxes', 'jumped']],
      ['stemmer_en_snowball', ['quick', 'fox', 'jump']],
      ['terms @ positions', ['quick@2', 'fox@3', 'jump@4']],
    ];
    rows.forEach(([stage, toks], i) => {
      const yy = y + 22 + i * 40;
      txt(b, x, yy + 4, stage, 'back-note');
      let cx = x;
      for (const t of toks) {
        const gone = t.startsWith('-'), s = gone ? t.slice(1) : t;
        const w = 14 + s.length * 6.6;
        el('rect', { x: cx, y: yy + 10, width: w, height: 18, rx: 3, class: gone ? 'tok gone' : 'tok' }, b);
        txt(b, cx + w / 2, yy + 23, s, gone ? 'tok-text gone' : 'tok-text', 'middle');
        cx += w + 6;
      }
    });
    txt(b, x, y + 232, 'CPU work: every indexed field of every doc', 'back-note');
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

  // Documents flowing from KV down the DCP arrow, for a batch's birth.
  _docs(g) {
    const doc = () => {
      const dg = el('g', { class: 'doc', opacity: 0 }, g);
      el('path', { d: 'M-5,-6.5 H2 L5,-3.5 V6.5 H-5 Z', class: 'doc-body' }, dg);
      el('path', { d: 'M-3,-2 H3 M-3,1 H3 M-3,4 H1', class: 'doc-lines' }, dg);
      return dg;
    };
    this.docs = [];
    for (let i = 0; i < 9; i++) this.docs.push(doc());
    // Our new file, down the persister's write arrow to disk.
    this.writeFly = el('g', { opacity: 0 }, g);
    el('use', { href: '#dg-file', x: -7, y: -9, width: 14, height: 18, class: 'ficon ficon-new ficon-ours' }, this.writeFly);
    txt(this.writeFly, 12, 4, 'our zap file', 'token-label');
    // Our batch's docs, off to the analysis queue and back.
    this.queueDocs = [];
    for (let i = 0; i < 24; i++) this.queueDocs.push(doc());
  }

  // q in 0..1 (<0 hides it): our file going down the persister's
  // write arrow into the disk.
  // It lands on its icon in the index directory, which stays hidden
  // until it gets there.
  setWriteFly(q) {
    const ic = this.writeIcon;
    if (this.writeHidden && this.writeHidden !== ic) this.writeHidden.g.style.visibility = '';
    if (q < 0 || q >= 1) {
      this.writeFly.setAttribute('opacity', 0);
      if (this.writeHidden) this.writeHidden.g.style.visibility = '';
      this.writeHidden = null;
      return;
    }
    const end = ic ? [ic.x + 6, ic.y + 7.5] : [280, 1384];
    // from the persister's 'merge → write zap → fsync' row, down its write arrow
    const pts = [[280, 1171], [280, 1378], [end[0], 1378], end];
    const [x, y] = along(pts, easeQuad(q));
    this.writeFly.setAttribute('opacity', Math.min(1, q / 0.08).toFixed(3));
    this.writeFly.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${lerp(1, 0.86, q).toFixed(3)})`);
    if (ic) { ic.g.style.visibility = 'hidden'; this.writeHidden = ic; }
  }

  // t in 0..1 (<0 hides them), over the step's whole length: our
  // batch's docs, one after another, go from Scorch.Batch() across to
  // the analysis queue, are analyzed there, and come back.
  setQueueDocs(t) {
    if (t < 0) {
      if (this.queueDocsShown) for (const d of this.queueDocs) d.setAttribute('opacity', 0);
      this.queueDocsShown = false;
      return;
    }
    this.queueDocsShown = true;
    const [x0, x1] = [STATIONS.analysis[0] + 14, 706];
    this.queueDocs.forEach((d, i) => {
      const n = this.queueDocs.length, trip = 0.3;
      const q = clamp01((t - 0.03 - i * (0.92 - trip) / (n - 1)) / trip);
      // out along the upper arrow, a pause in the queue, back along the lower
      const out = q < 0.4, back = q > 0.6;
      if (q <= 0 || q >= 1 || !(out || back)) { d.setAttribute('opacity', 0); return; }
      const f = out ? easeQuad(q / 0.4) : easeQuad((q - 0.6) / 0.4);
      const x = out ? lerp(x0, x1, f) : lerp(x1, x0, f), y = out ? 628 : 646;
      const edge = Math.min(f, 1 - f) / 0.1; // fade at either end
      d.setAttribute('opacity', Math.min(1, edge).toFixed(3));
      d.setAttribute('transform', `translate(${x.toFixed(1)} ${y}) scale(0.8)`);
    });
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
    this.docs.forEach((d, i) => {
      const start = i * 0.065;
      const q = Math.max(0, Math.min(1, (t - start) / 0.4));
      if (q <= 0 || q >= 1) { d.setAttribute('opacity', 0); return; }
      const [x, y] = along(pts, easeQuad(q));
      const sc = q > 0.85 ? 1 - (q - 0.85) / 0.15 * 0.7 : 1;
      d.setAttribute('opacity', q > 0.9 ? ((1 - q) / 0.1).toFixed(3) : 1);
      d.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${sc.toFixed(3)})`);
    });
  }

  // The marker for "our batch": a ringed chip that becomes our segment.
  _token(g) {
    const tg = el('g', { class: 'token', opacity: 0 }, g);
    // In the persister or merger, our segment (or file) is reached
    // through the root snapshot they hold a ref on: the marker wears a
    // little snapshot sheet around it, with other segments beside it.
    this.tokenSheet = el('g', { opacity: 0 }, tg);
    el('rect', { x: -18, y: -11, width: 40, height: 26, rx: 3, class: 'token-sheet' }, this.tokenSheet);
    el('rect', { x: -22, y: -14, width: 40, height: 26, rx: 3, class: 'token-sheet' }, this.tokenSheet);
    el('rect', { x: -17, y: -3, width: 6, height: 6, rx: 1, class: 'token-other' }, this.tokenSheet);
    el('rect', { x: 9, y: -3, width: 6, height: 6, rx: 1, class: 'token-other' }, this.tokenSheet);
    this.tokenRect = el('rect', { x: -8, y: -8, width: 16, height: 16, rx: 3, class: 'token-chip' }, tg);
    this.tokenLabel = txt(tg, 0, -14, 'our batch', 'token-label', 'middle');
    this.tokenSub = txt(tg, 0, -14, '', 'token-sub', 'middle');
    this.token = tg;
  }

  _disk(g) {
    txt(g, 70, 1378, 'index directory', 'zone-title');
    this.dirIcons = [];
    for (let i = 0; i < DIR_COLS * DIR_ROWS; i++) {
      const x = 70 + (i % DIR_COLS) * 17, y = 1390 + Math.floor(i / DIR_COLS) * 22;
      const ig = el('g', { opacity: 0 }, g);
      const use = el('use', { href: '#dg-file', x, y, width: 12, height: 15, class: 'ficon' }, ig);
      const del = el('use', { href: '#dg-del', x: x - 1, y: y + 1, width: 14, height: 14, opacity: 0 }, ig);
      this.dirIcons.push({ g: ig, use, del, x, y });
    }
    this.dirMore = txt(g, 614, 1530, '', 'note-in', 'end');
    txt(g, 650, 1378, 'root.bolt snapshots', 'zone-title');
    this.boltCards = [];
    for (let i = 0; i < 5; i++) {
      const y = 1390 + i * 30;
      const r = el('rect', { x: 650, y, width: 280, height: 24, rx: 4, class: 'bolt' }, g);
      // In columns: "epoch", the number and the file count right-
      // aligned, then the rest.
      const t = el('g', { transform: `translate(0 ${y + 16})` }, g);
      const cols = [txt(t, 660, 0, '', 'note-in'), txt(t, 726, 0, '', 'note-in', 'end'),
        txt(t, 754, 0, '', 'note-in', 'end'), txt(t, 758, 0, '', 'note-in')];
      this.boltCards.push({ r, t, cols, text: '' });
    }
    txt(g, 70, 1560, 'unlinked but still open:', 'note-in');
    this.zombieIcons = [];
    for (let i = 0; i < 12; i++) {
      this.zombieIcons.push(el('use', { href: '#dg-file', x: 232 + i * 17, y: 1548, width: 12, height: 15, class: 'ficon ficon-zombie', opacity: 0 }, g));
    }
    this.zombieText = txt(g, 450, 1560, '', 'note-in');
    el('use', { href: '#dg-del', x: 70, y: 1599, width: 14, height: 14 }, g);
    txt(g, 90, 1610, 'removeOldData() deletes files no root.bolt snapshot lists (the persister runs it when idle)', 'note-in');
    this.legendY = 1630;
    const legend = [['ficon-root', 'in the root'], ['ficon-new', 'new, not yet in root.bolt'], ['ficon-garbage', 'no longer in the root'], ['ficon-zombie', 'unlinked, still open']];
    let x = 70;
    for (const [cls, label] of legend) {
      el('use', { href: '#dg-file', x, y: 1620, width: 10, height: 13, class: `ficon ${cls}` }, g);
      txt(g, x + 14, 1631, label, 'note-in');
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
    const notch = L.section && SECTIONS[L.section].notch;
    el('path', { d: framePath([x, y, w, h], big ? 7 : 5, notch && [notch[0] - 5, notch[1] + 5]), class: 'lid-bg' }, lg);
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
        dy: +b.del.getAttribute('y'), dh: +b.del.getAttribute('height'), cls: b.bar.getAttribute('class'),
      })),
      stack: this.stackNow,
      epoch: this.rootEpochNow,
      introLid: this.lids.introducer.status.textContent,
      bolt: this.boltCards.map((c) => ({ text: c.text, cls: c.r.getAttribute('class'), o: c.r.getAttribute('opacity') })),
      dir: this.dirIcons.map((ic) => ({ o: ic.g.getAttribute('opacity'), cls: ic.use.getAttribute('class'), del: ic.del.getAttribute('opacity') })),
    };
  }

  // Whether going from slots A to B swaps the root (see drawSwap).
  static isSwap(A, B) {
    return !!(A && B && A.epoch !== undefined && B.epoch !== undefined && A.epoch !== B.epoch && A.stack && B.stack);
  }

  // Shows the slot grids partway (q) from snapshot A to snapshot B, for
  // steps that don't swap the root: things that appear fade in, things
  // that go fade out, bars that change size grow or shrink.
  blendSlots(A, B, q) {
    this._clearSwap();
    this._blendCells(A, B, q, q);
    if (A.epoch !== undefined && B.epoch !== undefined) this._drawEpoch(A.epoch, B.epoch, q);
    if (A.stack && B.stack) this._drawStack(stackFrame(A.stack, B.stack, q));
    this._blendDir(A, B, q);
  }

  // The introducer swapping in a new root (slots B) over the old one
  // (slots A), at s through SWAP_PHASES (0..8), one change at a time:
  // the new root X starts as a see-through, dashed copy laid over the
  // old one and lifts off the stack; it gets the old root's contents
  // and epoch, the new segment, loses what that replaces, then epoch
  // + 1; then it's solid (swapped in) and the stack shifts back under it.
  drawSwap(A, B, s) {
    const part = (n) => swapPart(s, n);
    const cover = part('cover'), peel = part('peel'), copy = part('copy'), ep = part('epoch');
    const add = part('add'), drop = part('drop'), solid = part('solid'), settle = easeQuad(part('settle'));

    // X, the new root, in the front sheet's elements.
    const [dx, dy] = swapShift(s);
    this.swapShift = [dx, dy];
    this.rootG.setAttribute('transform', `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
    this.rootG.setAttribute('opacity', cover.toFixed(3));
    setCls(this.rootG, solid < 0.5 ? 'root-draft' : '');
    // See-through while empty; mostly hides the old root once it has
    // its own copy of the contents, so they don't read doubled.
    this.rootRect.setAttribute('fill-opacity', lerp(lerp(0.72, 0.94, copy), 1, solid).toFixed(3));
    // Its contents start as a faint copy, and firm up when it's solid.
    this.rootContent.setAttribute('opacity', (0.5 * copy + 0.5 * solid).toFixed(3));
    // Contents change only once the marker has brought the new segment.
    this._blendCells(A, B, clamp01((add - ADD_TRAVEL) / (1 - ADD_TRAVEL)), drop);

    // Its epoch: the old one's, labeled "(copy)" as it lifts off, then
    // "+1" and it rolls over.
    this._drawEpoch(A.epoch, B.epoch, clamp01((ep - 0.2) / 0.25), 1, 1, peel);
    const one = B.epoch === A.epoch + 1;
    const fadeOut = clamp01((ep - 0.9) / 0.1);
    this.epochPlus.setAttribute('opacity', one ? (Math.min(1, ep / 0.3) * (1 - fadeOut)).toFixed(3) : 0);
    // The new number stays red, like its "+1", then both fade together.
    this.epochNew.style.fill = ep > 0 && ep < 1 ? `color-mix(in srgb, var(--accent) ${(100 * (1 - fadeOut)).toFixed(0)}%, var(--muted))` : '';

    // The introducer's lid names the root's epoch: the new one once
    // it's swapped in.
    setText(this.lids.introducer.status, solid < 0.5 ? A.introLid : B.introLid);

    // The old root, under X, then back into the stack (or gone, if
    // nothing holds it any more).
    const depth = B.stack.epochs.indexOf(A.epoch);
    const kept = depth > 0 && depth <= MAX_BACK;
    this._drawGhost(A, settle * (kept ? depth : 1), kept ? 1 : 1 - settle);
    this._drawStack(stackFrame(A.stack, B.stack, settle));
    this._blendDir(A, B, s / 8);
  }

  // The persister's commit (slots A before, B after), at s through
  // COMMIT_PHASES (0..3): a new root.bolt record slides in on top and
  // the others move down; then our zap file's icon turns solid; then
  // the persister lets go of its root snapshot.
  drawCommit(A, B, s) {
    const part = (n) => clamp01(s - COMMIT_PHASES.indexOf(n));
    // The older records move down first; then the new one appears.
    const shift = easeQuad(clamp01(part('bolt') / 0.5)), appear = clamp01((part('bolt') - 0.5) / 0.5);
    const listed = part('listed'), release = easeQuad(part('release'));
    this._clearSwap();
    this._blendCells(B, B, 1, 1);
    this._drawEpoch(B.epoch, B.epoch, 1);
    const added = B.bolt[0].text && B.bolt[0].text !== A.bolt[0].text;
    this.boltCards.forEach((c, i) => {
      const b = B.bolt[i], a = added ? A.bolt[i - 1] : A.bolt[i];
      const y1 = 1390 + i * 30, y0 = added && i > 0 ? y1 - 30 : y1;
      const y = lerp(y0, y1, shift);
      const shown = added && i === 0 ? b : shift < 0.5 && a ? a : b;
      c.r.setAttribute('y', y.toFixed(1));
      c.t.setAttribute('transform', `translate(0 ${(y + 16).toFixed(1)})`);
      setCls(c.r, shown.cls);
      this._boltText(c, shown.text);
      c.r.setAttribute('opacity', added && i === 0 ? (appear * +b.o).toFixed(3) : shown.o);
      c.t.setAttribute('opacity', added && i === 0 ? appear.toFixed(3) : 1);
    });
    this._blendDir(A, B, listed);
    this._drawStack(stackFrame(A.stack, B.stack, release));
  }

  // Whether a swap from A to B has anything for its 'drop' phase.
  static swapDrops(A, B) {
    return A.mem.some((a, i) => a !== 'cell' && B.mem[i] === 'cell') || A.bars.some((a, i) => a.h > 0 && B.bars[i].h === 0);
  }

  // Undoes drawSwap's changes to the front sheet.
  _clearSwap() {
    if (!this.swapShift) return;
    this.swapShift = null;
    this.rootG.removeAttribute('transform');
    this.rootG.removeAttribute('opacity');
    setCls(this.rootG, '');
    this.rootRect.removeAttribute('fill-opacity');
    this.rootContent.removeAttribute('opacity');
    this.epochPlus.setAttribute('opacity', 0);
    this.epochNew.style.fill = '';
    this._drawGhost(null, 0, 0);
  }

  // The front sheet's cells and bars partway from A to B: qIn for what
  // appears or changes, qOut for what goes.
  _blendCells(A, B, qIn, qOut) {
    const fade = (e, o) => { if (o >= 1) e.removeAttribute('opacity'); else e.setAttribute('opacity', o.toFixed(3)); };
    // In-memory segments that leave the root while a new file bar
    // appears were merged into it: they fly into that bar as they fade.
    const nb = A.bars.findIndex((a, i) => a.h === 0 && B.bars[i].h > 0);
    const into = nb >= 0 ? [this.fileBars[nb].x + 7, FILE_BASE - B.bars[nb].h / 2] : null;
    const k = easeQuad(qOut);
    this.memCells.forEach((c, i) => {
      const a = A.mem[i], b = B.mem[i];
      const aOn = a !== 'cell', bOn = b !== 'cell';
      c.removeAttribute('transform');
      if (a === b) { setCls(c, b); fade(c, 1); } else if (bOn && !aOn) { setCls(c, b); fade(c, qIn); } else if (aOn && !bOn) {
        setCls(c, a);
        if (into && qOut < 1) {
          const dx = into[0] - (+c.getAttribute('x') + 5), dy = into[1] - (+c.getAttribute('y') + 5);
          c.setAttribute('transform', `translate(${(dx * k).toFixed(1)} ${(dy * k).toFixed(1)})`);
          fade(c, 1 - k * k);
        } else fade(c, 1 - qOut);
      } else { setCls(c, qIn < 0.5 ? a : b); fade(c, 1); }
    });
    this.fileBars.forEach((bar, i) => {
      const a = A.bars[i], b = B.bars[i];
      let s = b, o = 1;
      if (a.h === 0 && b.h > 0) o = qIn;
      else if (a.h > 0 && b.h === 0) { s = a; o = 1 - qOut; } else if (a.h !== b.h || a.dh !== b.dh) {
        const l = (x, y) => x + (y - x) * qIn;
        s = { y: l(a.y, b.y), h: l(a.h, b.h), dy: l(a.dy, b.dy), dh: l(a.dh, b.dh), cls: b.cls };
      }
      bar.bar.setAttribute('y', s.y.toFixed(1)); bar.bar.setAttribute('height', s.h.toFixed(1));
      bar.del.setAttribute('y', s.dy.toFixed(1)); bar.del.setAttribute('height', s.dh.toFixed(1));
      setCls(bar.bar, s.cls);
      fade(bar.bar, o); fade(bar.del, o);
    });
  }

  _blendDir(A, B, q) {
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
    const st = this.stackTween;
    if (st) this._drawStack(stackFrame(st.a, st.b, easeQuad(Math.min(1, (wallNow - st.t0) / STACK_TWEEN_MS))));
  }

  // The root's epoch number, partway (q) from a to b: the old number
  // rolls up and out as the new one rolls in, lit while it changes.
  // shown: 0 hides the number (an empty root, before its epoch lands).
  // copy (0..1): the old number is a new root's copy of it, and the
  // label "(copy)" fades in, in italics.
  _drawEpoch(a, b, q, whole = q, shown = 1, copy = 0) {
    const r = a === b ? 1 : q;
    // "+1" while a one-epoch step is shown, until the scroll settles.
    this.epochPlus.setAttribute('opacity', b === a + 1 && whole < 1 && shown ? Math.min(1, q * 3).toFixed(3) : 0);
    this.epochOldNum.textContent = a === b ? '' : String(a);
    this.epochCopy.textContent = a === b || !copy ? '' : ' (copy)';
    this.epochCopy.setAttribute('fill-opacity', copy.toFixed(3));
    const italic = copy > 0 && a !== b && r < 0.5 && shown > 0;
    this.epochWord.setAttribute('class', italic ? 'copy-label' : '');
    this.epochOld.classList.toggle('copy-label', copy > 0);
    // "+1" just after the old number and its label
    const w = this.epochOld.textContent && this.epochOld.getComputedTextLength ? this.epochOld.getComputedTextLength() : 24;
    this.epochPlus.setAttribute('x', (EPOCH_X + (w || 24) + 8).toFixed(1));
    setText(this.epochNew, String(b));
    this.epochOld.setAttribute('y', (862 - 12 * r).toFixed(1));
    this.epochOld.setAttribute('opacity', ((1 - r) * shown).toFixed(3));
    this.epochNew.setAttribute('y', (862 + 12 * (1 - r)).toFixed(1));
    this.epochNew.setAttribute('opacity', (r * shown).toFixed(3));
    const lit = a !== b && q < 1;
    setCls(this.epochNew, lit ? 'zone-title epoch-num lit' : 'zone-title epoch-num');
  }

  // Places the older sheets and the persister's and merger's ref arrows.
  _drawStack({ sheets, readers }) {
    this.sheets.forEach((r, i) => {
      const sh = sheets[i], tag = this.sheetTags[i];
      if (!sh) { r.setAttribute('opacity', 0); tag.setAttribute('opacity', 0); return; }
      r.setAttribute('x', (ROOT[0] + SHEET_DX * sh.k).toFixed(1));
      r.setAttribute('y', (ROOT[1] + SHEET_DY * sh.k).toFixed(1));
      r.setAttribute('opacity', sh.o.toFixed(3));
      setText(tag, String(sh.epoch));
      tag.setAttribute('x', (ROOT[0] + ROOT[2] + SHEET_DX * sh.k + 7).toFixed(1));
      tag.setAttribute('y', (866 + SHEET_DY * sh.k).toFixed(1));
      tag.setAttribute('opacity', (sh.o * Math.min(1, sh.k)).toFixed(3));
    });
    const bottom = ROOT[1] + ROOT[3];
    for (const [who, r] of Object.entries(this.readers)) {
      const rd = readers[who];
      r.g.setAttribute('opacity', rd.o.toFixed(3));
      if (who === 'query') {
        // From the chip's end to the sheet's top edge or, for an older
        // sheet, the part of it that peeks out on the right.
        const ex = ROOT[0] + ROOT[2] - 6 + SHEET_DX * rd.k;
        const ey = ROOT[1] + SHEET_DY * rd.k + 10 * Math.min(rd.k, 1);
        r.path.setAttribute('d', `M880,825 H${ex.toFixed(1)} V${(ey - 1).toFixed(1)}`);
        continue;
      }
      r.path.setAttribute('d', `M${r.x},1050 V${(bottom + SHEET_DY * rd.k + 1).toFixed(1)}`);
      setText(r.label, rd.epoch !== null ? `holds a ref on epoch ${rd.epoch}` : '');
    }
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
    if (id === 'scorch') this.queueArrows.setAttribute('opacity', t.toFixed(3));
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
    const so = t.snapO || 0;
    this.tokenSheet.setAttribute('opacity', so.toFixed(3));
    this.tokenSheet.setAttribute('transform', `scale(${(0.3 + 0.7 * so).toFixed(3)})`);
    const top = -Math.max(z / 2, 14 * so) - 5;
    setText(this.tokenLabel, t.label);
    setText(this.tokenSub, t.sub || '');
    this.tokenSub.setAttribute('opacity', so.toFixed(3));
    this.tokenSub.setAttribute('y', top.toFixed(1));
    // The label sits above the marker, or (sideMix 1) to its right.
    const sm = t.sideMix || 0, w = t.label.length * 6.6;
    this.tokenLabel.setAttribute('x', (sm * (z / 2 + 6 + w / 2)).toFixed(1));
    this.tokenLabel.setAttribute('y', ((1 - sm) * (top - 12 * so) + sm * 4).toFixed(1));
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
        return { p: [ic.x + 6, ic.y + 7.5], size: 18, kind: 'file', label: 'our zap file', st: 'icon', key: tr.fileName };
      }
    }
    const fixed = STATIONS[tr.stage];
    if (fixed) {
      // From Scorch.Batch()'s NewUsing() on, it's our segment.
      const kind = ['built', 'introducing', 'persisting'].includes(tr.stage) ? 'mem' : ['merging', 'written', 'fileIntroducing'].includes(tr.stage) ? 'file' : 'batch';
      const st = tr.stage;
      const held = st === 'persisting' ? m.persisterSnapshot : st === 'merging' ? m.mergerSnapshot : null;
      if (held) {
        return { p: fixed, size: 10, kind, st, snap: true, label: kind === 'mem' ? 'our segment' : 'our file segment', sub: `in epoch ${held.epoch}` };
      }
      // Under the introducer's 'merges' chip, the label goes to the
      // right, clear of the channel chips above.
      const side = st === 'fileIntroducing' ? 'right' : undefined;
      return { p: fixed, size: st === 'channel' || side ? 14 : 16, kind, st, side, label: kind === 'batch' ? 'our batch' : kind === 'mem' ? 'our segment' : 'our file segment' };
    }
    const seg = this.positions.ourSeg;
    if (seg) {
      const isFile = m.root.segs.some((ss) => ss.seg.id === tr.segId && ss.seg.kind === 'file');
      return isFile
        ? { p: [seg.p[0] + 10, seg.p[1]], size: 18, kind: 'file', label: 'our file segment', st: 'bar', key: tr.segId }
        : { p: [seg.p[0] + 8, seg.p[1]], size: 14, kind: 'mem', label: 'our segment', st: 'cell', key: tr.segId };
    }
    return null;
  }

  // Lights a channel chip, or not, overriding the simulation's view of
  // it: our file's channel lights only once the marker gets there.
  setChanLit(name, lit) {
    setCls(this.chans[name], lit ? 'chan lit' : 'chan');
  }

  // Whether the marker at point pt has reached a channel chip (it
  // comes along the chip row from the left, then drops below it).
  reachedChan(name, pt, size) {
    const x = +this.chans[name].getAttribute('x');
    return pt[0] + size / 2 >= x && pt[1] >= 745;
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
  // Anchors on the front sheet move with it while a new root lifts off.
  anchor(id) {
    const open = this.open || new Set(), bubbles = this.shownBubbles || new Set();
    const d = ANCHORS[id] || this.positions[id];
    if (!d) return null;
    const sh = this.swapShift && ON_ROOT.includes(id) ? this.swapShift : [0, 0];
    return { p: [d.p[0] + sh[0], d.p[1] + sh[1]], visible: isAnchorVisible(id, open, bubbles, ANCHORS[id] ? undefined : d.needs) };
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
      : m.cfg.ingestDocsPerSec === 0 ? 'no new mutations for now'
        : this.live ? `sending ${fmtNum(rate)} docs/s` : 'sending mutations');
    const frac = Math.min(1, m.dcpBufUsed / m.cfg.dcpBufferBytes);
    this.dcpFill.setAttribute('width', (140 * frac).toFixed(1));
    setCls(this.dcpFill, frac > 0.8 ? 'gauge-fill warn' : 'gauge-fill');
    setText(this.dcpText, `${fmtBytes(m.dcpBufUsed)} / ${fmtBytes(m.cfg.dcpBufferBytes)}`);

    // cbft
    ns.dcp = st(procs.get('dcp'));
    // The front panel is worker 0, which is also where the story's
    // followed batch goes (Model.follow).
    const front = 0;
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
    // A channel lights only while the introducer handles what came on it.
    const handling = procState(procs.get('introducer')) === 'busy' && m.introLast ? m.introLast.kind : null;
    for (const [k, r] of Object.entries(this.chans)) setCls(r, k === handling ? 'chan lit' : 'chan');

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
    this.rootEpochNow = m.root.epoch;
    this._clearSwap();
    this._drawEpoch(m.root.epoch, m.root.epoch, 1);
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
      if (!ss) { b.bar.setAttribute('height', 0); b.del.setAttribute('height', 0); setCls(b.bar, 'fbar'); return; }
      const h = barHeight(ss.seg.bytes, 100);
      b.bar.setAttribute('y', (FILE_BASE - h).toFixed(1)); b.bar.setAttribute('height', h.toFixed(1));
      const dh = h * ss.deleted / ss.seg.docs;
      b.del.setAttribute('y', (FILE_BASE - h).toFixed(1)); b.del.setAttribute('height', dh.toFixed(1));
      setCls(b.bar, merging.has(ss.seg.id) ? 'fbar merging' : 'fbar');
    });
    setText(this.fileMore, fileOver ? `+${fileOver} more` : '');

    // While the simulation plays, the stack eases to its new shape;
    // otherwise it's drawn as is (and the page blends between steps).
    const S = stackOf(m);
    const prev = this.stackNow;
    this.stackNow = S;
    if (!this.live) { this.stackTween = null; this._drawStack(stackFrame(S, S, 1)); } else if (!prev || stackKey(prev) !== stackKey(S)) {
      const now = performance.now();
      const st = this.stackTween;
      const done = !st || now - st.t0 >= STACK_TWEEN_MS;
      this.stackTween = { a: done ? (prev || S) : st.b, b: S, t0: now };
    }
  }

  _updatePersister(m, procs) {
    const p = procs.get('persister');

    const label = p ? p.label : '';
    const workers = [...procs.values()].filter((x) => x.name.startsWith('persisterWorker-'));
    // While in-memory merge workers run, the persister is in its merge
    // phase; just before they start, it has cut the flushables.
    const busyWorkers = workers.some((w) => w.label);
    const cut = workers.length > 0 && !busyWorkers;
    // A worker handing its file to the introducer is in phase 4.
    const introducing = workers.some((w) => /merges <-|merge introduction/.test(w.label));
    litRow(this.pRows, cut ? 1 : busyWorkers && !/nap|paused/.test(label) ? (introducing ? 3 : 2) : phaseRow(PHASES.persister, label), /paused/.test(label));
    this.pWorkers.forEach((w, i) => setCls(w, `pw s-${workers[i] && !cut ? procState(workers[i]) : 'wait'}`));
    litRow(this.pBack, busyWorkers && !/nap|paused/.test(label) ? 3 : phaseRow(PHASES.persisterCode, label));
  }

  _updateMerger(m, procs) {
    const p = procs.get('merger');

    litRow(this.mRows, phaseRow(PHASES.merger, p ? p.label : ''));

    // The bubble's staircase, live: the root's file segments.
    this.stairLive = {
      files: planInput(m.root),
      opts: m.cfg.mergePlan,
      merging: new Set(m.currentMerge ? m.currentMerge.srcs : []),
    };
    this.stairLiveKey = `${m.root.epoch}|${m.currentMerge ? m.currentMerge.label : ''}`;
  }

  // The merger bubble's staircase, between story phases pa and pb.
  setStairs(pa, pb, q) {
    const box = BUBBLES.merger.box;
    const scene = (ph) => stairScene(box, ph, this.stairLive);
    this.stairs.draw(scene(pa), scene(pb), q, `${pa}|${pb}|${this.stairLiveKey}`);
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
    const ours = m.trace ? m.trace.fileName || m.trace.newFileName : null;
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
      c.r.setAttribute('y', 1390 + i * 30);
      c.t.setAttribute('transform', `translate(0 ${1390 + i * 30 + 16})`);
      c.t.setAttribute('opacity', 1);
      c.r.setAttribute('opacity', b ? 1 : 0.25);
      // The records that list our file get its outline.
      const hasOurs = b && ours && b.files.has(ours) ? ' ours' : '';
      setCls(c.r, (i === 0 ? 'bolt latest' : prot.has(b && b.epoch) ? 'bolt protected' : 'bolt') + hasOurs);
      this._boltText(c, b ? `epoch ${b.epoch} · ${b.files.size} files${i === 0 ? ' · latest' : prot.has(b.epoch) ? ' · rollback point' : ''}` : '');
    });
    const zs = [...m.zombies.values()];
    this.zombieIcons.forEach((z, i) => z.setAttribute('opacity', i < zs.length ? 1 : 0));
    setText(this.zombieText, zs.length ? `${zs.length} file(s), ${fmtBytes(m.zombieBytes())} not counted by num_bytes_used_disk` : 'none');
  }

  // A root.bolt record's line, "epoch N · F files · ...", in columns.
  _boltText(c, text) {
    c.text = text;
    const mm = /^epoch (\d+) · (\d+) (files?)(.*)$/.exec(text);
    const parts = mm ? ['epoch', mm[1], `· ${mm[2]}`, `${mm[3]}${mm[4]}`] : [text, '', '', ''];
    c.cols.forEach((t, k) => setText(t, parts[k]));
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
    const q = m.analysisQueue;
    set('bleve', q.inUse ? 'busy' : 'wait', `analysis: ${q.inUse} of ${m.cfg.numCPUs} CPUs busy`);
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
        const x = 96 + (i % MEM_COLS) * 14, y = 888 + Math.floor(i / MEM_COLS) * 14;
        return [x - 3, y + 5];
      }
      const i = this.fileSlots.get(id);
      if (i === undefined) return null;
      const x = 520 + i * 18;
      return [x - 3, 940];
    };
    const seg = tr.segId != null ? segPos(tr.segId) : null;
    if (seg) this.positions.ourSeg = { p: seg, needs: ['cbft', 'bleve', 'scorch'] };
    const dirPos = (name) => {
      const i = this.dirSlots.get(name);
      if (i === undefined) return null;
      const ic = this.dirIcons[i];
      return [ic.x - 2, ic.y + 8];
    };
    const ourName = tr.fileName || tr.newFileName;
    if (ourName) { const p = dirPos(ourName); if (p) this.positions.ourFile = { p, needs: ['disk'] }; }
    // Where our new zap file lands in the directory, once written.
    const wi = tr.newFileName ? this.dirSlots.get(tr.newFileName) : undefined;
    this.writeIcon = wi !== undefined ? this.dirIcons[wi] : null;
    if (tr.deletedFile) { const p = dirPos(tr.deletedFile); if (p) this.positions.deletedFile = { p, needs: ['disk'] }; }
    const at = {
      dcp: 'dcp', channel: 'slot', worker: 'workers', herder: 'gate',
      analysis: 'batch', built: 'batch', introducing: 'introducer', persisting: 'persister', merging: 'merger',
      written: 'persister', fileIntroducing: 'introducer',
    }[tr.stage];
    // Callouts about our batch end at its marker.
    const tok = this.tokenTarget(m, 'auto');
    const needs = at ? ANCHORS[at].needs : ['cbft', 'bleve', 'scorch'];
    if (tok) this.positions.ourBatch = { p: [tok.p[0] - tok.size / 2 - 2, tok.p[1]], needs };
  }
}

// Which row of a panel's phase list (or its bubble's code list) is
// active, from the goroutine's raw activity label: first match wins.
const PHASES = {
  persister: [[/nap|paused/, 0], [/root\.bolt|persists <-|persist introduction/, 3], [/writing|fsync/, 2]],
  persisterCode: [[/nap|paused/, 0], [/root\.bolt: removed/, 5], [/root\.bolt|writing|fsync|persists <-|persist introduction/, 4]],
  merger: [[/waiting for persister|persisterNotifier/, 0], [/MergeUsing|writing|fsync/, 2], [/merge introduction|merges <-/, 3]],
};
function phaseRow(table, label) {
  for (const [re, row] of table) if (re.test(label)) return row;
  return -1;
}
function litRow(rows, lit, stalled = false) {
  rows.forEach((r, i) => setCls(r, i === lit ? (stalled && i === 0 ? 'row lit stall' : 'row lit') : 'row'));
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

// A rounded rect [x, y, w, h] as a path, optionally with its top-right
// corner cut away beyond notch [nx, ny].
export function framePath([x, y, w, h], r, notch) {
  const x1 = x + w, y1 = y + h;
  const top = notch
    ? `H${notch[0] - r} Q${notch[0]},${y} ${notch[0]},${y + r} V${notch[1] - r} Q${notch[0]},${notch[1]} ${notch[0] + r},${notch[1]} H${x1 - r} Q${x1},${notch[1]} ${x1},${notch[1] + r}`
    : `H${x1 - r} Q${x1},${y} ${x1},${y + r}`;
  return `M${x + r},${y} ${top} V${y1 - r} Q${x1},${y1} ${x1 - r},${y1} H${x + r} Q${x},${y1} ${x},${y1 - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;
}
