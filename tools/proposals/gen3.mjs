// Third round: the arrows spine, organized into sections whose insides
// start hidden under opaque lids and are revealed as the story drills
// down (r2d3-style). Lids cover exactly the area of what they hide, so
// opening one never moves anything. Writes docs/proposals/v3.html.
//
//   node tools/proposals/gen3.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  esc, f, rect, text, line, path, circle, node, stack, rounded, memCells, fileSlots, diskGrid,
  DEFS, TOKENS, SVG_STYLE,
} from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'docs/proposals');
const CW = 900, CH = 1360;

const DISK_KINDS = [...Array(9).fill('file'), ...Array(15).fill('garbage'), 'new', 'new', 'zombie'];
const FILE_SIZES = [180, 160, 120, 60, 40, 22, 20, 18, 9];
const FILE_DELS = [0.25, 0.1, 0.4, 0, 0.15, 0, 0, 0, 0];

const arrow = (pts, cls = 'flow', marker = 'arrow') => path(rounded(pts), cls, `marker-end="url(#${marker})"`);

// A small labeled box used for the drill-down internals.
const mini = (x, y, w, h, label, cls = 'mini') => rect(x, y, w, h, cls, 4) + text(x + 10, y + h / 2 + 4, label, 'mini-text');

// An opaque lid over a region, with a title and a one-line summary.
function lid(id, x, y, w, h, title, sub, { small = false } = {}) {
  const tx = x + 20, ty = small ? y + 30 : y + 50;
  return `<g class="cover" data-cover="${id}">` +
    rect(x, y, w, h, small ? 'lid lid-small' : 'lid', small ? 5 : 8) +
    text(tx, ty, title, small ? 'lid-title-small' : 'lid-title') +
    text(tx, ty + (small ? 22 : 32), sub, small ? 'lid-sub' : 'lid-sub-big') + '</g>';
}

