// The 01-vbmap explainer's story vocabulary, for the engine. There's
// no simulation: a step's state is one of the diagram's states (`at`,
// see states.js). Facts, for `expect`, come from the real vbmap runs
// (../lib/runs.json) and the naive deal.

import { STATES, STATE, statePath } from './states.js';
import { NODES, NUM_VBUCKETS, rackOf } from './layout.js';
import { serving, vbucketOf, RUNS, PICKS } from '../lib/maps.js';
import { MAPS, FIVE, SIX, HERO_KEY, HERO } from './deals.js';

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
    out[`${name}.sameRack`] = map.filter(([a, r]) => rackOf(a) === rackOf(r)).length;
  }
  // act 4: five nodes, racks of 3 and 2
  const five = ['a', 'b', 'c', 'd', 'e'], six = [...five, 'f'];
  const count = (map, k, n) => map.filter((c) => c[k] === n).length;
  const perNode = (nodes, f) => nodes.map((n) => `${n}${f(n)}`).join(' ');
  out['uneven.serves'] = perNode(five, (n) => count(MAPS.uneven, 0, n));
  out['uneven.holds'] = perNode(five, (n) => count(MAPS.uneven, 1, n));
  out['uneven.west.actives'] = MAPS.uneven.filter((c) => rackOf(c[0]) === 'West').length;
  out['uneven.east.actives'] = MAPS.uneven.filter((c) => rackOf(c[0]) === 'East').length;
  // (vbuckets with a new home, and where node e's came from)
  out['uneven.rehomed'] = MAPS.uneven.filter((c, v) => c[0] !== MAPS.vbmap[v][0]).length;
  out['uneven.e.from'] = [...new Set(MAPS.uneven.flatMap((c, v) => (c[0] === 'e' ? [MAPS.vbmap[v][0]] : [])))].sort().join(',');
  // the rebalances: what ns_server's pick moves, and where its new
  // copies land; its tries
  for (const [name, R, before, nodes] of [['uneven', FIVE, MAPS.vbmap, five], ['six', SIX, MAPS.uneven, six]]) {
    const added = R.best.map.flatMap((c, v) => c.filter((n) => !before[v].includes(n)));
    out[`${name}.moves`] = R.best.score.join(',');
    out[`${name}.dealt`] = R.best.asDealt.join(',');
    out[`${name}.promoted`] = R.best.map.filter((c, v) => c[0] !== before[v][0] && before[v].includes(c[0])).length;
    out[`${name}.land`] = perNode(nodes, (n) => added.filter((x) => x === n).length);
    out[`${name}.tries`] = R.tried.length;
    out[`${name}.best`] = `${R.best.order} ${R.best.seed}`;
    out[`${name}.range`] = `${Math.min(...R.tried.map((t) => t.score[0]))}-${Math.max(...R.tried.map((t) => t.score[0]))}`;
    // (the floor: a new node's copies are all new, and its actives all
    // takeovers)
    const newNode = nodes.at(-1);
    out[`${name}.newNode.copies`] = count(R.best.map, 0, newNode) + count(R.best.map, 1, newNode);
    out[`${name}.newNode.actives`] = count(R.best.map, 0, newNode);
  }
  out['six.serves'] = perNode(six, (n) => count(MAPS.six, 0, n));
  out['six.holds'] = perNode(six, (n) => count(MAPS.six, 1, n));
  // the engine: greedy, as ns_server runs it (and the picks agree
  // with the golden tool's)
  out['engine'] = [...new Set(Object.values(RUNS).filter((r) => !r.engine.startsWith('max')).map((r) => r.engine))].join(',');
  out['picks.agree'] = FIVE.best.run === PICKS.five && SIX.best.run === PICKS.six;
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
