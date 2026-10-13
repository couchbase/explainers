// Checks the JS port of blance's planner and moves (lib/plan.js,
// lib/moves.js) against golden cases from the real blance
// (tools/plan-golden): the same next map, warnings and moves, case by
// case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planNextMap, sortStateNames } from '../plan.js';
import { calcPartitionMoves } from '../moves.js';

const { cases } = JSON.parse(readFileSync(new URL('./golden-plan.json', import.meta.url)));

// Go's nil and empty slices are both [] here.
const norm = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, p]) => [k, Object.fromEntries(
  Object.entries(p.nodesByState || {}).map(([s, ns]) => [s, ns || []]))]));
const hierarchyRules = (r) => r && Object.fromEntries(Object.entries(r).map(([s, rules]) =>
  [s, rules.map((x) => ({ includeLevel: x.includeLevel, excludeLevel: x.excludeLevel }))]));
const model = (m) => Object.fromEntries(Object.entries(m).map(([s, x]) => [s, { priority: x.priority, constraints: x.constraints }]));

test('golden cases exist, with warnings, groups and changes', () => {
  assert.ok(cases.length > 100);
  assert.ok(cases.some((c) => Object.keys(c.warnings || {}).length));
  assert.ok(cases.some((c) => c.opts.nodeHierarchy));
  assert.ok(cases.some((c) => (c.nodesToRemove || []).length) && cases.some((c) => (c.nodesToAdd || []).length));
});

for (const c of cases) {
  test(`plan: ${c.name}`, () => {
    const { nextMap, warnings } = planNextMap(c.prevMap, c.prevMap, c.nodesAll, c.nodesToRemove, c.nodesToAdd, model(c.model),
      { ...c.opts, hierarchyRules: hierarchyRules(c.opts.hierarchyRules) });
    assert.deepEqual(norm(nextMap), norm(c.nextMap));
    assert.deepEqual(warnings, c.warnings || {});
    const states = sortStateNames(model(c.model));
    for (const [name, p] of Object.entries(c.prevMap)) {
      const end = c.nextMap[name].nodesByState;
      assert.deepEqual(calcPartitionMoves(states, p.nodesByState, end, false), c.moves[name] || [], `moves ${name}`);
      assert.deepEqual(calcPartitionMoves(states, p.nodesByState, end, true), c.movesMinNodes[name] || [], `moves (min nodes) ${name}`);
    }
  });
}
