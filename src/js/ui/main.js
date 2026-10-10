// Entry point: renders the story, runs the simulation, and ties the
// diagram to the scroll position.
//
// Continuity is the main idea here. Each step has a transition zone at
// the start of its scroll range, where everything visual interpolates
// from the previous step's view to this one's: the camera, lids,
// detail bubbles, the UI chrome, the callout lines (one fading out, one
// fading in), and the marker for "our batch", which travels along the
// flow lines from where it was to where it is now. Scrolling back
// plays it all in reverse; nothing teleports.

import { Diagram } from './diagram.js';
import { CAMERAS, CANVAS, LIDS, BUBBLES, ANCHORS, isAnchorVisible } from './layout.js';
import { CodeDrawer } from './code.js';
import { KnobsDrawer } from './knobs.js';
import { sparkline } from './charts.js';
import { flattenSteps, modelAtStep, enterStep, resolveViews, speedAt } from '../story/timeline.js';
import { checkInvariants } from '../sim/invariants.js';
import { fmtBytes } from '../sim/model.js';

const data = JSON.parse(document.getElementById('bx-data').textContent);
const { narrative, snippets, sources } = data;
const steps = flattenSteps(narrative);
const views = resolveViews(steps);
const debug = /[?&]debug=1/.test(location.search);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
};
const NS = 'http://www.w3.org/2000/svg';
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------------------------------------------------------------
// Page skeleton: story | stage (toolbar + diagram) | charts

const app = document.getElementById('app');
const layoutEl = h('div', { class: 'layout' });
const story = h('main', { class: 'story' });
const stage = h('section', { class: 'stage', 'aria-label': 'Diagram' });
const chartsCol = h('aside', { class: 'charts', 'aria-label': 'Charts' });
const overlay = document.createElementNS(NS, 'svg');
overlay.setAttribute('class', 'overlay');
overlay.setAttribute('aria-hidden', 'true');
layoutEl.append(story, stage, chartsCol);
app.append(layoutEl, overlay);

const shortCommit = (c) => (c || '').slice(0, 12);
story.append(h('header', { class: 'hero' },
  h('div', { class: 'eyebrow', text: 'cbft / bleve / scorch' }),
  h('h1', { text: narrative.title }),
  h('div', { class: 'subtitle', html: narrative.subtitleHtml }),
  h('div', { class: 'meta', html:
    `Modeled on bleve <a href="${sources.bleve.github}/tree/${sources.bleve.commit}" target="_blank" rel="noopener">${shortCommit(sources.bleve.commit)}</a>, ` +
    `zapx <a href="${sources.zapx.github}/tree/${sources.zapx.commit}" target="_blank" rel="noopener">${shortCommit(sources.zapx.commit)}</a> and ` +
    `cbft <a href="${sources.cbft.github}/tree/${sources.cbft.commit}" target="_blank" rel="noopener">${shortCommit(sources.cbft.commit)}</a>` +
    ` · built ${data.builtAt}` }),
  h('p', { class: 'scroll-hint', text: 'Scroll to begin ↓' }),
));

const codeDrawer = new CodeDrawer(document.body, snippets);

const stepEls = [];
let idx = 0;
narrative.chapters.forEach((ch) => {
  story.append(h('h2', { class: `chapter-title sec-${ch.color || 'neutral'}`, id: ch.id },
    h('span', { class: 'chapter-dot' }), h('span', { text: ch.title })));
  ch.steps.forEach((st) => {
    const i = idx++;
    const el = h('section', { class: 'step', id: `${ch.id}--${st.id}`, 'data-index': String(i) });
    el.append(h('div', { class: 'step-body', html: st.html }));
    if (st.code && st.code.length) {
      const chips = h('div', { class: 'code-chips' });
      st.code.forEach((id) => {
        const sn = snippets[id];
        chips.append(h('button', {
          class: 'code-chip', type: 'button', title: sn.title,
          onclick: () => codeDrawer.open(st.code, id),
        }, h('span', { class: 'repo', text: `${sn.repo}/${sn.path.split('/').pop()} · ` }), sn.title.split(' — ')[0]));
      });
      el.append(chips);
    }
    story.append(el);
    stepEls.push(el);
  });
});

