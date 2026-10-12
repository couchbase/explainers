// The zap-format explainer's page: the engine's story column, camera,
// callouts, contents and code drawer, with this explainer's diagram.
// There's no simulation: each step's scene comes from its view (see
// sceneAt in story.js), and the scroll blends one step's scene into
// the next. The same rules as the first explainer: the scroll is the
// timeline, and the reader marker never teleports.

import { buildPage } from '../../js/ui/page.js';
import { CodeDrawer } from '../../js/ui/code.js';
import { Toc } from '../../js/ui/toc.js';
import { Camera } from '../../js/ui/camera.js';
import { bindGestures } from '../../js/ui/gestures.js';
import { Overlay } from '../../js/ui/overlay.js';
import { scrollState, scrollYFor } from '../../js/ui/scroll.js';
import { toggleAt } from '../../js/ui/transitions.js';
import { along, ease } from '../../js/ui/util/anim.js';
import { flattenSteps, resolveViews } from '../../js/story/timeline.js';
import { CAMERAS, LIDS, BUBBLES } from './layout.js';
import { FOCI, sceneAt } from './story.js';
import { Diagram } from './diagram.js';

const data = JSON.parse(document.getElementById('bx-data').textContent);
const { narrative } = data;
const steps = flattenSteps(narrative);
const views = resolveViews(steps);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const codeDrawer = new CodeDrawer(document.body, data.snippets);
const page = buildPage(document.getElementById('app'), data, codeDrawer);
const { ui, stepEls } = page;
const diagram = new Diagram(page.svg);
const overlay = new Overlay(page.overlay);
const camera = new Camera({ ...page, reduceMotion });
bindGestures(page.viewport, camera);

// No simulation, so no controls and no charts.
page.layout.style.setProperty('--chrome', '0');
for (const e of [ui.controls, page.chartsCol]) { e.style.visibility = 'hidden'; e.style.opacity = '0'; }
ui.controls.style.display = 'none';

const firstStepOf = narrative.chapters.map((ch) => steps.findIndex((st) => st.chapterId === ch.id));
const toc = new Toc(document.body, narrative.chapters.map((ch, ci) => ({
  ...ch, href: `#${ch.id}--${ch.steps[0].id}`, first: firstStepOf[ci],
})), (ci) => jumpTo(firstStepOf[ci]));

const scenes = views.map((_, i) => sceneAt(views, i));
const ctl = { current: -1, scrolled: false };

function enter(i) {
  if (i === ctl.current) return;
  ctl.current = i;
  const st = steps[i], view = views[i];
  camera.recenter();
  stepEls.forEach((e, j) => e.classList.toggle('active', j === i));
  toc.setCurrent(st.chapterIndex);
  diagram.setView(view.open, view.bubbles);
  const cam = typeof view.camera === 'string' ? CAMERAS[view.camera] : { label: 'detail' };
  ui.crumbText.textContent = cam.label || '';
  ui.crumb.hidden = !cam.label;
  ui.codeBtn.disabled = !(st.code && st.code.length);
  codeDrawer.setDefault(st.code || []);
  if (ctl.scrolled) {
    try { history.replaceState(null, '', `#${stepEls[i].id}`); } catch { /* sandboxed */ }
  }
}

// The reader marker partway (p) from step i-1's focus to step i's.
function readerAt(i, p) {
  const fa = i > 0 && views[i - 1].focus ? FOCI[views[i - 1].focus] : null;
  const fb = views[i].focus ? FOCI[views[i].focus] : null;
  if (!fa && !fb) return null;
  if (!fa) return { p: fb.p, o: ease(p) };
  if (!fb) return { p: fa.p, o: 1 - ease(p) };
  // straight across, or down and then across between lenses
  const pts = fa.p[1] === fb.p[1] || fa.p[0] === fb.p[0] ? [fa.p, fb.p] : [fa.p, [fa.p[0], fb.p[1]], fb.p];
  return { p: along(pts, ease(p)), o: 1 };
}

function drawCallout(i, view, opacity) {
  if (!view.target || window.innerWidth <= 900) return;
  const a = diagram.anchor(view.target);
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
  const { i, p } = scrollState(stepEls, reduceMotion);
  const v = views[i], pv = i > 0 ? views[i - 1] : v;
  const t = ease(p);
  const r = readerAt(i, p);
  diagram.readerAt = r && r.p;
  camera.show(camera.follow(camera.between(i > 0 ? pv.camera : null, v.camera, p), r && r.o > 0.01 ? r.p : null));
  for (const id of Object.keys(LIDS)) diagram.setLid(id, toggleAt(pv.open.has(id), v.open.has(id), p));
  for (const id of Object.keys(BUBBLES)) diagram.setBubble(id, toggleAt(pv.bubbles.has(id), v.bubbles.has(id), p));
  diagram.drawScene(i > 0 ? scenes[i - 1] : scenes[i], scenes[i], p);
  diagram.setReader(r && r.p, r ? r.o : 0);
  overlay.begin();
  if (i > 0 && p < 1) drawCallout(i - 1, pv, 1 - t);
  drawCallout(i, v, i === 0 ? 1 : t);
  overlay.end();
  const target = v.target ? diagram.anchor(v.target) : null;
  diagram.setTarget(target && target.visible && p > 0.6 ? target.p : null);
}

function frame() {
  camera.tick();
  render();
  requestAnimationFrame(frame);
}

ui.zoomIn.addEventListener('click', () => camera.zoomAt(1.3));
ui.zoomOut.addEventListener('click', () => camera.zoomAt(1 / 1.3));
ui.recenter.addEventListener('click', () => camera.recenter());
ui.codeBtn.addEventListener('click', () => codeDrawer.open());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') codeDrawer.close(); });

window.addEventListener('scroll', () => {
  ctl.scrolled = true;
  const { i } = scrollState(stepEls, reduceMotion);
  if (i !== ctl.current) enter(i);
}, { passive: true });

function jumpTo(i) {
  window.scrollTo({ top: scrollYFor(stepEls[i], 1) + 2, behavior: 'instant' });
  ctl.scrolled = true;
  enter(scrollState(stepEls, reduceMotion).i);
}

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
  ctl, steps, views, scenes, enter, jumpTo, diagram, camera, toc,
  scrollState: () => scrollState(stepEls, reduceMotion),
  scrollYFor: (i, p) => scrollYFor(stepEls[i], p),
};
