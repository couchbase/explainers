// Narrative content checks: schema, code refs, and that each step's
// simulated state matches what its prose claims (`expect`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import yaml from 'js-yaml';
import { validateNarrative } from '../build/schema.mjs';
import { resolveAll, findLocal } from '../build/snippets.mjs';
import { flattenSteps, modelAtStep, EXPECTATIONS } from '../src/js/story/timeline.js';
import { checkInvariants } from '../src/js/sim/invariants.js';

const dir = new URL('../content/narratives/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
const coderefs = yaml.load(readFileSync(new URL('../content/coderefs.yaml', import.meta.url), 'utf8'));
const snippets = JSON.parse(readFileSync(new URL('../content/snippets.json', import.meta.url), 'utf8'));
const sources = yaml.load(readFileSync(new URL('../content/sources.yaml', import.meta.url), 'utf8'));

test('there is at least one narrative', () => assert.ok(files.length > 0));

test('every code ref has a snippet', () => {
  for (const id of Object.keys(coderefs)) assert.ok(snippets[id], `missing snippet for ${id}; run npm run snippets`);
});

const haveSources = Object.values(sources).every((s) => findLocal(s));
test('snippets.json matches the pinned sources', { skip: !haveSources && 'local sources not available' }, () => {
  const { out, errors } = resolveAll();
  assert.deepEqual(errors, []);
  assert.deepEqual(out, snippets, 'content/snippets.json is stale; run npm run snippets');
});

for (const f of files) {
  const n = yaml.load(readFileSync(new URL(f, dir), 'utf8'));

  test(`${f}: schema`, () => {
    assert.deepEqual(validateNarrative(n, { coderefs, file: f }), []);
  });

  const steps = flattenSteps(n);
  steps.forEach((st, i) => {
    test(`${f}: ${st.chapterId}/${st.id} simulates as described`, () => {
      const m = modelAtStep(n, steps, i);
      assert.deepEqual(checkInvariants(m), []);
      for (const e of st.expect || []) {
        assert.ok(EXPECTATIONS[e](m), `expected "${e}" at t=${m.now}ms`);
      }
    });
  });
}

test('schema rejects common mistakes', () => {
  const bad = {
    id: 'x', title: 'x',
    chapters: [{ id: 'c', title: 'c', steps: [
      { id: 's', text: 'hi', sim: { set: { nope: 1 } }, view: { focus: ['nowhere'] }, code: ['missing.ref'], typo: 1 },
    ] }],
  };
  const errs = validateNarrative(bad, { coderefs });
  const joined = errs.join('\n');
  for (const frag of ['unknown key "typo"', 'unknown sim config key: nope', 'unknown focus "nowhere"', 'unknown code ref "missing.ref"', 'first step must have sim.reset']) {
    assert.ok(joined.includes(frag), `missing error: ${frag}\n${joined}`);
  }
});
