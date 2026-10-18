// The 01-life explainer's story vocabulary, for the engine. There's no
// simulation: a step's state is one of the diagram's states (`at`, see
// states.js). Facts, for `expect`, come from the transaction's real run
// (../lib/txn.json, from tools/txn-golden).

import { STATES, STATE, statePath } from './states.js';
import { TXN, SNAPS, WRITES, KEYS, snap, serverAt, docView, atrView, changedDocs } from '../lib/txn.js';

export const VIEW_KEYS = {
  at: { values: STATES.map((s) => s.key), sticky: true, initial: 'start', counts: () => true },
};

function facts() {
  const seed = snap('begun');
  const body = (s, k) => docView(s, k).body;
  const committed = atrView(snap('AfterATRCommit')).entry;
  return {
    'vb.alice': TXN.vb.alice,
    'vb.bob': TXN.vb.bob,
    vbuckets: TXN.vbuckets,
    'atr.ids': TXN.atrIds,
    'atr.key': TXN.atr,
    'atr.used': TXN.atrUsed,
    'alice.before': body(seed, 'alice'),
    'bob.before': body(seed, 'bob'),
    'alice.staged': docView(serverAt(2), 'alice').txn.stgd,
    'bob.staged': docView(serverAt(3), 'bob').txn.stgd,
    // (reads write nothing: the server, after both, is as it was)
    'reads.write': ['Got alice', 'Got bob'].some((at) => changedDocs(seed, snap(at)).length > 0),
    // (nothing's written before the first Replace: not even the ATR)
    'atr.beforeReplace': JSON.stringify(snap('BeforeATRPending').atr),
    writes: WRITES.length,
    // (each write changes one doc: the one the diagram says)
    'writes.oneDoc': WRITES.every((w, i) => {
      const c = changedDocs(serverAt(i), serverAt(i + 1));
      return c.length === 1 && c[0] === w.doc;
    }),
    'pending.st': atrView(serverAt(1)).entry.st,
    'pending.fields': Object.keys(SNAPS.find((s) => s.at === 'AfterATRPending').atr['attempt-1']).join(','),
    'pending.exp': atrView(serverAt(1)).entry.exp / 1000,
    'commit.st': committed.st,
    'commit.rep': committed.rep.join(','),
    // (staged, the bodies are as they were: everyone else still sees
    // them, even just after the commit point)
    'staged.bodies': KEYS.map((k) => body(serverAt(3), k)).join(' '),
    'committed.bodies': KEYS.map((k) => body(serverAt(4), k)).join(' '),
    'alice.after': body(serverAt(5), 'alice'),
    'bob.midway': body(serverAt(5), 'bob'),
    'done.atr': JSON.stringify(atrView(serverAt(7))),
    'done.state': TXN.state,
    gocbcore: TXN.gocbcore,
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