// ---------------------------------------------------------------
// Stage: toolbar + zoomable diagram viewport

const crumbDot = h('span', { class: 'crumb-dot' });
const crumbText = h('span', { class: 'crumb-text' });
const crumb = h('span', { class: 'crumb', title: 'Where you are in the diagram' }, crumbDot, crumbText);
const clock = h('span', { class: 'clock' });
const playBtn = h('button', { class: 'btn', type: 'button', title: 'Pause or resume the simulation (space)' });
const speedSel = h('select', { class: 'btn', id: 'speed', 'aria-label': 'Simulation speed' });
for (const [v, label] of [['auto', 'speed: auto'], ['0.1', '0.1×'], ['0.25', '0.25×'], ['0.5', '0.5×'], ['1', '1×'], ['2', '2×'], ['4', '4×']]) {
  speedSel.append(h('option', { value: v, text: label }));
}
const replayBtn = h('button', { class: 'btn', type: 'button', text: 'Replay', title: 'Rebuild this step’s simulation from scratch' });
const knobsBtn = h('button', { class: 'btn', type: 'button', text: 'Knobs' });
const controls = h('span', { class: 'controls' }, clock, playBtn, speedSel, replayBtn, knobsBtn);
const codeBtn = h('button', { class: 'btn', type: 'button', text: 'Code' });
const zoomHint = h('span', { class: 'zoom-hint', text: 'drag to pan · ⌘/Ctrl + scroll to zoom' });
// The hint and the controls share one slot and cross-fade.
stage.append(h('div', { class: 'toolbar' }, crumb, h('span', { class: 'spacer' }), h('span', { class: 'tools' }, zoomHint, controls), codeBtn));

const viewport = h('div', { class: 'viewport' });
const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('class', 'diagram');
svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
svg.setAttribute('role', 'img');
svg.setAttribute('aria-label', 'Diagram of cbft and scorch goroutines, segments and files');
viewport.append(svg);
const zoomIn = h('button', { class: 'zbtn', type: 'button', text: '+', 'aria-label': 'Zoom in' });
const zoomOut = h('button', { class: 'zbtn', type: 'button', text: '−', 'aria-label': 'Zoom out' });
const recenter = h('button', { class: 'zbtn', type: 'button', text: '⟲', 'aria-label': 'Recenter on the story', title: 'Recenter on the story' });
viewport.append(h('div', { class: 'zoom' }, zoomIn, zoomOut, recenter));
stage.append(viewport);
const diagram = new Diagram(svg);

// ---------------------------------------------------------------
// Charts with leader lines to what they measure

const CHARTS = [
  { id: 'dcpBuf', title: 'DCP unacked', anchor: 'bufferR', key: 'dcpBuf', fmt: fmtBytes, ref: () => 20 * 1024 * 1024 },
  { id: 'memUsed', title: 'memory vs quota', anchor: 'memGaugeR', key: 'memUsed', fmt: fmtBytes, ref: (s) => s.indexQuota },
  { id: 'segments', title: 'segments in root', anchor: 'rootR', key: (s) => s.memSegs + s.fileSegs, sub: (s) => `${s.memSegs} mem · ${s.fileSegs} file` },
  { id: 'files', title: 'files on disk', anchor: 'diskR', key: 'filesOnDisk', fmt: (v) => `${v}` },
];
const chartEls = CHARTS.map((c) => {
  const val = h('b');
  const plot = h('div', { class: 'plot' });
  const el = h('div', { class: 'chart' }, h('div', { class: 'chart-head' }, h('span', { text: c.title }), val), plot);
  chartsCol.append(el);
  return { ...c, el, val, plot };
});

// ---------------------------------------------------------------
// Simulation state for the active step

const ctl = {
  model: null, current: -1, speed: 0, playing: false,
  lastTs: null, lastSim: 0, dirty: true, scrolled: false, autoKnobs: false,
  tokenAt: new Map(), // step index -> marker target at that step
  user: { dx: 0, dy: 0, z: 1 }, // the reader's own pan/zoom
  relaxUser: false,
};

