// The diagram's states, in story order. Each is the whole picture.
// Between two neighbors, exactly one thing changes (test/states.test.mjs
// checks), so the scroll plays one change at a time.
//
// A state's fields:
//   lanes   the two lanes and their heaps are shown
//   boxed   how many of the boxed lane's stages have run (0..4)
//   bytes   how many of the byte lane's stages have run (0..4)
//   twenty  the twenty rows' tallies are shown, under the heaps
//   table   the totals table, boxed and written back, in the lanes' place

const START = { lanes: false, boxed: 0, bytes: 0, twenty: false, table: false };

const CHANGES = [
  ['start', {}],
  ['lanes', { lanes: true }],
  ...[1, 2, 3, 4].flatMap((k) => [[`boxed.${k}`, { boxed: k }], [`bytes.${k}`, { bytes: k }]]),
  ['twenty', { twenty: true }],
  ['table', { table: true }],
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
