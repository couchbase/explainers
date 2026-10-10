// Entry point: renders the story, runs the simulation, and keeps the
// diagram, camera, lids and callouts in step as the reader scrolls.

import { Diagram } from './diagram.js';
import { CAMERAS, CW, CH } from './layout.js';
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

// ---------------------------------------------------------------
// Page skeleton: story | stage (toolbar + diagram) | charts

const app = document.getElementById('app');
const story = h('main', { class: 'story' });
const stage = h('section', { class: 'stage', 'aria-label': 'Live diagram' });
const chartsCol = h('aside', { class: 'charts', 'aria-label': 'Charts' });
const overlay = document.createElementNS(NS, 'svg');
overlay.setAttribute('class', 'overlay');
overlay.setAttribute('aria-hidden', 'true');
app.append(h('div', { class: 'layout' }, story, stage, chartsCol), overlay);

const shortCommit = (c) => (c || '').slice(0, 12);
story.append(h('header', { class: 'hero' },
  h('div', { class: 'eyebrow', text: 'bleve · scorch · cbft' }),
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
  story.append(h('h2', { class: `chapter-title sec-${ch.color || 'neutral'}`, id: ch.id, text: ch.title }));
  ch.steps.forEach((st) => {
    const i = idx++;
    const el = h('section', { class: `step sec-${ch.color || 'neutral'}`, id: `${ch.id}--${st.id}`, 'data-index': String(i) });
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
// Stage: toolbar + diagram viewport

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
const codeBtn = h('button', { class: 'btn', type: 'button', text: 'Code' });
const knobsBtn = h('button', { class: 'btn', type: 'button', text: 'Knobs' });
stage.append(h('div', { class: 'toolbar' }, crumb, h('span', { class: 'spacer' }), clock, playBtn, speedSel, replayBtn, codeBtn, knobsBtn));
const viewport = h('div', { class: 'viewport' });
const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('class', 'diagram');
svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
svg.setAttribute('role', 'img');
svg.setAttribute('aria-label', 'Diagram of cbft and scorch goroutines, segments and files');
viewport.append(svg);
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
// Controller

const ctl = { model: null, current: -1, speed: 1, playing: true, cam: null, camAnim: 0, animating: false, lastTs: null, lastDraw: 0, scrolled: false, autoKnobs: false };

function fitCamera(name) {
  const c = typeof name === 'string' ? CAMERAS[name].rect : name;
  const r = viewport.getBoundingClientRect();
  const aspect = r.width / Math.max(1, r.height);
  const [x0, y0, x1, y1] = c;
  // Don't zoom in so far that text gets huge (less of a risk on phones).
  let w = Math.max(x1 - x0, r.width < 600 ? 360 : 560), hgt = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (w / hgt > aspect) hgt = w / aspect; else w = hgt * aspect;
  // Keep the view on the canvas rather than showing empty space past it.
  const clamp = (v, size, max) => (size >= max ? (max - size) / 2 : Math.min(Math.max(v, 0), max - size));
  return { x: clamp(cx - w / 2, w, CW), y: clamp(cy - hgt / 2, hgt, CH), w, h: hgt };
}

function setViewBox(v) {
  ctl.cam = v;
  svg.setAttribute('viewBox', `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
}

function moveCamera(name, instant) {
  const to = fitCamera(name);
  cancelAnimationFrame(ctl.camAnim);
  if (!ctl.cam || instant || reduceMotion) { setViewBox(to); ctl.animating = false; return; }
  const from = { ...ctl.cam }, t0 = performance.now(), dur = 1000;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  ctl.animating = true;
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / dur), e = ease(t);
    setViewBox({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
    if (t < 1) ctl.camAnim = requestAnimationFrame(tick); else ctl.animating = false;
  };
  ctl.camAnim = requestAnimationFrame(tick);
}

function enter(i, { rebuild = false } = {}) {
  if (i === ctl.current && !rebuild) return;
  const st = steps[i];
  const prev = ctl.current;
  const forward = !rebuild && ctl.model && i === prev + 1 && !(st.sim && st.sim.reset);
  if (forward) enterStep(ctl.model, st);
  else ctl.model = modelAtStep(narrative, steps, i);
  const view = views[i];
  const camChanged = prev < 0 || JSON.stringify(views[prev].camera) !== JSON.stringify(view.camera);
  ctl.current = i;
  ctl.speed = speedAt(steps, i);
  ctl.playing = ctl.speed > 0 && !reduceMotion;
  stepEls.forEach((el, j) => el.classList.toggle('active', j === i));
  diagram.setView(view.open, view.flipped);
  if (camChanged) moveCamera(view.camera, Math.abs(i - prev) > 1);
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
  draw();
}

function effectiveSpeed() {
  if (speedSel.value !== 'auto') return Number(speedSel.value);
  return ctl.speed > 0 ? ctl.speed : 0.25;
}

function draw() {
  const m = ctl.model;
  if (!m) return;
  clock.textContent = `t = ${(m.now / 1000).toFixed(2)}s`;
  playBtn.textContent = ctl.playing ? 'Pause' : 'Play';
  diagram.update(m);
  updateCharts(m);
  drawOverlay();
  if (debug) {
    const errs = checkInvariants(m);
    if (errs.length) console.error('invariant violations', errs);
  }
}

function updateCharts(m) {
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

// Viewport (fixed) coordinates of a canvas point.
function toScreen([x, y]) {
  const r = viewport.getBoundingClientRect();
  const v = ctl.cam;
  const s = Math.min(r.width / v.w, r.height / v.h);
  const ox = r.left + (r.width - v.w * s) / 2, oy = r.top + (r.height - v.h * s) / 2;
  return [ox + (x - v.x) * s, oy + (y - v.y) * s];
}

function inViewport([sx, sy]) {
  const r = viewport.getBoundingClientRect();
  return sx >= r.left - 1 && sx <= r.right + 1 && sy >= r.top - 1 && sy <= r.bottom + 1;
}

function drawOverlay() {
  if (!ctl.cam || ctl.current < 0) return;
  let out = '';
  const view = views[ctl.current];
  const wide = window.innerWidth > 900;
  // The one story callout: under the highlighted phrase to the column
  // edge, then a diagonal, then horizontally into its target.
  const target = view.target ? diagram.anchor(view.target) : null;
  diagram.setTarget(target && target.visible ? target.p : null);
  const hl = stepEls[ctl.current].querySelector('.hl');
  if (wide && hl && target && target.visible) {
    const [tx, ty] = toScreen(target.p);
    const rects = hl.getClientRects();
    const last = rects[rects.length - 1];
    const edge = story.getBoundingClientRect().right + 10;
    if (last && inViewport([tx, ty]) && last.bottom > 0 && last.top < window.innerHeight) {
      const x0 = last.left, y0 = last.bottom + 2;
      out += `<path class="callout" d="M${x0.toFixed(1)},${y0.toFixed(1)} H${edge.toFixed(1)} L${(tx - 26).toFixed(1)},${ty.toFixed(1)} H${(tx - 4).toFixed(1)}"/>`;
      out += `<circle class="callout-end" cx="${(tx - 4).toFixed(1)}" cy="${ty.toFixed(1)}" r="3.5"/>`;
    }
  }
  // Chart leaders, for charts whose subject is in view.
  const chartsShown = chartsCol.offsetParent !== null;
  for (const c of chartEls) {
    const a = diagram.anchor(c.anchor);
    const p = a && toScreen(a.p);
    const show = chartsShown && a && a.visible && inViewport(p);
    c.el.classList.toggle('dim', !show);
    if (!show) continue;
    const cr = c.el.getBoundingClientRect();
    const x0 = cr.left - 6, y0 = cr.top + 36, x1 = p[0] + 5;
    out += `<path class="leader" d="M${x0.toFixed(1)},${y0.toFixed(1)} H${(x0 - 12).toFixed(1)} L${(x1 + 12).toFixed(1)},${p[1].toFixed(1)} H${x1.toFixed(1)}"/>`;
    out += `<circle class="leader-end" cx="${x1.toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5"/>`;
  }
  overlay.innerHTML = out;
}

function frame(ts) {
  if (ctl.lastTs === null) ctl.lastTs = ts;
  const dt = Math.min(100, ts - ctl.lastTs);
  ctl.lastTs = ts;
  if (ctl.playing && ctl.model) ctl.model.advance(dt * effectiveSpeed());
  if (ts - ctl.lastDraw > 100) {
    ctl.lastDraw = ts;
    draw();
  } else if (ctl.animating) {
    drawOverlay();
  }
  requestAnimationFrame(frame);
}

playBtn.addEventListener('click', () => { ctl.playing = !ctl.playing; draw(); });
replayBtn.addEventListener('click', () => enter(ctl.current, { rebuild: true }));
codeBtn.addEventListener('click', () => codeDrawer.open());
knobsBtn.addEventListener('click', () => { ctl.autoKnobs = false; if (knobs.isOpen) knobs.close(); else knobs.open(); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); ctl.playing = !ctl.playing; draw(); }
  if (e.key === 'Escape') { codeDrawer.close(); knobs.close(); }
});

const knobs = new KnobsDrawer(document.body, data, { onReset: () => enter(ctl.current, { rebuild: true }) });

// ---------------------------------------------------------------
// Scroll tracking: the active step is the last one whose top has
// passed a trigger line.

function triggerY() { return window.innerWidth <= 900 ? window.innerHeight * 0.85 : window.innerHeight * 0.6; }
function activeIndex() {
  const y = triggerY();
  let best = 0;
  for (let i = 0; i < stepEls.length; i++) {
    if (stepEls[i].getBoundingClientRect().top <= y) best = i; else break;
  }
  return best;
}
let scrollPending = false;
window.addEventListener('scroll', () => {
  ctl.scrolled = true;
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => { scrollPending = false; enter(activeIndex()); drawOverlay(); });
}, { passive: true });
window.addEventListener('resize', () => {
  if (ctl.current >= 0) { moveCamera(views[ctl.current].camera, true); drawOverlay(); }
});

const hash = decodeURIComponent(location.hash.slice(1));
const target = hash && document.getElementById(hash);
if (target && target.classList.contains('step')) {
  target.scrollIntoView();
  enter(Number(target.dataset.index));
} else {
  enter(activeIndex());
}
requestAnimationFrame(frame);

window.bleveExplainer = { ctl, steps, views, enter, diagram };
