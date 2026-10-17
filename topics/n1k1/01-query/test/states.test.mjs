// The diagram's states: between neighbors, exactly one thing changes,
// so the scroll plays one change at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, changed } from '../states.js';

test('neighboring states differ in exactly one field', () => {
  for (let i = 1; i < STATES.length; i++) {
    const c = changed(STATES[i - 1], STATES[i]);
    assert.equal(c.length, 1, `${STATES[i - 1].key} -> ${STATES[i].key} changes ${c.join(', ') || 'nothing'}`);
  }
});
