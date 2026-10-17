// The diagram's states, in story order. Each is the whole picture.
// Between two neighbors, exactly one thing changes (test/states.test.mjs
// checks), so the scroll plays one change at a time.
//
// A state's fields:
//   lanes   the two lanes and their heaps are shown
//   boxed   how many of the boxed lane's stages have run (0..4)
//   bytes   how many of the byte lane's stages have run (0..4)
//   twenty  the twenty rows' tallies are shown, under the heaps
//   group   GROUP BY, in the lanes' place: 0, not shown; 1, both
//           engines' group tables, empty; 2, after all 20 rows
//   order   ORDER BY, in the lanes' place: 0, not shown; 1, the rows,
//           unsorted; 2, each taken in, row by row; 3, sorted
//   join    the hash JOIN, in the lanes' place: 0, not shown; 1, the
//           orders, waiting; 2, the build, order by order; 3, the probe,
//           customer by customer, each match joined
//   table   the totals table, boxed and written back, in the lanes' place
//   fallback  which lane a query took, as n1k1's stats say
//
// Only one of the lanes, group, order, join, table and fallback panels shows
// at a time: the last one turned on.

const START = { lanes: false, boxed: 0, bytes: 0, twenty: false, group: 0, order: 0, join: 0, table: false, fallback: false };

const CHANGES = [
  ['start', {}],
  ['lanes', { lanes: true }],
  ...[1, 2, 3, 4].flatMap((k) => [[`boxed.${k}`, { boxed: k }], [`bytes.${k}`, { bytes: k }]]),
  ['twenty', { twenty: true }],
  ['group.1', { group: 1 }],
  ['group.2', { group: 2 }],
  ...[1, 2, 3].map((k) => [`order.${k}`, { order: k }]),
  ...[1, 2, 3].map((k) => [`join.${k}`, { join: k }]),
  ['table', { table: true }],
  ['fallback', { fallback: true }],
];

export const STATES = [];
{
  let s = START;
  CHANGES.forEach(([key, change], i) => {
    s = { ...s, ...change };
    STATES.push({ key, i, ...s });
  });
}
export const STATE = Object.fromEntries(STATES.map((s) => [s.key, s]));

export const changed = (a, b) => Object.keys(START).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

export function statePath(a, b) {
  const sa = STATE[a], sb = STATE[b];
  if (!sa || !sb || sb.i <= sa.i) return [a, b];
  return STATES.slice(sa.i, sb.i + 1).map((s) => s.key);
}

// The panel a state shows, in the lanes' place.
export function panelOf(s) {
  if (s.fallback) return 'fallback';
  if (s.table) return 'table';
  if (s.join) return 'join';
  if (s.order) return 'order';
  if (s.group) return 'group';
  return s.lanes ? 'lanes' : 'none';
}
