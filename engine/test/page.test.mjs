import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSiblings } from '../js/ui/page.js';

test('hasSiblings: served, or from disk in its topic directory, but not a stray copy', () => {
  const at = (protocol, pathname) => hasSiblings({ protocol, pathname }, 'cbft/01-indexing');
  assert.ok(at('https:', '/explainers/cbft/01-indexing.html'));
  assert.ok(at('http:', '/anything.html'));
  assert.ok(at('file:', '/Users/me/explainers/dist/cbft/01-indexing.html'));
  assert.ok(at('file:', '/Users/me/explainers/dist/cbft/01-indexing-drafts.html'));
  assert.ok(at('file:', '/C:/Users/me/my%20stuff/cbft/01-indexing.html'));
  assert.ok(!at('file:', '/Users/me/Downloads/01-indexing.html'));
  assert.ok(!at('file:', '/Users/me/Downloads/01-indexing (1).html'));
  assert.ok(!at('file:', '/Users/me/Downloads/cbft-01-indexing.html'));
});