function enter(i, { rebuild = false } = {}) {
  if (i === ctl.current && !rebuild) return;
  const st = steps[i];
  const prev = ctl.current;
  const forward = !rebuild && ctl.model && i === prev + 1 && !(st.sim && st.sim.reset);
  if (forward) enterStep(ctl.model, st);
  else ctl.model = modelAtStep(narrative, steps, i);
  ctl.current = i;
  ctl.speed = speedAt(steps, i);
  ctl.playing = ctl.speed > 0 && !reduceMotion;
  ctl.relaxUser = true;
  stepEls.forEach((el, j) => el.classList.toggle('active', j === i));
  const view = views[i];
  diagram.setView(view.open, view.bubbles);
  diagram.update(ctl.model);
  ctl.tokenAt.set(i, diagram.tokenTarget(ctl.model, view.token));
  const cam = typeof view.camera === 'string' ? CAMERAS[view.camera] : { label: 'detail', section: null };
  crumbDot.className = `crumb-dot sec-${cam.section || 'neutral'}`;
  crumbText.textContent = cam.label;
  chartEls.forEach((c) => c.el.classList.toggle('emph', c.id === view.chart));
  codeBtn.disabled = !(st.code && st.code.length);
  codeDrawer.setDefault(st.code || []);
  knobs.attach(ctl.model);
  if (st.sandbox && !knobs.isOpen) { knobs.open(); ctl.autoKnobs = true; }
  if (!st.sandbox && ctl.autoKnobs) { knobs.close(); ctl.autoKnobs = false; }
  if (ctl.scrolled) {
    try { history.replaceState(null, '', `#${stepEls[i].id}`); } catch { /* sandboxed */ }
  }
  ctl.dirty = true;
}

function effectiveSpeed() {
  if (speedSel.value !== 'auto') return Number(speedSel.value);
  return ctl.speed > 0 ? ctl.speed : 0.25;
}

// ---------------------------------------------------------------
// Scroll position -> (active step, progress through its transition)

function scrollState() {
  const H = window.innerHeight;
  const narrow = window.innerWidth <= 900;
  const enterY = H * (narrow ? 0.92 : 0.82);
  const settleY = H * (narrow ? 0.66 : 0.42);
  let i = 0;
  for (let j = 0; j < stepEls.length; j++) {
    if (stepEls[j].getBoundingClientRect().top <= enterY) i = j; else break;
  }
  const top = stepEls[i].getBoundingClientRect().top;
  const p = i === 0 ? 1 : clamp01((enterY - top) / (enterY - settleY));
  return { i, p: reduceMotion ? 1 : p };
}

// ---------------------------------------------------------------
// Camera: interpolate between steps' regions, plus the reader's pan/zoom

function fitRect(name) {
  const c = typeof name === 'string' ? CAMERAS[name].rect : name;
  const r = viewport.getBoundingClientRect();
  const aspect = r.width / Math.max(1, r.height);
  const [x0, y0, x1, y1] = c;
  let w = Math.max(x1 - x0, r.width < 600 ? 360 : 560), hgt = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (w / hgt > aspect) hgt = w / aspect; else w = hgt * aspect;
  const [X0, Y0, X1, Y1] = CANVAS;
  const fit = (v, size, lo, hi) => (size >= hi - lo ? lo + (hi - lo - size) / 2 : Math.min(Math.max(v, lo), hi - size));
  return { x: fit(cx - w / 2, w, X0, X1), y: fit(cy - hgt / 2, hgt, Y0, Y1), w, h: hgt };
}

