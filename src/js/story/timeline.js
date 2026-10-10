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
// lids, and the set of flipped panels. A step only states what changes.

import { Model } from '../sim/model.js';

// The stages a followed batch goes through, in order (see Model._trace).
export const TRACE_STAGES = ['dcp', 'channel', 'worker', 'herder', 'analysis', 'introducing', 'introduced',
  'persisting', 'file', 'merging', 'merged', 'oldFileDeleted'];

export function flattenSteps(narrative) {
  const out = [];
  narrative.chapters.forEach((ch, ci) => {
    ch.steps.forEach((st, si) => out.push({ ...st, chapterId: ch.id, chapterIndex: ci, indexInChapter: si, color: ch.color }));
  });
  return out;
}

export function resetIndexFor(steps, i) {
  for (let j = i; j >= 0; j--) if (steps[j].sim && steps[j].sim.reset) return j;
  throw new Error(`no reset at or before step ${i}`);
}

export function newModelFor(narrative, step) {
  const base = narrative.sim || {};
  const r = step.sim.reset === true ? {} : step.sim.reset;
  const config = { ...(base.config || {}), ...(r.config || {}) };
  const seed = r.seed ?? base.seed ?? 1;
  return new Model({ seed, config });
}

const UNTIL_MAX_MS = 180000;

// Runs the model one event at a time until pred() holds (or a cap).
export function advanceUntil(model, pred, maxMs = UNTIL_MAX_MS) {
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
  if (sim.follow) model.follow();
  model.advance(0); // let just-spawned processes start
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
  let flipped = new Set();
  return steps.map((st) => {
    const v = st.view || {};
    if (v.camera !== undefined) camera = v.camera;
    if (v.open || v.close) {
      open = new Set(open);
      for (const id of v.open || []) open.add(id);
      for (const id of v.close || []) open.delete(id);
    }
    if (v.flip || v.unflip) {
      flipped = new Set(flipped);
      for (const id of v.flip || []) flipped.add(id);
      for (const id of v.unflip || []) flipped.delete(id);
    }
    return { camera, open, flipped, target: v.target || null, chart: v.chart || null };
  });
}

const SIM_CHANGES = ['reset', 'set', 'query', 'follow', 'until', 'minTimeMs'];
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const sameCamera = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What changes from step i-1 to step i: any of camera, lids, flips, sim.
export function changesAt(steps, views, i) {
  if (i === 0) return [];
  const out = [];
  if (!sameCamera(views[i - 1].camera, views[i].camera)) out.push('camera');
  if (!sameSet(views[i - 1].open, views[i].open)) out.push('lids');
  if (!sameSet(views[i - 1].flipped, views[i].flipped)) out.push('flips');
  if (steps[i].sim && SIM_CHANGES.some((k) => steps[i].sim[k] !== undefined)) out.push('simulation');
  return out;
}

// Named predicates that steps can `expect`, checked by the tests so
// the prose and the simulation can't silently drift apart. Also
// "reached:<stage>" for the followed batch.
export const EXPECTATIONS = {
  herderBlocking: (m) => m.numEventsBlocking > 0,
  herderIdle: (m) => m.numEventsBlocking === 0,
  kvPaused: (m) => m.kvPausedSince !== null,
  kvFlowing: (m) => m.kvPausedSince === null,
  kvHasPaused: (m) => m.dcpPausedMs() > 0,
  overHalfQuota: (m) => m.memUsed() > 0.5 * m.indexQuota(),
  underQuota: (m) => m.memUsed() < m.indexQuota(),
  memSegsPilingUp: (m) => m.root.segs.filter((ss) => ss.seg.kind === 'mem').length >= 50,
  fileSegsAtRoot: (m) => m.root.segs.some((ss) => ss.seg.kind === 'file'),
  mergesDone: (m) => m.stats.TotFileMergeIntroductionsDone > 0,
  memMergesDone: (m) => m.stats.TotMemMergeDone > 0,
  napBroken: (m) => m.stats.TotPersisterMergerNapBreak > 0,
  persisterPausedForMerger: (m) => m.stats.TotPersisterSlowMergerPause > 0,
  queryRunning: (m) => m.queries.size > 0,
  noQueries: (m) => m.queries.size === 0,
  zombies: (m) => m.zombieBytes() > 0,
  noZombies: (m) => m.zombieBytes() === 0,
  safeBatchesSlow: (m) => m.stats.NumBatchesIntroduced > 0 &&
    m.stats.TotBatchIntroTime / m.stats.NumBatchesIntroduced > 100,
  analysisSaturated: (m) => m.analysisQueue.totWaited > 1000,
  garbageFilesOnDisk: (m) => m.files.size > m.root.segs.filter((ss) => ss.seg.kind === 'file').length,
  ourSegInMemory: (m) => !!m.trace && m.root.segs.some((ss) => ss.seg.id === m.trace.segId && ss.seg.kind === 'mem'),
  ourSegIsFile: (m) => !!m.trace && m.root.segs.some((ss) => ss.seg.id === m.trace.segId && ss.seg.kind === 'file'),
};

export function checkExpectation(name, m) {
  if (name.startsWith('reached:')) return m.reached(name.slice(8));
  return EXPECTATIONS[name](m);
}

export function isKnownExpectation(name) {
  if (name.startsWith('reached:')) return TRACE_STAGES.includes(name.slice(8));
  return name in EXPECTATIONS;
}
