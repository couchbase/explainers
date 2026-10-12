// Validates narrative YAML. Hand-rolled (no schema library) so errors
// can say exactly which step is wrong, in terms an author understands.
// Also enforces the storytelling rule: each step changes at most one
// thing (camera, lids, bubbles, UI, or the simulation) unless it says
// `multi: true`.

// Names an author can use (cameras, lids, anchors, stages, the
// explainer's own view directives...) come from the explainer, through
// src/js/domain.js; the rules here are the engine's.

import { isKnownExpectation, flattenSteps, resolveViews, changesAt, isStop, UI_MODES } from '../src/js/story/timeline.js';
import { isAnchorVisible } from '../src/js/ui/anchors.js';
import { D } from '../src/js/domain.js';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const CALLOUT = /\[\[(.+?)\]\]/g;

export function validateNarrative(n, { coderefs = {}, sources = null, file = 'narrative' } = {}) {
  const errs = [];
  const err = (where, msg) => errs.push(`${file}: ${where}: ${msg}`);
  const keys = (obj, allowed, where) => {
    for (const k of Object.keys(obj || {})) if (!allowed.includes(k)) err(where, `unknown key "${k}" (allowed: ${allowed.join(', ')})`);
  };
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const checkConfig = (cfg, where) => {
    if (cfg === undefined) return;
    if (!isObj(cfg)) return err(where, 'config must be a mapping');
    if (!D.makeConfig) return err(where, 'this explainer has no config');
    try { D.applyConfig(D.makeConfig(), cfg); } catch (e) { err(where, e.message); }
  };
  const checkIds = (list, known, where, what) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) return err(where, `${what} must be a list`);
    for (const id of list) if (!known.includes(id)) err(where, `unknown ${what} "${id}" (known: ${known.join(', ')})`);
  };

  if (!isObj(n)) return [`${file}: not a mapping`];
  keys(n, ['title', 'subtitle', 'audience', 'explainer', 'sources', 'next', 'sim', 'chapters'], 'top');
  // the pinned sources it's modeled on, named in its header
  if (n.sources !== undefined && sources) checkIds(n.sources, Object.keys(sources), 'top', 'source');
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
  if (n.chapters.filter(isStop).length > 1) err('top', 'at most one `stop` entry');
  n.chapters.forEach((ch, ci) => {
    const cw = `chapter[${ci}]${ch && ch.id ? ' ' + ch.id : ''}`;
    if (!isObj(ch)) return err(cw, 'must be a mapping');
    if (isStop(ch)) {
      keys(ch, ['stop'], cw);
      if (ci === 0) err(cw, 'a `stop` needs at least one chapter before it');
      return;
    }
    keys(ch, ['id', 'title', 'color', 'steps'], cw);
    if (typeof ch.id !== 'string' || !SLUG.test(ch.id)) err(cw, 'id must be a slug');
    if (typeof ch.title !== 'string') err(cw, 'title is required');
    if (ch.color !== undefined && !D.SECTION_COLORS.includes(ch.color)) err(cw, `unknown color "${ch.color}" (known: ${D.SECTION_COLORS.join(', ')})`);
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
        keys(st.sim, ['reset', ...(D.SIM ? D.SIM.keys : [])], `${sw} sim`);
        const r = st.sim.reset;
        if (r !== undefined && r !== true) {
          if (!isObj(r)) err(sw, 'sim.reset must be true or a mapping');
          else {
            keys(r, ['seed', 'config'], `${sw} sim.reset`);
            checkConfig(r.config, `${sw} sim.reset.config`);
          }
        }
        // the rest, as the explainer says
        if (D.SIM && isObj(st.sim)) D.SIM.validate(st.sim, (msg) => err(sw, msg), (cfg, w) => checkConfig(cfg, `${sw} ${w}`));
      }
      // (An explainer without a simulation has no sim directives at all.)
      if (!D.makeModel && st.sim) err(sw, 'this explainer has no simulation, so no sim directives');
      if (D.makeModel && first && !(st.sim && st.sim.reset)) err(sw, 'the first step must have sim.reset');
      first = false;
      if (st.view !== undefined) {
        keys(st.view, ['camera', 'open', 'close', 'bubble', 'unbubble', 'ui', 'target', ...Object.keys(D.VIEW_KEYS)], `${sw} view`);
        const v = st.view;
        if (v.camera !== undefined && !(typeof v.camera === 'string' && D.CAMERAS[v.camera]) &&
          !(Array.isArray(v.camera) && v.camera.length === 4 && v.camera.every((x) => typeof x === 'number'))) {
          err(sw, `unknown camera "${v.camera}" (known: ${Object.keys(D.CAMERAS).join(', ')}, or [x0, y0, x1, y1])`);
        }
        checkIds(v.open, Object.keys(D.LIDS), sw, 'lid');
        checkIds(v.close, Object.keys(D.LIDS), sw, 'lid');
        checkIds(v.bubble, Object.keys(D.BUBBLES), sw, 'bubble');
        checkIds(v.unbubble, Object.keys(D.BUBBLES), sw, 'bubble');
        if (v.ui !== undefined && !UI_MODES.includes(v.ui)) err(sw, `unknown ui "${v.ui}" (known: ${UI_MODES.join(', ')})`);
        for (const [k, d] of Object.entries(D.VIEW_KEYS)) {
          if (v[k] !== undefined && !d.values.includes(v[k])) err(sw, `unknown ${k} "${v[k]}" (known: ${d.values.join(', ')})`);
        }
        if (v.target !== undefined && !(v.target in D.ANCHORS) && !D.DYNAMIC_ANCHORS.includes(v.target)) {
          err(sw, `unknown target "${v.target}" (known: ${[...Object.keys(D.ANCHORS), ...D.DYNAMIC_ANCHORS].join(', ')})`);
        }
        if (v.target && callouts === 0) err(sw, 'a view.target needs a [[callout]] phrase in the text');
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
      const parent = D.LIDS[id].parent;
      if (parent && !v.open.has(parent)) err(sw, `lid "${id}" is open but its parent "${parent}" isn't`);
    }
    for (const id of v.bubbles) if (!v.open.has(D.BUBBLES[id].parent)) err(sw, `bubble "${id}" shows, but its panel's lid isn't open`);
    // A phase told over several steps (VIEW_KEYS with a `run`): its
    // phases come in order; an 'ordered' run's first step is the one
    // that changes the simulation.
    for (const [k, d] of Object.entries(D.VIEW_KEYS)) {
      if (!d.run || !v[k]) continue;
      const pv = i > 0 ? views[i - 1] : null, ph = (x) => d.values.indexOf(x);
      if (pv && pv[k] && (d.run === 'ordered' ? ph(v[k]) <= ph(pv[k]) : ph(v[k]) < ph(pv[k]))) err(sw, `${k} "${v[k]}" must come after "${pv[k]}"`);
      if (d.run === 'ordered' && !(pv && pv[k]) && !(st.sim && st.sim.until)) err(sw, `the first step of a ${k} needs sim.until (the step that makes the change it tells)`);
    }
    if (v.target && D.ANCHORS[v.target] && !isAnchorVisible(v.target, v.open, v.bubbles)) {
      err(sw, `target "${v.target}" is hidden under a closed lid (or needs its bubble) at this step`);
    }
    const changes = changesAt(steps, views, i);
    if (changes.length > 1 && !st.multi) {
      err(sw, `changes ${changes.join(' and ')} at once; split it into steps, one change each (or set multi: true)`);
    }
  });
  return errs;
}

