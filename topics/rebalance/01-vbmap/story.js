// The 01-vbmap explainer's story vocabulary, for the engine. There's
// no simulation: a step's state is one of the diagram's states (`at`,
// see states.js). Facts, for `expect`, come from the real vbmap runs
// (../lib/runs.json) and the naive deal.

import { STATES, STATE, statePath } from './states.js';
import { NODES, NUM_VBUCKETS } from './layout.js';
import { serving, vbucketOf, RUNS } from '../lib/maps.js';
import { MAPS, HERO_KEY, HERO } from './deals.js';
import { EDGES, FLOW, PATHS } from './plumbing.js';

export { MAPS, HERO_KEY, HERO };

export const VIEW_KEYS = {
  // the diagram's state; carried over, and each move counts as the step's change
  at: { values: STATES.map((s) => s.key), sticky: true, initial: 'doc', counts: () => true },
};

const servesText = (map, down) => { const { serves } = serving(map, down); return NODES.filter((n) => !down.includes(n)).map((n) => `${n}${serves[n] || 0}`).join(' '); };
function facts() {
  const out = { 'hero.key': HERO_KEY, 'hero.vb': HERO, 'hero.vb1024': vbucketOf(HERO_KEY, 1024), vbuckets: NUM_VBUCKETS };
  for (const [name, map] of Object.entries(MAPS)) {
    out[`${name}.hero`] = map[HERO].join(',');
    out[`${name}.serves`] = servesText(map, []);
    for (const [k, down] of [['c', ['c']], ['west', ['a', 'b']]]) {
      out[`${name}.${k}.serves`] = servesText(map, down);
      out[`${name}.${k}.lost`] = serving(map, down).lost.length;
    }
    // how many of each node's replicas sit in its own rack
    out[`${name}.sameRack`] = map.filter(([a, r]) => (a < 'c') === (r < 'c')).length;
  }
  // act 3: the network's pipes and max-flow's paths
  for (const e of EDGES) if (e.from[0] === 'L') out[`pipe.${e.from.slice(2)}${e.to.slice(2)}`] = FLOW.flow[`${e.from}>${e.to}`];
  for (const e of EDGES) if (e.from === 'S') out[`source.${e.to.slice(2)}`] = e.cap;
  PATHS.forEach((p, i) => { out[`path.${i + 1}`] = `${p.vertices.map((v) => v.replace(/^[LR]\./, '')).join(' ')} ${p.push}`; });
  out.paths = PATHS.length;
  // act 4: five nodes, racks of 3 and 2
  const five = ['a', 'b', 'c', 'd', 'e'], west = ['a', 'b', 'e'];
  const count = (map, k, n) => map.filter((c) => c[k] === n).length;
  out['uneven.serves'] = five.map((n) => `${n}${count(MAPS.uneven, 0, n)}`).join(' ');
  out['uneven.holds'] = five.map((n) => `${n}${count(MAPS.uneven, 1, n)}`).join(' ');
  out['uneven.west.actives'] = MAPS.uneven.filter((c) => west.includes(c[0])).length;
  out['uneven.east.actives'] = MAPS.uneven.filter((c) => !west.includes(c[0])).length;
  out['uneven.sameRack'] = MAPS.uneven.filter(([a, r]) => west.includes(a) === west.includes(r)).length;
  out['uneven.hero'] = MAPS.uneven[HERO].join(',');
  // (vbuckets with a new home, and where node e's came from)
  out['uneven.rehomed'] = MAPS.uneven.filter((c, v) => c[0] !== MAPS.vbmap[v][0]).length;
  out['uneven.e.from'] = [...new Set(MAPS.uneven.flatMap((c, v) => (c[0] === 'e' ? [MAPS.vbmap[v][0]] : [])))].join(',');
  // what vbmap said it did (its diagnostics)
  out['uneven.relaxed'] = /Generated RI with relaxed replica balance/.test(RUNS.uneven5.diag);
  out['uneven.strictTried'] = /Trying to generate strict RI with NumSlaves=2/.test(RUNS.uneven5.diag);
  out['flow.total'] = FLOW.total;
  return out;
}
export const FACTS = facts();

export const EXPECTATION_PARAMS = {
  fact: {
    valid: (arg) => /^[\w.]+=.+$/.test(arg) && arg.split('=')[0] in FACTS,
    check: (_m, arg) => {
      const [k, v] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
      return String(FACTS[k]) === v;
    },
  },
};
export const factModel = () => ({});

export function sceneAt(views, i) {
  return { at: views[i].at, state: STATE[views[i].at] };
}
export { statePath };

// callout ends the page works out: the story's vbucket's two copies
export const DYNAMIC_ANCHORS = ['hero', 'hero.replica'];