function diagram() {
  let s = rect(0, 0, CW, CH, 'canvas', 0);

  // ---- flows (drawn first; arrows between sections stay visible) ----
  s += arrow([[450, 88], [450, 114]]);
  s += arrow([[450, 128], [450, 184]]);
  s += arrow([[450, 236], [450, 256]]) + arrow([[450, 270], [450, 300]]);
  s += arrow([[450, 356], [450, 464]]);
  s += arrow([[450, 516], [450, 552]]);
  s += arrow([[450, 652], [450, 690]]);
  s += arrow([[240, 840], [240, 884]]) + arrow([[660, 840], [660, 884]]);
  s += arrow([[80, 980], [46, 980], [46, 600], [298, 600]], 'flow-up', 'arrow-up');
  s += arrow([[820, 980], [854, 980], [854, 600], [602, 600]], 'flow-up', 'arrow-up');
  s += text(56, 676, 'introduce ↑', 'z-small') + text(844, 676, 'introduce ↑', 'z-small', 'end');
  s += arrow([[255, 1064], [255, 1138]]) + arrow([[645, 1064], [645, 1138]]);
  s += text(265, 1100, 'zap + fsync', 'z-small') + text(655, 1100, 'zap + fsync', 'z-small');

  // ---- KV ----
  s += node(340, 36, 220, 52, 'KV engine', 'DCP producer · 8k docs/s', 'busy');
  s += text(330, 127, 'flow control', 'z-small', 'end');
  s += rect(340, 118, 220, 10, 'gauge') + rect(340, 118, 34, 10, 'gauge-fill', 2);
  s += text(570, 127, '3.1 of 20MB', 'z-small');

  // ---- cbft ----
  s += node(340, 186, 220, 50, 'DCP goroutine', 'batch.Index() per vbucket', 'wait');
  s += rect(444, 257, 12, 12, 'slot-full', 2) + text(466, 267, 'cap-1 channel per worker', 'z-small');
  s += stack(340, 302, 220, 54, 4, 'batch worker 0', '≤200 ops or 100ms', 'busy', { badge: '×4' });
  s += line(110, 400, 790, 400, 'gate');
  s += text(790, 416, 'app herder: blocks here when memory > indexing quota', 'z-small', 'end');

  // ---- scorch ----
  s += node(340, 466, 220, 50, 'Scorch.Batch()', 'analyze → in-memory segment', 'wait');
  s += line(560, 491, 590, 491, 'flow');
  s += rect(590, 466, 180, 50, 'zone', 5) + text(602, 484, 'analysis queue', 'z-in');
  for (let i = 0; i < 8; i++) s += rect(602 + i * 20, 494, 14, 14, i < 3 ? 'cpu-busy' : 'slot', 2);

  // introducer internals
  s += `<g class="node s-busy">${rect(300, 554, 300, 98, 'box', 5)}${circle(314, 571, 4.5, 'dot')}${text(326, 575, 'introducer', 'n-title')}</g>`;
  s += text(314, 596, 'select {', 'mini-code');
  ['introductions', 'persists', 'merges', 'watchers'].forEach((c, i) => {
    s += rect(314 + i * 70, 604, 64, 20, 'chan', 3) + text(346 + i * 70, 618, c, 'chan-text', 'middle');
  });
  s += text(314, 642, '} → new root: epoch++, then close(applied)', 'mini-code');

  s += rect(620, 662, 150, 22, 'query', 11) + text(695, 677, 'q7 pins epoch 1,031', 'b-label', 'middle');
  s += line(695, 684, 695, 692, 'pin');
  s += rect(80, 692, 740, 148, 'zone strong', 6);
  s += text(96, 714, 'root snapshot · epoch 1,042', 'z-title');
  s += text(96, 734, 'in-memory segments', 'z-in') + text(470, 734, 'file segments (mmapped zap)', 'z-in');
  s += memCells(96, 744, 22, 5, 38, { ours: 37 });
  s += fileSlots(470, 746, 14, 18, 80, FILE_SIZES, FILE_DELS);

  // persister internals
  s += `<g class="node s-sleep">${rect(80, 886, 350, 178, 'box', 6)}${circle(96, 904, 4.5, 'dot')}${text(108, 908, 'persister', 'n-title')}</g>`;
  s += mini(96, 918, 318, 24, '1 · nap ≤2s (skipped while the herder blocks)');
  s += arrow([[255, 942], [255, 950]]);
  s += mini(96, 952, 318, 24, '2 · cut in-memory segs into ~20MB flushables');
  s += arrow([[255, 976], [255, 984]]);
  for (let i = 3; i >= 0; i--) s += rect(96 + i * 6, 986 - i * 4, 318 - 18, 24, i ? 'mini behind' : 'mini', 4);
  s += text(106, 1002, '3 · ×4 workers: merge → write zap → fsync', 'mini-text');
  s += arrow([[255, 1010], [255, 1018]]);
  s += mini(96, 1020, 318, 24, '4 · introduce ↑ · commit root.bolt + fsync');

  // merger internals
  s += `<g class="node s-busy">${rect(470, 886, 350, 178, 'box', 6)}${circle(486, 904, 4.5, 'dot')}${text(498, 908, 'merger', 'n-title')}</g>`;
  s += mini(486, 918, 318, 24, '1 · wait until a newer epoch is persisted');
  s += arrow([[645, 942], [645, 950]]);
  s += mini(486, 952, 318, 24, '2 · mergeplan: tiers & budget, file segs only');
  s += arrow([[645, 976], [645, 984]]);
  s += mini(486, 986, 318, 24, '3 · each task in turn: merge → write → fsync');
  s += arrow([[645, 1010], [645, 1018]]);
  s += mini(486, 1020, 318, 24, '4 · introduce merged segment ↑');

  s += line(20, 1110, 880, 1110, 'boundary');
  s += text(24, 1103, 'MEMORY', 'z-boundary') + text(24, 1125, 'DISK', 'z-boundary');

  // ---- disk ----
  s += rect(80, 1140, 740, 200, 'zone', 6);
  s += text(96, 1162, 'index directory', 'z-title');
  s += diskGrid(96, 1174, 28, 8, DISK_KINDS);
  s += text(560, 1162, 'root.bolt', 'z-title');
  s += rect(560, 1174, 240, 26, 'bolt latest') + text(570, 1191, 'epoch 1,040 · latest', 'b-label');
  s += rect(560, 1206, 240, 26, 'bolt') + text(570, 1223, 'epoch 1,012', 'b-label');
  s += rect(560, 1238, 240, 26, 'bolt protected') + text(570, 1255, 'epoch 640 · rollback point', 'b-label');
  s += text(96, 1324, 'removeOldData() (the persister, when idle) deletes files no root.bolt snapshot lists', 'z-in');

  // ---- lids: nested ones first, so the outer ones sit on top ----
  s += lid('introducer', 300, 554, 300, 98, 'introducer', 'the one goroutine that swaps the root', { small: true });
  s += lid('persister', 80, 886, 350, 178, 'persister', 'makes in-memory segments durable', { small: true });
  s += lid('merger', 470, 886, 350, 178, 'merger', 'compacts file segments', { small: true });
  s += lid('kv', 230, 22, 440, 120, 'KV', 'streams mutations over DCP');
  s += lid('cbft', 90, 160, 720, 270, 'cbft', 'turns DCP mutations into batches');
  s += lid('scorch', 30, 448, 840, 642, 'scorch (bleve)', 'turns batches into searchable, durable segments');
  s += lid('disk', 70, 1132, 760, 216, 'disk', 'zap segment files and root.bolt');
  return s;
}

