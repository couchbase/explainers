// The merger bubble's staircase: the numbers the narrative quotes come
// from the real Plan() port, so check them here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planOf, exampleFiles, EXAMPLE_OPTS, stairScene, PLAN_PHASES, sizeLabel } from '../src/explainers/scorch-goroutines/stairs-scene.js';
import { calcBudget, DefaultMergePlanOptions } from '../src/js/sim/mergeplan.js';
import { ANCHORS, BUBBLES } from '../src/js/domain.js';
import { MB } from '../src/js/sim/config.js';

test('example: 20 files, budget 16 from 10 × 20MB + 6 × 200MB', () => {
  const P = planOf(exampleFiles(), EXAMPLE_OPTS);
  assert.equal(P.sorted.length, 20);
  assert.equal(P.budget, 16);
  assert.deepEqual(P.tiers.map((t) => [t.count, sizeLabel(t.size)]), [[10, '20MB'], [6, '200MB']]);
  assert.equal(sizeLabel(P.total), '1.29GB');
});

test('example: the plan merges the ten smallest (39MB), leaving 11 files', () => {
  const P = planOf(exampleFiles(), EXAMPLE_OPTS);
  assert.equal(P.tasks.length, 1);
  const task = P.tasks[0].segments;
  assert.equal(task.length, 10);
  assert.deepEqual(new Set(task), new Set(P.sorted.slice(-10)));
  assert.equal(task.reduce((s, f) => s + f.liveFileSize, 0), 39 * MB);
});

test('the drawn staircase has one stair per file of budget', () => {
  const o = { ...DefaultMergePlanOptions, ...EXAMPLE_OPTS };
  for (const n of [1, 3, 9, 25, 70]) {
    const files = Array.from({ length: n }, (_, i) => ({ id: i, fullSize: 1000 * (i + 1), liveSize: 1000 * (i + 1), fileSize: (i + 1) * 7 * MB, liveFileSize: (i + 1) * 7 * MB }));
    const P = planOf(files, EXAMPLE_OPTS);
    if (n > 1) assert.equal(P.tiers.reduce((s, t) => s + t.count, 0), P.budget, `n=${n}`);
    const total = files.reduce((s, f) => s + f.liveFileSize, 0);
    assert.equal(P.tiers.reduce((s, t) => s + t.count, 0), calcBudget(total, Math.max(7 * MB, o.floorSegmentFileSize), o));
  }
});

test('every phase draws inside the bubble, and its anchors exist', () => {
  const [x, y, w, h] = BUBBLES.merger.box;
  const live = { files: exampleFiles(), opts: EXAMPLE_OPTS, merging: new Set() };
  for (const ph of PLAN_PHASES) {
    const sc = stairScene(BUBBLES.merger.box, ph, live);
    for (const it of sc.items) {
      assert.ok(it.x >= x && it.x + (it.w || 0) <= x + w && it.y >= y && it.y + (it.h || 0) <= y + h, `${ph} ${it.key} out of the bubble`);
    }
  }
  for (const a of ['stairs', 'stairFiles', 'stairOver', 'stairPick', 'stairMerged']) assert.ok(ANCHORS[a], a);
});
