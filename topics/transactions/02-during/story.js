// The 02-during explainer's story vocabulary, for the engine. There's
// no simulation: a step's state is one of the diagram's states (`at`,
// see states.js). Facts, for `expect`, come from the real runs
// (../lib/txn.json, from tools/txn-golden).

import { STATES, STATE, statePath } from './states.js';
import { AUDIT, T2_READS, serverOf } from './model.js';
import { CONFLICT, ATRS, VB, event } from '../lib/during.js';

export const VIEW_KEYS = {
  at: { values: STATES.map((s) => s.key), sticky: true, initial: 'start', counts: () => true },
};

function facts() {
  const f = {};
  AUDIT.forEach((a, m) => {
    f[`m${m + 1}.atr`] = a.atrState;
    f[`m${m + 1}.plain`] = `${a.plain.alice} ${a.plain.bob} ${a.total.plain}`;
    f[`m${m + 1}.txn`] = `${a.txn.alice} ${a.txn.bob} ${a.total.txn}`;
    // (which docs' ATR the transaction's reads looked up)
    f[`m${m + 1}.checks`] = a.atrChecks.length;
    f[`m${m + 1}.wrote`] = a.wrote;
  });
  const end = serverOf(STATE.clean);
  const t2 = CONFLICT.t2;
  Object.assign(f, {
    'atr.t2': ATRS[1],
    'vb.bob': VB.bob,
    't2.read1': `${T2_READS[0].bob} ${T2_READS[0].alice}`,
    't2.read1.cas': T2_READS[0].cas.bob,
    't2.polls': CONFLICT.polls,
    // (bob's CAS when T2 tried to write it)
    'bob.cas.then': serverOf(STATE['t2.cas']).docs.bob.cas,
    't2.error': t2[0].error,
    't2.retry': `${t2[0].retry} ${t2[0].rollback}`,
    't2.attempts': t2.length,
    't2.aborted': serverOf(STATE['t2.aborted']).atrs[ATRS[1]][0].st,
    't2.rolledback': JSON.stringify(serverOf(STATE['t2.rolledback']).atrs[ATRS[1]]),
    't2.read2': `${T2_READS[1].bob} ${T2_READS[1].alice}`,
    'end.balances': `${end.docs.alice.balance} ${end.docs.bob.balance}`,
    't1.attempts': CONFLICT.t1.length,
    't2.atr.during.poll': JSON.stringify(event('t2 poll 1').server.atrs[ATRS[1]]),
  });
  return f;
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
