// Validates narrative YAML. Hand-rolled (no schema library) so errors
// can say exactly which step is wrong, in terms an author understands.
// Also enforces the storytelling rule: each step changes at most one
// thing (camera, lids, bubbles, UI, or the simulation) unless it says
// `multi: true`.

import { applyConfig, makeConfig } from '../src/js/sim/config.js';
import { PLAN_PHASES } from '../src/js/ui/stairs-scene.js';
import { SWAP_PHASES } from '../src/js/ui/snapstack.js';
import { isKnownExpectation, flattenSteps, resolveViews, changesAt } from '../src/js/story/timeline.js';
import { CAMERAS, LIDS, BUBBLES, ANCHORS, DYNAMIC_ANCHORS, CHART_IDS, SECTION_COLORS, UI_MODES, TOKEN_MODES, isAnchorVisible } from '../src/js/ui/layout.js';
import { TRACE_STAGES } from '../src/js/story/timeline.js';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const CALLOUT = /\[\[(.+?)\]\]/g;

export function validateNarrative(n, { coderefs = {}, file = 'narrative' } = {}) {
  const errs = [];
  const err = (where, msg) => errs.push(`${file}: ${where}: ${msg}`);
  const keys = (obj, allowed, where) => {
    for (const k of Object.keys(obj || {})) if (!allowed.includes(k)) err(where, `unknown key "${k}" (allowed: ${allowed.join(', ')})`);
  };
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const checkConfig = (cfg, where) => {
    if (cfg === undefined) return;
    if (!isObj(cfg)) return err(where, 'config must be a mapping');
    try { applyConfig(makeConfig(), cfg); } catch (e) { err(where, e.message); }
  };
  const checkIds = (list, known, where, what) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) return err(where, `${what} must be a list`);
    for (const id of list) if (!known.includes(id)) err(where, `unknown ${what} "${id}" (known: ${known.join(', ')})`);
  };

  if (!isObj(n)) return [`${file}: not a mapping`];
  keys(n, ['id', 'title', 'subtitle', 'audience', 'sim', 'chapters'], 'top');
  if (typeof n.id !== 'string' || !SLUG.test(n.id)) err('top', 'id must be a slug');
  if (typeof n.title !== 'string') err('top', 'title is required');
  if (n.sim !== undefined) {
    keys(n.sim, ['seed', 'config'], 'sim');
    checkConfig(n.sim.config, 'sim.config');
  }
  if (!Array.isArray(n.chapters) || n.chapters.length === 0) {
    err('top', 'chapters must be a non-empty list');
    return errs;
  }
  const ids = new Set();
  let first = true;
  const where = [];
  n.chapters.forEach((ch, ci) => {
    const cw = `chapter[${ci}]${ch && ch.id ? ' ' + ch.id : ''}`;
    if (!isObj(ch)) return err(cw, 'must be a mapping');
    keys(ch, ['id', 'title', 'color', 'steps'], cw);
    if (typeof ch.id !== 'string' || !SLUG.test(ch.id)) err(cw, 'id must be a slug');
    if (typeof ch.title !== 'string') err(cw, 'title is required');
    if (ch.color !== undefined && !SECTION_COLORS.includes(ch.color)) err(cw, `unknown color "${ch.color}" (known: ${SECTION_COLORS.join(', ')})`);
    if (!Array.isArray(ch.steps) || ch.steps.length === 0) return err(cw, 'steps must be a non-empty list');
    ch.steps.forEach((st, si) => {
      const sw = `${cw} step[${si}]${st && st.id ? ' ' + st.id : ''}`;
      where.push(sw);
      if (!isObj(st)) return err(sw, 'must be a mapping');
      keys(st, ['id', 'text', 'sim', 'view', 'code', 'expect', 'sandbox', 'multi'], sw);
      const full = `${ch.id}/${st.id}`;
      if (typeof st.id !== 'string' || !SLUG.test(st.id)) err(sw, 'id must be a slug');
      else if (ids.has(full)) err(sw, `duplicate id ${full}`);
      ids.add(full);
      if (typeof st.text !== 'string' || !st.text.trim()) err(sw, 'text is required');
      const callouts = typeof st.text === 'string' ? [...st.text.matchAll(CALLOUT)].length : 0;
      if (callouts > 1) err(sw, 'at most one [[callout]] phrase per step');
      if (st.sim !== undefined) {
        if (!isObj(st.sim)) err(sw, 'sim must be a mapping');
        keys(st.sim, ['reset', 'minTimeMs', 'set', 'query', 'speed', 'follow', 'until'], `${sw} sim`);
        const r = st.sim.reset;
        if (r !== undefined && r !== true) {
          if (!isObj(r)) err(sw, 'sim.reset must be true or a mapping');
          else {
            keys(r, ['seed', 'config'], `${sw} sim.reset`);
            checkConfig(r.config, `${sw} sim.reset.config`);
          }
        }
        checkConfig(st.sim.set, `${sw} sim.set`);
        if (st.sim.query !== undefined) {
          keys(st.sim.query, ['durationMs', 'timeoutMs', 'label'], `${sw} sim.query`);
          if (!(st.sim.query.durationMs > 0)) err(sw, 'sim.query.durationMs must be > 0');
        }
        for (const k of ['minTimeMs', 'speed']) {
          if (st.sim[k] !== undefined && !(typeof st.sim[k] === 'number' && st.sim[k] >= 0)) err(sw, `sim.${k} must be a number >= 0`);
        }
        if (st.sim.follow !== undefined && st.sim.follow !== true) err(sw, 'sim.follow must be true');
        if (st.sim.until !== undefined && !TRACE_STAGES.includes(st.sim.until)) err(sw, `unknown sim.until stage "${st.sim.until}" (known: ${TRACE_STAGES.join(', ')})`);
      }
      if (first && !(st.sim && st.sim.reset)) err(sw, 'the first step must have sim.reset');
      first = false;
      if (st.view !== undefined) {
        keys(st.view, ['camera', 'open', 'close', 'bubble', 'unbubble', 'ui', 'token', 'plan', 'swap', 'flow', 'target', 'chart'], `${sw} view`);
        const v = st.view;
        if (v.camera !== undefined && !(typeof v.camera === 'string' && CAMERAS[v.camera]) &&
          !(Array.isArray(v.camera) && v.camera.length === 4 && v.camera.every((x) => typeof x === 'number'))) {
          err(sw, `unknown camera "${v.camera}" (known: ${Object.keys(CAMERAS).join(', ')}, or [x0, y0, x1, y1])`);
        }
        checkIds(v.open, Object.keys(LIDS), sw, 'lid');
        checkIds(v.close, Object.keys(LIDS), sw, 'lid');
        checkIds(v.bubble, Object.keys(BUBBLES), sw, 'bubble');
        checkIds(v.unbubble, Object.keys(BUBBLES), sw, 'bubble');
        if (v.ui !== undefined && !UI_MODES.includes(v.ui)) err(sw, `unknown ui "${v.ui}" (known: ${UI_MODES.join(', ')})`);
        if (v.token !== undefined && !TOKEN_MODES.includes(v.token)) err(sw, `unknown token "${v.token}" (known: ${TOKEN_MODES.join(', ')})`);
        if (v.plan !== undefined && !PLAN_PHASES.includes(v.plan)) err(sw, `unknown plan "${v.plan}" (known: ${PLAN_PHASES.join(', ')})`);
        if (v.flow !== undefined && v.flow !== 'analysis') err(sw, `unknown flow "${v.flow}" (known: analysis)`);
        if (v.swap !== undefined && !SWAP_PHASES.includes(v.swap)) err(sw, `unknown swap "${v.swap}" (known: ${SWAP_PHASES.join(', ')})`);
        if (v.target !== undefined && !(v.target in ANCHORS) && !DYNAMIC_ANCHORS.includes(v.target)) {
          err(sw, `unknown target "${v.target}" (known: ${[...Object.keys(ANCHORS), ...DYNAMIC_ANCHORS].join(', ')})`);
        }
        if (v.target && callouts === 0) err(sw, 'a view.target needs a [[callout]] phrase in the text');
        if (v.chart !== undefined && !CHART_IDS.includes(v.chart)) err(sw, `unknown chart "${v.chart}" (known: ${CHART_IDS.join(', ')})`);
      }
      if (callouts === 1 && !(st.view && st.view.target)) err(sw, 'a [[callout]] phrase needs a view.target');
      for (const c of st.code || []) if (!(c in coderefs)) err(sw, `unknown code ref "${c}" (see content/coderefs.yaml)`);
      for (const e of st.expect || []) if (!isKnownExpectation(e)) err(sw, `unknown expectation "${e}"`);
    });
  });
  if (errs.length) return errs;

  // Cross-step checks on the resolved views.
  const steps = flattenSteps(n);
  const views = resolveViews(steps);
  steps.forEach((st, i) => {
    const sw = where[i];
    const v = views[i];
    for (const id of v.open) {
      const parent = LIDS[id].parent;
      if (parent && !v.open.has(parent)) err(sw, `lid "${id}" is open but its parent "${parent}" isn't`);
    }
    for (const id of v.bubbles) if (!v.open.has(BUBBLES[id].parent)) err(sw, `bubble "${id}" shows, but its panel's lid isn't open`);
    // A root swap told over several steps: its phases in order, and its
    // first step is the one that changes the simulation.
    if (v.swap) {
      const pv = i > 0 ? views[i - 1] : null;
      if (pv && pv.swap && SWAP_PHASES.indexOf(v.swap) <= SWAP_PHASES.indexOf(pv.swap)) err(sw, `swap "${v.swap}" must come after "${pv.swap}"`);
      if (!(pv && pv.swap) && !(st.sim && st.sim.until)) err(sw, 'the first step of a swap needs sim.until (the step that swaps the root)');
    }
    if (v.target && ANCHORS[v.target] && !isAnchorVisible(v.target, v.open, v.bubbles)) {
      err(sw, `target "${v.target}" is hidden under a closed lid (or needs its bubble) at this step`);
    }
    const changes = changesAt(steps, views, i);
    if (changes.length > 1 && !st.multi) {
      err(sw, `changes ${changes.join(' and ')} at once; split it into steps, one change each (or set multi: true)`);
    }
  });
  return errs;
}

export { CHART_IDS };