function cameraAt(i, p) {
  const b = fitRect(views[i].camera);
  if (i === 0 || p >= 1) return b;
  const a = fitRect(views[i - 1].camera);
  const t = ease(p);
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

// Keeps our batch's marker in view: if the story's camera would leave
// it outside (or too near an edge), shift the camera just enough. The
// marker moves continuously, so this shift does too.
function follow(c, tf) {
  if (!tf || !tf.t || tf.o <= 0.01) return c;
  const [x, y] = tf.t.p;
  const mx = Math.min(80, c.w * 0.12), my = Math.min(70, c.h * 0.1);
  let dx = 0, dy = 0;
  if (x < c.x + mx) dx = x - (c.x + mx);
  else if (x > c.x + c.w - mx) dx = x - (c.x + c.w - mx);
  if (y < c.y + my) dy = y - (c.y + my);
  else if (y > c.y + c.h - my) dy = y - (c.y + c.h - my);
  return { ...c, x: c.x + dx, y: c.y + dy };
}

// The reader's zoom (z) and pan (dx, dy, canvas units) on top of the story's camera.
function applyUser(c) {
  const u = ctl.user;
  const w = c.w / u.z, hh = c.h / u.z;
  return { x: c.x + (c.w - w) / 2 + u.dx, y: c.y + (c.h - hh) / 2 + u.dy, w, h: hh };
}

let cam = null;
function setCamera(c) {
  cam = c;
  svg.setAttribute('viewBox', `${c.x.toFixed(2)} ${c.y.toFixed(2)} ${c.w.toFixed(2)} ${c.h.toFixed(2)}`);
}

function screenScale() {
  const r = viewport.getBoundingClientRect();
  const s = Math.min(r.width / cam.w, r.height / cam.h);
  return { r, s, ox: r.left + (r.width - cam.w * s) / 2, oy: r.top + (r.height - cam.h * s) / 2 };
}

function toScreen([x, y]) {
  const { s, ox, oy } = screenScale();
  return [ox + (x - cam.x) * s, oy + (y - cam.y) * s];
}

function inViewport([sx, sy]) {
  const r = viewport.getBoundingClientRect();
  return sx >= r.left - 1 && sx <= r.right + 1 && sy >= r.top - 1 && sy <= r.bottom + 1;
}

// ---------------------------------------------------------------
// The marker's route between two stations, through the corridors
// between boxes (the same ways the arrows go), so it never cuts across
// a panel. Corridors: x=372 left of the spine, y=490 into bleve, y=590
// above the introducer, y=722 above the root, y=930 between the root
// and the persister/merger, the side gaps x=60 and x=940, x=500
// between the persister and merger, and y=1240 above the disk.

const VIA = {
  'cell>bar': 'persisting', // a segment becomes a file via the persister
  'bar>bar': 'merging', // a file becomes a bigger file via the merger
  'cell>icon': 'bar',
};

const LEGS = {
  'dcp>worker': (a, b) => [a, b],
  'worker>herder': (a, b) => [a, [a[0], b[1]], b],
  'herder>analysis': (a, b) => [a, [a[0], 490], [b[0], 490], b],
  'worker>analysis': (a, b) => [a, [a[0], 490], b],
  'analysis>introducing': (a, b) => [a, [a[0], 590], [b[0], 590], b],
  'introducing>cell': (a, b) => [a, [a[0], 722], [b[0], 722], b],
  'cell>persisting': (a, b) => [a, [b[0], a[1]], b],
  'persisting>bar': (a, b) => [a, [a[0], 930], [b[0], 930], b],
  'bar>merging': (a, b) => [a, [a[0], 930], [b[0], 930], b],
  'merging>bar': (a, b) => [a, [a[0], 930], [b[0], 930], b],
  'bar>icon': (a, b) => [a, [a[0], 930], [500, 930], [500, 1240], [b[0], 1240], b],
};

function leg(a, b) {
  const k = `${a.st}>${b.st}`;
  if (LEGS[k]) return LEGS[k](a.p, b.p);
  const back = `${b.st}>${a.st}`;
  if (LEGS[back]) return LEGS[back](b.p, a.p).reverse();
  return null;
}

function route(a, b) {
  if (a.st === b.st && a.key === b.key) return [a.p, b.p];
  const direct = leg(a, b);
  if (direct) return direct;
  const via = VIA[`${a.st}>${b.st}`] || VIA[`${b.st}>${a.st}`];
  if (via) {
    const mid = { st: via, p: STATIONS[via] || null };
    if (!mid.p && via === 'bar') mid.p = [a.p[0] + 20, 840];
    const x = leg(a, mid), y = leg(mid, b);
    if (x && y) return [...x, ...y.slice(1)];
  }
  // Fallback: vertical first, unless heading into a side gap.
  const [ax, ay] = a.p, [bx, by] = b.p;
  if (Math.abs(ax - bx) < 2 || Math.abs(ay - by) < 2) return [a.p, b.p];
  const outside = (x) => x < 80 || x > 920;
  return outside(bx) ? [a.p, [bx, ay], b.p] : [a.p, [ax, by], b.p];
}

const STATIONS = { persisting: [60, 1067], merging: [940, 1067] };

function along(pts, t) {
  const segs = [];
  let total = 0;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    segs.push(d);
    total += d;
  }
  if (total === 0) return pts[pts.length - 1];
  let want = t * total;
  for (let k = 0; k < segs.length; k++) {
    if (want <= segs[k] || k === segs.length - 1) {
      const f = segs[k] ? Math.min(1, want / segs[k]) : 1;
      return [lerp(pts[k][0], pts[k + 1][0], f), lerp(pts[k][1], pts[k + 1][1], f)];
    }
    want -= segs[k];
  }
  return pts[pts.length - 1];
}

