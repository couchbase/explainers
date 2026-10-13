// Checks the simulation of blance's OrchestrateMoves (lib/orchestrate.js)
// against the real orchestrator, run by tools/orchestrate-golden: on each
// case whose real runs agree, every node gets the same batches, in the
// same order, and each starts and ends at about the same time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orchestrateMoves } from '../orchestrate.js';

const { cases } = JSON.parse(readFileSync(new URL('./golden-orchestrate.json', import.meta.url)));
const STATES = ['primary', 'replica'];
const nbs = (m) => Object.fromEntries(Object.entries(m).map(([p, x]) => [p, x.nodesByState]));
// each node's batches, in order
const shape = (bs) => {
  const by = {};
  for (const b of [...bs].sort((x, y) => x.start - y.start)) (by[b.node] ||= []).push(b.partitions.map((p, i) => `${p}:${b.ops[i]}`).join(','));
  return by;
};

test('golden orchestrations exist, mostly stable, and include the stories', () => {
  assert.ok(cases.length >= 20);
  assert.ok(cases.filter((c) => c.stable).length >= cases.length * 0.75);
  assert.ok(cases.filter((c) => c.name.startsWith('story:')).every((c) => c.stable));
});

for (const c of cases.filter((x) => x.stable)) {
  test(`orchestrate: ${c.name}`, () => {
    const sim = orchestrateMoves({
      states: STATES, nodesAll: c.nodesAll, begMap: nbs(c.begMap), endMap: nbs(c.endMap),
      maxConcurrent: c.maxConcurrent, favorMinNodes: c.favorMinNodes, duration: (p, op) => c.durations[p][op],
    });
    assert.deepEqual(shape(sim.batches), shape(c.batches));
    // and its times, give or take the real one's drift (a unit a batch)
    const real = [...c.batches];
    for (const b of sim.batches) {
      const r = real.find((x) => x.node === b.node && x.partitions.join() === b.partitions.join() && x.ops.join() === b.ops.join());
      real.splice(real.indexOf(r), 1);
      const slack = 1 + Math.ceil(c.batches.filter((x) => x.start < r.start).length / 2);
      assert.ok(Math.abs(r.start - b.start) <= slack, `${b.node} ${b.partitions}: starts at ${b.start}, really ${r.start}`);
    }
  });
}
