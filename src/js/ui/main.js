// Entry point: builds the page, runs the simulation, and ties the
// diagram to the scroll position.
//
// The design rule: the reader's scroll is the timeline. Each step has a
// transition zone at the start of its scroll range, where everything
// visual interpolates from the previous step's view to this one's: the
// camera, lids, bubbles, the UI chrome, the callout lines, the marker
// for "our batch", the goroutine boxes, and the slot grids. Scrolling
// back plays it all in reverse; nothing teleports. Only when the reader
// presses Play does the simulation's own clock drive things.

import { Diagram } from './diagram.js';
import { CAMERAS, LIDS, BUBBLES, ANCHORS, isAnchorVisible } from './layout.js';
import { CodeDrawer } from './code.js';
import { KnobsDrawer } from './knobs.js';
import { ChartsPanel } from './charts.js';
import { buildPage } from './page.js';
import { Toc } from './toc.js';
import { Camera } from './camera.js';
import { bindGestures } from './gestures.js';
import { Overlay } from './overlay.js';
import { scrollState, scrollYFor } from './scroll.js';
import { markerFrame, swapMarker, boxFrames, toggleAt } from './transitions.js';
import { SWAP_PHASES } from './snapstack.js';
import { clamp01, ease, lerp } from './util/anim.js';
import { flattenSteps, modelAtStep, enterStep, resolveViews, speedAt } from '../story/timeline.js';
import { checkInvariants } from '../sim/invariants.js';

const data = JSON.parse(document.getElementById('bx-data').textContent);
const { narrative } = data;
const steps = flattenSteps(narrative);
const views = resolveViews(steps);
const debug = /[?&]debug=1/.test(location.search);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const codeDrawer = new CodeDrawer(document.body, data.snippets);
const page = buildPage(document.getElementById('app'), data, codeDrawer);
const { ui, stepEls } = page;
const diagram = new Diagram(page.svg);
const charts = new ChartsPanel(page.chartsCol);
const overlay = new Overlay(page.overlay);
const camera = new Camera({ ...page, reduceMotion });
bindGestures(page.viewport, camera);

// Contents: jump straight to a chapter's first step, settled.
const firstStepOf = narrative.chapters.map((ch) => steps.findIndex((st) => st.chapterId === ch.id));
const toc = new Toc(document.body, narrative.chapters.map((ch, ci) => ({
  ...ch, href: `#${ch.id}--${ch.steps[0].id}`, first: firstStepOf[ci],
})), (ci) => jumpTo(firstStepOf[ci]));

// ---------------------------------------------------------------
// Simulation state, per step

const ctl = {
  model: null, current: -1, speed: 0, playing: false,
  lastTs: null, lastSim: 0, dirty: true, scrolled: false, autoKnobs: false, blending: false,
  // What the diagram showed at each visited step, for transitions:
  tokenAt: new Map(), // the batch marker's place
  stateAt: new Map(), // the goroutine boxes' states
  slotsAt: new Map(), // the slot grids' contents
};

const knobs = new KnobsDrawer(document.body, data, { onReset: () => enter(ctl.current, { rebuild: true }) });

function enter(i, { rebuild = false } = {}) {
  if (i === ctl.current && !rebuild) return;
  const st = steps[i], view = views[i];
  const forward = !rebuild && ctl.model && i === ctl.current + 1 && !(st.sim && st.sim.reset);
  if (forward) enterStep(ctl.model, st);
  else ctl.model = modelAtStep(narrative, steps, i);
  ctl.current = i;
  ctl.speed = speedAt(steps, i);
  ctl.playing = ctl.speed > 0 && !reduceMotion;
  camera.recenter();
  stepEls.forEach((el, j) => el.classList.toggle('active', j === i));
  toc.setCurrent(st.chapterIndex);

  diagram.setView(view.open, view.bubbles);
  diagram.live = ctl.playing;
  // A root swap told over several steps starts from the step before
  // it, so that one's needed too (e.g. after a deep link).
  const base = swapBase(i);
  if (base !== null && !ctl.slotsAt.has(base)) record(base, modelAtStep(narrative, steps, base));
  record(i, ctl.model);
  // The boxes stay as they were until the new root is swapped in.
  if (base !== null && SWAP_PHASES.indexOf(view.swap) < SOLID) ctl.stateAt.set(i, ctl.stateAt.get(base));

  const cam = typeof view.camera === 'string' ? CAMERAS[view.camera] : { label: 'detail', section: null };
  ui.crumbDot.className = `crumb-dot sec-${cam.section || 'neutral'}`;
  ui.crumbText.textContent = cam.label || '';
  ui.crumb.hidden = !cam.label;
  charts.emphasize(view.chart);
  ui.codeBtn.disabled = !(st.code && st.code.length);
  codeDrawer.setDefault(st.code || []);
  knobs.attach(ctl.model);
  if (st.sandbox && !knobs.isOpen) { knobs.open(); ctl.autoKnobs = true; }
  if (!st.sandbox && ctl.autoKnobs) { knobs.close(); ctl.autoKnobs = false; }
  if (ctl.scrolled) {
    try { history.replaceState(null, '', `#${stepEls[i].id}`); } catch { /* sandboxed */ }
  }
  ctl.dirty = true;
}

