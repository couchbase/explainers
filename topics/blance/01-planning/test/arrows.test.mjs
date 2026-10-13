// The arrows to the score strip: cause, then effect. For every decision
// of every scenario, sampled densely through each stage: no part of a
// bar grows before the arrow that brings it has landed, and each arrow
// lands on the top of the bar as it is when it arrives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, sourcesOf, PARTITIONS } from '../scenarios.js';
import { Diagram, flight, grown, through } from '../diagram.js';

const STEPS = 400; // samples per stage
for (const scn of Object.values(SCENARIOS)) {
  test(`arrows: ${scn.id}: each lands before its part grows, on the bar's top`, () => {
    const np = PARTITIONS.length;
    for (const f of scn.frames.filter((x) => x.sub && x.stage === 0)) {
      const d = f.decision;
      const src = sourcesOf(scn, d, d.before);
      d.seq.forEach((x, j) => {
        if (!x.term || x.term === 'sticky') return;
        const n = src[x.node][x.term].length;
        const c = d.scored.find((y) => y.node === x.node);
        for (let k = 0; k <= STEPS; k++) {
          const s = j - 1 + k / STEPS, u = through(s, j);
          for (let i = 0; i < n; i++) {
            // its part grows only once it's landed
            if (grown(u, i, n) > 0) assert.equal(flight(u, i, n), 1, `${f.key} ${x.node} ${x.term} #${i} grew in flight`);
          }
        }
        // where each lands: the bar's top just then
        for (let i = 0; i < n; i++) {
          const landing = j - 1 + (i + 0.7) / n;
          const b = Diagram.barAt(d, landing, x.node);
          const want = x.term === 'count' ? i / c.weight : x.term === 'spread' ? b.count + i / np / c.weight : b.spread;
          const top = x.term === 'count' ? b.count : x.term === 'spread' ? b.spread : b.spread;
          assert.ok(Math.abs(top - want) < 1e-9, `${f.key} ${x.node} ${x.term} #${i}: lands at ${want}, bar's top ${top}`);
        }
      });
    }
  });
}