// The marker for step i at progress p: {t: target-ish, o: opacity}.
function tokenFrame(i, p) {
  const cur = views[i].token === 'hide' ? null : ctl.tokenAt.get(i) || null;
  const prev = i > 0 && views[i - 1].token !== 'hide' ? ctl.tokenAt.get(i - 1) || null : null;
  const e = ease(p);
  if (cur && prev) {
    const mid = e > 0.5 ? cur : prev;
    return { t: { p: along(route(prev, cur), e), size: lerp(prev.size, cur.size, e), kind: mid.kind, label: mid.label },
      o: 1, dest: prev.st !== cur.st || prev.key !== cur.key ? cur : null, arrived: e >= 0.97 };
  }
  if (cur) return { t: cur, o: i > 0 && !ctl.tokenAt.has(i - 1) ? 1 : e };
  if (prev) return { t: prev, o: 1 - e };
  return null;
}

// ---------------------------------------------------------------
// Callouts: one per step, fading with the transition

function calloutPath(stepIndex, view, opacity) {
  if (!view.target || opacity <= 0.01 || window.innerWidth <= 900) return '';
  const a = ANCHORS[view.target]
    ? { p: ANCHORS[view.target].p, visible: isAnchorVisible(view.target, view.open, view.bubbles) }
    : diagram.anchor(view.target);
  if (!a || !a.visible) return '';
  const hl = stepEls[stepIndex].querySelector('.hl');
  if (!hl) return '';
  const rects = hl.getClientRects();
  const last = rects[rects.length - 1];
  if (!last || last.bottom < 0 || last.top > window.innerHeight) return '';
  const [tx, ty] = toScreen(a.p);
  if (!inViewport([tx, ty])) return '';
  const edge = story.getBoundingClientRect().right + 10;
  return `<g style="opacity:${opacity.toFixed(3)}"><path class="callout" d="M${last.left.toFixed(1)},${(last.bottom + 2).toFixed(1)} H${edge.toFixed(1)} L${(tx - 26).toFixed(1)},${ty.toFixed(1)} H${(tx - 4).toFixed(1)}"/>` +
    `<circle class="callout-end" cx="${(tx - 4).toFixed(1)}" cy="${ty.toFixed(1)}" r="3.5"/></g>`;
}

// ---------------------------------------------------------------
// Render one frame of the view for the current scroll position

