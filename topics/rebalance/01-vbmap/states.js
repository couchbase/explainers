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
//   lifted    the cluster (racks, nodes, copies) is up in its place; till
//             then it sits below the bucket's grid, so the two don't overlap
//   counts    each node's "serves N" label is shown
//   map       which deal: 'naive' or 'vbmap'
//   down      the nodes that are down: a grey curtain drops over each
//             (over its whole rack, if the rack is down); their copies
//             are unreachable, but keep their colors, on top
//   promoted  replicas whose active is unreachable are promoted
//   lost      vbuckets with no copy left are marked
//   ghost     a copy of the naive deal, shifted down, to compare

const START = {
  doc: true, split: false, scaffold: false, actives: false, replicas: false, lifted: false, counts: false,
  map: 'naive', down: [], promoted: false, lost: false, ghost: false,
};

// nodes failing (down, then failed over), and coming back
const fail = (prefix, nodes, { lost = false } = {}) => [
  [`${prefix}.down`, { down: nodes }],
  [`${prefix}.promoted`, { promoted: true }],
  ...(lost ? [[`${prefix}.lost`, { lost: true }], [`${prefix}.unlost`, { lost: false }]] : []),
  [`${prefix}.unpromoted`, { promoted: false }],
  [`${prefix}.up`, { down: [] }],
];

const CHANGES = [
  ['doc', {}],
  ['grid', { doc: false }],
  ['split', { split: true }],
  ['scaffold', { scaffold: true }],
  ['naive.actives', { actives: true }],
  ['naive.replicas', { replicas: true }],
  ['naive.lifted', { lifted: true }],
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
