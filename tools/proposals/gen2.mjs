// Second round of design sketches: proposal A on a larger, zoomable
// canvas, with arrows vs. vertical Sankey flows, stacked worker panels,
// and an interactive "camera" demo. Writes docs/proposals/v2.html.
//
//   node tools/proposals/gen2.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  esc, rect, text, line, path, node, stack, rounded, memCells, fileSlots, diskGrid,
  DEFS, TOKENS, SVG_STYLE,
} from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'docs/proposals');
const CW = 900, CH = 1220; // canvas size

const DISK_KINDS = [...Array(9).fill('file'), ...Array(15).fill('garbage'), 'new', 'new', 'zombie'];
const FILE_SIZES = [180, 160, 120, 60, 40, 22, 20, 18, 9];
const FILE_DELS = [0.25, 0.1, 0.4, 0, 0.15, 0, 0, 0, 0];

// Named anchor points (canvas coords) that callouts and leaders aim at.
const T = {
  buffer: [340, 127], bufferR: [560, 127],
  workers: [340, 318],
  gate: [110, 380], gateR: [790, 380],
  introducer: [320, 548],
  rootR: [820, 695], memSegs: [80, 700],
  persister: [120, 858],
  merger: [540, 858],
  disk: [80, 1070], diskR: [820, 1070],
};

function flows(variant) {
  let s = '';
  const arrow = (pts, cls = 'flow', marker = 'arrow') => path(rounded(pts), cls, `marker-end="url(#${marker})"`);
  if (variant === 'arrows') {
    s += arrow([[450, 92], [450, 118]]) + arrow([[450, 132], [450, 158]]);
    s += arrow([[450, 212], [450, 236]]) + arrow([[450, 250], [450, 286]]);
    s += arrow([[450, 346], [450, 410]]);
    s += arrow([[450, 464], [450, 518]]) + arrow([[450, 576], [450, 618]]);
    s += arrow([[240, 770], [240, 828]]) + arrow([[240, 886], [240, 968]]);
    s += arrow([[660, 770], [660, 828]]) + arrow([[660, 886], [660, 968]]);
    s += arrow([[120, 858], [56, 858], [56, 548], [318, 548]], 'flow-up', 'arrow-up');
    s += arrow([[780, 858], [846, 858], [846, 548], [582, 548]], 'flow-up', 'arrow-up');
    s += text(68, 612, 'introduce ↑', 'z-small') + text(836, 612, 'introduce ↑', 'z-small', 'end');
    s += text(250, 932, 'zap + fsync', 'z-small') + text(670, 932, 'zap + fsync', 'z-small');
  } else {
    // Ribbon width ~ documents per second (8k docs/s -> 14px).
    const ribbon = (pts, w, cls) => path(rounded(pts, 30), cls, `stroke-width="${w}"`);
    s += ribbon([[450, 70], [450, 596], [240, 596], [240, 660]], 14, 'ribbon-mem');
    s += ribbon([[240, 760], [240, 850]], 14, 'ribbon-mem');
    s += ribbon([[130, 858], [56, 858], [56, 540], [330, 540]], 14, 'ribbon-file');
    s += ribbon([[560, 560], [660, 560], [660, 660]], 14 + 35, 'ribbon-file');
    s += ribbon([[660, 760], [660, 850]], 35, 'ribbon-file');
    s += ribbon([[770, 858], [846, 858], [846, 552], [570, 552]], 35, 'ribbon-file');
    // bytes to disk (MB/s): thinner, gray
    s += ribbon([[240, 880], [240, 1000]], 6, 'ribbon-bytes') + ribbon([[660, 880], [660, 1000]], 16, 'ribbon-bytes');
    s += text(462, 496, '8k docs/s', 'ribbon-label');
    s += text(68, 612, '8k docs/s ↑', 'ribbon-label') + text(836, 612, '20k docs/s ↑', 'ribbon-label', 'end');
    s += text(252, 930, '5.6 MB/s', 'ribbon-label') + text(674, 930, '14 MB/s', 'ribbon-label');
  }
  return s;
}

