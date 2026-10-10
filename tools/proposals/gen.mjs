// Generates static design proposals for the explainer's center
// diagram: docs/proposals/index.html plus one standalone SVG per
// proposal. These are sketches for discussion, not the product.
//
//   node tools/proposals/gen.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'docs/proposals');
const W = 1440, H = 900;

// ---------- tiny SVG helpers ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n) => +n.toFixed(1);
const rect = (x, y, w, h, cls = '', rx = 4) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}" class="${cls}"/>`;
const text = (x, y, s, cls = '', anchor = 'start') => `<text x="${f(x)}" y="${f(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
const line = (x1, y1, x2, y2, cls = 'wire') => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" class="${cls}"/>`;
const path = (d, cls = 'wire') => `<path d="${d}" class="${cls}"/>`;
const arrow = (x1, y1, x2, y2, cls = 'flow') => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" class="${cls}" marker-end="url(#arrow)"/>`;
const circle = (x, y, r, cls) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" class="${cls}"/>`;

let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

// A goroutine box: state dot, name, one-line activity.
function node(x, y, w, h, title, sub, state = 'wait', extra = '') {
  return `<g class="node s-${state} ${extra}">${rect(x, y, w, h, 'box')}` +
    circle(x + 12, y + 15, 4, 'dot') +
    text(x + 22, y + 19, title, 'n-title') +
    (sub ? text(x + 12, y + h - 10, sub, 'n-sub') : '') + '</g>';
}

// The callout grammar: a horizontal run (under a text line, or out of
// a chart), a diagonal, then a horizontal run into the target.
function callout(x0, y0, tx, ty, cls = 'callout', run = 26) {
  const dir = tx > x0 ? 1 : -1;
  const d = `M${f(x0)},${f(y0)} H${f(x0 + dir * run)} L${f(tx - dir * run)},${f(ty)} H${f(tx)}`;
  return path(d, cls) + circle(tx, ty, cls === 'callout' ? 3.5 : 2.5, cls + '-end');
}

function sparkline(x, y, w, h, n, gen, { ref = null, max = 1 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(gen(i / (n - 1)));
  const X = (i) => x + (i / (n - 1)) * w, Y = (v) => y + h - (v / max) * h;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${f(X(i))},${f(Y(v))}`).join('');
  let s = path(`${d}L${f(x + w)},${f(y + h)}L${f(x)},${f(y + h)}Z`, 'spark-area') + path(d, 'spark-line');
  s += line(x, y + h, x + w, y + h, 'axis');
  if (ref !== null) s += line(x, Y(ref), x + w, Y(ref), 'spark-ref');
  s += circle(X(n - 1), Y(pts[n - 1]), 2.5, 'spark-end');
  return s;
}

// ---------- shared frame: story column + chart column ----------

const STORY_X = 48, STORY_R = 440;

function storyColumn() {
  let s = '';
  s += text(STORY_X, 56, 'FOLLOW A BATCH · STEP 4 OF 9', 'eyebrow');
  // previous step, faded
  const prev = ['3 · Scorch.Batch()', 'The worker calls Scorch.Batch(), which fans', 'our 200 docs out to the analysis queue and', 'encodes the results into one in-memory', 'segment.'];
  prev.forEach((l, i) => { s += text(STORY_X, 150 + i * 24, l, i === 0 ? 'p-title faded' : 'p faded'); });
  // active step
  const y0 = 380;
  s += text(STORY_X, y0, '4 · The introducer', 'p-title');
  const lines = [
    ['Our batch is now an in-memory segment of', null],
    ['200 docs. It goes to the one goroutine', null],
    ['allowed to change the index root:', ' the introducer.'],
    ['It builds a new root snapshot with our', null],
    ['segment appended, swaps it in, and bumps', null],
    ['the epoch to 1,042. From now on, searches', null],
    ['can see our docs.', null],
  ];
  let anchor = null;
  lines.forEach(([a, hl], i) => {
    const y = y0 + 34 + i * 26;
    if (hl) {
      s += `<text x="${STORY_X}" y="${y}" class="p">${esc(a)}<tspan class="hl">${esc(hl)}</tspan></text>`;
      // underline from the highlighted phrase to the column edge
      const startX = STORY_X + a.length * 7.35 + 6;
      s += line(startX, y + 6, STORY_R, y + 6, 'callout');
      anchor = { x: STORY_R, y: y + 6 };
    } else {
      s += text(STORY_X, y, a, 'p');
    }
  });
  const next = ['5 · The persister naps', 'cbft sets a 2s nap, so in-memory segments', 'pile up and get merged before they’re', 'written to disk…'];
  next.forEach((l, i) => { s += text(STORY_X, 720 + i * 24, l, i === 0 ? 'p-title faded' : 'p faded'); });
  return { svg: s, anchor };
}

const CHART_X = 1150, CHART_W = 250;
const CHARTS = [
  { key: 'dcp', title: 'DCP unacked', value: '3.1MB / 20MB', gen: (t) => 0.12 + 0.05 * Math.sin(t * 9), ref: 0.95 },
  { key: 'mem', title: 'memory · quota', value: '212MB / 665MB', gen: (t) => 0.28 + 0.06 * Math.sin(t * 5) + 0.04 * rnd(), ref: 0.85 },
  { key: 'root', title: 'segments in root', value: '38 mem · 9 file', gen: (t) => 0.35 + 0.25 * ((t * 7) % 1) },
  { key: 'disk', title: 'files on disk', value: '27 files · 162MB', gen: (t) => 0.3 + 0.2 * t + 0.08 * Math.sin(t * 13) },
  { key: 'merge', title: 'merge bytes written', value: '1.4GB total', gen: (t) => 0.1 + 0.8 * t },
];

function chartColumn(targets) {
  let s = '';
  // Order charts by their targets' heights so leader lines don't cross.
  const charts = [...CHARTS].sort((a, b) => (targets[a.key]?.y ?? 0) - (targets[b.key]?.y ?? 0));
  charts.forEach((c, i) => {
    const y = 70 + i * 160;
    s += text(CHART_X, y, c.title, 'c-title');
    s += text(CHART_X + CHART_W, y, c.value, 'c-value', 'end');
    s += sparkline(CHART_X, y + 12, CHART_W, 70, 40, c.gen, { ref: c.ref ?? null });
    const t = targets[c.key];
    if (t) s += callout(CHART_X - 8, y + 47, t.x + 6, t.y, 'leader', 14);
  });
  return s;
}

function frame(center, targets, calloutTarget) {
  const story = storyColumn();
  const defs = `<defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker>
    <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="4" class="hatch"/></pattern>
  </defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="proposal">${defs}` +
    rect(0, 0, W, H, 'canvas', 0) +
    line(468, 30, 468, H - 30, 'gutter') + line(1110, 30, 1110, H - 30, 'gutter') +
    story.svg + center + chartColumn(targets) +
    callout(story.anchor.x, story.anchor.y, calloutTarget.x - 4, calloutTarget.y, 'callout', 14) +
    '</svg>';
}

// ---------- shared pieces ----------

// Fixed-slot grids keep geometry stable as counts change.
function memCells(x, y, cols, rows, n, { ours = true } = {}) {
  let s = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    const cls = i < n ? 'mem' : 'slot-empty';
    s += rect(x + c * 13, y + r * 13, 10, 10, cls, 2);
  }
  if (ours) {
    const i = n - 1, cx = x + (i % cols) * 13, cy = y + Math.floor(i / cols) * 13;
    s += rect(cx - 2.5, cy - 2.5, 15, 15, 'ours-ring', 3);
  }
  return s;
}

// File segments: fixed slots, height ~ log(size), hatched deleted part.
function fileSlots(x, y, slots, w, h, sizes, dels) {
  let s = '';
  const max = Math.log(Math.max(...sizes) + 1);
  for (let i = 0; i < slots; i++) {
    const sx = x + i * (w + 4);
    if (i >= sizes.length) { s += rect(sx, y, w, h, 'slot-empty', 2); continue; }
    const bh = Math.max(6, (Math.log(sizes[i] + 1) / max) * h);
    s += rect(sx, y + h - bh, w, bh, 'file', 2);
    const dh = bh * dels[i];
    if (dh > 0) s += rect(sx, y + h - bh, w, dh, 'deleted', 2);
  }
  return s;
}

function diskGrid(x, y, cols, rows, kinds) {
  let s = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = kinds[r * cols + c] || 'slot-empty';
    s += rect(x + c * 15, y + r * 15, 11, 11, k === 'new' ? 'file-new' : k, 2);
  }
  return s;
}
const DISK_KINDS = [...Array(9).fill('file'), ...Array(13).fill('garbage'), 'new', 'new', 'zombie'];
const FILE_SIZES = [180, 160, 120, 60, 40, 22, 20, 18, 9];
const FILE_DELS = [0.25, 0.1, 0.4, 0, 0.15, 0, 0, 0, 0];

function boltCards(x, y) {
  return text(x, y, 'root.bolt', 'z-title') +
    rect(x, y + 10, 170, 24, 'bolt latest') + text(x + 8, y + 26, 'epoch 1,040 · latest', 'b-label') +
    rect(x, y + 40, 170, 24, 'bolt') + text(x + 8, y + 56, 'epoch 1,012', 'b-label') +
    rect(x, y + 70, 170, 24, 'bolt protected') + text(x + 8, y + 86, 'epoch 640 · rollback pt', 'b-label');
}

function batchToken(x, y, label = 'our batch · 200 docs') {
  return `<g class="token">${rect(x, y, 128, 20, 'token-box', 10)}${text(x + 64, y + 14, label, 'token-text', 'middle')}</g>`;
}

// ---------- Proposal A: the spine ----------

function proposalA() {
  let s = '';
  const cx = 785;
  s += node(685, 36, 200, 46, 'KV engine', 'DCP producer · 8k docs/s', 'busy');
  s += arrow(cx, 82, cx, 102);
  s += text(675, 115, 'flow control', 'z-small', 'end');
  s += rect(685, 106, 200, 10, 'gauge') + rect(685, 106, 32, 10, 'gauge-fill', 2);
  s += text(675, 128, '3.1 of 20MB', 'z-small', 'end');
  s += arrow(cx, 118, cx, 138);
  s += node(685, 140, 200, 46, 'DCP goroutine', 'batch.Index() per vbucket', 'wait');
  // fan out to workers
  const wx = [497, 644, 791, 938];
  s += line(cx, 186, cx, 200, 'flow') + line(wx[0] + 62, 200, wx[3] + 62, 200, 'flow');
  wx.forEach((x, i) => {
    s += arrow(x + 62, 200, x + 62, 210);
    s += rect(x + 56, 212, 12, 12, i === 1 ? 'slot-full' : 'slot', 2);
    s += node(x, 230, 125, 44, `worker ${i}`, '≤200 ops · 100ms', i === 1 ? 'busy' : 'wait');
  });
  s += text(497, 222, 'cap-1 chans', 'z-small');
  // herder gate
  s += line(497, 292, 1063, 292, 'gate');
  s += text(1063, 304, 'app herder: blocks here when memory > indexing quota', 'z-small', 'end');
  wx.forEach((x) => { s += line(x + 62, 274, x + 62, 306, 'flow'); });
  s += line(wx[0] + 62, 306, wx[3] + 62, 306, 'flow') + arrow(cx, 306, cx, 318);
  s += node(685, 320, 200, 46, 'Scorch.Batch()', 'analyze · build mem segment', 'wait');
  s += rect(905, 320, 158, 46, 'zone') + text(915, 337, 'analysis queue', 'z-small');
  for (let i = 0; i < 8; i++) s += rect(915 + i * 17, 346, 12, 12, i < 3 ? 'cpu-busy' : 'slot', 2);
  s += arrow(cx, 366, cx, 384);
  s += node(685, 386, 200, 46, 'introducer', '1 goroutine · swaps the root', 'busy', 'focus');
  s += arrow(cx, 432, cx, 452);
  // query pin
  s += rect(905, 404, 158, 22, 'query') + text(984, 419, 'q7 pins epoch 1,031', 'b-label', 'middle');
  s += line(984, 426, 984, 452, 'pin');
  // root snapshot
  s += rect(497, 454, 566, 98, 'zone strong');
  s += text(509, 472, 'root snapshot · epoch 1,042', 'z-title');
  s += text(509, 490, 'in-memory segments', 'z-small') + text(806, 490, 'file segments (mmapped zap)', 'z-small');
  s += memCells(509, 498, 20, 3, 38);
  s += text(509 + 13 * 17 + 4, 545, '← our batch', 'z-tiny');
  s += fileSlots(806, 496, 12, 16, 48, FILE_SIZES, FILE_DELS);
  // persister (under the in-memory segments) & merger (under the files)
  s += arrow(615, 552, 615, 574);
  s += node(510, 576, 210, 46, 'persister', 'nap 2s · in-mem merge → zap', 'sleep');
  s += arrow(925, 552, 925, 574);
  s += node(840, 576, 210, 46, 'merger', 'tiered plan · file segs only', 'busy');
  // results go back through the introducer
  s += path('M1050,599 H1074 V398 H889', 'return') + path('M510,599 H486 V398 H681', 'return');
  s += text(1070, 470, 'introduce', 'z-tiny', 'end');
  // memory | disk boundary
  s += line(470, 640, 1085, 640, 'boundary');
  s += text(472, 634, 'MEMORY', 'z-boundary') + text(472, 654, 'DISK', 'z-boundary');
  s += arrow(615, 622, 615, 660) + arrow(945, 622, 945, 660);
  s += rect(497, 662, 566, 140, 'zone');
  s += text(509, 680, 'index directory', 'z-title');
  s += diskGrid(509, 690, 22, 6, DISK_KINDS);
  s += boltCards(880, 684);
  s += legend(497, 828);
  return frame(s, {
    dcp: { x: 885, y: 111 },
    mem: { x: 1063, y: 292 },
    root: { x: 1063, y: 500 },
    disk: { x: 1063, y: 740 },
    merge: { x: 1050, y: 590 },
  }, { x: 685, y: 418 });
}

function legend(x, y) {
  const items = [['mem', 'in-memory seg'], ['file', 'file seg'], ['garbage', 'not in root'], ['file-new', 'not yet in root.bolt'], ['zombie', 'unlinked, still open']];
  let s = '', cx = x;
  for (const [cls, label] of items) {
    s += rect(cx, y - 9, 10, 10, cls, 2) + text(cx + 14, y, label, 'z-small');
    cx += 22 + label.length * 6.2;
  }
  return s;
}

// ---------- Proposal B: shelves and movers ----------

function proposalB() {
  let s = '';
  const X = 560, SW = 503, MX = 600; // shelves; mover axis
  const shelf = (y, h, title, cls = '') => rect(X, y, SW, h, `zone ${cls}`) + text(X + 12, y + 18, title, 'z-title');
  const mover = (y, name, sub, state, extra = '') =>
    `<g class="node s-${state} ${extra}">${circle(MX, y, 15, 'mover')}${circle(MX, y, 4, 'dot')}</g>` +
    text(MX + 26, y - 2, name, 'n-title') + text(MX + 26, y + 13, sub, 'n-sub');

  s += shelf(36, 74, 'DCP stream · unacked mutations');
  s += rect(X + 12, 76, 300, 10, 'gauge') + rect(X + 12, 76, 48, 10, 'gauge-fill', 2) + text(X + 322, 85, '3.1 of 20MB (flow control)', 'z-small');
  s += arrow(MX, 110, MX, 160);
  s += mover(135, 'DCP goroutine', 'batch.Index() · per-vbucket batches', 'wait');

  s += shelf(162, 96, 'batches in flight · 4 workers, each with a cap-1 channel');
  for (let i = 0; i < 4; i++) {
    const x = X + 12 + i * 122;
    s += rect(x, 196, 12, 12, i === 1 ? 'slot-full' : 'slot', 2);
    s += rect(x + 18, 196, 92, 12, 'gauge') + rect(x + 18, 196, [30, 92, 10, 55][i], 12, i === 1 ? 'token-box' : 'gauge-fill', 2);
    s += text(x, 228, `worker ${i}`, 'z-small') + text(x + 110, 228, ['61', '200', '20', '120'][i] + ' ops', 'z-small', 'end');
  }
  s += text(X + 12, 248, 'executes at 200 ops or every 100ms', 'z-small');
  s += arrow(MX, 258, MX, 312);
  // herder valve on the conveyor
  s += `<g class="valve">${rect(MX - 9, 266, 18, 10, 'valve-box', 2)}</g>` + text(MX - 16, 275, 'herder', 'z-small', 'end');
  s += mover(296, 'introducer', 'via Scorch.Batch() → analysis → new root', 'busy', 'focus');

  s += shelf(314, 84, 'root snapshot · in-memory segments');
  s += memCells(X + 12, 338, 34, 3, 38);
  s += arrow(MX, 398, MX, 446);
  s += mover(422, 'persister', 'nap 2s · in-memory merge → zap + fsync', 'sleep');

  s += shelf(448, 86, 'root snapshot · file segments (mmapped zap)');
  s += fileSlots(X + 12, 470, 16, 22, 52, FILE_SIZES, FILE_DELS);
  // root bracket
  s += path(`M${X + SW + 6},316 h8 V532 h-8`, 'bracket') + text(X + SW + 18, 428, 'epoch 1,042', 'z-small');
  // merger loop between file shelf and disk
  const M2 = 900;
  s += `<g class="node s-busy">${circle(M2, 560, 15, 'mover')}${circle(M2, 560, 4, 'dot')}</g>`;
  s += text(M2 + 24, 558, 'merger', 'n-title') + text(M2 + 24, 573, 'tiered plan', 'n-sub');
  s += arrow(M2 - 8, 534, M2 - 8, 545) + arrow(M2 + 8, 545, M2 + 8, 536);
  s += arrow(M2, 575, M2, 584);
  s += text(X + 12, 566, 'MEMORY ↑  DISK ↓', 'z-boundary');
  s += line(470, 572, 860, 572, 'boundary');

  s += shelf(586, 150, 'index directory');
  s += diskGrid(X + 12, 614, 20, 7, DISK_KINDS);
  s += boltCards(X + 330, 608);
  s += mover(756, 'cleanup', 'removeOldData() when the persister is idle', 'wait');
  s += arrow(MX, 736, MX, 741);

  s += shelf(782, 52, 'queries');
  s += rect(X + 80, 802, 190, 22, 'query') + text(X + 175, 817, 'q7 · pins epoch 1,031 · 4.2s', 'z-small', 'middle');
  s += legend(X, 862);
  return frame(s, {
    dcp: { x: X + SW, y: 81 },
    mem: { x: X + SW, y: 356 },
    root: { x: X + SW + 14, y: 470 },
    disk: { x: X + SW, y: 660 },
    merge: { x: M2 + 80, y: 560 },
  }, { x: MX - 15, y: 296 });
}

// ---------- Proposal C: rows with time traces ----------

function proposalC() {
  let s = '';
  const NX = 490, NW = 140, LX = 645, LW = 420;
  const rows = [
    ['KV engine', 'busy', 26], ['DCP goroutine', 'mix', 26],
    ['worker 0', 'mix', 16], ['worker 1', 'mix', 16], ['worker 2', 'mix', 16], ['worker 3', 'mix', 16],
    ['app herder', 'herder', 16], ['introducer', 'blips', 26],
    ['root snapshot', 'data-root', 60],
    ['persister', 'persister', 26], ['p.workers', 'pw', 16], ['merger', 'merger', 26],
    ['index directory', 'data-disk', 50],
  ];
  s += text(LX, 44, '← last 10 seconds', 'z-small') + text(LX + LW, 44, 'now', 'z-small', 'end');
  let y = 58;
  const rowY = {};
  for (const [name, kind, h] of rows) {
    rowY[name] = { y, h };
    const focus = name === 'introducer' ? ' focus' : '';
    s += `<g class="row${focus}">`;
    s += text(NX + NW - 6, y + h / 2 + 4, name, h >= 26 ? 'n-title' : 'z-small', 'end');
    s += rect(LX, y, LW, h, 'lane', 2);
    s += lane(kind, LX, y, LW, h);
    s += '</g>';
    y += h + (h >= 26 ? 12 : 5);
  }
  // time grid
  for (let i = 1; i < 10; i++) s += line(LX + (LW * i) / 10, 52, LX + (LW * i) / 10, y - 6, 'tgrid');
  s += line(LX + LW, 52, LX + LW, y - 6, 'now');
  // the batch's journey across rows
  const tx = (t) => LX + LW * (1 + t / 10); // t in seconds, negative
  const pts = [['DCP goroutine', -1.6], ['worker 1', -1.45], ['worker 1', -1.05], ['introducer', -0.95], ['root snapshot', -0.9]];
  const d = pts.map(([r, t], i) => `${i ? 'L' : 'M'}${f(tx(t))},${f(rowY[r].y + rowY[r].h / 2)}`).join('');
  s += path(d, 'journey') + pts.map(([r, t]) => circle(tx(t), rowY[r].y + rowY[r].h / 2, 3, 'journey-dot')).join('');
  s += batchToken(tx(-0.9) - 150, rowY['root snapshot'].y + 6);
  s += legend(LX - 150, 862);
  return frame(s, {
    dcp: { x: LX + LW, y: rowY['KV engine'].y + 13 },
    mem: { x: LX + LW, y: rowY['app herder'].y + 8 },
    root: { x: LX + LW, y: rowY['root snapshot'].y + 30 },
    disk: { x: LX + LW, y: rowY['index directory'].y + 25 },
    merge: { x: LX + LW, y: rowY.merger.y + 13 },
  }, { x: NX + 46, y: rowY.introducer.y + 13 });
}

// State bars for a lane.
function lane(kind, x, y, w, h) {
  let s = '';
  const span = (a, b, cls) => rect(x + w * a, y + 2, Math.max(1.2, w * (b - a)), h - 4, cls, 1.5);
  if (kind === 'busy') { s += span(0, 1, 'st-busy'); return s; }
  if (kind === 'mix' || kind === 'pw') {
    let t = rnd() * 0.05;
    while (t < 1) {
      const len = kind === 'pw' ? 0.02 + rnd() * 0.05 : 0.004 + rnd() * 0.02;
      if (rnd() < (kind === 'pw' ? 0.25 : 0.5)) s += span(t, Math.min(1, t + len), 'st-busy');
      t += len + rnd() * 0.03;
    }
    return s;
  }
  if (kind === 'blips') { for (let t = 0.01; t < 1; t += 0.006 + rnd() * 0.012) s += span(t, t + 0.002, 'st-busy'); return s; }
  if (kind === 'herder') { s += text(x + 8, y + h - 4, 'not blocking', 'z-tiny'); return s; }
  if (kind === 'persister') {
    for (let t = 0; t < 1; t += 0.2) { s += span(t, t + 0.12, 'st-nap') + span(t + 0.12, t + 0.17, 'st-busy'); }
    return s;
  }
  if (kind === 'merger') { s += span(0.05, 0.3, 'st-busy') + span(0.45, 0.52, 'st-busy') + span(0.66, 0.95, 'st-busy'); return s; }
  if (kind === 'data-root') {
    // stacked area: file segs (bottom), mem segs (top)
    let top = '', mid = '';
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, fx = x + w * t;
      const files = 0.25 + 0.05 * Math.sin(t * 6), mems = ((t * 5) % 1) * 0.55;
      mid += `${i ? 'L' : 'M'}${f(fx)},${f(y + h - files * h)}`;
      top += `${i ? 'L' : 'M'}${f(fx)},${f(y + h - (files + mems) * h)}`;
    }
    s += path(`${top}L${x + w},${y + h}L${x},${y + h}Z`, 'area-mem') + path(`${mid}L${x + w},${y + h}L${x},${y + h}Z`, 'area-file');
    return s;
  }
  if (kind === 'data-disk') {
    let top = '';
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      top += `${i ? 'L' : 'M'}${f(x + w * t)},${f(y + h - (0.3 + 0.3 * t + 0.1 * Math.sin(t * 11)) * h)}`;
    }
    s += path(`${top}L${x + w},${y + h}L${x},${y + h}Z`, 'area-file');
    return s;
  }
  return s;
}

// ---------- page ----------

const STYLE = `
:root {
  --bg: #f3f5f7; --panel: #ffffff; --ink: #18222c; --muted: #5d6b78; --line: #cfd8df; --faint: #e6ebef;
  --accent: #c2410c; --flow: #7b8a97;
  --busy: #1f8f58; --nap: #6e5bd0; --wait: #8b97a3; --stall: #cf4a26;
  --mem: #e8862a; --file: #2d6cc9; --garbage: #b3bdc6; --zombie: #d23a4e;
  --font-body: "IBM Plex Sans", system-ui, sans-serif; --font-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  --font-display: "IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0f1418; --panel: #161d23; --ink: #e2e8ed; --muted: #93a2ae; --line: #33404b; --faint: #222c35;
  --accent: #fb7a3c; --flow: #7f8f9c; --busy: #3cc283; --nap: #9a8cf0; --wait: #6f7d89; --stall: #ff7a52;
  --mem: #f59e4a; --file: #5b93e8; --garbage: #4f5d69; --zombie: #ff5d72; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0f1418; --panel: #161d23; --ink: #e2e8ed; --muted: #93a2ae; --line: #33404b; --faint: #222c35;
  --accent: #fb7a3c; --flow: #7f8f9c; --busy: #3cc283; --nap: #9a8cf0; --wait: #6f7d89; --stall: #ff7a52;
  --mem: #f59e4a; --file: #5b93e8; --garbage: #4f5d69; --zombie: #ff5d72; color-scheme: dark; }
`;

const SVG_STYLE = `
.proposal { display: block; width: 100%; height: auto; font-family: var(--font-body); }
.canvas { fill: var(--bg); }
.gutter { stroke: var(--faint); stroke-width: 1; }
.eyebrow { font: 600 12px var(--font-display); letter-spacing: 0.08em; fill: var(--accent); }
.p { font: 400 15px var(--font-body); fill: var(--ink); }
.p-title { font: 600 17px var(--font-display); fill: var(--ink); }
.faded { opacity: 0.35; }
.hl { font-weight: 600; fill: var(--accent); }
.callout { fill: none; stroke: var(--accent); stroke-width: 1.5; }
.callout-end { fill: var(--accent); }
.leader { fill: none; stroke: var(--line); stroke-width: 1; }
.leader-end { fill: var(--muted); }
.c-title { font: 500 12px var(--font-mono); fill: var(--muted); }
.c-value { font: 500 12px var(--font-mono); fill: var(--ink); }
.spark-area { fill: color-mix(in srgb, var(--file) 14%, transparent); }
.spark-line { fill: none; stroke: var(--file); stroke-width: 1.5; }
.spark-ref { stroke: var(--stall); stroke-width: 1; stroke-dasharray: 3 3; }
.spark-end { fill: var(--file); }
.axis { stroke: var(--line); stroke-width: 1; }
.box { fill: var(--panel); stroke: var(--line); stroke-width: 1; }
.node.s-busy .box, .node.s-busy .mover { stroke: var(--busy); }
.node.s-sleep .box, .node.s-sleep .mover { stroke: var(--nap); }
.node.s-wait .box, .node.s-wait .mover { stroke: var(--wait); stroke-dasharray: 4 3; }
.dot { fill: var(--wait); }
.s-busy .dot { fill: var(--busy); }
.s-sleep .dot { fill: var(--nap); }
.s-wait .dot { fill: none; stroke: var(--wait); stroke-width: 1.5; }
.mover { fill: var(--panel); stroke-width: 1.5; }
.node.focus .box, .node.focus .mover { stroke: var(--accent); stroke-width: 2; stroke-dasharray: none; }
.row.focus .lane { stroke: var(--accent); stroke-width: 1.5; }
.n-title { font: 600 12px var(--font-mono); fill: var(--ink); }
.n-sub { font: 400 10.5px var(--font-mono); fill: var(--muted); }
.flow { stroke: var(--flow); stroke-width: 1.2; fill: none; }
.arrowhead { fill: var(--flow); }
.return { fill: none; stroke: var(--flow); stroke-width: 1; stroke-dasharray: 2 3; }
.wire { stroke: var(--line); fill: none; }
.zone { fill: var(--panel); stroke: var(--line); stroke-width: 1; }
.zone.strong { stroke: var(--ink); stroke-opacity: 0.35; }
.z-title { font: 600 11px var(--font-display); letter-spacing: 0.06em; text-transform: uppercase; fill: var(--muted); }
.z-small { font: 400 10.5px var(--font-mono); fill: var(--muted); paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
.zone ~ .z-small, .in-zone { stroke: var(--panel); }
.z-tiny { font: 400 9.5px var(--font-mono); fill: var(--muted); }
.z-boundary { font: 600 10px var(--font-display); letter-spacing: 0.12em; fill: var(--muted); }
.boundary { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 6 4; }
.gate { stroke: var(--stall); stroke-width: 1.5; stroke-dasharray: 10 3 2 3; }
.gauge { fill: var(--faint); stroke: var(--line); }
.gauge-fill { fill: var(--file); }
.slot { fill: var(--panel); stroke: var(--line); }
.slot-full { fill: var(--accent); }
.slot-empty { fill: none; stroke: var(--faint); }
.cpu-busy { fill: var(--busy); }
.mem { fill: var(--mem); }
.file { fill: var(--file); }
.deleted { fill: url(#hatch); }
.hatch { fill: var(--panel); opacity: 0.8; }
.garbage { fill: var(--garbage); }
.file-new { fill: none; stroke: var(--file); stroke-dasharray: 2 2; }
.zombie { fill: var(--zombie); }
.ours-ring { fill: none; stroke: var(--accent); stroke-width: 2; }
.token-box { fill: var(--accent); }
.token-text { font: 600 10.5px var(--font-mono); fill: var(--panel); }
.query { fill: var(--panel); stroke: var(--busy); }
.pin { stroke: var(--busy); stroke-dasharray: 2 2; }
.bolt { fill: var(--panel); stroke: var(--line); }
.bolt.latest { stroke: var(--file); }
.bolt.protected { stroke-width: 2.5; stroke: var(--muted); }
.b-label { font: 400 10.5px var(--font-mono); fill: var(--ink); }
.bracket { fill: none; stroke: var(--muted); }
.valve-box { fill: var(--panel); stroke: var(--stall); stroke-width: 1.5; }
.lane { fill: var(--panel); stroke: var(--faint); }
.tgrid { stroke: var(--faint); stroke-width: 1; }
.now { stroke: var(--muted); stroke-width: 1; }
.st-busy { fill: var(--busy); opacity: 0.85; }
.st-nap { fill: var(--nap); opacity: 0.55; }
.area-mem { fill: var(--mem); opacity: 0.8; }
.area-file { fill: var(--file); opacity: 0.8; }
.journey { fill: none; stroke: var(--accent); stroke-width: 2; }
.journey-dot { fill: var(--accent); }
`;

const PAGE_STYLE = `
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.6 var(--font-body); }
main { max-width: 1480px; margin: 0 auto; padding-inline: 16px; padding-block: 2rem 4rem; }
.intro, .notes { max-width: 70ch; }
h1 { font: 600 2.2rem/1.1 var(--font-display); margin: 0 0 0.75rem; text-wrap: balance; }
h2 { font: 600 1.5rem/1.2 var(--font-display); margin: 3.5rem 0 0.5rem; text-wrap: balance; }
h3 { font: 600 1rem/1.3 var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 1.25rem 0 0.25rem; }
.figure { border: 1px solid var(--line); border-radius: 6px; overflow-x: auto; background: var(--bg); }
.figure svg { min-width: 900px; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 0 2rem; }
.cols > div { min-width: 0; }
ul { padding-left: 1.2em; } li { margin-bottom: 0.3em; }
code { font-family: var(--font-mono); font-size: 0.9em; }
ol.steps li { margin-bottom: 0.5em; }
`;

function page(proposals) {
  const sections = proposals.map((p) => `
<h2 id="${p.id}">${esc(p.title)}</h2>
<p class="notes">${p.summary}</p>
<div class="figure">${p.svg}</div>
<div class="cols">
  <div><h3>Good at</h3><ul>${p.pros.map((x) => `<li>${x}</li>`).join('')}</ul></div>
  <div><h3>Weaker at</h3><ul>${p.cons.map((x) => `<li>${x}</li>`).join('')}</ul></div>
</div>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Scorch Diagram Proposals</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@600&display=swap">
<style>${STYLE}${PAGE_STYLE}${SVG_STYLE}</style></head>
<body><main>
<h1>Center diagram proposals</h1>
<div class="intro">
<p>Three static sketches of the main diagram, all in the same frame. The story text is on the left, with <strong>one</strong> callout from the active text line into the diagram. Charts are on the right, with thin leader lines to what they measure. All three show the same moment: step 4 of a “follow a batch” walkthrough, where our batch reaches the introducer.</p>
<p>All three use fixed geometry. In-memory segments, file segments and files go into fixed slots, so nothing reflows or shifts as counts change. Animation would only change fills and states in place.</p>
<h3>Callout grammar</h3>
<ul>
<li><strong>Story callout</strong> (accent color, one at a time): it runs under the highlighted phrase to the edge of the text column, then a diagonal, then a horizontal run into its target.</li>
<li><strong>Chart leaders</strong> (thin and gray, always present): a short horizontal out of the chart, a diagonal, then a horizontal into the thing the chart measures.</li>
</ul>
<h3>A possible “follow a batch” walkthrough</h3>
<ol class="steps">
<li><strong>KV sends a DCP snapshot.</strong> The mutations land in the 20MB flow-control buffer.</li>
<li><strong>The DCP goroutine</strong> calls <code>batch.Index()</code> for each doc into the vbucket’s batch, and hands it off at 200 ops or at the end of the snapshot.</li>
<li><strong>A batch worker</strong> receives it over its capacity-1 channel. It merges in other batches until it has 200 ops or its 100ms ticker fires.</li>
<li><strong>The herder gate.</strong> The batch passes the app herder’s memory check. Today it doesn’t block.</li>
<li><strong>Scorch.Batch()</strong> analyzes the docs on the analysis queue and builds one in-memory segment.</li>
<li><strong>The introducer</strong> makes a new root snapshot with our segment, at epoch N. Our docs are now searchable, and <code>Batch()</code> returns (unsafe_batch).</li>
<li><strong>The persister</strong> naps, then in-memory merges our segment with its neighbors into a zap file, fsyncs it, swaps it into the root, and commits root.bolt.</li>
<li><strong>The merger</strong> later merges that file into a bigger one. Our docs move again, and the old files become garbage.</li>
<li><strong>Cleanup</strong> deletes the old files once no root.bolt snapshot lists them. Our batch is now part of a big, durable segment.</li>
</ol>
<p>The scenarios (slow disk, huge ingest, slow query) would come after this, as separate chapters on the same diagram.</p>
</div>
${sections}
</main></body></html>`;
}

const proposals = [
  {
    id: 'a', title: 'A · The spine',
    summary: 'One vertical pipeline of goroutines, in the order data meets them. Data containers sit inline: the DCP buffer, worker channels, the root snapshot, and the index directory. A dashed line splits memory from disk. Dotted lines on both sides show that the persister’s and merger’s results go back through the introducer.',
    svg: proposalA(),
    pros: [
      'Reads like the code path. Each box is a real goroutine or function, in call order.',
      'Following one batch is a straight walk down the page. Each step’s callout target sits a bit lower than the last.',
      'The memory/disk boundary is explicit, and the herder shows up as a gate across the flow.',
      'The return-to-introducer loops make “one goroutine owns the root” visible.',
    ],
    cons: [
      'It’s tall. Everything fits at 900px, but there’s little room to spare.',
      'The persister and merger sit side by side under the root, so their pacing of each other (watchers, nap breaks) needs extra drawing to show.',
      'Without a time axis, it shows <em>state</em>. Scenarios that are about timing, like naps or slow fsyncs, rely on the charts.',
    ],
  },
  {
    id: 'b', title: 'B · Shelves and movers',
    summary: 'Data at rest is a stack of horizontal “shelves”: unacked DCP bytes, batches in flight, in-memory segments, file segments, the directory, and queries. Goroutines are the “motors” on the conveyors between shelves, each moving data one shelf down.',
    svg: proposalB(),
    pros: [
      'Puts the emphasis on <em>where the data is</em>, which is what most support questions are about: memory growth, file counts, disk usage.',
      'Each goroutine’s job is clear from its position: it moves data from one shelf to the next.',
      'Shelves are wide, fixed rows of slots, which suits counters and fill levels and stays very calm when animated.',
      'Backpressure has a simple visual: an upstream shelf fills while the motor below it is stalled.',
    ],
    cons: [
      'It hides the call structure. Workers, Scorch.Batch() and the analysis queue are folded into one “introducer” conveyor.',
      'The merger doesn’t fit the downward flow, since it moves file segments back into the same shelf.',
      'More abstract, and so further from the code that the readers know.',
    ],
  },
  {
    id: 'c', title: 'C · Rows with time traces',
    summary: 'Still top-down, but each goroutine (and the two big data structures) is a row with a scrolling trace of the last 10 seconds, like a logic analyzer or Go’s execution tracer. A batch’s journey is drawn as a line hopping across rows.',
    svg: proposalC(),
    pros: [
      'The best fit for timing stories: naps, fsync stalls, blocking, and the merger breaking the persister’s nap are all visible as shapes over time.',
      '“Follow a batch” becomes a literal line across rows, like a distributed trace.',
      'Will feel familiar to anyone who has used <code>go tool trace</code>.',
    ],
    cons: [
      'Constant leftward scrolling is motion, even if it’s slow and steady. That’s the opposite of the calm you asked for, unless it advances only per step.',
      'Shows little about the shape of the data: individual segments, files, root.bolt.',
      'The data rows partly duplicate the right-hand charts.',
    ],
  },
];

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'index.html'), page(proposals));
for (const p of proposals) {
  const svg = p.svg.replace('<svg ', `<svg font-family="IBM Plex Sans, system-ui, sans-serif" `)
    .replace('</defs>', `</defs><style>${STYLE}${SVG_STYLE}</style>`);
  writeFileSync(join(OUT, `proposal-${p.id}.svg`), svg);
}
console.log('wrote docs/proposals/index.html and proposal-{a,b,c}.svg');
