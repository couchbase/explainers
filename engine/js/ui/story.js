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

  const ctl = { current: -1, scrolled: false };
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
    if (ctl.scrolled) {
      try { history.replaceState(null, '', `#${stepEls[i].id}`); } catch { /* sandboxed */ }
    }
  }

  // The story callout for step i's highlighted phrase, if it's in view.
  const anchorOf = hooks.anchor || ((id) => diagram.anchor(id));
  function drawCallout(i, view, opacity) {
    if (!view.target || window.innerWidth <= 900) return;
    const a = anchorOf(view.target, view);
    const hl = stepEls[i].querySelector('.hl');
    if (!a || !a.visible || !hl) return;
    const rects = hl.getClientRects();
    const last = rects[rects.length - 1];
    if (!last || last.bottom < 0 || last.top > window.innerHeight) return;
    const t = camera.toScreen(a.p);
    if (camera.inViewport(t)) overlay.callout(last, page.story.getBoundingClientRect().right + 10, t, opacity);
  }

  function render() {
    if (ctl.current < 0) return;
    const { i, p, u } = scrollState(stepEls, reduceMotion);
    const v = views[i], pv = i > 0 ? views[i - 1] : v;
    const t = ease(p);
    if (hooks.render) hooks.render({ i, p, u, t, v, pv });
    overlay.begin();
    if (i > 0 && p < 1) drawCallout(i - 1, pv, 1 - t);
    drawCallout(i, v, i === 0 ? 1 : t);
    if (hooks.overlay) hooks.overlay(overlay);
    overlay.end();
    const target = v.target ? diagram.anchor(v.target) : null;
    diagram.setTarget(target && target.visible && p > 0.6 ? target.p : null);
  }

  function frame(ts) {
    if (hooks.beforeFrame) hooks.beforeFrame(ts);
    camera.tick();
    render();
    requestAnimationFrame(frame);
  }

  ui.zoomIn.addEventListener('click', () => camera.zoomAt(1.3));
  ui.zoomOut.addEventListener('click', () => camera.zoomAt(1 / 1.3));
  ui.recenter.addEventListener('click', () => camera.recenter());
  ui.codeBtn.addEventListener('click', () => codeDrawer.open());
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (hooks.onKey) hooks.onKey(e);
    if (e.key === 'Escape') {
      codeDrawer.close();
      if (hooks.onEscape) hooks.onEscape();
    }
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
    window.scrollTo(0, scrollYFor(target, 1) + 2);
    enter(scrollState(stepEls, reduceMotion).i);
  }
  try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  land();
  window.addEventListener('load', () => setTimeout(land, 0));
  if (target && window.ResizeObserver) new ResizeObserver(() => land()).observe(page.story);
  enter(scrollState(stepEls, reduceMotion).i);
  requestAnimationFrame(frame);

  // For tests and the curious.
  window.explainer = {
    ctl, steps, views, enter, jumpTo, diagram, camera, toc,
    scrollState: () => scrollState(stepEls, reduceMotion),
    scrollYFor: (i, p) => scrollYFor(stepEls[i], p),
    ...(hooks.expose || {}),
  };
  return story;
}
