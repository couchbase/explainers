// What the 02-during diagram shows in each state, from the real runs
// (../lib/during.js): the server, the auditor's reads, and T2's.

import { READS, event, view, ATRS } from '../lib/during.js';
import { STATES, T1, T2 } from './states.js';

export const KEYS = ['alice', 'bob'];

// The server in a state.
export function serverOf(s) {
  if (s.part === 1) return view(READS.events[s.t1 - 3].server);
  if (s.t2 >= 3) return view(event(T2[s.t2].at, T2[s.t2].nth || 0).server);
  if (s.t1 > 3) return view(event(T1[s.t1]).server);
  return view(event(T2[s.t2].at).server);
}

// The auditor's reads at each moment: what each read saw, and, for its
// transaction's, whether it was a staged value, found through the ATR.
export const AUDIT = READS.events.map((e) => {
  const v = view(e.server);
  const out = { at: e.at, plain: {}, txn: {}, staged: {}, checked: {}, atrState: null, wrote: e.seen.wrote, atrChecks: e.seen.atrChecks };
  for (const k of KEYS) {
    out.plain[k] = e.seen.plain[k].balance;
    out.txn[k] = e.seen.txn[k].balance;
    out.checked[k] = !!v.docs[k].txn;
    out.staged[k] = out.txn[k] !== v.docs[k].balance;
  }
  const entry = v.atrs[ATRS[0]] && v.atrs[ATRS[0]][0];
  out.atrState = entry ? entry.st : null;
  out.total = { plain: out.plain.alice + out.plain.bob, txn: out.txn.alice + out.txn.bob };
  return out;
});

// T2's two attempts' reads: each doc's balance, and its CAS then.
export const T2_READS = [1, 2].map((n) => event(`t2 attempt ${n} read`).seen);

// "was N": a doc's body before its last change, in each state (within a
// part; null if it hasn't changed).
export const GHOST = {};
{
  let part = null, last = {}, ghost = {};
  for (const s of STATES) {
    if (s.part !== part) { part = s.part; last = {}; ghost = {}; }
    const v = serverOf(s);
    for (const k of KEYS) {
      const b = v.docs[k].balance;
      if (last[k] != null && last[k] !== b) ghost[k] = last[k];
      last[k] = b;
    }
    GHOST[s.key] = { ...ghost };
  }
}
