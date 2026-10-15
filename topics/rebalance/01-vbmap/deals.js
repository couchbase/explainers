// The story's deals of its clusters, and its vbucket: the naive deal
// (replicas next door), and vbmap's (made by the vbmap tool itself,
// with its greedy engine, ns_server's default), and the vbucket that
// airline_10 hashes to.

import { RUNS, mapOf, naiveMap, vbucketOf } from '../lib/maps.js';
import { pickMap } from '../lib/rebalance.js';
import { NUM_VBUCKETS } from './layout.js';

// a rebalance's tries: vbmap's maps from ns_server's 3 node orders x 3
// runs, each from the current map (named <prefix>-<order>-<seed>)
const tries = (prefix) => Object.keys(RUNS).filter((k) => k.startsWith(`${prefix}-`)).sort()
  .map((run) => ({ run, order: RUNS[run].nodes.join(''), seed: RUNS[run].seed, map: mapOf(run) }));

// The maps: the naive deal and vbmap's, of the four nodes; then, once
// node e joins rack West, the five-node map ns_server keeps ('uneven');
// and once node f joins rack East, the six-node one ('six').
export const MAPS = { naive: naiveMap('story4'), vbmap: mapOf('story4') };
export const FIVE = { generated: tries('five'), ...pickMap(MAPS.vbmap, tries('five'), ['a', 'b', 'c', 'd', 'e']) };
MAPS.uneven = FIVE.best.map;
export const SIX = { generated: tries('six'), ...pickMap(MAPS.uneven, tries('six'), ['a', 'b', 'c', 'd', 'e', 'f']) };
MAPS.six = SIX.best.map;

export const HERO_KEY = 'airline_10';
export const HERO = vbucketOf(HERO_KEY, NUM_VBUCKETS);
