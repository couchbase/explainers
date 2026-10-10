// Validates narrative YAML. Hand-rolled (no schema library) so errors
// can say exactly which step is wrong, in terms an author understands.

import { DEFAULT_CONFIG, applyConfig, makeConfig } from '../src/js/sim/config.js';
import { EXPECTATIONS } from '../src/js/story/timeline.js';

export const FOCUS_IDS = ['kv', 'dcp', 'workers', 'herder', 'analysis', 'introducer', 'root',
  'persister', 'merger', 'disk', 'bolt', 'queries'];
export const CHART_IDS = ['memUsed', 'files', 'dcpBuf', 'disk'];

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

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
  n.chapters.forEach((ch, ci) => {
    const cw = `chapter[${ci}]${ch && ch.id ? ' ' + ch.id : ''}`;
    if (!isObj(ch)) return err(cw, 'must be a mapping');
    keys(ch, ['id', 'title', 'steps'], cw);
    if (typeof ch.id !== 'string' || !SLUG.test(ch.id)) err(cw, 'id must be a slug');
    if (typeof ch.title !== 'string') err(cw, 'title is required');
    if (!Array.isArray(ch.steps) || ch.steps.length === 0) return err(cw, 'steps must be a non-empty list');
    ch.steps.forEach((st, si) => {
      const sw = `${cw} step[${si}]${st && st.id ? ' ' + st.id : ''}`;
      if (!isObj(st)) return err(sw, 'must be a mapping');
      keys(st, ['id', 'text', 'sim', 'view', 'code', 'expect', 'sandbox'], sw);
      const full = `${ch.id}/${st.id}`;
      if (typeof st.id !== 'string' || !SLUG.test(st.id)) err(sw, 'id must be a slug');
      else if (ids.has(full)) err(sw, `duplicate id ${full}`);
      ids.add(full);
      if (typeof st.text !== 'string' || !st.text.trim()) err(sw, 'text is required');
      if (st.sim !== undefined) {
        if (!isObj(st.sim)) err(sw, 'sim must be a mapping');
        keys(st.sim, ['reset', 'minTimeMs', 'set', 'query', 'speed'], `${sw} sim`);
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
      }
      if (first && !(st.sim && st.sim.reset)) err(sw, 'the first step must have sim.reset');
      first = false;
      if (st.view !== undefined) {
        keys(st.view, ['focus', 'chart'], `${sw} view`);
        for (const f of st.view.focus || []) if (!FOCUS_IDS.includes(f)) err(sw, `unknown focus "${f}" (known: ${FOCUS_IDS.join(', ')})`);
        if (st.view.chart !== undefined && !CHART_IDS.includes(st.view.chart)) err(sw, `unknown chart "${st.view.chart}" (known: ${CHART_IDS.join(', ')})`);
      }
      for (const c of st.code || []) if (!(c in coderefs)) err(sw, `unknown code ref "${c}" (see content/coderefs.yaml)`);
      for (const e of st.expect || []) if (!(e in EXPECTATIONS)) err(sw, `unknown expectation "${e}"`);
    });
  });
  return errs;
}

export { DEFAULT_CONFIG };
