// The real runs (../lib/txn.json), as the diagram plays them: each
// write changes the one doc the ball goes to; a refused write, and
// every read, change nothing; and a transaction's read returns a staged
// value only when the ATR it points to says COMMITTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, changed } from '../states.js';
import { serverOf, AUDIT, KEYS } from '../model.js';
import { ATRS } from '../../lib/during.js';

// what differs between two servers: the docs and ATRs that changed
function diff(a, b) {
  const out = KEYS.filter((k) => JSON.stringify(a.docs[k]) !== JSON.stringify(b.docs[k]));
  for (const k of ATRS) if (JSON.stringify(a.atrs[k]) !== JSON.stringify(b.atrs[k])) out.push(k);
  return out;
}

// the doc each change writes, by its field and new value
const WRITES = {
  t1: { 4: [ATRS[0]], 5: ['alice'], 6: ['bob'], 7: [ATRS[0]] },
  t2: { 1: [], 2: [], 3: [], 4: [ATRS[1]], 5: [], 6: [ATRS[1]], 7: [ATRS[1]], 8: [], 9: [ATRS[1]], 10: ['bob'], 11: ['alice'], 12: [ATRS[1]], 13: ['bob'], 14: ['alice'], 15: [ATRS[1]] },
};

test('each change writes just the doc the diagram sends its ball to', () => {
  for (let i = 1; i < STATES.length; i++) {
    const A = STATES[i - 1], B = STATES[i], f = changed(A, B)[0];
    if (f === 'part') continue;
    const want = WRITES[f] ? WRITES[f][B[f]] : [];
    assert.deepEqual(diff(serverOf(A), serverOf(B)), want, `${A.key} -> ${B.key}`);
  }
});

test("the auditor's reads write nothing, and look up the ATR for each staged doc", () => {
  for (const a of AUDIT) {
    assert.equal(a.wrote, false, a.at);
    assert.equal(a.atrChecks.length, KEYS.filter((k) => a.checked[k]).length, a.at);
  }
});

test("a transaction's read returns a staged value only if its ATR says COMMITTED", () => {
  for (const a of AUDIT) {
    for (const k of KEYS) {
      if (a.staged[k]) assert.equal(a.atrState, 'COMMITTED', `${a.at} ${k}`);
      if (a.checked[k] && a.atrState === 'COMMITTED') assert.equal(a.staged[k], true, `${a.at} ${k}`);
    }
    assert.equal(a.total.txn, 150, a.at);
  }
});
