// What the 02-during explainer shows, from the real runs (txn.json, from
// tools/txn-golden): the transfer, alice pays bob 30, paused while
// others read and write the same docs.
//
//   READS: paused at three moments; at each, an auditor reads alice and
//   bob, plainly and in a transaction of its own.
//   CONFLICT: paused with both docs staged; meanwhile T2, bob pays alice
//   5, reads both, waits on bob, fails its CAS, rolls back and retries.

import GOLDEN from './txn.json' with { type: 'json' };

export const READS = GOLDEN.reads;
export const CONFLICT = GOLDEN.conflict;
export const VB = CONFLICT.vb;
// the ATRs: alice's vbucket's (the transfer's), and bob's (T2's)
export const ATRS = CONFLICT.atrs;

// the three moments, in order
export const MOMENTS = READS.events.map((e) => e.at);

// A conflict event, by name (and which one, if the name repeats).
export function event(at, nth = 0) {
  const es = CONFLICT.events.filter((e) => e.at === at);
  if (!es[nth]) throw new Error(`no event ${at} #${nth}`);
  return es[nth];
}

const bal = (body) => (body && typeof body === 'object' ? body.balance : null);

// A server, as the diagram shows it: each doc's balance, CAS, and, if
// staged, its "txn" xattr's fields; each ATR's entries (null: no ATR).
export function view(server) {
  const docs = {};
  for (const [k, d] of Object.entries(server.docs)) {
    const x = d.txn;
    docs[k] = { balance: bal(d.body), body: JSON.stringify(d.body), cas: d.cas, txn: x && { atr: x.atr.id, atmpt: x.id.atmpt, stgd: JSON.stringify(x.op.stgd), stgdBalance: bal(x.op.stgd) } };
  }
  const atrs = {};
  for (const k of ATRS) {
    const a = server.atrs[k];
    atrs[k] = a == null ? null : Object.entries(a).map(([id, e]) => ({ id, st: e.st, rep: e.rep ? e.rep.map((r) => r.id) : null }));
  }
  return { docs, atrs };
}
