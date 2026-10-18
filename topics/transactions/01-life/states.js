// The diagram's states, in story order. Each is the whole picture.
// Between two neighbors, exactly one thing changes (test/states.test.mjs
// checks), so the scroll plays one change at a time.
//
// A state's fields:
//   reads   how many of the two reads the app has made (0..2)
//   track   the transaction's writes, in order, are shown
//   writes  how many of those writes have landed (0..7); the server
//           shows the snapshot just after the last (see ../lib/txn.js)
//   halves  the track's two halves are named: before the commit point,
//           rolled back; after it, rolled forward
//   clean   the end: no current line, nothing in flight

import { WRITES } from '../lib/txn.js';

const START = { reads: 0, track: false, writes: 0, halves: false, clean: false };

const CHANGES = [
  ['start', {}],
  ['get.alice', { reads: 1 }],
  ['get.bob', { reads: 2 }],
  ['track', { track: true }],
  ...WRITES.slice(0, 4).map((w, i) => [w.key, { writes: i + 1 }]),
  ['halves', { halves: true }],
  ...WRITES.slice(4).map((w, i) => [w.key, { writes: i + 5 }]),
  ['clean', { clean: true }],
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
