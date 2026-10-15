// The story's two deals of the same cluster, and its vbucket: the
// naive deal (replicas next door) and vbmap's (made by the vbmap tool),
// and the vbucket that airline_10 hashes to.

import { RUNS, mapOf, naiveMap, vbucketOf } from '../lib/maps.js';
import { pickMap } from '../lib/rebalance.js';
import { NUM_VBUCKETS } from './layout.js';

// (and, once node e joins rack West, vbmap's deal for five nodes)
export const MAPS = { naive: naiveMap('story4'), vbmap: mapOf('story4'), uneven: mapOf('uneven5') };

// (then node f joins rack East: ns_server's nine maps from vbmap, each
// seated on the vbuckets, and the cheapest; act 5 shows the winner as
// vbmap dealt it, then as seated)
const generated = Object.keys(RUNS).filter((k) => k.startsWith('six-')).map((run) => ({ run, order: RUNS[run].nodes.join(''), seed: RUNS[run].seed, map: mapOf(run) }));
export const SIX = { generated, ...pickMap(MAPS.uneven, generated, ['a', 'b', 'c', 'd', 'e', 'f']) };
MAPS.dealt6 = generated.find((g) => g.run === SIX.best.run).map;
MAPS.six = SIX.best.map;
export const HERO_KEY = 'airline_10';
export const HERO = vbucketOf(HERO_KEY, NUM_VBUCKETS);