let lastChrome = -1;
function render() {
  if (ctl.current < 0) return;
  const { i, p } = scrollState();
  const v = views[i], pv = i > 0 ? views[i - 1] : v;
  const t = ease(p);

  // UI chrome (controls, charts) fades in only when the story asks;
  // the charts column takes no room until then.
  const chrome = lerp(pv.ui === 'full' ? 1 : 0, v.ui === 'full' ? 1 : 0, t);
  if (chrome !== lastChrome) layoutEl.style.setProperty('--chrome', chrome.toFixed(4));

  const tf = tokenFrame(i, p);
  setCamera(applyUser(follow(cameraAt(i, p), tf)));
  for (const id of Object.keys(LIDS)) diagram.setLid(id, lerp(pv.open.has(id) ? 1 : 0, v.open.has(id) ? 1 : 0, t));
  for (const id of Object.keys(BUBBLES)) diagram.setBubble(id, lerp(pv.bubbles.has(id) ? 1 : 0, v.bubbles.has(id) ? 1 : 0, t));
  diagram.setToken(tf && tf.t, tf ? tf.o : 0);
  // Our segment's slot stays faint until the marker arrives.
  const dest = tf && tf.dest;
  diagram.setArrival(dest || null, dest && !tf.arrived ? 0 : 1);

  if (chrome !== lastChrome) {
    lastChrome = chrome;
    for (const el of [controls, chartsCol]) {
      el.style.opacity = chrome.toFixed(3);
      el.style.visibility = chrome < 0.02 ? 'hidden' : '';
    }
    zoomHint.style.opacity = (1 - chrome).toFixed(3);
    zoomHint.style.visibility = chrome > 0.98 ? 'hidden' : '';
  }

  let out = '';
  if (i > 0 && p < 1) out += calloutPath(i - 1, pv, 1 - t);
  out += calloutPath(i, v, i === 0 ? 1 : t);
  const target = v.target ? diagram.anchor(v.target) : null;
  diagram.setTarget(target && target.visible && p > 0.6 ? target.p : null);

  const chartsShown = chartsCol.offsetParent !== null && chrome > 0.02;
  for (const c of chartEls) {
    const a = diagram.anchor(c.anchor);
    const sp = a && toScreen(a.p);
    const show = chartsShown && a && a.visible && inViewport(sp);
    c.el.classList.toggle('dim', !show);
    if (!show) continue;
    const cr = c.el.getBoundingClientRect();
    const x0 = cr.left - 6, y0 = cr.top + 36, x1 = sp[0] + 5;
    out += `<g style="opacity:${chrome.toFixed(3)}"><path class="leader" d="M${x0.toFixed(1)},${y0.toFixed(1)} H${(x0 - 12).toFixed(1)} L${(x1 + 12).toFixed(1)},${sp[1].toFixed(1)} H${x1.toFixed(1)}"/>` +
      `<circle class="leader-end" cx="${x1.toFixed(1)}" cy="${sp[1].toFixed(1)}" r="2.5"/></g>`;
  }
  overlay.innerHTML = out;
}

function drawSim() {
  const m = ctl.model;
  if (!m) return;
  clock.textContent = `t = ${(m.now / 1000).toFixed(2)}s`;
  playBtn.textContent = ctl.playing ? 'Pause' : 'Play';
  diagram.update(m);
  if (ctl.playing) ctl.tokenAt.set(ctl.current, diagram.tokenTarget(m, views[ctl.current].token));
  updateCharts(m);
  if (debug) {
    const errs = checkInvariants(m);
    if (errs.length) console.error('invariant violations', errs);
  }
}

function updateCharts(m) {
  if (lastChrome <= 0.02) return;
  const series = m.series.filter((p) => p.t >= m.now - 60000);
  if (!series.length) return;
  const last = series[series.length - 1];
  for (const c of chartEls) {
    const val = (p) => (typeof c.key === 'function' ? c.key(p) : p[c.key]);
    const vals = series.map(val);
    c.val.textContent = c.sub ? c.sub(last) : c.fmt(vals[vals.length - 1]);
    c.plot.innerHTML = sparkline(series.map((p) => p.t), vals, { ref: c.ref ? c.ref(last) : null, t0: m.now - 60000, t1: m.now });
  }
}

