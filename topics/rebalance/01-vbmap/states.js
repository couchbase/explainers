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
//   chart     the seating chart's frame is shown (rows: actives' nodes;
//             columns: replicas' nodes)
//   view      where the copies are: 'bins' (on their nodes), 'chart'
//             (in their seats), or 'net' (beads on the network's threads)
//   chartUp   the chart is up in the cluster's place (else below it)
//   sums      the chart's sums, and each seat's count, are shown
//   arcs      each vbucket's thread, from its row through its seat to its
//             column, is shown
//   rowsOut   the rows' labels have moved out to the left, as nodes
//   colsOut   the columns' labels have swung to the right, as nodes
//   pipes     each seat's threads are bundled into a pipe
//   source    the source, and its pipes to the left column, are shown
//   sink      the sink, and the right column's pipes to it, are shown
//   flow      how many of max-flow's paths have been pushed (all, till
//             the pipes are emptied to show how)
//   network   the network (its nodes, threads, pipes, source, sink) is
//             shown, once it's built; it fades as one
//   cluster   which nodes: 'four', or 'five' once node e joins rack West
//   holds     each node's count says how many replicas it holds, too

import { PATHS } from './plumbing.js';

const START = {
  doc: true, split: false, scaffold: false, actives: false, replicas: false, lifted: false, counts: false,
  map: 'naive', down: [], promoted: false, lost: false, ghost: false,
  chart: false, view: 'bins', chartUp: false, sums: false, arcs: false, rowsOut: false, colsOut: false, pipes: false, source: false, sink: false, flow: PATHS.length,
  network: true, cluster: 'four', holds: false,
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
  ...fail('vbmap.c', ['c']),
  ...fail('vbmap.west', ['a', 'b']),
  // act 3: the deal as a chart, a network, pipes, a flow
  ['unghost', { ghost: false }],
  ['chart.frame', { chart: true }],
  ['chart.seated', { view: 'chart' }],
  ['chart.clear', { scaffold: false }],
  ['chart.up', { chartUp: true }],
  ['chart.sums', { sums: true }],
  ['arcs', { arcs: true }],
  ['turn.rows', { rowsOut: true }],
  ['turn.cols', { colsOut: true }],
  ['net', { view: 'net' }],
  ['pipes', { pipes: true }],
  ['source', { source: true }],
  ['sink', { sink: true }],
  ['flow.0', { flow: 0 }],
  ...PATHS.map((_, k) => [`flow.${k + 1}`, { flow: k + 1 }]),
  // act 4: back to the nodes, then node e joins rack West
  ['beads', { pipes: false }],
  ['unnet', { network: false }],
  ['home', { view: 'bins' }],
  ['recluster', { scaffold: true }],
  ['e.joins', { cluster: 'five' }],
  ['e.deal', { map: 'uneven' }],
  ['e.holds', { holds: true }],
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
