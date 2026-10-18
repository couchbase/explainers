// The diagram's states, in story order. Each is the whole picture.
// Between two neighbors, exactly one thing changes (test/states.test.mjs
// checks), so the scroll plays one change at a time.
//
// A state's fields:
//   part     1, the reads; 2, the conflict (a fresh run, rewound to the
//            same pause)
//   t1       the transfer's writes landed (of 01's seven): 3, both
//            staged, where it's paused; 4, COMMITTED; 5, alice
//            unstaged; 6, bob unstaged; 7, its ATR entry gone
//   audit    part 1: the auditor's reads done, two per moment (plain,
//            then in a transaction), 0..6
//   verdict  part 1: the totals judged
//   t2       part 2: how far T2, bob pays alice 5, has got (see T2 below)
//   clean    the end: nothing in flight

const START = { part: 1, t1: 3, audit: 0, verdict: false, t2: 0, clean: false };

// T2's steps, by its t2: each a request, and the event after it (see
// ../lib/during.js)
export const T2 = [
  { key: 'start', at: 't1 paused' },
  { key: 'read', at: 't2 attempt 1 read' },
  { key: 'poll', at: 't2 poll 1' },
  { key: 'resolved', at: 't2 poll 2' },
  { key: 'pending', at: 't2 AfterATRPending', nth: 0 },
  { key: 'cas', at: 't2 attempt 1 failed' },
  { key: 'aborted', at: 't2 AfterATRAborted' },
  { key: 'rolledback', at: 't2 AfterATRRolledBack' },
  { key: 'read2', at: 't2 attempt 2 read' },
  { key: 'pending2', at: 't2 AfterATRPending', nth: 1 },
  { key: 'stage.bob', at: 't2 AfterStagedReplaceComplete bob' },
  { key: 'stage.alice', at: 't2 AfterStagedReplaceComplete alice' },
  { key: 'commit', at: 't2 AfterATRCommit' },
  { key: 'unstage.bob', at: 't2 AfterDocCommitted bob' },
  { key: 'unstage.alice', at: 't2 AfterDocCommitted alice' },
  { key: 'complete', at: 't2 AfterATRComplete' },
];
// the transfer's writes, as it runs on while T2 waits
export const T1 = { 4: 't1 AfterATRCommit', 5: 't1 AfterDocCommitted alice', 6: 't1 AfterDocCommitted bob', 7: 't1 AfterATRComplete' };
// (T2 waits, polling, from its poll until it's resolved)
export const T2_WAITS = 2;

const CHANGES = [
  ['start', {}],
  ...[1, 2].map((k) => [`audit.${k}`, { audit: k }]),
  ['t1.commit', { t1: 4 }],
  ...[3, 4].map((k) => [`audit.${k}`, { audit: k }]),
  ['t1.alice', { t1: 5 }],
  ...[5, 6].map((k) => [`audit.${k}`, { audit: k }]),
  ['verdict', { verdict: true }],
  ['rewind', { part: 2, t1: 3, audit: 0, verdict: false }],
  ['t2.read', { t2: 1 }],
  ['t2.poll', { t2: 2 }],
  ...[4, 5, 6, 7].map((k) => [`t1.${k}`, { t1: k }]),
  ...T2.slice(3).map((s, i) => [`t2.${s.key}`, { t2: i + 3 }]),
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

// (the rewind changes the part, and resets what the part shows)
export const changed = (a, b) => (a.part !== b.part ? ['part'] : Object.keys(START).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])));

export function statePath(a, b) {
  const sa = STATE[a], sb = STATE[b];
  if (!sa || !sb || sb.i <= sa.i) return [a, b];
  return STATES.slice(sa.i, sb.i + 1).map((s) => s.key);
}
