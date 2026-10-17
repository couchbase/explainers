// The 02-compile explainer's story vocabulary, for the engine. There's
// no simulation: a step's state is one of the diagram's states (`at`,
// see states.js). Facts, for `expect`, come from n1k1's compiler run
// for real (../lib/compile.json, from tools/compile-golden).

import { STATES, STATE, statePath } from './states.js';
import { COMPILE, EMITTED, funcNamed } from '../lib/compile.js';
import { FILTER } from './layout.js';

export const VIEW_KEYS = {
  // the diagram's state; carried over, and each move counts as the step's change
  at: { values: STATES.map((s) => s.key), sticky: true, initial: 'start', counts: () => true },
};

function facts() {
  const count = (k) => FILTER.filter((r) => r.kind === k).length;
  const lines = (re) => EMITTED.filter((e) => re.test(e.text)).length;
  return {
    'filter.lines': funcNamed('OpFilter').src.length,
    'filter.early': count('early'),
    'filter.late': count('late'),
    'filter.hide': count('hide'),
    'filter.captured': count('captured'),
    'emitted.lines': EMITTED.length,
    'emitted.200': lines(/^if 200 [<=]=? lzF64 \{$/),
    'emitted.register0': lines(/^lzVal = lzVals\[0\]$/),
    'emitted.calls': lines(/^lzYieldVals\(/) + lines(/^lzYieldValsOrig\(/),
    'emitted.lifted': EMITTED.filter((e) => /^var /.test(e.text) && e.i < EMITTED.findIndex((x) => x.text === 'if true {')).length,
    rows: COMPILE.compiled.length,
    'rows.same': JSON.stringify(COMPILE.compiled) === JSON.stringify(COMPILE.interpreted),
    row1: COMPILE.compiled[0],
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
