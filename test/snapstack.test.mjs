import test from 'node:test';
import assert from 'node:assert/strict';
import { stackFrame, MAX_BACK } from '../src/js/ui/snapstack.js';

const S = (epochs, persister = null, merger = null, query = null) => ({ epochs, persister, merger, query });

test('the current root is the front sheet; only older ones are drawn', () => {
  const f = stackFrame(S([5]), S([5]), 1);
  assert.deepEqual(f.sheets, []);
  assert.equal(f.readers.persister.o, 0);
});

test('a held old root slides back as a new root is swapped in', () => {
  const A = S([430], 430), B = S([438, 430], 430);
  const mid = stackFrame(A, B, 0.5);
  assert.deepEqual(mid.sheets, [{ epoch: 430, k: 0.5, o: 1 }]);
  assert.equal(mid.readers.persister.k, 0.5); // the ref arrow moves with it
  assert.equal(stackFrame(A, B, 1).readers.persister.k, 1);
});

test('a freed snapshot fades where it was', () => {
  const f = stackFrame(S([438, 430], 430), S([452]), 0.25);
  assert.deepEqual(f.sheets, [{ epoch: 430, k: 1, o: 0.75 }]);
  assert.equal(f.readers.persister.o, 0.75);
});

test('sheets past the deepest drawn one are hidden', () => {
  const f = stackFrame(S([9, 8, 7, 6, 5]), S([9, 8, 7, 6, 5]), 1);
  assert.equal(f.sheets.length, MAX_BACK);
  assert.ok(f.sheets.every((s) => s.k <= MAX_BACK));
});

import { Slots } from '../src/js/ui/slots.js';

test("a key arriving as others leave takes its own slot, not theirs", () => {
  const s = new Slots(5);
  s.sync(['a', 'b', 'c']);
  s.sync(['a', 'm']); // b and c merged into m
  assert.equal(s.get('a'), 0);
  assert.equal(s.get('m'), 3);
  s.sync(['a', 'm', 'n']); // later, freed slots are used again
  assert.equal(s.get('n'), 1);
});
