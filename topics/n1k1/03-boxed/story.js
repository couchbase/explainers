// The 03-boxed explainer's story vocabulary, for the engine. There's no
// simulation: a step's state is one of the diagram's states (`at`, see
// states.js). Facts, for `expect`, come from the two lanes' real run
// (../lib/boxed.json, from tools/boxed-golden).

import { STATES, STATE, statePath } from './states.js';
import { ROWS, HERO, ALLOCS, CHANGED, GROUP, ORDER, JOIN, bytesOf } from '../lib/boxed.js';
import { RUN } from '../lib/query.js';

export const VIEW_KEYS = {
  at: { values: STATES.map((s) => s.key), sticky: true, initial: 'start', counts: () => true },
};

function facts() {
  const sum = (f) => ROWS.reduce((s, r) => s + f(r), 0);
  const stage = (st) => ALLOCS.filter((a) => a.stage === st);
  return {
    'hero.boxed.allocs': HERO.boxedAllocs,
    'hero.boxed.bytes': bytesOf(HERO),
    'hero.native.allocs': HERO.nativeAllocs,
    'hero.convert.bytes': stage('convert').reduce((s, a) => s + a.bytes, 0),
    'hero.convert.kinds': stage('convert').length,
    'hero.id.bytes': ALLOCS.find((a) => /^the id/.test(a.what)).bytes,
    'hero.id.count': ALLOCS.find((a) => /^the id/.test(a.what)).count,
    'hero.parsed.bytes': ALLOCS.find((a) => /parsedValue/.test(a.what)).bytes,
    'hero.evaluate.bytes': stage('evaluate').reduce((s, a) => s + a.bytes, 0),
    'hero.compare.bytes': stage('compare').reduce((s, a) => s + a.bytes, 0),
    'hero.total.boxed': HERO.totalBoxed,
    'hero.total.type': HERO.totalType,
    'hero.total.bytes': HERO.order.total.bytes,
    'hero.total.range': `${HERO.order.total.start}:${HERO.order.total.end}`,
    rows: ROWS.length,
    'rows.same': ROWS.every((r) => r.native === r.boxed),
    'rows.native.allocs': sum((r) => r.nativeAllocs),
    'rows.boxed.allocs': sum((r) => r.boxedAllocs),
    'rows.boxed.bytes': sum(bytesOf),
    'rows.boxed.min': Math.min(...ROWS.map((r) => r.boxedAllocs)),
    'rows.boxed.max': Math.max(...ROWS.map((r) => r.boxedAllocs)),
    changed: CHANGED.length,
    // GROUP BY
    'group.cbq.perRow': Math.round(GROUP.cbqPerRow),
    'group.cbq.perRowBytes': GROUP.cbqPerRowBytes,
    'group.cbq.box': Math.round(GROUP.cbqBoxPerRow),
    ...Object.fromEntries(GROUP.cbqStages.map((x) => [`group.cbq.${x.stage}.bytes`, x.bytes])),
    'group.n1k1.setup': GROUP.n1k1Setup,
    'group.n1k1.perRow': GROUP.n1k1PerRow,
    'group.groups': GROUP.n1k1Groups.length,
    // (the same sums and counts, in both)
    'group.same': GROUP.n1k1Groups.every((g) => {
      const [c, sum, n] = g.split(' ');
      return GROUP.cbqGroups.some((x) => x.startsWith(`{"0":${c}} sum=${sum} `) && x.includes(` count=${n} `));
    }),
    'group.alice.sum': GROUP.n1k1Groups.find((g) => g.startsWith('"alice"')).split(' ')[1],
    // ORDER BY and JOIN
    ...Object.fromEntries(ORDER.cbqStages.flatMap((x) => [[`order.cbq.${x.stage}.count`, x.count], [`order.cbq.${x.stage}.bytes`, x.bytes]])),
    'order.n1k1.setup': ORDER.n1k1Setup,
    'order.n1k1.perRow': Math.round(ORDER.n1k1PerRow),
    'order.n1k1.push.bytes': ORDER.n1k1PushBytes,
    ...Object.fromEntries(JOIN.cbqStages.flatMap((x) => [[`join.cbq.${x.stage}.count`, x.count], [`join.cbq.${x.stage}.bytes`, x.bytes]])),
    'join.n1k1.setup': JOIN.n1k1Setup,
    'join.n1k1.perRow': Math.round(JOIN.n1k1PerRow),
    'join.rows': `${JOIN.cbqMatches} ${JOIN.n1k1Joined}`,
    // which lane: n1k1's stats line, for a query it can't make native
    'lanes.native.expr': RUN.lanes[0].stats.some((x) => x.startsWith('expr:')),
    'lanes.boxed.expr': RUN.lanes[1].stats.find((x) => x.startsWith('expr:')),
    'changed.list': CHANGED.map((r) => `${r.order.total.bytes}>${r.totalBoxed}`).join(','),
  };
}
export const FACTS = facts();

export const EXPECTATION_PARAMS = {
  fact: {
    valid: (arg) => /^[\w.-]+=.+$/.test(arg) && arg.split('=')[0] in FACTS,
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
