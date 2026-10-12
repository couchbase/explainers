// The narrative schema's rules, with this explainer's names: it
// rejects common mistakes, enforces one change per step, and keeps
// callouts off closed lids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { validateNarrative } from '../../../../engine/build/schema.mjs';
import { useDomain } from '../../../../engine/js/domain.js';
import * as scorch from '../domain.js';

const coderefs = yaml.load(readFileSync(new URL('../coderefs.yaml', import.meta.url), 'utf8'));

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

