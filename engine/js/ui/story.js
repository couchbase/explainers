// A scrollytelling page, run: the story column, camera, callouts,
// contents, code drawer and controls, tied to the scroll. What's
// explainer-specific comes from the hooks that `setup` returns, so an
// explainer's main.js is only its diagram and what moves in it.
//
//   runStory({ simulation, setup: (story) => ({ diagram, ...hooks }) })
//
// `story` (passed to setup, and returned) has the page's parts: data,
// narrative, steps, views, page, ui, stepEls, codeDrawer, camera,
// overlay, toc, reduceMotion, and ctl ({current, scrolled}, which the
// explainer may add to); and enter(i, opts) and jumpTo(i).
//
// The hooks, all optional but `diagram`:
//   diagram          has anchor(id) -> {p, visible}, setTarget(p|null)
//   enter(i, opts)   step i becomes current (ctl.current is still the
//                    previous one); opts.rebuild asks to rebuild it
//   render(s)        one frame for the scroll state s: {i, p, u, t, v,
//                    pv}, t = ease(p); moves the camera (camera.show)
//   anchor(id, view) a callout's end, {p, visible} (default: the
//                    diagram's anchor)
//   overlay(o)       more lines on the overlay, after the callouts
//   beforeFrame(ts)  each animation frame, before the camera and render
//   onKey(e)         a key, outside of form fields
//   onEscape()       Escape: close the explainer's own drawers
//   expose           more for window.explainer (tests, the curious)
//
// The rule it keeps: the reader's scroll is the timeline. Each step's
// transition is its scroll progress p; scrolling back plays it in
// reverse, and deep links land with the step settled.

import { D } from '../domain.js';
import { buildPage } from './page.js';
import { CodeDrawer } from './code.js';
import { Toc } from './toc.js';
import { Camera } from './camera.js';
import { bindGestures } from './gestures.js';
import { Overlay } from './overlay.js';
import { scrollState, scrollYFor } from './scroll.js';
import { ease } from './util/anim.js';
import { flattenSteps, resolveViews } from '../story/timeline.js';

