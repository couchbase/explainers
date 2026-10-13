// This explainer's page is 01-planning's, so its styles must be too
// (the build takes each explainer's style.css from its own directory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('03-groups/style.css is 01-planning/style.css', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.equal(read('../style.css'), read('../../01-planning/style.css'), 'copy 01-planning/style.css to 03-groups/');
});
