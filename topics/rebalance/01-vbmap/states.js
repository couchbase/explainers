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
//   trails    the redeal's arcs (naive to vbmap) are shown, once it's dealt
//   down      the nodes that are down: a grey curtain drops over each
//             (over its whole rack, if the rack is down); their copies
//             are unreachable, but keep their colors, on top
//   promoted  replicas whose active is unreachable are promoted
//   lost      vbuckets with no copy left are marked
//   ghost     a copy of the naive deal, shifted down, to compare
//   chart     the seating chart's frame is shown (rows: actives' nodes;
//             columns: replicas' nodes)
//   view      where the copies are: 'bins' (on their nodes), or 'chart'
//             (in their seats)
//   chartUp   the chart is up in the cluster's place (else below it)
//   sums      the chart's sums are shown
//   cluster   which nodes: 'four', 'five' once node e joins rack West, or
//             'six' once node f joins rack East
//   holds     each node's count says how many replicas it holds, too
//   recolor   in the uneven deal, copies take their new homes' colors
//             (till then, they keep their old ones, from vbmap's deal)
//   tries     the table of ns_server's nine tries at the six-node map
//
// The maps (see deals.js): 'naive', 'vbmap' (four nodes), 'uneven' (five)
// and 'six'. In the five- and six-node maps, a copy on a node that
// didn't hold its vbucket before is built from scratch.

const START = {
  doc: true, split: false, scaffold: false, actives: false, replicas: false, lifted: false, counts: false,
  map: 'naive', trails: true, down: [], promoted: false, lost: false, ghost: false,
  chart: false, view: 'bins', chartUp: false, sums: false, cluster: 'four', holds: false, recolor: false, tries: false,
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
  ...fail('naive.west', ['a', 'b'], { lost: true }),
  ['ghost', { ghost: true }],
  ['vbmap', { map: 'vbmap' }],
  ['vbmap.untrail', { trails: false }],
  ...fail('vbmap.c', ['c']),
  ...fail('vbmap.west', ['a', 'b']),
  // act 3: the deal as a seating chart
  ['unghost', { ghost: false }],
  ['chart.frame', { chart: true }],
  ['chart.seated', { view: 'chart' }],
  ['chart.clear', { scaffold: false }],
  ['chart.up', { chartUp: true }],
  ['chart.sums', { sums: true }],
  // act 4: back to the nodes, then node e joins rack West
  ['chart.down', { chartUp: false }],
  ['recluster', { scaffold: true }],
  ['home', { view: 'bins' }],
  ['unchart', { chart: false }],
  ['e.joins', { cluster: 'five' }],
  ['e.deal', { map: 'uneven' }],
  ['e.recolor', { recolor: true }],
  ['e.holds', { holds: true }],
  // act 5: node f joins rack East, and the cluster rebalances
  ['f.joins', { cluster: 'six' }],
  ['six.deal', { map: 'six' }],
  ['six.tries', { tries: true }],
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
