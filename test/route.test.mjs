// The batch marker's routing rule: leave a box vertically, travel the
// gaps between boxes, enter the destination's box vertically, and never
// cut through a box on the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, usesArrowHop } from '../src/js/ui/transitions.js';
import { STATIONS, BOXES } from '../src/js/ui/layout.js';

const boxes = Object.values(BOXES);
const inside = (b, [x, y]) => x > b[0] && x < b[0] + b[2] && y > b[1] && y < b[1] + b[3];
const crosses = (p, q, b) => {
  const [x0, x1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])];
  const [y0, y1] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
  return x1 > b[0] && x0 < b[0] + b[2] && y1 > b[1] && y0 < b[1] + b[3];
};

// Places the marker visits: fixed stations, plus sample cells, file
// bars and directory icons (as the diagram positions them).
const places = [
  ...Object.entries(STATIONS).map(([st, p]) => ({ st, p })),
  { st: 'cell', key: 1, p: [101, 893] }, { st: 'cell', key: 2, p: [339, 949] }, { st: 'cell', key: 3, p: [451, 991] },
  { st: 'bar', key: 4, p: [527, 940] }, { st: 'bar', key: 5, p: [869, 940] },
  { st: 'icon', key: 'a', p: [76, 1397] }, { st: 'icon', key: 'b', p: [400, 1485] },
];

test('routes never cut through a box, and leave and enter boxes vertically', () => {
  let checked = 0;
  for (const a of places) {
    for (const b of places) {
      if (a === b) continue;
      const pts = route(a, b);
      const ends = boxes.filter((bx) => inside(bx, a.p) || inside(bx, b.p));
      // A hop along a drawn arrow may enter the introducer from the side.
      const arrow = usesArrowHop(a, b);
      if (arrow) ends.push(BOXES.introducer);
      for (let k = 1; k < pts.length; k++) {
        const [p, q] = [pts[k - 1], pts[k]];
        assert.ok(p[0] === q[0] || p[1] === q[1], `${a.st}>${b.st}: segment ${k} isn't horizontal or vertical`);
        for (const bx of boxes) {
          if (ends.includes(bx)) continue;
          assert.ok(!crosses(p, q, bx), `${a.st}>${b.st}: cuts through box ${bx} (${p} -> ${q})`);
        }
      }
      for (const bx of boxes) {
        if (inside(bx, a.p) && !inside(bx, b.p) && !(arrow && bx === BOXES.introducer)) assert.equal(pts[1][0], a.p[0], `${a.st}>${b.st}: leaves its box sideways`);
        if (inside(bx, b.p) && !inside(bx, a.p) && !(arrow && bx === BOXES.introducer)) assert.equal(pts[pts.length - 2][0], b.p[0], `${a.st}>${b.st}: enters its box sideways`);
      }
      checked++;
    }
  }
  assert.ok(checked > 100);
});

test('our segment goes down out of the root snapshot, then left to the persister', () => {
  const pts = route({ st: 'cell', key: 2, p: [339, 949] }, { st: 'persisting', p: STATIONS.persisting });
  const [r] = [BOXES.root];
  assert.deepEqual(pts[1], [339, r[1] + r[3] + 10], 'first straight down, out of the root');
  assert.equal(pts[2][1], pts[1][1], 'then horizontally, in the gap');
});

test('our new file rides the introduce arrow into the introducer, onto its merges channel', () => {
  const pts = route({ st: 'written', p: STATIONS.written }, { st: 'fileIntroducing', p: STATIONS.fileIntroducing });
  assert.ok(pts.some(([x, y]) => x === STATIONS.introducing[0] && y === STATIONS.introducing[1]), 'via the end of the introduce arrow');
  assert.deepEqual(pts[pts.length - 1], STATIONS.fileIntroducing);
});
