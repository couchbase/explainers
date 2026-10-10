// Turns a narrative's per-step `sim` directives into simulator state.
// Shared by the UI and the tests, so "what you see at step N" is
// deterministic and testable no matter how the reader scrolled there.
//
// Semantics, for the steps from the most recent `reset` up to N:
//   - reset: a fresh Model (seed + base config + reset overrides);
//   - each step: fast-forward to its minTimeMs (sim time since the
//     reset), then apply its `set` and `query` directives.

import { Model } from '../sim/model.js';

export function flattenSteps(narrative) {
  const out = [];
  narrative.chapters.forEach((ch, ci) => {
    ch.steps.forEach((st, si) => out.push({ ...st, chapterId: ch.id, chapterIndex: ci, indexInChapter: si }));
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

// Applies a step's directives to a model whose clock started at the
// last reset. Returns the model.
export function enterStep(model, step) {
  const sim = step.sim || {};
  const target = sim.minTimeMs || 0;
  if (model.now < target) model.advance(target - model.now);
  if (sim.set) model.set(sim.set);
  if (sim.query) model.startQuery(sim.query);
  model.advance(0); // let just-spawned processes start
  return model;
}

// Builds the model state for step i from scratch.
export function modelAtStep(narrative, steps, i) {
  const j = resetIndexFor(steps, i);
  const model = newModelFor(narrative, steps[j]);
  for (let s = j; s <= i; s++) enterStep(model, steps[s]);
  return model;
}

// Named predicates that steps can `expect`, checked by the tests so
// the prose and the simulation can't silently drift apart.
export const EXPECTATIONS = {
  herderBlocking: (m) => m.numEventsBlocking > 0,
  herderIdle: (m) => m.numEventsBlocking === 0,
  kvPaused: (m) => m.kvPausedSince !== null,
  kvFlowing: (m) => m.kvPausedSince === null,
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
};
