// Entry point: renders the narrative, runs the simulation, and keeps
// the two in step as the reader scrolls.

import { Viz } from './viz.js';
import { CodeDrawer } from './code.js';
import { KnobsDrawer } from './knobs.js';
import { flattenSteps, modelAtStep, enterStep } from '../story/timeline.js';
import { checkInvariants } from '../sim/invariants.js';
import { fmtMs } from '../sim/model.js';

const data = JSON.parse(document.getElementById('bx-data').textContent);
const { narrative, snippets, sources } = data;
const steps = flattenSteps(narrative);
const debug = /[?&]debug=1/.test(location.search);

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

// ---------------------------------------------------------------
// Page skeleton

const app = document.getElementById('app');
const story = h('main', { class: 'story' });
const stage = h('aside', { class: 'stage', 'aria-label': 'Live simulation' });
app.append(h('div', { class: 'layout' }, stage, story));

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
));

const codeDrawer = new CodeDrawer(document.body, snippets);

const stepEls = [];
let stepIdx = 0;
narrative.chapters.forEach((ch) => {
  story.append(h('h2', { class: 'chapter-title', id: ch.id, text: ch.title }));
  ch.steps.forEach((st) => {
    const idx = stepIdx++;
    const el = h('section', { class: 'step', id: `${ch.id}--${st.id}`, 'data-index': String(idx) });
    el.append(h('div', { html: st.html }));
    if (st.code && st.code.length) {
      const chips = h('div', { class: 'code-chips' });
      st.code.forEach((id) => {
        const sn = snippets[id];
        const fn = sn.title.split(' — ')[0];
        chips.append(h('button', {
          class: 'code-chip', type: 'button', title: sn.title,
          onclick: () => codeDrawer.open(st.code, id),
        }, h('span', { class: 'repo', text: `${sn.repo}/${sn.path.split('/').pop()} · ` }), fn));
      });
      el.append(chips);
    }
    story.append(el);
    stepEls.push(el);
  });
});

// ---------------------------------------------------------------
// Toolbar

const clock = h('span', { class: 'clock' });
const ffNote = h('span', { class: 'ff' });
const playBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', title: 'Pause or resume the simulation (space)' });
const speedSel = h('select', { class: 'btn', id: 'speed', 'aria-label': 'Simulation speed' });
for (const [v, label] of [['auto', 'speed: auto'], ['0.1', '0.1×'], ['0.25', '0.25×'], ['0.5', '0.5×'], ['1', '1×'], ['2', '2×'], ['4', '4×'], ['10', '10×']]) {
  speedSel.append(h('option', { value: v, text: label }));
}
const replayBtn = h('button', { class: 'btn', type: 'button', text: 'Replay step', title: 'Rebuild this step’s simulation from scratch' });
const knobsBtn = h('button', { class: 'btn', type: 'button', text: 'Knobs' });
const codeBtn = h('button', { class: 'btn', type: 'button', text: 'Code' });
stage.append(h('div', { class: 'toolbar' }, clock, ffNote, h('span', { class: 'spacer' }), playBtn, speedSel, replayBtn, codeBtn, knobsBtn));

const viz = new Viz(stage);

// ---------------------------------------------------------------
// Controller: one live model, rebuilt deterministically when needed.

const ctl = {
  model: null,
  current: -1,
  speed: 1,
  playing: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  lastTs: null,
  lastDraw: 0,
};

function stepSpeed(i) {
  for (let j = i; j >= 0; j--) if (steps[j].sim && steps[j].sim.speed !== undefined) return steps[j].sim.speed;
  return 1;
}

function enter(i, { rebuild = false } = {}) {
  if (i === ctl.current && !rebuild) return;
  const st = steps[i];
  const before = ctl.model ? ctl.model.now : 0;
  if (!rebuild && ctl.model && i === ctl.current + 1 && !(st.sim && st.sim.reset)) {
    enterStep(ctl.model, st);
    const jumped = ctl.model.now - before;
    flashFF(jumped > 500 ? `⏩ +${fmtMs(jumped)}` : '');
  } else {
    ctl.model = modelAtStep(narrative, steps, i);
    flashFF(ctl.model.now > 0 ? `⏩ ${fmtMs(ctl.model.now)} simulated` : '');
  }
  ctl.current = i;
  ctl.speed = stepSpeed(i);
  stepEls.forEach((el, j) => el.classList.toggle('active', j === i));
  const view = st.view || {};
  viz.setFocus(view.focus, view.chart);
  codeBtn.disabled = !(st.code && st.code.length);
  codeDrawer.setDefault(st.code || []);
  knobs.attach(ctl.model);
  if (st.sandbox && !knobs.isOpen) { knobs.open(); ctl.autoKnobs = true; }
  if (!st.sandbox && ctl.autoKnobs) { knobs.close(); ctl.autoKnobs = false; }
  // Only after the reader scrolls: setting a fragment while the page is
  // still loading makes Chrome jump to it.
  if (ctl.scrolled) {
    try { history.replaceState(null, '', `#${stepEls[i].id}`); } catch { /* sandboxed frames */ }
  }
  draw(true);
}

let ffTimer = null;
function flashFF(text) {
  ffNote.textContent = text;
  clearTimeout(ffTimer);
  if (text) ffTimer = setTimeout(() => { ffNote.textContent = ''; }, 2500);
}

function effectiveSpeed() {
  return speedSel.value === 'auto' ? ctl.speed : Number(speedSel.value);
}

function draw(force) {
  const m = ctl.model;
  if (!m) return;
  clock.textContent = `t = ${(m.now / 1000).toFixed(1)}s`;
  playBtn.textContent = ctl.playing ? 'Pause' : 'Play';
  playBtn.setAttribute('aria-pressed', ctl.playing ? 'false' : 'true');
  viz.update(m);
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
  if (ts - ctl.lastDraw > 66) {
    ctl.lastDraw = ts;
    draw();
  }
  requestAnimationFrame(frame);
}

playBtn.addEventListener('click', () => { ctl.playing = !ctl.playing; draw(true); });
replayBtn.addEventListener('click', () => enter(ctl.current, { rebuild: true }));
codeBtn.addEventListener('click', () => codeDrawer.open());
knobsBtn.addEventListener('click', () => {
  ctl.autoKnobs = false;
  if (knobs.isOpen) knobs.close(); else knobs.open();
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); ctl.playing = !ctl.playing; draw(true); }
  if (e.key === 'Escape') { codeDrawer.close(); knobs.close(); }
});

const knobs = new KnobsDrawer(document.body, data, {
  onReset: () => enter(ctl.current, { rebuild: true }),
});

// ---------------------------------------------------------------
// Scroll tracking: the active step is the one under a trigger line.

function triggerY() {
  return window.innerWidth <= 900 ? window.innerHeight * 0.8 : window.innerHeight * 0.55;
}

function activeIndex() {
  const y = triggerY();
  let best = 0;
  for (let i = 0; i < stepEls.length; i++) {
    if (stepEls[i].getBoundingClientRect().top <= y) best = i;
    else break;
  }
  return best;
}

let scrollPending = false;
window.addEventListener('scroll', () => {
  ctl.scrolled = true;
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    enter(activeIndex());
  });
}, { passive: true });

// Deep links: #chapter--step
const hash = decodeURIComponent(location.hash.slice(1));
const target = hash && document.getElementById(hash);
if (target && target.classList.contains('step')) {
  target.scrollIntoView();
  enter(Number(target.dataset.index));
} else {
  enter(activeIndex());
}
requestAnimationFrame(frame);

// Exposed for tests and the curious.
window.bleveExplainer = { ctl, steps, enter };
