// The scorch-goroutines explainer's story vocabulary, for the engine
// (src/js/story/timeline.js, build/schema.mjs): its model, the stages
// our followed batch goes through, what steps can `expect`, and the
// view directives it adds.

import { Model } from './sim/model.js';
import { plan as mergePlan } from './sim/mergeplan.js';
import { planInput } from './sim/procs/merger.js';
import { PLAN_PHASES } from './stairs-scene.js';
import { SWAP_PHASES, COMMIT_PHASES } from './snapstack.js';
import { CHART_IDS, TOKEN_MODES } from './layout.js';

// The simulation's settings (for `sim.reset.config` and `sim.set`).
export { applyConfig, makeConfig } from './sim/config.js';

// A fresh simulation, for a narrative's `sim.reset`.
export const makeModel = ({ seed, config }) => new Model({ seed, config });

// `sim.follow` values: true, or 'alone' (see Model.follow).
export const FOLLOW_MODES = [true, 'alone'];

// The stages a followed batch goes through, in order (see Model._trace),
// for `sim.until` and `expect: ["reached:<stage>"]`.
export const TRACE_STAGES = ['dcp', 'channel', 'worker', 'herder', 'analysis', 'built', 'introducing', 'introduced',
  'flushables', 'persisting', 'written', 'fileIntroducing', 'file', 'committed', 'caughtUp', 'persisterWaits', 'persisterNudged', 'watcherClosed', 'planning', 'merging', 'mergeWritten', 'mergeIntroducing', 'merged', 'oldFileDeleted'];

// Named predicates that steps can `expect`, checked by the tests so
// the prose and the simulation can't silently drift apart. (The engine
// Also "reached:<stage>", below, for the followed batch.)
export const EXPECTATIONS = {
  herderBlocking: (m) => m.numEventsBlocking > 0,
  herderIdle: (m) => m.numEventsBlocking === 0,
  kvPaused: (m) => m.kvPausedSince !== null,
  kvFlowing: (m) => m.kvPausedSince === null,
  kvHasPaused: (m) => m.dcpPausedMs() > 0,
  overHalfQuota: (m) => m.memUsed() > 0.5 * m.indexQuota(),
  underQuota: (m) => m.memUsed() < m.indexQuota(),
  memSegsPilingUp: (m) => m.root.segs.filter((ss) => ss.seg.kind === 'mem').length >= 50,
  noMemSegsAtRoot: (m) => m.root.segs.every((ss) => ss.seg.kind !== 'mem'),
  fileSegsAtRoot: (m) => m.root.segs.some((ss) => ss.seg.kind === 'file'),
  mergesDone: (m) => m.stats.TotFileMergeIntroductionsDone > 0,
  memMergesDone: (m) => m.stats.TotMemMergeDone > 0,
  napBroken: (m) => m.stats.TotPersisterMergerNapBreak > 0,
  persisterPausedForMerger: (m) => m.stats.TotPersisterSlowMergerPause > 0,
  queryRunning: (m) => m.queries.size > 0,
  persisterHoldsOlderRoot: (m) => !!m.persisterSnapshot && m.persisterSnapshot !== m.root,
  onlyRootLive: (m) => m.liveSnapshots.size === 1,
  rootMovedPastPersister: (m) => !!m.persisterSnapshot && m.root.epoch - m.persisterSnapshot.epoch >= 3,
  noQueries: (m) => m.queries.size === 0,
  zombies: (m) => m.zombieBytes() > 0,
  filesWithinBudget: (m) => mergePlan(planInput(m.root), m.cfg.mergePlan).tasks.length === 0,
  filesOverBudget: (m) => mergePlan(planInput(m.root), m.cfg.mergePlan).tasks.length > 0,
  noZombies: (m) => m.zombieBytes() === 0,
  safeBatchesSlow: (m) => m.stats.NumBatchesIntroduced > 0 &&
    m.stats.TotBatchIntroTime / m.stats.NumBatchesIntroduced > 100,
  analysisSaturated: (m) => m.analysisQueue.totWaited > 1000,
  garbageFilesOnDisk: (m) => m.files.size > m.root.segs.filter((ss) => ss.seg.kind === 'file').length,
  ourSegInMemory: (m) => !!m.trace && m.root.segs.some((ss) => ss.seg.id === m.trace.segId && ss.seg.kind === 'mem'),
  ourSegIsFile: (m) => !!m.trace && m.root.segs.some((ss) => ss.seg.id === m.trace.segId && ss.seg.kind === 'file'),
};

// Parameterized expectations, "<name>:<arg>": rootEpoch:<n> for prose
// that names the root's epoch.
export const EXPECTATION_PARAMS = {
  reached: { valid: (arg) => TRACE_STAGES.includes(arg), check: (m, arg) => m.reached(arg) },
  rootEpoch: { valid: (arg) => /^\d+$/.test(arg), check: (m, arg) => m.root.epoch === Number(arg) },
};

// View directives this explainer adds to the engine's own (camera,
// open/close, bubble/unbubble, ui, target):
//   values: what it may be set to;
//   sticky: carried over from step to step (else it holds for one step);
//   counts(prev, cur): whether changing it counts as the step's one
//     change (sticky keys), when it does at all;
//   run: a phase told over consecutive steps ('ordered': strictly
//     forward, its first step must change the simulation with
//     `until`; 'held': forward or held in place). A run's step counts
//     as a change unless the simulation already changes.
export const VIEW_KEYS = {
  // how to place our batch's marker: 'auto', as a 'file', or 'hide'
  token: { values: TOKEN_MODES, sticky: true, initial: 'auto' },
  // the chart a step's callout points along to (for that step only)
  chart: { values: CHART_IDS },
  plan: { values: PLAN_PHASES, sticky: true, initial: 'live', counts: (a, b) => a.bubbles.has('merger') && b.bubbles.has('merger') },
  swap: { values: SWAP_PHASES, run: 'ordered' },
  commit: { values: COMMIT_PHASES, run: 'held' },
  flow: { values: ['analysis', 'write', 'mergeWrite', 'watcher'] },
};
