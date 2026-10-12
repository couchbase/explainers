// Narrative content checks: schema, code refs, and that each step's
// simulated state matches what its prose claims (`expect`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import yaml from 'js-yaml';
import { validateNarrative } from '../build/schema.mjs';
import { resolveAll, findLocal } from '../build/snippets.mjs';
import { flattenSteps, modelAtStep, checkExpectation } from '../src/js/story/timeline.js';
import { checkInvariants } from '../src/explainers/scorch-goroutines/sim/invariants.js';
import { useDomain } from '../src/js/domain.js';
import * as scorch from '../src/explainers/scorch-goroutines/domain.js';

// Each narrative is checked against its explainer (see src/js/domain.js);
// the schema's own tests use the first explainer's names.
const domainOf = (n) => import(`../src/explainers/${n.explainer}/domain.js`);

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
  const domain = await domainOf(n);

  test(`${f}: schema`, () => {
    useDomain(domain);
    assert.deepEqual(validateNarrative(n, { coderefs, sources, file: f }), []);
  });

  const steps = flattenSteps(n);
  steps.forEach((st, i) => {
    // With no simulation, `expect` is checked against the explainer's
    // facts (its real example data) instead.
    if (!domain.makeModel) {
      if (!(st.expect || []).length) return;
      test(`${f}: ${st.chapterId}/${st.id} states the facts`, () => {
        useDomain(domain);
        const m = domain.factModel();
        for (const e of st.expect) assert.ok(checkExpectation(e, m), `expected "${e}"`);
      });
      return;
    }
    test(`${f}: ${st.chapterId}/${st.id} simulates as described`, () => {
      useDomain(domain);
      const m = modelAtStep(n, steps, i);
      assert.deepEqual(checkInvariants(m), []);
      for (const e of st.expect || []) {
        assert.ok(checkExpectation(e, m), `expected "${e}" at t=${m.now}ms`);
      }
    });
  });
}

test('schema rejects common mistakes', () => {
  useDomain(scorch);
  const bad = {
    title: 'x',
    chapters: [{ id: 'c', title: 'c', color: 'plaid', steps: [
      { id: 's', text: 'hi [[a]] and [[b]]', sim: { set: { nope: 1 }, until: 'nowhere' }, view: { camera: 'moon', open: ['lid9'], target: 'zzz' }, code: ['missing.ref'], typo: 1 },
    ] }],
  };
  const joined = validateNarrative(bad, { coderefs }).join('\n');
  for (const frag of ['unknown key "typo"', 'unknown sim config key: nope', 'unknown camera "moon"', 'unknown lid "lid9"',
    'unknown target "zzz"', 'unknown code ref "missing.ref"', 'first step must have sim.reset', 'at most one [[callout]]',
    'unknown color "plaid"', 'unknown sim.until stage "nowhere"']) {
    assert.ok(joined.includes(frag), `missing error: ${frag}\n${joined}`);
  }
});

test('schema enforces one change per step, and lid visibility', () => {
  useDomain(scorch);
  const n = (steps) => ({ title: 'x', chapters: [{ id: 'c', title: 'c', steps }] });
  const two = n([
    { id: 'a', text: 'a', sim: { reset: true } },
    { id: 'b', text: 'b', view: { camera: 'cbft', open: ['kv'] } },
  ]);
  assert.match(validateNarrative(two, { coderefs }).join('\n'), /changes camera and lids at once/);
  const ok = n([
    { id: 'a', text: 'a', sim: { reset: true } },
    { id: 'b', text: 'b', view: { camera: 'cbft', open: ['kv'] }, multi: true },
  ]);
  assert.deepEqual(validateNarrative(ok, { coderefs }), []);
  const hidden = n([
    { id: 'a', text: 'see [[it]]', sim: { reset: true }, view: { target: 'dcp' } },
  ]);
  assert.match(validateNarrative(hidden, { coderefs }).join('\n'), /hidden under a closed lid/);
  const orphan = n([
    { id: 'a', text: 'a', sim: { reset: true }, view: { open: ['persister'] } },
  ]);
  assert.match(validateNarrative(orphan, { coderefs }).join('\n'), /parent "scorch" isn't/);
});

test('a `stop` entry ends the page; chapters after it are still steps for the tests', async () => {
  useDomain(scorch);
  const { shownChapters, flattenSteps } = await import('../src/js/story/timeline.js');
  const st = { id: 's', text: 'x' };
  const n = { chapters: [{ id: 'a', title: 'a', steps: [st] }, { stop: 'drafts' }, { id: 'b', title: 'b', steps: [st] }] };
  assert.deepEqual(shownChapters(n).map((c) => c.id), ['a']);
  assert.deepEqual(flattenSteps(n).map((s) => s.chapterId), ['a', 'b']);
});
