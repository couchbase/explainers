// The narrative schema's checks of a step's text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNarrative } from '../build/schema.mjs';
import { useDomain } from '../js/domain.js';

const DOMAIN = { CANVAS: [0, 0, 100, 100], CAMERAS: { overview: [0, 0, 100, 100] }, LIDS: {}, BUBBLES: {}, ANCHORS: {}, SECTION_COLORS: ['neutral'] };
const narrativeWith = (text) => ({
  title: 't', subtitle: 's', audience: 'a',
  chapters: [{ id: 'c', title: 'C', color: 'neutral', steps: [{ id: 's', text }] }],
});
const errorsFor = (text) => { useDomain(DOMAIN); return validateNarrative(narrativeWith(text)); };

test('a wrapped line that starts like a list item, mid-paragraph, is an error', () => {
  assert.match(errorsFor('Node d starts adding partition\n1. Node b is still adding.\n').join('\n'), /line 2 starts "1\. N".*rewrap/);
  assert.match(errorsFor('The moves for\n- node b are next.\n').join('\n'), /line 2 starts "- no"/);
});

test('a list in its own paragraph, or a code block, is fine', () => {
  assert.deepEqual(errorsFor('The knobs:\n\n- one,\n  wrapped;\n- two.\n'), []);
  assert.deepEqual(errorsFor('Loops:\n\n```\nfor each:\n- 1 + 2\n```\n'), []);
  assert.deepEqual(errorsFor('Just a paragraph, with 1. in it.\n'), []);
});
