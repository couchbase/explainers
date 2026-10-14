// The story's two deals of the same cluster, and its vbucket: the
// naive deal (replicas next door) and vbmap's (made by the vbmap tool),
// and the vbucket that airline_10 hashes to.

import { mapOf, naiveMap, vbucketOf } from '../lib/maps.js';
import { NUM_VBUCKETS } from './layout.js';

export const MAPS = { naive: naiveMap('story4'), vbmap: mapOf('story4') };
export const HERO_KEY = 'airline_10';
export const HERO = vbucketOf(HERO_KEY, NUM_VBUCKETS);