// Anchors (canvas coords) for callouts and chart leaders. `in` names the
// lid that must be open for the anchor to count as visible.
const T = {
  kvLid: { p: [230, 82] },
  scorchLid: { p: [30, 760] },
  dcp: { p: [340, 211], in: 'cbft' },
  workers: { p: [340, 329], in: 'cbft' },
  gate: { p: [110, 400], in: 'cbft' },
  batch: { p: [340, 491], in: 'scorch' },
  introducer: { p: [300, 580], in: 'scorch' },
  root: { p: [80, 760], in: 'scorch' },
  select: { p: [314, 614], in: 'introducer' },
  persister: { p: [80, 960], in: 'persister' },
  merger: { p: [470, 960], in: 'merger' },
  disk: { p: [80, 1240], in: 'disk' },
  bufferR: { p: [560, 123], in: 'kv' },
  gateR: { p: [790, 400], in: 'cbft' },
  rootR: { p: [820, 766], in: 'scorch' },
  diskR: { p: [820, 1240], in: 'disk' },
};

const SECTIONS = [
  { title: 'The big picture', steps: [
    { cam: [0, 0, CW, CH], open: [], target: 'scorchLid', title: 'Four layers',
      text: 'A cbft index partition has four layers, and data flows top to bottom. For now, treat [scorch] as one black box.' },
    { cam: [0, 0, CW, CH], open: [], target: 'kvLid', title: 'Where data comes from',
      text: 'Mutations start in [KV], which streams them to cbft over DCP.' },
  ] },
  { title: 'Inside cbft', steps: [
    { cam: [150, 10, 750, 430], open: ['kv', 'cbft'], target: 'dcp', title: 'The DCP goroutine',
      text: '[The DCP goroutine] maps each mutation into its vbucket’s batch, on the DCP connection’s own goroutine.' },
    { cam: [150, 140, 750, 440], open: ['kv', 'cbft'], target: 'workers', title: 'Batch workers',
      text: 'Batches go to [4 batch workers], each over a capacity-1 channel.' },
    { cam: [60, 160, 840, 470], open: ['kv', 'cbft'], target: 'gate', title: 'The herder gate',
      text: 'Before a batch may enter scorch, it passes [the app herder]’s memory check.' },
  ] },
  { title: 'Inside scorch', steps: [
    { cam: [100, 430, 800, 700], open: ['kv', 'cbft', 'scorch'], target: 'batch', title: 'Scorch.Batch()',
      text: '[Scorch.Batch()] analyzes the docs and builds one in-memory segment.' },
    { cam: [60, 440, 840, 860], open: ['kv', 'cbft', 'scorch'], target: 'introducer', title: 'One owner of the root',
      text: 'Only [the introducer] may change the root. Batches come in from above; the persister and merger send results up from below.' },
    { cam: [40, 660, 860, 1080], open: ['kv', 'cbft', 'scorch'], target: 'root', title: 'The root snapshot',
      text: '[The root snapshot] is what queries search. The persister and merger work on it in the background. More on them soon.' },
  ] },
  { title: 'Drill down: the introducer', steps: [
    { cam: [150, 520, 750, 700], open: ['kv', 'cbft', 'scorch', 'introducer'], target: 'select', title: 'A select loop',
      text: 'Inside, the introducer is [a select] over four channels. Each message produces a new root and bumps the epoch.' },
  ] },
  { title: 'Drill down: the persister', steps: [
    { cam: [20, 840, 520, 1110], open: ['kv', 'cbft', 'scorch', 'introducer', 'persister'], target: 'persister', title: 'Nap, merge, write, commit',
      text: '[The persister] naps, cuts flushables, merges them with 4 workers, then introduces the files and commits root.bolt.' },
  ] },
  { title: 'Drill down: the merger', steps: [
    { cam: [380, 840, 880, 1110], open: ['kv', 'cbft', 'scorch', 'introducer', 'persister', 'merger'], target: 'merger', title: 'Plan, merge, introduce',
      text: '[The merger] waits for the persister, plans tiered merges over file segments, and runs them one at a time.' },
  ] },
  { title: 'Down to disk', steps: [
    { cam: [40, 1080, 860, 1360], open: ['kv', 'cbft', 'scorch', 'introducer', 'persister', 'merger', 'disk'], target: 'disk', title: 'Files and root.bolt',
      text: 'Files stay in [the index directory] until no root.bolt snapshot lists them.' },
    { cam: [0, 0, CW, CH], open: ['kv', 'cbft', 'scorch', 'introducer', 'persister', 'merger', 'disk'], target: 'root', title: 'Everything at once',
      text: 'With every lid open, here’s the whole machine. The scenarios that follow (slow disk, huge ingest, slow query) all play out on this diagram, around [the root snapshot].' },
  ] },
];

