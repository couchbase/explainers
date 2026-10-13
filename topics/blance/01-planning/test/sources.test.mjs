// The arrows the page draws, from the board to the score strip, show
// where each score term comes from: these check, for every decision in
// every scenario, that those sources add up to blance's own terms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, sourcesOf } from '../scenarios.js';

for (const scn of Object.values(SCENARIOS)) {
  test(`sources: ${scn.id}: each decision's terms come from the chips the page points at`, () => {
    const n = 8; // partitions
    for (const f of scn.frames.filter((x) => x.sub && x.stage === 0)) {
      const d = f.decision;
      const src = sourcesOf(scn, d, f.board);
      for (const c of d.scored) {
        const s = src[c.node];
        assert.equal(s.count.length, c.count, `${f.key} ${c.node}: count`);
        assert.ok(Math.abs(s.spread.length / n - c.lowerPriorityBalanceFactor) < 1e-12, `${f.key} ${c.node}: spread ${s.spread.length}/${n} vs ${c.lowerPriorityBalanceFactor}`);
        assert.ok(Math.abs((0.001 * s.fill.length) / n - c.filledFactor) < 1e-12, `${f.key} ${c.node}: fill ${s.fill.length} vs ${c.filledFactor}`);
        assert.equal(s.sticky.length ? 1.5 : 0, c.currentFactor, `${f.key} ${c.node}: sticky`);
      }
    }
  });
}