// What the diagram shows at step i, for transitions.
function record(i, m) {
  diagram.update(m);
  ctl.tokenAt.set(i, diagram.tokenTarget(m, views[i].token));
  ctl.stateAt.set(i, diagram.nodeStates);
  ctl.slotsAt.set(i, diagram.captureSlots());
}

// ---------------------------------------------------------------
// Root swaps (see SWAP_PHASES): told over several steps (`swap: <phase>`
// on each), or played within one step's scroll whenever the root changes.

const SOLID = SWAP_PHASES.indexOf('solid');
const phaseNum = (v) => (v.swap ? SWAP_PHASES.indexOf(v.swap) + 1 : 0);

// The step before the told swap that step i is part of, or null.
function swapBase(i) {
  if (!views[i].swap) return null;
  let j = i;
  while (j > 0 && views[j - 1].swap) j--;
  return j - 1;
}

// The swap shown at step i, progress p (t = ease(p)): {A, B, base, s},
// with s from 0 to SWAP_PHASES.length; or null.
function swapAt(i, p, t) {
  const base = swapBase(i);
  if (base !== null) {
    const A = ctl.slotsAt.get(base), B = ctl.slotsAt.get(i);
    if (!A || !B) return null;
    // In the step where the new root goes solid, it does so in the
    // first half; the boxes catch up in the second (see boxProgress).
    const tt = crossesSolid(i) ? clamp01(t / 0.5) : t;
    return { A, B, base, s: lerp(phaseNum(views[i - 1]), phaseNum(views[i]), tt) };
  }
  const A = ctl.slotsAt.get(i - 1), B = ctl.slotsAt.get(i);
  if (p < 1 && Diagram.isSwap(A, B)) return { A, B, base: i - 1, s: SWAP_PHASES.length * clamp01((t - 0.1) / 0.8) };
  return null;
}
const crossesSolid = (i) => !!views[i].swap && phaseNum(views[i - 1]) <= SOLID && phaseNum(views[i]) > SOLID;
const boxProgress = (i, p) => (crossesSolid(i) ? clamp01((p - 0.5) / 0.5) : p);

function effectiveSpeed() {
  if (ui.speedSel.value !== 'auto') return Number(ui.speedSel.value);
  return ctl.speed > 0 ? ctl.speed : 0.25;
}

// ---------------------------------------------------------------
// One frame of the view for the current scroll position

// The story callout for step i's highlighted phrase, if it's in view.
function drawCallout(i, view, opacity) {
  if (!view.target || window.innerWidth <= 900) return;
  const a = ANCHORS[view.target]
    ? { ...diagram.anchor(view.target), visible: isAnchorVisible(view.target, view.open, view.bubbles) }
    : diagram.anchor(view.target);
  const hl = stepEls[i].querySelector('.hl');
  if (!a || !a.visible || !hl) return;
  const rects = hl.getClientRects();
  const last = rects[rects.length - 1];
  if (!last || last.bottom < 0 || last.top > window.innerHeight) return;
  const t = camera.toScreen(a.p);
  if (camera.inViewport(t)) overlay.callout(last, page.story.getBoundingClientRect().right + 10, t, opacity);
}

let lastChrome = -1;
function setChrome(chrome) {
  if (chrome === lastChrome) return;
  lastChrome = chrome;
  // The charts column takes no room until shown.
  page.layout.style.setProperty('--chrome', chrome.toFixed(4));
  for (const el of [ui.controls, page.chartsCol]) {
    el.style.opacity = chrome.toFixed(3);
    el.style.visibility = chrome < 0.02 ? 'hidden' : '';
  }
  // On phones the toolbar wraps, so hidden controls would leave an empty row.
  ui.controls.style.display = chrome < 0.02 && window.innerWidth <= 900 ? 'none' : '';
  ui.zoomHint.style.opacity = (1 - chrome).toFixed(3);
  ui.zoomHint.style.visibility = chrome > 0.98 ? 'hidden' : '';
}

