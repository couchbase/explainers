// The 01-vbmap explainer's story vocabulary, for the engine. There's
// no simulation: a step's state is one of the diagram's states (`at`,
// see states.js). Facts, for `expect`, come from the real vbmap runs
// (../lib/runs.json) and the naive deal.

import { STATES, STATE, statePath } from './states.js';
import { NODES, NUM_VBUCKETS } from './layout.js';
import { mapOf, naiveMap, serving, vbucketOf } from '../lib/maps.js';

export const MAPS = { naive: naiveMap('story4'), vbmap: mapOf('story4') };
export const HERO_KEY = 'airline_10';
export const HERO = vbucketOf(HERO_KEY, NUM_VBUCKETS);

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
    for (const [k, down] of [['c', ['c']], ['east', ['a', 'b']]]) {
      out[`${name}.${k}.serves`] = servesText(map, down);
      out[`${name}.${k}.lost`] = serving(map, down).lost.length;
    }
    // how many of each node's replicas sit in its own rack
    out[`${name}.sameRack`] = map.filter(([a, r]) => (a < 'c') === (r < 'c')).length;
  }
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
