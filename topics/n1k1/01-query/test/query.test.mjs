// The JS working of the query (../lib/query.js) against what the real
// n1k1 printed (../lib/runs.json): the same rows, byte for byte, the
// same counts as its stats, and the plan the explainer draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUN, ORDERS, PASSED, SORTED, outputRow } from '../../lib/query.js';
import { OPS, opLook } from '../flow.js';
import { STATE } from '../states.js';

test('the rows: filtered, sorted and printed as n1k1 did, byte for byte', () => {
  assert.deepEqual(SORTED.map(outputRow), RUN.rows);
});

test('the counts: as n1k1\'s stats', () => {
  const line = (op) => RUN.stats.find((l) => l.trim().startsWith(`${op} `)).trim().split(/\s+/).slice(1);
  assert.deepEqual(line('datastore-scan-records'), [`${ORDERS.length}/${ORDERS.length}`]);
  assert.deepEqual(line('filter'), [String(ORDERS.length), String(PASSED.length)]);
  assert.deepEqual(line('order-offset-limit'), [String(PASSED.length), String(PASSED.length)]);
});

test('the plan drawn: n1k1\'s, as .explain prints it', () => {
  const s = STATE.strip;
  const drawn = ['strip', 'order', 'proj', 'filter', 'scan'].map((id) => opLook(s, id));
  drawn.forEach((d, i) => assert.equal(d.slot, i));
  assert.deepEqual(drawn.map((d) => d.title), RUN.plan.map((l) => l.trim().split(/\s+/)[0]));
  // (each one's params, as .explain shows them, but for its spacing)
  const params = RUN.plan.map((l) => l.trim().replace(/^\S+\s+/, ''));
  assert.equal(`[${drawn[0].params.replace(/, /g, ', ')}]`, params[0]);
  assert.equal(`[${drawn[4].params}]`, params[4]);
  assert.equal(drawn[3].params, params[3]);
  assert.ok(params[2].startsWith(`[${OPS.proj.params}`) && params[2].endsWith(', labelPath]'));
  assert.equal(`[${opLook(s, 'order').labels.join(' ')}]`, params[1]);
});

test('each total: found where it is in its doc', () => {
  for (const o of ORDERS) {
    assert.equal(o.doc.slice(o.total.start, o.total.end), o.total.bytes);
    assert.ok(/^\d+(\.\d+)?$/.test(o.total.bytes), o.name);
  }
});