function render() {
  if (ctl.current < 0) return;
  const { i, p } = scrollState(stepEls, reduceMotion);
  const v = views[i], pv = i > 0 ? views[i - 1] : v;
  const t = ease(p);

  setChrome(toggleAt(pv.ui === 'full', v.ui === 'full', p));

  // While the root is swapped, the marker waits for its turn.
  const swap = ctl.playing ? null : swapAt(i, p, t);
  const mf = (swap && swapMarker(views, ctl.tokenAt, i, swap.base, swap.s)) || markerFrame(views, ctl.tokenAt, i, p);
  const markerPt = mf && mf.t && mf.o > 0.01 ? mf.t.p : null;
  camera.show(camera.follow(camera.between(i > 0 ? pv.camera : null, v.camera, p), markerPt));

  for (const id of Object.keys(LIDS)) diagram.setLid(id, toggleAt(pv.open.has(id), v.open.has(id), p));
  for (const id of Object.keys(BUBBLES)) diagram.setBubble(id, toggleAt(pv.bubbles.has(id), v.bubbles.has(id), p));
  if (pv.bubbles.has('merger') || v.bubbles.has('merger')) diagram.setStairs(pv.plan, v.plan, t);
  diagram.setToken(mf && mf.t, mf ? mf.o : 0);
  diagram.setDocs(mf && mf.birth !== undefined ? mf.birth : -1, mf && mf.t);
  diagram.setQueueDocs(v.flow === 'analysis' && p < 1 ? t : -1);
  // Our segment's slot stays faint until the marker arrives.
  diagram.setArrival(mf && mf.dest, mf && mf.dest && !mf.arrived ? 0 : 1);

  // Who owns time: the clock while the simulation plays, otherwise the scroll.
  if (ctl.playing) {
    diagram.liveNodes(diagram.nodeStates, performance.now(), 450);
  } else {
    diagram.scrubNodes(boxFrames(ctl.stateAt, Diagram.NODE_ORDER, i, boxProgress(i, p), diagram.nodeStates));
    const sa = ctl.slotsAt.get(i - 1), sb = ctl.slotsAt.get(i);
    if (swap) {
      diagram.drawSwap(swap.A, swap.B, swap.s);
      ctl.blending = true;
    } else if (sa && sb && p < 1) {
      diagram.blendSlots(sa, sb, clamp01((t - 0.1) / 0.8));
      ctl.blending = true;
    } else if (ctl.blending && sb) {
      diagram.blendSlots(sb, sb, 1);
      ctl.blending = false;
    }
  }

  overlay.begin();
  if (i > 0 && p < 1) drawCallout(i - 1, pv, 1 - t);
  drawCallout(i, v, i === 0 ? 1 : t);
  charts.drawLeaders(overlay, diagram, camera, lastChrome);
  overlay.end();
  const target = v.target ? diagram.anchor(v.target) : null;
  diagram.setTarget(target && target.visible && p > 0.6 ? target.p : null);
}

function drawSim() {
  const m = ctl.model;
  if (!m) return;
  ui.clock.textContent = `t = ${(m.now / 1000).toFixed(2)}s`;
  ui.playBtn.textContent = ctl.playing ? 'Pause' : 'Play';
  diagram.live = ctl.playing;
  diagram.update(m);
  if (ctl.playing) {
    ctl.tokenAt.set(ctl.current, diagram.tokenTarget(m, views[ctl.current].token));
    ctl.stateAt.set(ctl.current, diagram.nodeStates);
  }
  if (lastChrome > 0.02) charts.update(m);
  if (debug) {
    const errs = checkInvariants(m);
    if (errs.length) console.error('invariant violations', errs);
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
  camera.tick();
  render();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------
// Controls

ui.zoomIn.addEventListener('click', () => camera.zoomAt(1.3));
ui.zoomOut.addEventListener('click', () => camera.zoomAt(1 / 1.3));
ui.recenter.addEventListener('click', () => camera.recenter());
ui.playBtn.addEventListener('click', () => { ctl.playing = !ctl.playing; ctl.dirty = true; });
ui.replayBtn.addEventListener('click', () => enter(ctl.current, { rebuild: true }));
ui.codeBtn.addEventListener('click', () => codeDrawer.open());
ui.knobsBtn.addEventListener('click', () => { ctl.autoKnobs = false; if (knobs.isOpen) knobs.close(); else knobs.open(); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === ' ' && !e.target.closest('button') && views[ctl.current]?.ui === 'full') {
    e.preventDefault(); ctl.playing = !ctl.playing; ctl.dirty = true;
  }
  if (e.key === 'Escape') { codeDrawer.close(); knobs.close(); }
});

window.addEventListener('scroll', () => {
  ctl.scrolled = true;
  const { i } = scrollState(stepEls, reduceMotion);
  if (i !== ctl.current) enter(i);
}, { passive: true });

// Jumps (no smooth scroll through everything in between) to step i,
// fully settled.
function jumpTo(i) {
  window.scrollTo({ top: scrollYFor(stepEls[i], 1) + 2, behavior: 'instant' });
  ctl.scrolled = true;
  enter(scrollState(stepEls, reduceMotion).i);
}

// Deep links (#chapter--step) land with the step fully settled. The
// browser scrolls to the fragment itself once the page has loaded, so
// land again then.
const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
function land() {
  if (!target || !target.classList.contains('step')) return;
  window.scrollTo(0, scrollYFor(target, 1) + 2);
  enter(scrollState(stepEls, reduceMotion).i);
}
try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
land();
window.addEventListener('load', () => setTimeout(land, 0));
enter(scrollState(stepEls, reduceMotion).i);
requestAnimationFrame(frame);

// For tests and the curious.
window.bleveExplainer = {
  ctl, steps, views, enter, jumpTo, diagram, camera, toc,
  scrollState: () => scrollState(stepEls, reduceMotion),
  scrollYFor: (i, p) => scrollYFor(stepEls[i], p),
};
