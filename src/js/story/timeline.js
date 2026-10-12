// Turns a narrative's per-step directives into simulator state and
// view state. Shared by the UI and the tests, so "what you see at step
// N" is deterministic and testable no matter how the reader got there.
//
// Simulation, for the steps from the most recent `sim.reset` up to N:
//   - reset: a fresh Model (seed + base config + reset overrides);
//   - each step: fast-forward to its minTimeMs (sim time since the
//     reset), apply `set`, `query` and `follow`, then run event by event
//     `until` the followed batch reaches the named stage.
//
// View, folded from the first step up to N: the camera, the set of open
// lids, the shown detail bubbles, the UI mode (minimal or full chrome)
// and how to place our batch's marker. A step only states what changes.

import { makeModel, TRACE_STAGES, EXPECTATIONS, EXPECTATION_PARAMS, VIEW_KEYS } from '../domain.js';

// The engine's own UI modes: minimal chrome, or full (charts, controls).
export const UI_MODES = ['minimal', 'full'];

// A `- stop: <note>` entry in the chapter list: the page ends there
// (chapters after it are drafts), though they're still validated and
// simulated by the tests.
export const isStop = (ch) => !!ch && typeof ch === 'object' && 'stop' in ch;
export const shownChapters = (narrative) => {
  const k = narrative.chapters.findIndex(isStop);
  return k < 0 ? narrative.chapters : narrative.chapters.slice(0, k);
};

export function flattenSteps(narrative) {
  const out = [];
  narrative.chapters.forEach((ch, ci) => {
    if (isStop(ch)) return;
    ch.steps.forEach((st, si) => out.push({ ...st, chapterId: ch.id, chapterIndex: ci, indexInChapter: si, color: ch.color }));
  });
  return out;
}

function resetIndexFor(steps, i) {
  for (let j = i; j >= 0; j--) if (steps[j].sim && steps[j].sim.reset) return j;
  throw new Error(`no reset at or before step ${i}`);
}

function newModelFor(narrative, step) {
  const base = narrative.sim || {};
  const r = step.sim.reset === true ? {} : step.sim.reset;
  const config = { ...(base.config || {}), ...(r.config || {}) };
  const seed = r.seed ?? base.seed ?? 1;
  return makeModel({ seed, config });
}

const UNTIL_MAX_MS = 180000;

// Runs the model one event at a time until pred() holds (or a cap).
function advanceUntil(model, pred, maxMs = UNTIL_MAX_MS) {
  const end = model.now + maxMs;
  const k = model.k;
  while (!pred() && model.now < end) {
    if (k.runUntil(end, 1) === 0) break;
  }
  return pred();
}

// Applies a step's sim directives to a model whose clock started at the
// last reset. Returns the model.
export function enterStep(model, step) {
  const sim = step.sim || {};
  const target = sim.minTimeMs || 0;
  if (model.now < target) model.advance(target - model.now);
  if (sim.set) model.set(sim.set);
  if (sim.query) model.startQuery(sim.query);
  if (sim.follow) model.follow(sim.follow);
  if (sim.set || sim.query || sim.follow) model.advance(0); // let just-spawned processes start
  if (sim.until) {
    if (!advanceUntil(model, () => model.reached(sim.until))) {
      model.log('trace', `(our batch didn't reach "${sim.until}" in time)`);
    }
  }
  return model;
}

// Builds the model state for step i from scratch.
export function modelAtStep(narrative, steps, i) {
  const j = resetIndexFor(steps, i);
  const model = newModelFor(narrative, steps[j]);
  for (let s = j; s <= i; s++) enterStep(model, steps[s]);
  return model;
}

// Playback speed in effect at step i (0 means paused).
export function speedAt(steps, i) {
  for (let j = i; j >= 0; j--) if (steps[j].sim && steps[j].sim.speed !== undefined) return steps[j].sim.speed;
  return 1;
}

