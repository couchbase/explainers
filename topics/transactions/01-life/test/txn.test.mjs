// The transaction's real run (../lib/txn.json), as the diagram plays
// it: each write changes the one doc the diagram moves; a staged value
// waits in the doc's "txn" xattr while its body stays as it was; and
// unstaging makes the staged value the body, and removes the xattr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TXN, WRITES, KEYS, snap, serverAt, docView, atrView, changedDocs } from '../../lib/txn.js';

test('the run: completed, with the ATR for alice\'s vbucket', () => {
  assert.equal(TXN.state, 'completed');
  assert.match(TXN.atr, new RegExp(`^_txn:atr-${TXN.vb.alice}-`));
});

test('reads write nothing; nothing at all is written before the first Replace', () => {
  const seed = snap('begun');
  for (const at of ['Got alice', 'Got bob', 'BeforeATRPending']) assert.deepEqual(changedDocs(seed, snap(at)), [], at);
  assert.equal(snap('BeforeATRPending').atr, null);
});

test('each write changes one doc: the one the diagram moves', () => {
  WRITES.forEach((w, i) => assert.deepEqual(changedDocs(serverAt(i), serverAt(i + 1)), [w.doc], w.key));
});

test('staging leaves the body; unstaging makes the staged value the body', () => {
  for (const k of KEYS) {
    const stage = WRITES.findIndex((w) => w.key === `stage.${k}`) + 1;
    const unstage = WRITES.findIndex((w) => w.key === `unstage.${k}`) + 1;
    const before = docView(serverAt(stage - 1), k), staged = docView(serverAt(stage), k), after = docView(serverAt(unstage), k);
    assert.equal(before.txn, null, k);
    assert.equal(staged.body, before.body, k);
    assert.equal(staged.txn.atr, TXN.atr, k);
    assert.equal(staged.txn.type, 'replace', k);
    assert.equal(staged.txn.stgd, TXN.values[k], k);
    // (until it's unstaged, the body stays, even past the commit point)
    assert.equal(docView(serverAt(unstage - 1), k).body, before.body, k);
    assert.equal(after.txn, null, k);
    assert.equal(after.body, staged.txn.stgd, k);
  }
});

test('the ATR: PENDING, then COMMITTED with the docs, then its entry gone', () => {
  const states = WRITES.map((_, i) => atrView(serverAt(i + 1)));
  assert.deepEqual(states.map((v) => v.entry && v.entry.st), ['PENDING', 'PENDING', 'PENDING', 'COMMITTED', 'COMMITTED', 'COMMITTED', null]);
  assert.equal(states[0].entry.rep, null);
  assert.deepEqual(states[3].entry.rep, KEYS);
});
