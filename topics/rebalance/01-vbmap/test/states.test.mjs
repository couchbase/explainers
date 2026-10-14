// The diagram's states: between neighbors, exactly one thing changes,
// so the scroll plays one change at a time (no flashing: nothing
// disappears and comes back in one move). And the facts the story
// rests on: the key's vbucket, by Couchbase's hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, changed } from '../states.js';
import { crc32, vbucketOf } from '../../lib/maps.js';

test('neighboring states differ in exactly one field', () => {
  for (let i = 1; i < STATES.length; i++) {
    const c = changed(STATES[i - 1], STATES[i]);
    assert.equal(c.length, 1, `${STATES[i - 1].key} -> ${STATES[i].key} changes ${c.join(', ') || 'nothing'}`);
  }
});

test('state keys are unique', () => {
  assert.equal(new Set(STATES.map((s) => s.key)).size, STATES.length);
});

test("Couchbase's key hash", () => {
  assert.equal(crc32('123456789'), 0xcbf43926); // the standard crc32 check value
  assert.equal(vbucketOf('airline_10', 1024), 361);
  assert.equal(vbucketOf('airline_10', 32), 9);
});
