// Every explainer's narrative, checked against its own domain: the
// schema, its code refs, and that each step's state matches what its
// prose claims (`expect`): simulated, for an explainer with a
// simulation, or else checked against its facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { validateNarrative } from '../build/schema.mjs';
import { resolveAll, findLocal } from '../build/snippets.mjs';
import { listExplainers, loadExplainer } from '../build/explainers.mjs';
import { flattenSteps, modelAtStep, checkExpectation, shownChapters } from '../js/story/timeline.js';
import { useDomain } from '../js/domain.js';

const explainers = listExplainers().map(loadExplainer);

test('there is at least one explainer', () => assert.ok(explainers.length > 0));

for (const e of explainers) {
  const n = e.narrative;
  const domain = await import(pathToFileURL(join(e.dir, 'domain.js')).href);

  test(`${e.id}: every code ref has a snippet`, () => {
    for (const id of Object.keys(e.coderefs)) assert.ok(e.snippets[id], `missing snippet for ${id}; run npm run snippets`);
  });

  const haveSources = Object.entries(e.sources).every(([name, s]) => findLocal(s, name));
  test(`${e.id}: snippets.json matches the pinned sources`, { skip: !haveSources && 'local sources not available' }, () => {
    const { out, errors } = resolveAll(e);
    assert.deepEqual(errors, []);
    assert.deepEqual(out, e.snippets, `${e.rel}/snippets.json is stale; run npm run snippets`);
  });

  test(`${e.id}: schema`, () => {
    useDomain(domain);
    assert.deepEqual(validateNarrative(n, { coderefs: e.coderefs, sources: e.sources, file: `${e.rel}/narrative.yaml` }), []);
  });

  const steps = flattenSteps(n);
  steps.forEach((st, i) => {
    // With no simulation, `expect` is checked against the explainer's
    // facts (its real example data) instead.
    if (!domain.makeModel) {
      if (!(st.expect || []).length) return;
      test(`${e.id}: ${st.chapterId}/${st.id} states the facts`, () => {
        useDomain(domain);
        const m = domain.factModel();
        for (const x of st.expect) assert.ok(checkExpectation(x, m), `expected "${x}"`);
      });
      return;
    }
    test(`${e.id}: ${st.chapterId}/${st.id} simulates as described`, () => {
      useDomain(domain);
      const m = modelAtStep(n, steps, i);
      if (domain.checkInvariants) assert.deepEqual(domain.checkInvariants(m), []);
      for (const x of st.expect || []) {
        assert.ok(checkExpectation(x, m), `expected "${x}" at t=${m.now}ms`);
      }
    });
  });
}

test('a `stop` entry ends the page; chapters after it are still steps for the tests', () => {
  const st = { id: 's', text: 'x' };
  const n = { chapters: [{ id: 'a', title: 'a', steps: [st] }, { stop: 'drafts' }, { id: 'b', title: 'b', steps: [st] }] };
  assert.deepEqual(shownChapters(n).map((c) => c.id), ['a']);
  assert.deepEqual(flattenSteps(n).map((s) => s.chapterId), ['a', 'b']);
});