function frame(ts) {
  if (ctl.lastTs === null) ctl.lastTs = ts;
  const dt = Math.min(100, ts - ctl.lastTs);
  ctl.lastTs = ts;
  if (ctl.playing && ctl.model) ctl.model.advance(dt * effectiveSpeed());
  if (ctl.dirty || (ctl.playing && ts - ctl.lastSim > 100)) {
    ctl.lastSim = ts;
    ctl.dirty = false;
    drawSim();
  }
  if (ctl.relaxUser) {
    // Ease the reader's own pan/zoom back to the story's camera.
    const u = ctl.user;
    const k = reduceMotion ? 0 : 0.85;
    u.dx *= k; u.dy *= k; u.z = 1 + (u.z - 1) * k;
    if (Math.abs(u.dx) < 0.5 && Math.abs(u.dy) < 0.5 && Math.abs(u.z - 1) < 0.002) {
      u.dx = 0; u.dy = 0; u.z = 1; ctl.relaxUser = false;
    }
  }
  render();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------
// The reader's pan and zoom. Plain scrolling always drives the story.

function zoomAt(factor, sx, sy) {
  const u = ctl.user;
  const { r, s, ox, oy } = screenScale();
  const px = sx ?? r.left + r.width / 2, py = sy ?? r.top + r.height / 2;
  const cx = cam.x + (px - ox) / s, cy = cam.y + (py - oy) / s; // canvas point under the cursor
  const fx = (cx - cam.x) / cam.w, fy = (cy - cam.y) / cam.h;
  const bw = cam.w * u.z, bh = cam.h * u.z; // the story camera's size
  const bx = cam.x - (bw - cam.w) / 2 - u.dx, by = cam.y - (bh - cam.h) / 2 - u.dy;
  const z = Math.max(0.5, Math.min(8, u.z * factor));
  const w = bw / z, hh = bh / z;
  u.dx = cx - fx * w - bx - (bw - w) / 2;
  u.dy = cy - fy * hh - by - (bh - hh) / 2;
  u.z = z;
  ctl.relaxUser = false;
}

zoomIn.addEventListener('click', () => zoomAt(1.3));
zoomOut.addEventListener('click', () => zoomAt(1 / 1.3));
recenter.addEventListener('click', () => { ctl.relaxUser = true; });
viewport.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
}, { passive: false });
let drag = null;
viewport.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button')) return;
  drag = { x: e.clientX, y: e.clientY };
  viewport.setPointerCapture(e.pointerId);
  viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { s } = screenScale();
  ctl.user.dx -= (e.clientX - drag.x) / s;
  ctl.user.dy -= (e.clientY - drag.y) / s;
  drag = { x: e.clientX, y: e.clientY };
  ctl.relaxUser = false;
});
const endDrag = () => { drag = null; viewport.classList.remove('dragging'); };
viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------

playBtn.addEventListener('click', () => { ctl.playing = !ctl.playing; ctl.dirty = true; });
replayBtn.addEventListener('click', () => enter(ctl.current, { rebuild: true }));
codeBtn.addEventListener('click', () => codeDrawer.open());
knobsBtn.addEventListener('click', () => { ctl.autoKnobs = false; if (knobs.isOpen) knobs.close(); else knobs.open(); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === ' ' && !e.target.closest('button') && views[ctl.current]?.ui === 'full') {
    e.preventDefault(); ctl.playing = !ctl.playing; ctl.dirty = true;
  }
  if (e.key === 'Escape') { codeDrawer.close(); knobs.close(); }
});

const knobs = new KnobsDrawer(document.body, data, { onReset: () => enter(ctl.current, { rebuild: true }) });

window.addEventListener('scroll', () => {
  ctl.scrolled = true;
  const { i } = scrollState();
  if (i !== ctl.current) enter(i);
}, { passive: true });

// Deep links (#chapter--step) land with the step fully settled, past
// its transition zone. The browser scrolls to the fragment itself once
// the page has loaded, so land again then.
const hash = decodeURIComponent(location.hash.slice(1));
const target = hash && document.getElementById(hash);
function land() {
  if (!target || !target.classList.contains('step')) return;
  const narrow = window.innerWidth <= 900;
  const settleY = window.innerHeight * (narrow ? 0.66 : 0.42);
  window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - settleY + 2);
  enter(scrollState().i);
}
try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
land();
window.addEventListener('load', () => setTimeout(land, 0));
enter(scrollState().i);
requestAnimationFrame(frame);

window.bleveExplainer = { ctl, steps, views, enter, diagram, scrollState };
