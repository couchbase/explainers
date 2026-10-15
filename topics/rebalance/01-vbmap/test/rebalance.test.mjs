// The port of ns_server's map picking (lib/rebalance.js): hand-worked
// cases for its pieces, and, on the real runs, what must hold whatever
// the details: seating only reorders vbmap's chains, never costs more
// than vbmap's own order, and the pick is the cheapest of the nine,
// the same one the golden tool's Go port picked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listcmp, genmerge, simpleMinimizeMoves, vbucketMovements, maybeMinimize, pickMap, scoreLess, UNDEFINED } from '../../lib/rebalance.js';
import { MAPS, FIVE, SIX } from '../deals.js';
import { PICKS } from '../../lib/maps.js';

test('listcmp: element by element, up to the shorter list', () => {
  assert.equal(listcmp(['a', 'b'], ['a', 'c']), -1);
  assert.equal(listcmp(['b'], ['a', 'z']), 1);
  assert.equal(listcmp(['a'], ['a', 'z']), 0);
  assert.equal(listcmp([], ['a']), 0);
});

test('genmerge: pairs the equal, leaves the rest', () => {
  const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
  assert.deepEqual(genmerge(cmp, [1, 2, 4, 6], [2, 3, 4, 5]), { pairs: [[2, 2], [4, 4]], rest1: [1, 6], rest2: [3, 5] });
});

test('simple_minimize_moves: same chain first, then a replica that becomes the active, then the rest', () => {
  const current = [['a', 'b'], ['b', 'a'], ['c', 'a'], ['d', 'c']];
  const chains = [['a', 'c'], ['b', 'a'], ['a', 'b'], ['b', 'd']];
  const { map, pass } = simpleMinimizeMoves(current, chains, 2, ['a', 'b', 'c', 'd']);
  // vbuckets 0 and 1 keep their chains; 2's replica, a, becomes its
  // active; 3 takes what's left
  assert.deepEqual(map, [['a', 'b'], ['b', 'a'], ['a', 'c'], ['b', 'd']]);
  assert.deepEqual(pass, [0, 0, 1, 2]);
});

test('simple_minimize_moves: a leaving node is undefined, so matches nothing', () => {
  const { map } = simpleMinimizeMoves([['x', 'a'], ['a', 'b']], [['a', 'b'], ['b', 'a']], 2, ['a', 'b']);
  assert.deepEqual(map, [['b', 'a'], ['a', 'b']]);
});

test('vbucket_movements: [copies built from scratch, takeovers]', () => {
  assert.deepEqual(vbucketMovements([['a', 'b'], ['c', 'd']], [['b', 'a'], ['c', 'e']]), [0 + 1, 1]);
  assert.deepEqual(vbucketMovements([['a', 'b']], [['a', UNDEFINED]]), [0, 0]);
});

const sorted = (m) => m.map((c) => c.join()).sort();

test('on the real runs: seating only reorders the chains, and never costs more', () => {
  for (const [R, current, nodes] of [[FIVE, MAPS.vbmap, ['a', 'b', 'c', 'd', 'e']], [SIX, MAPS.uneven, ['a', 'b', 'c', 'd', 'e', 'f']]]) {
    for (const g of R.generated) {
      const r = maybeMinimize(current, g.map, nodes);
      assert.deepEqual(sorted(r.map), sorted(g.map), g.run);
      assert.ok(!scoreLess(r.asDealt, r.score), g.run);
    }
  }
});

test('the picks: the cheapest of nine, and the same as the golden tool\'s (its Go port)', () => {
  for (const [R, name] of [[FIVE, 'five'], [SIX, 'six']]) {
    assert.equal(R.tried.length, 9);
    for (const t of R.tried) assert.ok(!scoreLess(t.score, R.best.score));
    assert.equal(R.best.run, PICKS[name]);
  }
  assert.deepEqual(MAPS.uneven, FIVE.best.map);
  assert.deepEqual(MAPS.six, SIX.best.map);
});
