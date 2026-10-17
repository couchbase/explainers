// The two lanes' real run (../lib/boxed.json), as the explainer reads
// it: the same answers, row for row; the byte lane allocates nothing;
// the boxed lane's allocations are all placed in a stage; and the
// totals that change, boxed, are the ones whose text isn't a number's
// shortest form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROWS, HERO, ALLOCS, STAGES, CHANGED } from '../../lib/boxed.js';
import { NODES } from '../diagram.js';

test('both lanes: the same answers, and the filter\'s', () => {
  for (const r of ROWS) {
    assert.equal(r.native, r.boxed, r.file);
    assert.equal(r.native, String(r.order.pass), r.file);
  }
});

test('the byte lane allocates nothing; the boxed lane, every row', () => {
  for (const r of ROWS) {
    assert.equal(r.nativeAllocs, 0, r.file);
    assert.ok(r.boxedAllocs > 0 && r.allocs.length > 0, r.file);
    assert.ok(r.allocs.every((a) => STAGES.includes(a.stage)), r.file);
  }
});

test('the hero\'s allocations: each one a node in its stage', () => {
  assert.equal(HERO.file, 'order-1003.json');
  assert.equal(NODES.boxed.filter((n) => n.kind === 'heap').length, ALLOCS.length);
});

test('a total changes, boxed, exactly when its text isn\'t its number\'s shortest form', () => {
  const short = (t) => String(parseFloat(t));
  assert.deepEqual(CHANGED.map((r) => r.file), ROWS.filter((r) => short(r.order.total.bytes) !== r.order.total.bytes).map((r) => r.file));
  for (const r of ROWS) assert.equal(r.totalBoxed, short(r.order.total.bytes), r.file);
});
