// The 03-boxed explainer's story vocabulary, for the engine. There's no
// simulation: a step's state is one of the diagram's states (`at`, see
// states.js). Facts, for `expect`, come from the two lanes' real run
// (../lib/boxed.json, from tools/boxed-golden).

import { STATES, STATE, statePath } from './states.js';
import { ROWS, HERO, ALLOCS, CHANGED, bytesOf } from '../lib/boxed.js';

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