export function runStory({ simulation = false, setup }) {
  const data = JSON.parse(document.getElementById('bx-data').textContent);
  const { narrative } = data;
  const steps = flattenSteps(narrative);
  const views = resolveViews(steps);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const codeDrawer = new CodeDrawer(document.body, data.snippets);
  const page = buildPage(document.getElementById('app'), data, codeDrawer, { simulation });
  const { ui, stepEls } = page;
  const overlay = new Overlay(page.overlay);
  const camera = new Camera({ ...page, reduceMotion });
  bindGestures(page.viewport, camera);

  // Contents: jump straight to a chapter's first step, settled.
  const firstStepOf = narrative.chapters.map((ch) => steps.findIndex((st) => st.chapterId === ch.id));
  const toc = new Toc(document.body, narrative.chapters.map((ch, ci) => ({
    ...ch, href: `#${ch.id}--${ch.steps[0].id}`, first: firstStepOf[ci],
  })), (ci) => jumpTo(firstStepOf[ci]));

  const ctl = { current: -1, scrolled: false, jumping: false };
  const story = {
    data, narrative, steps, views, page, ui, stepEls, codeDrawer, camera, overlay, toc, reduceMotion, ctl,
    enter, jumpTo,
  };
  const hooks = setup(story);
  const { diagram } = hooks;
  story.diagram = diagram;

  function enter(i, opts = {}) {
    if (i === ctl.current && !opts.rebuild) return;
    const st = steps[i], view = views[i];
    if (hooks.enter) hooks.enter(i, opts);
    ctl.current = i;
    camera.recenter();
    stepEls.forEach((el, j) => el.classList.toggle('active', j === i));
    toc.setCurrent(st.chapterIndex);
    const cam = typeof view.camera === 'string' ? D.CAMERAS[view.camera] : { label: 'detail', section: null };
    ui.crumbDot.className = `crumb-dot sec-${cam.section || 'neutral'}`;
    ui.crumbText.textContent = cam.label || '';
    ui.crumb.hidden = !cam.label;
    ui.codeBtn.disabled = !(st.code && st.code.length);
    codeDrawer.setDefault(st.code || []);
    if (ctl.scrolled) syncHash(i);
  }

  // The URL's fragment names the step in view, so a reload or a shared
  // link lands there; back at the very top, it names none, so a reload
  // starts at the top.
  function syncHash(i) {
    const hash = window.scrollY <= 0 ? '' : `#${stepEls[i].id}`;
    if (location.hash === hash) return;
    try { history.replaceState(null, '', `${location.pathname}${location.search}${hash}`); } catch { /* sandboxed */ }
  }
  window.addEventListener('scroll', () => { if (ctl.scrolled && ctl.current >= 0) syncHash(ctl.current); }, { passive: true });

  // The story callout for step i's highlighted phrase, if it's in view.
  const anchorOf = hooks.anchor || ((id) => diagram.anchor(id));
  // (whether it drew one)
  function drawCallout(i, view, opacity) {
    if (!view.target || window.innerWidth <= 900) return false;
    const a = anchorOf(view.target, view);
    const hl = stepEls[i].querySelector('.hl');
    if (!a || !a.visible || !hl) return false;
    const rects = hl.getClientRects();
    const last = rects[rects.length - 1];
    if (!last || last.bottom < 0 || last.top > window.innerHeight) return false;
    const t = camera.toScreen(a.p);
    if (!camera.inViewport(t)) return false;
    overlay.callout(last, page.story.getBoundingClientRect().right + 10, t, opacity);
    return true;
  }

  // The scroll position the page shows: the real one, smoothed, so a
  // big jump (a wheel notch, a flick) plays through what's between,
  // quickly, rather than skipping it. Still the scroll's: it settles
  // where the scroll is, and follows it back. It snaps for jumps (the
  // contents, deep links), and with reduced motion.
  const SMOOTH_MS = 140;
  let shownY = window.scrollY, lastTs = null;
  const shown = () => scrollState(stepEls, reduceMotion, window.scrollY - shownY);
  function snap() { shownY = window.scrollY; }
  function follow(ts) {
    const dt = lastTs === null ? 16 : Math.min(100, ts - lastTs);
    lastTs = ts;
    const d = window.scrollY - shownY;
    if (reduceMotion || Math.abs(d) < 0.5 || Math.abs(d) > 4 * window.innerHeight) shownY = window.scrollY;
    else shownY += d * (1 - Math.exp(-dt / SMOOTH_MS));
  }

  // A card the reader has just scrolled past stays bright while it's
  // still being read: till its bottom rises above this far down the
  // window. (Its callout line fades as the next step's comes, as usual.)
  const READ_LINE = 0.3;
  const reading = new Set();
  function markReading(i) {
    const now = new Set();
    for (let j = Math.max(0, i - 2); j < i; j++) {
      const card = stepEls[j].querySelector('.card') || stepEls[j];
      if (card.getBoundingClientRect().bottom > window.innerHeight * READ_LINE) now.add(j);
    }
    for (const j of reading) if (!now.has(j)) stepEls[j].classList.remove('reading');
    for (const j of now) if (!reading.has(j)) stepEls[j].classList.add('reading');
    reading.clear();
    for (const j of now) reading.add(j);
  }

  function render() {
    if (ctl.current < 0) return;
    const { i, p, u } = shown();
    if (i !== ctl.current) enter(i);
    markReading(i);
    const v = views[i], pv = i > 0 ? views[i - 1] : v;
    const t = ease(p);
    if (hooks.render) hooks.render({ i, p, u, t, v, pv });
    overlay.begin();
    if (i > 0 && p < 1) drawCallout(i - 1, pv, 1 - t);
    const called = drawCallout(i, v, t);
    if (hooks.overlay) hooks.overlay(overlay);
    overlay.end();
    // The target ring, as the step settles (a scrubbing step's, at its
    // end), and with its callout line (except on narrow screens, which
    // have none)
    const target = v.target ? diagram.anchor(v.target) : null;
    const settled = p > (stepEls[i].classList.contains('step-scrub') ? 0.95 : 0.6);
    diagram.setTarget(target && target.visible && settled && (called || window.innerWidth <= 900) ? target.p : null);
  }

  function frame(ts) {
    follow(ts);
    if (hooks.beforeFrame) hooks.beforeFrame(ts);
    camera.tick();
    render();
    requestAnimationFrame(frame);
  }

  ui.zoomIn.addEventListener('click', () => camera.zoomAt(1.3));
  ui.zoomOut.addEventListener('click', () => camera.zoomAt(1 / 1.3));
  ui.recenter.addEventListener('click', () => camera.recenter());
  ui.codeBtn.addEventListener('click', () => (codeDrawer.isOpen ? codeDrawer.close() : codeDrawer.open()));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (hooks.onKey) hooks.onKey(e);
    if (e.key === 'Escape') {
      codeDrawer.close();
      if (hooks.onEscape) hooks.onEscape();
    }
  });

  // (the step changes as the shown scroll position reaches it: see render)
  window.addEventListener('scroll', () => { ctl.scrolled = true; }, { passive: true });

  // Goes to step i, fully settled: a fast scroll (quick even for a long
  // way, so the steps in between flash by), or, for a reader who'd
  // rather not have motion, a jump. Touching the wheel, the screen or a
  // key on the way stops it where it is.
  let jumping = null;
  function jumpTo(i) {
    const to = scrollYFor(stepEls[i], 1) + 2, from = window.scrollY;
    ctl.scrolled = true;
    if (jumping) jumping.stop();
    const land = () => { jumping = null; ctl.jumping = false; snap(); enter(shown().i); };
    if (reduceMotion || Math.abs(to - from) < 2) {
      window.scrollTo({ top: to, behavior: 'instant' });
      return land();
    }
    // (a quarter of a second, and more the farther it goes, to 2/3)
    const ms = Math.min(650, 250 + (Math.abs(to - from) / window.innerHeight) * 25);
    const t0 = performance.now(), ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    let raf = 0;
    const stop = () => { cancelAnimationFrame(raf); for (const ev of STOPS) window.removeEventListener(ev, stop); jumping = null; ctl.jumping = false; };
    const STOPS = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    for (const ev of STOPS) window.addEventListener(ev, stop, { passive: true });
    jumping = { stop };
    ctl.jumping = true;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      window.scrollTo({ top: from + (to - from) * ease(t), behavior: 'instant' });
      if (t < 1) { raf = requestAnimationFrame(step); return; }
      for (const ev of STOPS) window.removeEventListener(ev, stop);
      land();
    };
    raf = requestAnimationFrame(step);
  }

  // Deep links (#chapter--step) land with the step fully settled. The
  // browser scrolls to the fragment itself once the page has loaded,
  // and web fonts arriving reflow the story, so land again whenever the
  // story's size changes, until the reader does something.
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  let interacted = false;
  for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
    window.addEventListener(ev, () => { interacted = true; }, { passive: true, once: true });
  }
  function land() {
    if (!target || !target.classList.contains('step') || interacted) return;
    // (a scrubbing step: past its settling, too, where what follows the
    // sweep, if anything, has played)
    window.scrollTo(0, scrollYFor(target, target.classList.contains('step-scrub') ? 1.5 : 1) + 2);
    snap();
    enter(shown().i);
  }
  try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  land();
  window.addEventListener('load', () => setTimeout(land, 0));
  if (target && window.ResizeObserver) new ResizeObserver(() => land()).observe(page.story);
  snap();
  enter(shown().i);
  requestAnimationFrame(frame);

  // For tests and the curious.
  window.explainer = {
    ctl, steps, views, enter, jumpTo, diagram, camera, toc,
    scrollState: () => scrollState(stepEls, reduceMotion),
    scrollYFor: (i, p) => scrollYFor(stepEls[i], p),
    // (tests: show the scroll position as it is, now)
    snap: () => { snap(); enter(shown().i); },
    ...(hooks.expose || {}),
  };
  return story;
}