const CHARTS = [
  { title: 'DCP unacked', value: '3.1MB / 20MB', target: 'bufferR' },
  { title: 'memory · quota', value: '212MB / 665MB', target: 'gateR' },
  { title: 'segments in root', value: '38 mem · 9 file', target: 'rootR' },
  { title: 'files on disk', value: '27 · 162MB', target: 'diskR' },
];

function spark(i) {
  const pts = [];
  for (let k = 0; k < 40; k++) {
    const t = k / 39;
    const v = [0.15 + 0.05 * Math.sin(t * 9), 0.3 + 0.05 * Math.sin(t * 5), 0.35 + 0.25 * ((t * 7) % 1), 0.3 + 0.25 * t][i];
    pts.push(`${k ? 'L' : 'M'}${(t * 240).toFixed(1)},${(56 - v * 56).toFixed(1)}`);
  }
  const d = pts.join('');
  return `<svg viewBox="0 0 240 60" class="spark"><path d="${d}L240,56L0,56Z" class="spark-area"/><path d="${d}" class="spark-line"/><line x1="0" x2="240" y1="56" y2="56" class="spark-axis"/></svg>`;
}

const EXTRA_SVG_CSS = `
.lid { fill: color-mix(in srgb, var(--ink) 6%, var(--panel)); stroke: color-mix(in srgb, var(--ink) 30%, var(--line)); stroke-width: 1.2; }
.lid-small { fill: color-mix(in srgb, var(--ink) 4%, var(--panel)); }
.lid-title { font: 600 36px var(--font-display); fill: var(--ink); }
.lid-title-small { font: 600 18px var(--font-display); fill: var(--ink); }
.lid-sub { font: 400 13px var(--font-body); fill: var(--muted); }
.lid-sub-big { font: 400 19px var(--font-body); fill: var(--muted); }
.cover { transition: opacity 0.7s ease, transform 0.7s ease; transform-box: fill-box; }
.cover.open { opacity: 0; transform: translateY(-14px); pointer-events: none; }
.mini { fill: var(--bg); stroke: var(--line); }
.mini.behind { fill: var(--panel); stroke: var(--faint); }
.mini-text { font: 400 11px var(--font-mono); fill: var(--ink); }
.mini-code { font: 400 11px var(--font-mono); fill: var(--muted); }
.chan { fill: var(--bg); stroke: var(--line); }
.chan-text { font: 400 9.5px var(--font-mono); fill: var(--ink); }
`;

const PAGE_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.6 var(--font-body); }
main { max-width: 1480px; margin: 0 auto; padding-inline: 16px; padding-block: 2rem 4rem; }
.intro { max-width: 72ch; }
h1 { font: 600 2.2rem/1.1 var(--font-display); margin: 0 0 0.75rem; }
h2 { font: 600 1.5rem/1.2 var(--font-display); margin: 3rem 0 0.5rem; }
code { font-family: var(--font-mono); font-size: 0.9em; }
ul { padding-left: 1.2em; } li { margin-bottom: 0.3em; }
.demo { position: relative; display: grid; grid-template-columns: minmax(0, 330px) minmax(0, 1fr) minmax(0, 260px); gap: 0 40px;
  height: 780px; border: 1px solid var(--line); border-radius: 6px; padding: 20px 24px; background: var(--bg); margin-top: 1rem; }
