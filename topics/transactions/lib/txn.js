// What the transactions explainers show of one real transaction, alice
// pays bob 30, from its run (txn.json, from tools/txn-golden): gocbcore
// running it against CAVES, Couchbase's mock server, with a snapshot of
// the server at each of gocbcore's test hooks: each doc's body and its
// "txn" xattr, and the ATR's attempts. (UUIDs and CASes are renamed in
// order of appearance: txn-1, attempt-1, op-1, cas-1, ...)

import GOLDEN from './txn.json' with { type: 'json' };

export const TXN = GOLDEN;
export const KEYS = ['alice', 'bob'];
export const SNAPS = GOLDEN.snaps;
export const snap = (at) => {
  const s = SNAPS.find((x) => x.at === at);
  if (!s) throw new Error(`no snapshot ${at}`);
  return s;
};

// The transaction's writes, in order: each one a single-doc write, and
// the snapshot just after it. `doc` is the one doc it changes.
export const WRITES = [
  { key: 'atr.pending', at: 'AfterATRPending', doc: 'atr', label: ['ATR', 'PENDING'] },
  { key: 'stage.alice', at: 'AfterStagedReplaceComplete alice', doc: 'alice', label: ['stage', 'alice'] },
  { key: 'stage.bob', at: 'AfterStagedReplaceComplete bob', doc: 'bob', label: ['stage', 'bob'] },
  { key: 'commit', at: 'AfterATRCommit', doc: 'atr', label: ['ATR', 'COMMITTED'] },
  { key: 'unstage.alice', at: 'AfterDocCommitted alice', doc: 'alice', label: ['unstage', 'alice'] },
  { key: 'unstage.bob', at: 'AfterDocCommitted bob', doc: 'bob', label: ['unstage', 'bob'] },
  { key: 'atr.done', at: 'AfterATRComplete', doc: 'atr', label: ['ATR', 'entry gone'] },
];
// (the commit point: the write that decides)
export const COMMIT = WRITES.findIndex((w) => w.key === 'commit');

// The server, as the diagram shows it, after `writes` of the writes
// (0: before any; reads write nothing).
export function serverAt(writes) {
  return writes === 0 ? snap('Got bob') : snap(WRITES[writes - 1].at);
}

// A doc as the diagram shows it: its body, as JSON text; and, if it has
// a "txn" xattr, the fields shown of it.
export function docView(s, k) {
  const d = s.docs[k], x = d.txn;
  return {
    body: JSON.stringify(d.body),
    txn: x && { atr: x.atr.id, atmpt: x.id.atmpt, type: x.op.type, stgd: JSON.stringify(x.op.stgd) },
  };
}

// The ATR as the diagram shows it: null if it isn't there; else its
// attempt's entry (null once it's gone).
export function atrView(s) {
  if (s.atr == null) return null;
  const ids = Object.keys(s.atr);
  if (!ids.length) return { entry: null };
  const e = s.atr[ids[0]];
  return { entry: { id: ids[0], st: e.st, tid: e.tid, exp: e.exp, rep: e.rep ? e.rep.map((r) => r.id) : null } };
}

// What differs between two snapshots: the docs (and 'atr') that changed.
export function changedDocs(a, b) {
  const out = KEYS.filter((k) => JSON.stringify(a.docs[k]) !== JSON.stringify(b.docs[k]));
  if (JSON.stringify(a.atr) !== JSON.stringify(b.atr)) out.push('atr');
  return out;
}
