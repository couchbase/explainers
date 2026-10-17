// The diagram's states, in story order. Each is the whole picture.
// Between two neighbors, exactly one thing changes (test/states.test.mjs
// checks), so the scroll plays one change at a time.
//
// A state's fields:
//   lanes   the two lanes and their heaps are shown
//   boxed   how many of the boxed lane's stages have run (0..4)
//   bytes   how many of the byte lane's stages have run (0..4)
//   twenty  the twenty rows' tallies are shown, under the heaps
//   group   GROUP BY, in the lanes' place: 0, not shown; 1, its query
//           alone; 2, both engines' group tables, empty; 3, after all
//           20 rows
//   order   ORDER BY, in the lanes' place: 0, not shown; 1, its query
//           alone; 2, the rows, unsorted; 3, each taken in, row by row;
//           4, sorted
//   join    the hash JOIN, in the lanes' place: 0, not shown; 1, its
//           query alone; 2, the orders, waiting; 3, the build, order by
//           order; 4, the probe, customer by customer, each match joined
//   table   the totals table, in the lanes' place: 1, the totals, as
//           written, and a question; 2, the answer: as boxed
//   window  a window function, in the lanes' place: 0, not shown; 1, its
//           query alone; 2, the rows, in their partitions; 3, row by
//           row, each running total
//   fallback  which lane a query took, as n1k1's stats say: 1, a native
//           query's; 2, and one with a boxed expression
//   summary   all of it together, each operation's cost per row: 1, cbq's;
//           2, and n1k1's; 3, and what to take away
//
// Only one of the lanes, group, order, join, table, fallback and summary
// panels shows
// at a time: the last one turned on.

const START = { lanes: false, boxed: 0, bytes: 0, twenty: false, group: 0, order: 0, join: 0, window: 0, table: 0, fallback: 0, summary: 0 };

const CHANGES = [
  ['start', {}],
  ['lanes', { lanes: true }],
  ...[1, 2, 3, 4].flatMap((k) => [[`boxed.${k}`, { boxed: k }], [`bytes.${k}`, { bytes: k }]]),
  ['twenty', { twenty: true }],
  // (each of these sections: its query alone, first, at level 1)
  ...[1, 2, 3].map((k) => [`group.${k}`, { group: k }]),
  ...[1, 2, 3, 4].map((k) => [`order.${k}`, { order: k }]),
  ...[1, 2, 3, 4].map((k) => [`join.${k}`, { join: k }]),
  ...[1, 2, 3].map((k) => [`window.${k}`, { window: k }]),
  ...[1, 2].map((k) => [`table.${k}`, { table: k }]),
  ...[1, 2].map((k) => [`fallback.${k}`, { fallback: k }]),
  ...[1, 2, 3].map((k) => [`summary.${k}`, { summary: k }]),
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
  if (s.summary) return 'summary';
  if (s.fallback) return 'fallback';
  if (s.table) return 'table';
  // (a section at level 1 shows its query alone: its panel, '<name>-q')
  const q = (name) => (s[name] === 1 ? `${name}-q` : name);
  if (s.window) return q('window');
  if (s.join) return q('join');
  if (s.order) return q('order');
  if (s.group) return q('group');
  return s.lanes ? 'lanes' : 'none';
}
