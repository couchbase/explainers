// The diagram's states, in story order. Each is the whole picture.
// Between two neighbors, exactly one thing changes (test/states.test.mjs
// checks), so the scroll from one step to the next plays one change at
// a time.
//
// A state's fields:
//   ns        the data directory's namespace and keyspaces are tagged
//   peek      the record buffer shows order-1001.json, as it is on disk
//   plan      which plan: 'none'; 'cbq' (cbq's planner's operators);
//             'nofetch' (its Fetch gone); 'n1k1' (n1k1's operators);
//             'aug' (the project carries the doc through, for the
//             sort); 'strip' (a last project strips it off)
//   labels    each operator's registers (its labels) are shown
//   prepared  the filter's setup: its constant parsed, its path lowered
//   yields    the push arrows: each operator yields rows to its parent
//   ev        how far the rows have got: an index into EVENTS (-1: none
//             read yet)
//   eof       the scan's end of input has reached the sort
//   sorted    the heap's rows are sorted
//   out       how many rows have been output
//   copies    the summary: where the query copies bytes

import { ORDERS } from '../lib/query.js';

// The rows' journey: each order file is read by the scan, then tested
// by the filter; one that passes goes on through the project, onto the
// sort's heap.
export const EVENTS = ORDERS.flatMap((o, file) => [
  { file, stage: 'read' },
  { file, stage: 'filter' },
  ...(o.pass ? [{ file, stage: 'project' }, { file, stage: 'order' }] : []),
]);
export const eventKey = (e) => `${ORDERS[e.file].stem.replace('order-', '')}.${e.stage}`;

const START = {
  ns: false, peek: false, plan: 'none', labels: false, prepared: false, yields: false,
  ev: -1, eof: false, sorted: false, out: 0, copies: false,
};
export const PLANS = ['none', 'cbq', 'nofetch', 'n1k1', 'aug', 'strip'];

const CHANGES = [
  ['start', {}],
  ['ns', { ns: true }],
  ['peek', { peek: true }],
  ...PLANS.slice(1).map((p) => [p, { plan: p }]),
  ['labels', { labels: true }],
  ['prepared', { prepared: true }],
  ['yields', { yields: true }],
  ...EVENTS.map((e, k) => [eventKey(e), { ev: k }]),
  ['eof', { eof: true }],
  ['sorted', { sorted: true }],
  ['out.1', { out: 1 }],
  ['out.2', { out: 2 }],
  ['out.3', { out: 3 }],
  ['copies', { copies: true }],
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

// The fields that differ between two states.
export const changed = (a, b) => Object.keys(START).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

// The states from a to b, in order (a later one), or just [a, b].
export function statePath(a, b) {
  const sa = STATE[a], sb = STATE[b];
  if (!sa || !sb || sb.i <= sa.i) return [a, b];
  return STATES.slice(sa.i, sb.i + 1).map((s) => s.key);
}