.steps { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; min-height: 0; padding-right: 4px; }
.section { font: 600 12px var(--font-display); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 14px 10px 2px; }
.section:first-child { margin-top: 0; }
.section.current { color: var(--accent); }
.step { text-align: left; font: inherit; color: var(--ink); background: none; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; opacity: 0.4; }
.step:hover { opacity: 0.7; }
.step.active { opacity: 1; background: var(--panel); }
.step .t { display: block; font: 600 15px/1.3 var(--font-display); margin-bottom: 2px; }
.step .b { font-size: 14px; line-height: 1.5; }
.step.active .hl { color: var(--accent); font-weight: 600; }
.viewport { position: relative; min-width: 0; border: 1px solid var(--faint); border-radius: 6px; overflow: hidden; background: var(--bg); }
.viewport svg { width: 100%; height: 100%; }
.charts { display: flex; flex-direction: column; gap: 22px; padding-top: 30px; }
.chart { font: 500 12px var(--font-mono); color: var(--muted); transition: opacity 0.4s; }
.chart .head { display: flex; justify-content: space-between; }
.chart .head b { color: var(--ink); font-weight: 500; }
.spark { width: 100%; height: 60px; display: block; }
.spark-area { fill: color-mix(in srgb, var(--file) 14%, transparent); }
.spark-line { fill: none; stroke: var(--file); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.spark-axis { stroke: var(--line); vector-effect: non-scaling-stroke; }
.overlay { position: absolute; inset: 0; pointer-events: none; width: 100%; height: 100%; }
.leader { fill: none; stroke: var(--muted); stroke-opacity: 0.5; stroke-width: 1; }
.leader-end { fill: var(--muted); }
@media (max-width: 1000px) { .demo { grid-template-columns: 1fr; height: auto; } .viewport { height: 70vh; } .charts { display: none; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

const STEPS = SECTIONS.flatMap((sec, si) => sec.steps.map((st) => ({ ...st, section: si })));

const DEMO_JS = `
const STEPS = ${JSON.stringify(STEPS)};
const SECTIONS = ${JSON.stringify(SECTIONS.map((s) => s.title))};
const T = ${JSON.stringify(T)};
const CHARTS = ${JSON.stringify(CHARTS)};
const demo = document.querySelector('.demo');
const vp = demo.querySelector('.viewport');
const svg = vp.querySelector('svg');
const overlay = demo.querySelector('.overlay');
const stepsEl = demo.querySelector('.steps');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let cur = { x: 0, y: 0, w: ${CW}, h: ${CH} }, active = 0, anim = null, openSet = new Set();
const stepBtns = [], secEls = [];

STEPS.forEach((st, i) => {
  if (i === 0 || STEPS[i - 1].section !== st.section) {
    const h = document.createElement('div');
    h.className = 'section';
    h.textContent = SECTIONS[st.section];
    secEls[st.section] = h;
    stepsEl.append(h);
  }
  const b = document.createElement('button');
  b.className = 'step';
  b.innerHTML = '<span class="t"></span><span class="b"></span>';
  b.querySelector('.t').textContent = st.title;
  b.querySelector('.b').innerHTML = st.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\\[(.+?)\\]/, '<span class="hl">$1</span>');
  b.addEventListener('click', () => go(i));
  stepsEl.append(b);
  stepBtns.push(b);
});

function fit([x0, y0, x1, y1]) {
  const r = vp.getBoundingClientRect(), aspect = r.width / r.height;
  let w = Math.max(x1 - x0, 600), h = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
function setViewBox(v) { cur = v; svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h); drawLines(); }
function toScreen([cx, cy]) {
  const r = vp.getBoundingClientRect(), d = demo.getBoundingClientRect();
  const s = Math.min(r.width / cur.w, r.height / cur.h);
  const ox = r.left - d.left + (r.width - cur.w * s) / 2, oy = r.top - d.top + (r.height - cur.h * s) / 2;
  return [ox + (cx - cur.x) * s, oy + (cy - cur.y) * s];
}
const visible = (a) => !a.in || openSet.has(a.in);
function drawLines() {
  const d = demo.getBoundingClientRect(), r = vp.getBoundingClientRect();
  const inView = ([sx, sy]) => sx >= r.left - d.left - 1 && sx <= r.right - d.left + 1 && sy >= r.top - d.top && sy <= r.bottom - d.top;
  let out = '';
  const hl = stepBtns[active].querySelector('.hl');
  if (hl) {
    const rects = hl.getClientRects(), last = rects[rects.length - 1];
    const x0 = last.left - d.left, y0 = last.bottom - d.top + 2, edge = r.left - d.left - 14;
    const [tx, ty] = toScreen(T[STEPS[active].target].p);
    out += '<path class="callout" d="M' + x0 + ',' + y0 + ' H' + edge + ' L' + (tx - 22) + ',' + ty + ' H' + (tx - 3) + '"/>';
    out += '<circle class="callout-end" cx="' + (tx - 3) + '" cy="' + ty + '" r="3.5"/>';
  }
  demo.querySelectorAll('.chart').forEach((c, i) => {
    const a = T[CHARTS[i].target], p = toScreen(a.p);
    const show = visible(a) && inView(p);
    c.style.opacity = show ? 1 : 0.3;
    if (!show) return;
    const cr = c.getBoundingClientRect();
    const x0 = cr.left - d.left - 8, y0 = cr.top - d.top + 50, x1 = p[0] + 4;
    out += '<path class="leader" d="M' + x0 + ',' + y0 + ' H' + (x0 - 12) + ' L' + (x1 + 12) + ',' + p[1] + ' H' + x1 + '"/><circle class="leader-end" cx="' + x1 + '" cy="' + p[1] + '" r="2.5"/>';
  });
  overlay.innerHTML = out;
}
function go(i) {
  active = i;
  stepBtns.forEach((b, j) => b.classList.toggle('active', j === i));
  secEls.forEach((h, j) => h && h.classList.toggle('current', j === STEPS[i].section));
  stepBtns[i].scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  openSet = new Set(STEPS[i].open);
  svg.querySelectorAll('.cover').forEach((c) => c.classList.toggle('open', openSet.has(c.dataset.cover)));
  const from = { ...cur }, to = fit(STEPS[i].cam), t0 = performance.now(), dur = reduce ? 0 : 900;
  cancelAnimationFrame(anim);
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const tick = (now) => {
    const t = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(t);
    setViewBox({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
    if (t < 1) anim = requestAnimationFrame(tick);
  };
  anim = requestAnimationFrame(tick);
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); go(Math.min(STEPS.length - 1, active + 1)); }
  if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); go(Math.max(0, active - 1)); }
});
addEventListener('resize', () => setViewBox(fit(STEPS[active].cam)));
setViewBox(fit(STEPS[0].cam));
go(0);
`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Scorch Diagram v3</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@600&display=swap">
<style>${TOKENS}${PAGE_CSS}${SVG_STYLE}${EXTRA_SVG_CSS}</style></head>
<body><main>
<h1>Proposal A, round 3: sections and lids</h1>
<div class="intro">
<p>This is the arrows spine, split into sections. Each section starts under an opaque lid that shows only its name and job. Lids open as the story reaches them: first KV and cbft, then scorch as a whole, then (nested inside scorch) the introducer, the persister and the merger, and finally the disk. Each lid covers exactly the area of what it hides, so opening one never moves anything. The arrows between sections stay visible, so even closed boxes show data flowing through them.</p>
<p><strong>Try it:</strong> click the steps, or press ↓/↑. Section headings in the story column mark where a new lid opens. A chart dims and drops its leader line while what it measures is still under a lid, or out of view.</p>
</div>
<div class="demo">
  <div class="steps"></div>
  <div class="viewport"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" class="canvas-svg">${DEFS}${diagram()}</svg></div>
  <div class="charts">${CHARTS.map((c, i) => `<div class="chart"><div class="head"><span>${esc(c.title)}</span><b>${esc(c.value)}</b></div>${spark(i)}</div>`).join('')}</div>
  <svg class="overlay" aria-hidden="true"></svg>
</div>
<h2>Notes</h2>
<div class="intro">
<ul>
<li><strong>Lids vs. growing boxes.</strong> Lids keep geometry fixed, which you asked for. The cost is that the closed overview has big, mostly empty boxes. The other way is to grow boxes as they open, like an accordion. That reads as more “zooming in,” but it shifts everything below.</li>
<li><strong>Drill-down depth.</strong> Two levels here: sections (KV, cbft, scorch, disk) and the scorch triplet. A third level could open the persister’s step 3 into its four workers, or the merger’s step 2 into the actual tier staircase.</li>
<li><strong>Re-closing.</strong> Scrolling back up closes lids again, so each step always looks the same however you got there. The scenario chapters would start with everything open.</li>
<li><strong>Simulation.</strong> When a lid is closed, its box could still show a summary state, such as a busy dot or a “blocked” tint, so the black box stays alive while its insides are hidden.</li>
</ul>
</div>
</main>
<script>${DEMO_JS}</script>
</body></html>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'v3.html'), html);
console.log('wrote docs/proposals/v3.html');
