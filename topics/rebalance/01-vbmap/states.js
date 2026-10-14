// The diagram's states, in story order. Each is the whole picture:
// where the copies are, which nodes are down, and so on. Between two
// neighbors, exactly one thing changes (test/states.test.mjs checks),
// so the scroll from one step to the next plays one change at a time.
//
// A state's fields:
//   doc       the document card, airline_10, is shown
//   split     each vbucket shows its two copies, side by side
//   scaffold  the racks and the nodes' bins are shown
//   actives   the actives are dealt to their nodes
//   replicas  the replicas are dealt to their nodes
//   counts    each node's "serves N" label is shown
//   map       which deal: 'naive' or 'vbmap'
//   down      the nodes that are down (their bins grey)
//   grey      the nodes whose copies are greyed (they're unreachable)
//   promoted  replicas whose active is unreachable are promoted
//   lost      vbuckets with no copy left are marked
//   ghost     a copy of the naive deal, shifted down, to compare

const START = {
  doc: true, split: false, scaffold: false, actives: false, replicas: false, counts: false,
  map: 'naive', down: [], grey: [], promoted: false, lost: false, ghost: false,
};

// a node failing, as four states, and coming back, as four more
const fail = (prefix, nodes, { lost = false } = {}) => [
  [`${prefix}.down`, { down: nodes }],
  [`${prefix}.grey`, { grey: nodes }],
  [`${prefix}.promoted`, { promoted: true }],
  ...(lost ? [[`${prefix}.lost`, { lost: true }], [`${prefix}.unlost`, { lost: false }]] : []),
  [`${prefix}.unpromoted`, { promoted: false }],
  [`${prefix}.ungrey`, { grey: [] }],
  [`${prefix}.up`, { down: [] }],
];

const CHANGES = [
  ['doc', {}],
  ['grid', { doc: false }],
  ['split', { split: true }],
  ['scaffold', { scaffold: true }],
  ['naive.actives', { actives: true }],
  ['naive.replicas', { replicas: true }],
  ['naive.counts', { counts: true }],
  ...fail('naive.c', ['c']),
  ...fail('naive.east', ['a', 'b'], { lost: true }),
  ['ghost', { ghost: true }],
  ['vbmap', { map: 'vbmap' }],
  ...fail('vbmap.c', ['c']),
  ...fail('vbmap.east', ['a', 'b']),
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