function diagram(variant) {
  let s = rect(0, 0, CW, CH, 'canvas', 0) + flows(variant);
  s += node(340, 40, 220, 52, 'KV engine', 'DCP producer · 8k docs/s', 'busy');
  s += text(330, 131, 'flow control', 'z-small', 'end');
  s += rect(340, 122, 220, 10, 'gauge') + rect(340, 122, 34, 10, 'gauge-fill', 2);
  s += text(570, 131, '3.1 of 20MB', 'z-small');
  s += node(340, 160, 220, 52, 'DCP goroutine', 'batch.Index() per vbucket', 'wait');
  s += rect(444, 238, 12, 12, 'slot-full', 2) + text(466, 248, 'cap-1 channel per worker', 'z-small');
  s += stack(340, 290, 220, 56, 4, 'batch worker 0', '≤200 ops or 100ms', 'busy', { badge: '×4' });
  s += line(110, 380, 790, 380, 'gate');
  s += text(790, 397, 'app herder: blocks here when memory > indexing quota', 'z-small', 'end');
  s += node(340, 412, 220, 52, 'Scorch.Batch()', 'analyze → in-memory segment', 'wait');
  s += line(560, 438, 590, 438, 'flow');
  s += rect(590, 412, 180, 52, 'zone', 5) + text(602, 430, 'analysis queue', 'z-in');
  for (let i = 0; i < 8; i++) s += rect(602 + i * 20, 440, 14, 14, i < 3 ? 'cpu-busy' : 'slot', 2);
  s += node(320, 520, 260, 56, 'introducer', 'the one goroutine that swaps root', 'busy', 'focus');
  s += rect(600, 582, 150, 24, 'query', 12) + text(675, 598, 'q7 pins epoch 1,031', 'b-label', 'middle');
  s += line(675, 606, 675, 620, 'pin');
  s += rect(80, 620, 740, 150, 'zone strong', 6);
  s += text(96, 642, 'root snapshot · epoch 1,042', 'z-title');
  s += text(96, 662, 'in-memory segments', 'z-in') + text(470, 662, 'file segments (mmapped zap)', 'z-in');
  s += memCells(96, 672, 22, 5, 38, { ours: 37 });
  s += fileSlots(470, 674, 14, 18, 80, FILE_SIZES, FILE_DELS);
  s += stack(120, 830, 240, 56, 4, 'persister', 'nap 2s · in-mem merge → zap', 'sleep', { badge: '×4' });
  s += node(540, 830, 240, 56, 'merger', 'tiered plan · file segs only', 'busy');
  s += line(30, 945, 870, 945, 'boundary');
  s += text(34, 938, 'MEMORY', 'z-boundary') + text(34, 960, 'DISK', 'z-boundary');
  s += rect(80, 970, 740, 210, 'zone', 6);
  s += text(96, 992, 'index directory', 'z-title');
  s += diskGrid(96, 1004, 28, 8, DISK_KINDS);
  s += text(560, 992, 'root.bolt', 'z-title');
  s += rect(560, 1004, 240, 26, 'bolt latest') + text(570, 1021, 'epoch 1,040 · latest', 'b-label');
  s += rect(560, 1036, 240, 26, 'bolt') + text(570, 1053, 'epoch 1,012', 'b-label');
  s += rect(560, 1068, 240, 26, 'bolt protected') + text(570, 1085, 'epoch 640 · rollback point', 'b-label');
  s += text(96, 1162, 'removeOldData() (the persister, when idle) deletes files no root.bolt snapshot lists', 'z-in');
  return s;
}