// Folds view directives into the full view state for every step.
export function resolveViews(steps) {
  let camera = 'overview';
  let open = new Set();
  let bubbles = new Set();
  let ui = 'minimal';
  let token = 'auto';
  // The explainer's own view directives (VIEW_KEYS): sticky ones carry
  // over; the others hold for their step only.
  const sticky = {};
  for (const [k, d] of Object.entries(VIEW_KEYS)) if (d.sticky) sticky[k] = d.initial ?? null;
  return steps.map((st) => {
    const v = st.view || {};
    if (v.camera !== undefined) camera = v.camera;
    if (v.open || v.close) {
      open = new Set(open);
      for (const id of v.open || []) open.add(id);
      for (const id of v.close || []) open.delete(id);
    }
    if (v.bubble || v.unbubble) {
      bubbles = new Set(bubbles);
      for (const id of v.bubble || []) bubbles.add(id);
      for (const id of v.unbubble || []) bubbles.delete(id);
    }
    if (v.ui !== undefined) ui = v.ui;
    if (v.token !== undefined) token = v.token;
    const own = {};
    for (const [k, d] of Object.entries(VIEW_KEYS)) {
      if (d.sticky) { if (v[k] !== undefined) sticky[k] = v[k]; own[k] = sticky[k]; } else own[k] = v[k] ?? null;
    }
    return { camera, open, bubbles, ui, token, ...own, target: v.target || null, chart: v.chart || null };
  });
}

const SIM_CHANGES = ['reset', 'set', 'query', 'follow', 'until', 'minTimeMs'];
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const sameCamera = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What changes from step i-1 to step i: camera, lids, bubbles, UI, sim.
export function changesAt(steps, views, i) {
  if (i === 0) return [];
  const out = [];
  if (!sameCamera(views[i - 1].camera, views[i].camera)) out.push('camera');
  if (!sameSet(views[i - 1].open, views[i].open)) out.push('lids');
  if (!sameSet(views[i - 1].bubbles, views[i].bubbles)) out.push('bubbles');
  if (views[i - 1].ui !== views[i].ui) out.push('ui');
  // The explainer's sticky keys, when their change counts.
  for (const [k, d] of Object.entries(VIEW_KEYS)) {
    if (d.sticky && d.counts && views[i - 1][k] !== views[i][k] && d.counts(views[i - 1], views[i])) out.push(k);
  }
  const simChanges = steps[i].sim && SIM_CHANGES.some((k) => steps[i].sim[k] !== undefined);
  if (simChanges) out.push('simulation');
  // A phase told step by step (a `run`): its first step may be the
  // simulation's change, shown one phase at a time; each later phase
  // is the step's change.
  else {
    for (const [k, d] of Object.entries(VIEW_KEYS)) {
      if (d.run && views[i][k] && views[i][k] !== views[i - 1][k]) { out.push(k); break; }
    }
  }
  return out;
}

// Whether expectation `name` holds for model m: "reached:<stage>", an
// explainer's EXPECTATIONS, or its "<name>:<arg>" EXPECTATION_PARAMS.
export function checkExpectation(name, m) {
  if (name.startsWith('reached:')) return m.reached(name.slice(8));
  const [k, arg] = splitParam(name);
  return arg !== undefined ? EXPECTATION_PARAMS[k].check(m, arg) : EXPECTATIONS[name](m);
}

export function isKnownExpectation(name) {
  if (name.startsWith('reached:')) return TRACE_STAGES.includes(name.slice(8));
  const [k, arg] = splitParam(name);
  return arg !== undefined ? !!EXPECTATION_PARAMS[k] && EXPECTATION_PARAMS[k].valid(arg) : name in EXPECTATIONS;
}

function splitParam(name) {
  const c = name.indexOf(':');
  return c < 0 ? [name, undefined] : [name.slice(0, c), name.slice(c + 1)];
}

export { TRACE_STAGES };
