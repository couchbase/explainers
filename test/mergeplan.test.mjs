// Checks the JS mergeplan port against golden plans produced by
// bleve's real Go mergeplan package (tools/mergeplan-golden).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plan, calcBudget, DefaultMergePlanOptions } from '../src/explainers/scorch-goroutines/sim/mergeplan.js';

const cases = JSON.parse(readFileSync(new URL('./golden-mergeplan.json', import.meta.url)));

test('golden cases exist and include non-trivial plans', () => {
  assert.ok(cases.length >= 100);
  assert.ok(cases.filter((c) => c.tasks.length > 1).length >= 10);
});

test('JS mergeplan matches Go mergeplan on golden cases', () => {
  let mismatches = [], compared = 0;
  cases.forEach((c, i) => {
    const got = plan(c.segments, c.options).tasks.map((t) => t.segments.map((s) => s.id));
    // Go's sort.Sort is unstable, so only compare when live sizes are distinct.
    const lives = c.segments.map((s) => s.liveSize);
    if (new Set(lives).size !== lives.length) return;
    compared++;
    try { assert.deepEqual(got, c.tasks); } catch { mismatches.push(i); }
  });
  assert.deepEqual(mismatches, []);
  assert.ok(compared >= 200, `only compared ${compared} cases`);
});

test('calcBudget staircase', () => {
  const o = DefaultMergePlanOptions;
  assert.equal(calcBudget(0, 2000, o), 0);
  assert.equal(calcBudget(2000 * 5, 2000, o), 5);
  // 10 at tier 1 (20000), remaining 80000 at tier 2 (20000 each) -> 4
  assert.equal(calcBudget(100000, 2000, o), 14);
});