// Each inline SVG gets its own marker/pattern ids: a duplicate id can
// resolve to a copy inside a hidden SVG, whose markers don't render.
let svgCount = 0;
const svg = (variant, cls = '') => {
  const p = `s${svgCount++}-`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" class="canvas-svg ${cls}">${DEFS}${diagram(variant)}</svg>`
    .replace(/id="(arrow-up|arrow|hatch)"/g, `id="${p}$1"`)
    .replace(/url\(#(arrow-up|arrow|hatch)\)/g, `url(#${p}$1)`);
};

// Steps for the camera demo: the phrase in [brackets] carries the callout.
const STEPS = [
  { cam: [0, 0, CW, CH], target: 'introducer', title: 'The whole pipeline',
    text: 'Data flows down, from KV at the top to files at the bottom. Only the persister and the merger send results back up, to [the introducer].' },
  { cam: [250, 20, 650, 300], target: 'buffer', title: '1 · KV sends a DCP snapshot',
    text: 'Our 200 mutations arrive over DCP and sit in the [flow-control buffer] until cbft acks them.' },
  { cam: [250, 140, 650, 420], target: 'workers', title: '2 · Into a batch worker',
    text: 'The DCP goroutine hands our batch to [worker 0] over its capacity-1 channel. Three more workers sit behind it.' },
  { cam: [60, 280, 840, 520], target: 'gate', title: '3 · The herder gate',
    text: 'Before Scorch.Batch() runs, the [app herder] checks memory against the indexing quota.' },
  { cam: [60, 440, 840, 790], target: 'introducer', title: '4 · The introducer',
    text: 'Our docs become an in-memory segment, and [the introducer] swaps in a new root at epoch 1,042.' },
  { cam: [20, 600, 600, 980], target: 'persister', title: '5 · The persister',
    text: 'Later, [the persister] merges our segment into a zap file, and sends it back up to be swapped in.' },
  { cam: [300, 600, 880, 980], target: 'merger', title: '6 · The merger',
    text: 'Later still, [the merger] folds that file into a bigger one. Our docs get rewritten again.' },
  { cam: [40, 900, 860, 1200], target: 'disk', title: '7 · Cleanup',
    text: 'Old files linger in the [index directory] until no root.bolt snapshot lists them.' },
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

const PAGE_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.6 var(--font-body); }
main { max-width: 1480px; margin: 0 auto; padding-inline: 16px; padding-block: 2rem 4rem; }
.intro { max-width: 72ch; }
h1 { font: 600 2.2rem/1.1 var(--font-display); margin: 0 0 0.75rem; }
h2 { font: 600 1.5rem/1.2 var(--font-display); margin: 3rem 0 0.5rem; }
h3 { font: 600 0.95rem/1.3 var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 1.25rem 0 0.25rem; }
code { font-family: var(--font-mono); font-size: 0.9em; }
ul { padding-left: 1.2em; } li { margin-bottom: 0.3em; }

.demo { position: relative; display: grid; grid-template-columns: minmax(0, 330px) minmax(0, 1fr) minmax(0, 260px); gap: 0 40px;
  height: 760px; border: 1px solid var(--line); border-radius: 6px; padding: 20px 24px; background: var(--bg); }
.steps { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; min-height: 0; }
.step { text-align: left; font: inherit; color: var(--ink); background: none; border: none; padding: 8px 10px; border-radius: 6px; cursor: pointer; opacity: 0.4; }
.step:hover { opacity: 0.7; }
.step.active { opacity: 1; background: var(--panel); }
.step .t { display: block; font: 600 15px/1.3 var(--font-display); margin-bottom: 2px; }
.step .b { font-size: 14px; line-height: 1.5; }
.step .hl { color: var(--accent); font-weight: 600; }
.viewport { position: relative; min-width: 0; border: 1px solid var(--faint); border-radius: 6px; overflow: hidden; background: var(--bg); }
.viewport svg { width: 100%; height: 100%; }
.viewport svg[hidden] { display: none; }
.charts { display: flex; flex-direction: column; gap: 22px; padding-top: 30px; }
.chart { font: 500 12px var(--font-mono); color: var(--muted); transition: opacity 0.3s; }
.chart .head { display: flex; justify-content: space-between; }
.chart .head b { color: var(--ink); font-weight: 500; }
.spark { width: 100%; height: 60px; display: block; }
.spark-area { fill: color-mix(in srgb, var(--file) 14%, transparent); }
.spark-line { fill: none; stroke: var(--file); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.spark-axis { stroke: var(--line); vector-effect: non-scaling-stroke; }
.overlay { position: absolute; inset: 0; pointer-events: none; width: 100%; height: 100%; }
.leader { fill: none; stroke: var(--muted); stroke-opacity: 0.5; stroke-width: 1; transition: opacity 0.3s; }
.leader-end { fill: var(--muted); }
.controls { display: flex; gap: 8px; margin: 0.75rem 0; flex-wrap: wrap; align-items: center; font: 400 13px var(--font-mono); color: var(--muted); }
.controls button { font: 500 13px var(--font-body); color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.controls button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 24px; }
.pair figure { margin: 0; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; min-width: 0; }
.pair figcaption { font: 600 13px var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding: 8px 12px; border-bottom: 1px solid var(--line); background: var(--panel); }
.pair svg { width: 100%; height: auto; }
@media (max-width: 1000px) { .demo { grid-template-columns: 1fr; height: auto; } .viewport { height: 70vh; } .charts { display: none; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

const DEMO_JS = `
const STEPS = ${JSON.stringify(STEPS)};
const T = ${JSON.stringify(T)};
const CHARTS = ${JSON.stringify(CHARTS)};
const demo = document.querySelector('.demo');
const vp = demo.querySelector('.viewport');
const overlay = demo.querySelector('.overlay');
const stepsEl = demo.querySelector('.steps');
let cur = { x: 0, y: 0, w: ${CW}, h: ${CH} }, active = 0, anim = null;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

STEPS.forEach((st, i) => {
  const b = document.createElement('button');
  b.className = 'step';
  b.innerHTML = '<span class="t"></span><span class="b"></span>';
  b.querySelector('.t').textContent = st.title;
  b.querySelector('.b').innerHTML = st.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\\[(.+?)\\]/, '<span class="hl">$1</span>');
  b.addEventListener('click', () => go(i));
  stepsEl.append(b);
});

function fit([x0, y0, x1, y1]) {
  const r = vp.getBoundingClientRect(), aspect = r.width / r.height;
  // Cap the zoom so text never gets bigger than ~1.3x its overview size.
  let w = Math.max(x1 - x0, 640), h = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function setViewBox(v) {
  cur = v;
  vp.querySelector('svg:not([hidden])').setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
  drawLines();
}

function toScreen([cx, cy]) {
  const r = vp.getBoundingClientRect(), d = demo.getBoundingClientRect();
  const s = Math.min(r.width / cur.w, r.height / cur.h);
  const ox = r.left - d.left + (r.width - cur.w * s) / 2, oy = r.top - d.top + (r.height - cur.h * s) / 2;
  return [ox + (cx - cur.x) * s, oy + (cy - cur.y) * s];
}

function elbow(x0, y0, x1, y1, run) {
  const dir = x1 > x0 ? 1 : -1;
  return 'M' + x0 + ',' + y0 + ' H' + (x0 + dir * run) + ' L' + (x1 - dir * run) + ',' + y1 + ' H' + x1;
}

function drawLines() {
  const d = demo.getBoundingClientRect(), r = vp.getBoundingClientRect();
  const inView = ([sx, sy]) => sx >= r.left - d.left - 1 && sx <= r.right - d.left + 1 && sy >= r.top - d.top && sy <= r.bottom - d.top;
  let out = '';
  // story callout: under the highlighted phrase, to the column edge, then into the target
  const hl = stepsEl.children[active].querySelector('.hl');
  if (hl) {
    const rects = hl.getClientRects(), last = rects[rects.length - 1];
    const x0 = last.left - d.left, y0 = last.bottom - d.top + 2, edge = r.left - d.left - 14;
    const [tx, ty] = toScreen(T[STEPS[active].target]);
    out += '<path class="callout" d="M' + x0 + ',' + y0 + ' H' + edge + ' L' + (tx - 22) + ',' + ty + ' H' + (tx - 3) + '"/>';
    out += '<circle class="callout-end" cx="' + (tx - 3) + '" cy="' + ty + '" r="3.5"/>';
  }
  // chart leaders: only for targets currently in view
  demo.querySelectorAll('.chart').forEach((c, i) => {
    const p = toScreen(T[CHARTS[i].target]);
    const show = inView(p);
    c.style.opacity = show ? 1 : 0.35;
    if (!show) return;
    const cr = c.getBoundingClientRect();
    const x0 = cr.left - d.left - 8, y0 = cr.top - d.top + 50;
    out += '<path class="leader" d="' + elbow(x0, y0, p[0] + 4, p[1], 12) + '"/><circle class="leader-end" cx="' + (p[0] + 4) + '" cy="' + p[1] + '" r="2.5"/>';
  });
  overlay.innerHTML = out;
}

function go(i) {
  active = i;
  [...stepsEl.children].forEach((b, j) => b.classList.toggle('active', j === i));
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

document.querySelectorAll('[data-variant]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-variant]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  vp.querySelectorAll('svg').forEach((s) => { s.hidden = s.dataset.v !== b.dataset.variant; });
  setViewBox(cur);
}));
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
<title>Scorch Diagram v2</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@600&display=swap">
<style>${TOKENS}${PAGE_CSS}${SVG_STYLE}</style></head>
<body><main>
<h1>Proposal A, round 2</h1>
<div class="intro">
<p>Proposal A on a larger canvas (900×1220) that the page zooms into, one region per step. Data flows downward. Only the persister and the merger have upward returns into the introducer. The batch workers and persister workers are drawn as stacked panels: worker 0 in front, the others peeking out behind it.</p>
<p><strong>Try it:</strong> click the steps, or press ↓/↑. The single story callout and the chart leaders follow the camera. A chart’s leader hides, and the chart dims, when its target is out of view. Switch between the two flow styles at any step.</p>
</div>
<div class="controls">flows:
  <button type="button" data-variant="arrows" aria-pressed="false">Arrows</button>
  <button type="button" data-variant="sankey" aria-pressed="true">Sankey ribbons (width = docs/s)</button>
</div>
<div class="demo">
  <div class="steps"></div>
  <div class="viewport">${svg('arrows').replace('<svg ', '<svg data-v="arrows" hidden ')}${svg('sankey').replace('<svg ', '<svg data-v="sankey" ')}</div>
  <div class="charts">${CHARTS.map((c, i) => `<div class="chart"><div class="head"><span>${esc(c.title)}</span><b>${esc(c.value)}</b></div>${spark(i)}</div>`).join('')}</div>
  <svg class="overlay" aria-hidden="true"></svg>
</div>

<h2>The two flow styles, whole canvas</h2>
<div class="pair">
  <figure><figcaption>Arrows</figcaption>${svg('arrows')}</figure>
  <figure><figcaption>Sankey ribbons</figcaption>${svg('sankey')}</figure>
</div>

<h2>Notes and open questions</h2>
<div class="intro">
<h3>Sankey: which quantity?</h3>
<p>The ribbons above use <strong>docs/s</strong>, because docs are conserved: the 8k docs/s coming down equals the 8k docs/s the persister sends back up as files. The merger’s ribbon is wider (≈20k docs/s re-merged) because it rewrites the same docs repeatedly, so write amplification shows up as width. Writes to disk are a second, gray kind of ribbon in <strong>MB/s</strong>. Mixing two units is the weak spot. Arrows avoid the question, but they lose the amplification story.</p>
<p>One subtlety: what goes “up” to the introducer is metadata (swap these segments for that one), not bytes. With docs/s as the unit, the ribbon still means something: “these docs now live in a different segment.”</p>
<h3>Stacked workers</h3>
<p>Only worker 0 is fully drawn. When the story needs it (for example, the herder blocking all four, or the CPU-bound ingest), the stack could fan out sideways into four panels, then collapse back afterward.</p>
<h3>Zoom</h3>
<p>Here the camera is driven by the story: each step declares a region of the canvas. We could also let readers pan and zoom freely, with a “recenter” button. The canvas can grow taller as chapters add detail (queries, rollback points), because the camera only ever shows part of it.</p>
</div>
</main>
<script>${DEMO_JS}</script>
</body></html>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'v2.html'), html);
console.log('wrote docs/proposals/v2.html');
