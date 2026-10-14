// The text and the diagram in lockstep. A step that plays two or more
// of the planner's decisions as it scrolls must name each partition
// decided, or say that it sums them up ("the rest", "the other", "and so on"), so
// the diagram never works through partitions the text doesn't mention.
// For 01-planning and 03-groups, which share this page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listExplainers, loadExplainer } from '../../../../engine/build/explainers.mjs';
import { flattenSteps, resolveViews } from '../../../../engine/js/story/timeline.js';
import { useDomain } from '../../../../engine/js/domain.js';
import * as domain from '../domain.js';
import { FRAMES } from '../scenarios.js';
import { framePath } from '../story.js';

const SUMS_UP = /\b(the rest|the other|and so on|the same way|remaining)\b/i;

// The partitions a text names: "partition 3", "partitions 0 and 1".
export function partitionsNamed(text) {
  const out = new Set();
  for (const m of text.matchAll(/\bpartitions?\s+((?:\d+(?:,\s*|\s+and\s+|\s*))+)/gi)) {
    for (const d of m[1].match(/\d+/g)) out.add(d);
  }
  return out;
}

test('partitionsNamed', () => {
  assert.deepEqual([...partitionsNamed('partition 3, then partitions 0 and 1, and partitions 4, 5 and 6')], ['3', '0', '1', '4', '5', '6']);
});

useDomain(domain);
for (const e of listExplainers().map(loadExplainer).filter((x) => /blance\/(01-planning|03-groups)$/.test(x.rel))) {
  test(`${e.rel}: a step that plays several decisions names each partition`, () => {
    const steps = flattenSteps(e.narrative);
    const views = resolveViews(steps);
    const bad = [];
    steps.forEach((st, i) => {
      if (i === 0) return;
      const picks = framePath(views[i - 1].at, views[i].at).slice(1)
        .map((k) => FRAMES[k]).filter((f) => f.decision && !f.sub).map((f) => String(f.decision.partition));
      if (picks.length < 2 || SUMS_UP.test(st.text)) return;
      const named = partitionsNamed(st.text);
      const missing = [...new Set(picks)].filter((p) => !named.has(p));
      if (missing.length) bad.push(`${st.chapterId}/${st.id} plays partitions ${picks.join(', ')}, and its text doesn't name ${missing.join(', ')}`);
    });
    assert.deepEqual(bad, []);
  });
}
