// This explainer's simulation directives: what a step's `sim` may say
// besides the engine's `reset` (a fresh model), how it's checked, and
// how it drives the model. The engine reads it as D.SIM (see
// src/js/story/timeline.js and build/schema.mjs).
//
// Each step: fast-forward to its minTimeMs (sim time since the reset),
// apply `set`, `query` and `follow`, then run event by event `until`
// the followed batch reaches the named stage. `speed` is the playback
// speed from that step on.

import { TRACE_STAGES, FOLLOW_MODES } from './story.js';

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

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export const SIM = {
  // the keys a step's `sim` may have, besides `reset`
  keys: ['minTimeMs', 'set', 'query', 'speed', 'follow', 'until'],
  // those that change the simulation (`speed` is just playback)
  changes: ['minTimeMs', 'set', 'query', 'follow', 'until'],

  // Checks a step's `sim`, reporting with err(msg); checkConfig(cfg,
  // where) checks config overrides.
  validate(sim, err, checkConfig) {
    checkConfig(sim.set, 'sim.set');
    if (sim.query !== undefined) {
      if (!isObj(sim.query)) err('sim.query must be a mapping');
      else {
        for (const k of Object.keys(sim.query)) if (!['durationMs', 'timeoutMs', 'label'].includes(k)) err(`sim.query: unknown key "${k}" (allowed: durationMs, timeoutMs, label)`);
        if (!(sim.query.durationMs > 0)) err('sim.query.durationMs must be > 0');
      }
    }
    for (const k of ['minTimeMs', 'speed']) {
      if (sim[k] !== undefined && !(typeof sim[k] === 'number' && sim[k] >= 0)) err(`sim.${k} must be a number >= 0`);
    }
    if (sim.follow !== undefined && !FOLLOW_MODES.includes(sim.follow)) err(`sim.follow must be one of: ${FOLLOW_MODES.join(', ')}`);
    if (sim.until !== undefined && !TRACE_STAGES.includes(sim.until)) err(`unknown sim.until stage "${sim.until}" (known: ${TRACE_STAGES.join(', ')})`);
  },

  // Applies a step's `sim` to a model whose clock started at the last
  // reset.
  enter(model, sim) {
    const target = sim.minTimeMs || 0;
    if (model.now < target) model.advance(target - model.now);
    if (sim.set) model.set(sim.set);
    if (sim.query) model.startQuery(sim.query);
    if (sim.follow) model.follow(sim.follow);
    if (sim.set || sim.query || sim.follow) model.advance(0); // let just-spawned processes start
    if (sim.until && !advanceUntil(model, () => model.reached(sim.until))) {
      model.log('trace', `(our batch didn't reach "${sim.until}" in time)`);
    }
  },
};

// Playback speed in effect at step i (0 means paused).
export function speedAt(steps, i) {
  for (let j = i; j >= 0; j--) if (steps[j].sim && steps[j].sim.speed !== undefined) return steps[j].sim.speed;
  return 1;
}
