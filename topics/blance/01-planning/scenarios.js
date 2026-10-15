// The scenarios the 01-planning explainer tells, run through the port
// of blance's planner (../lib/plan.js, checked against the real blance
// by its golden cases), and cut into frames: the partition map before
// the plan, after dropping the leaving nodes, and after each of the
// planner's decisions, in order. A step's `at` names a frame.
//
// Pure (no DOM), so the build, the tests and the page all see the same.

import { planNextMap } from '../lib/plan.js';
import { calcPartitionMoves } from '../lib/moves.js';

export const NODES = ['a', 'b', 'c', 'd'];
export const PARTITIONS = ['0', '1', '2', '3', '4', '5', '6', '7'];
export const STATES = ['primary', 'replica'];
const PLURAL = { primary: 'primaries', replica: 'replicas' };
// a primary and one replica (the model cbgt uses: manager_planner.go BlancePartitionModel)
export const MODEL = { primary: { priority: 0, constraints: 1 }, replica: { priority: 1, constraints: 1 } };
// server groups: g1 = {a, b}, g2 = {c, d}, in one datacenter
export const GROUPS = { a: 'g1', b: 'g1', c: 'g2', d: 'g2', g1: 'dc', g2: 'dc' };
// a replica in another group from its primary (cbgt's default rule
// when there are server groups: manager_planner.go)
export const OTHER_GROUP = { replica: [{ includeLevel: 2, excludeLevel: 1 }] };

const empty = () => Object.fromEntries(PARTITIONS.map((p) => [p, { name: p, nodesByState: {} }]));
// a partition map's boards: partition -> {primary: [...], replica: [...]}
const boardOf = (m) => Object.fromEntries(PARTITIONS.map((p) => [p, Object.fromEntries(STATES.map((s) => [s, [...((m[p] && m[p].nodesByState[s]) || [])]]))]));
const mapOf = (board) => Object.fromEntries(PARTITIONS.map((p) => [p, { name: p, nodesByState: Object.fromEntries(STATES.map((s) => [s, [...board[p][s]]])) }]));
const without = (board, nodes) => Object.fromEntries(PARTITIONS.map((p) => [p, Object.fromEntries(STATES.map((s) => [s, board[p][s].filter((n) => !nodes.includes(n))]))]));

// One decision, applied as blance does: the partition's old nodes in
// that state go, the chosen nodes leave any other state, and take this one.
function apply(board, d) {
  const b = JSON.parse(JSON.stringify(board));
  const nbs = b[d.partition];
  const old = nbs[d.state];
  for (const s of STATES) nbs[s] = nbs[s].filter((n) => !old.includes(n) && !d.chosen.includes(n));
  nbs[d.state] = [...d.chosen];
  return b;
}

// The stages of one decision, as the page plays it, in the planner's
// own order: its row outlined; then node by node (blance scores one
// node at a time, nodeSorter.Score), that node's terms: the count, the
// spread, the tie-breaker, and stickiness off if it holds the
// partition; then the pick. Each decision's `seq`: [{stage: 'row'},
// {node, term}, ..., {stage: 'pick'}].
export const TERMS = ['count', 'spread', 'fill', 'sticky'];
function seqOf(t) {
  const seq = [{ stage: 'row' }];
  for (const n of NODES) {
    const c = t.scored.find((x) => x.node === n);
    if (!c) continue;
    for (const term of TERMS) if (term !== 'sticky' || c.currentFactor) seq.push({ node: n, term });
  }
  seq.push({ stage: 'pick' });
  return seq;
}

// Runs a scenario: {id, title, nodes (all of them), joining, leaving,
// groups (shown), prev and result (boards), frames, moves (per
// partition, prev to result), iterations, decisions}.
//
// A frame: {key, i (its place in the scenario), board, decision, k
// (decisions made), stage (its place in the decision's seq), order (the
// board's rows, top to bottom), pass (while a state's pass is on: its
// state, each partition's group in its sort, and what the groups
// mean)}; and after each state's last decision, "fresh.primaries", the
// pass done (no decision in hand, nothing left over from the last one).
// Each pass begins by sorting the partitions, in four frames (each its
// `sort`): "fresh.replicas~rules", the sort's rules shown;
// "fresh.replicas~keys", each row's group shown under its name;
// "fresh.replicas~sorted", the rows in the pass's order; and
// "fresh.replicas~clear", the rules and the groups gone. Once the plan
// is made, "fresh.unsorted": the rows back in name order. Each
// decision has a frame per stage, "fresh.2~row", "fresh.2~a.count", on
// the board as it was before it, and then its pick, "fresh.2", with it
// made. A scenario that removes nodes ends with "remove.after": the
// same board, with the nodes removed out of the cluster.
function scenario(id, title, { prev, nodesAll, remove = [], add = [], opts = {}, groups = false }) {
  const r = planNextMap(mapOf(prev), mapOf(prev), nodesAll, remove, add, MODEL, opts, { trace: true });
  let order = [...PARTITIONS], pass = null;
  const frames = [{ key: `${id}.prev`, board: prev, decision: null, k: -1, i: 0, order, pass }];
  const push = (f) => frames.push({ order, pass, ...f, i: frames.length });
  let board = without(prev, remove);
  push({ key: `${id}.0`, board, decision: null, k: 0 });
  // what the sort's groups mean, here
  const labels = groupLabels(nodesAll, add, remove);
  let k = 0;
  for (const t of r.passes[0].trace) {
    if (t.begin) {
      // the pass's sort: its rules, each row's group, the rows in its
      // order, and the rules and groups put away
      pass = { state: t.state, groups: t.groups, labels };
      const sortFrame = (sort) => push({ key: `${id}.${PLURAL[t.state]}~${sort}`, board, decision: null, k, sort });
      sortFrame('rules');
      sortFrame('keys');
      order = t.order;
      sortFrame('sorted');
      sortFrame('clear');
      continue;
    }
    const seq = seqOf(t);
    const decision = { ...t, k: k + 1, before: board, seq };
    seq.forEach((x, si) => {
      if (x.stage === 'pick') return;
      push({ key: `${id}.${k + 1}~${x.stage || `${x.node}.${x.term}`}`, board, decision, k, stage: si, sub: true });
    });
    board = apply(board, t);
    k++;
    push({ key: `${id}.${k}`, board, decision, k, stage: seq.length - 1 });
    // after a state's last decision, the pass done: "fresh.primaries"
    const next = r.passes[0].trace.slice(r.passes[0].trace.indexOf(t) + 1).find((x) => !x.begin);
    if (!next || next.state !== t.state) {
      pass = null;
      push({ key: `${id}.${PLURAL[t.state]}`, board, decision: null, k, passDone: t.state });
    }
  }
  const result = boardOf(r.nextMap);
  if (JSON.stringify(board) !== JSON.stringify(result)) throw new Error(`${id}: replaying the trace doesn't give the plan`);
  // (the plan made: its rows back in name order, as the map is keyed)
  order = [...PARTITIONS];
  push({ key: `${id}.unsorted`, board, decision: null, k });
  push({ key: `${id}.end`, board: result, decision: null, k: k + 1, done: true });
  // (and once the rebalance is over, the nodes removed are gone: "remove.after")
  if (remove.length) push({ key: `${id}.after`, board: result, decision: null, k: k + 1, done: true, departed: true });
  const moves = Object.fromEntries(PARTITIONS.map((p) => [p, calcPartitionMoves(STATES, mapOf(prev)[p].nodesByState, r.nextMap[p].nodesByState, false)]));
  return {
    id, title, nodes: nodesAll, joining: add, leaving: remove, groups,
    prev, result, frames, moves, iterations: r.iterations, decisions: k, opts,
  };
}

// A pass's sort (partitionSorter.Score), as the page shows it: the
// number each partition gets first, from 1 (blance's '0', '1' and '2'),
// by the rule it matches, and which nodes the rule means here: 1, on a
// node leaving, in that state; 2, not yet on any node joining (with
// none joining, every partition but the leaving ones); 3, the rest:
// already on a node joining.
export const SORT_RULES = { 0: 'on a leaving node', 1: 'not yet on a joining node', 2: 'already on a joining node' };
function groupLabels(nodesAll, add, remove) {
  const names = (ns) => (ns.length ? `node${ns.length > 1 ? 's' : ''} ${ns.join(', ')}` : 'none');
  return { rules: SORT_RULES, which: { 0: names(remove), 1: names(add), 2: names(add) } };
}

const abc = ['a', 'b', 'c'];
const fresh = scenario('fresh', 'from scratch, on nodes a, b, c', { prev: boardOf(empty()), nodesAll: abc, add: abc });
const add = scenario('add', 'node d joins', { prev: fresh.result, nodesAll: NODES, add: ['d'] });
const remove = scenario('remove', 'node b leaves', { prev: add.result, nodesAll: NODES, remove: ['b'] });
// (with no groups, then with them, from scratch on all four)
const nogroups = scenario('nogroups', 'from scratch, on a, b, c, d', { prev: boardOf(empty()), nodesAll: NODES, add: NODES, groups: true });
const groups = scenario('groups', 'the same, told the server groups', {
  prev: boardOf(empty()), nodesAll: NODES, add: NODES, groups: true, opts: { nodeHierarchy: GROUPS, hierarchyRules: OTHER_GROUP },
});

export const SCENARIOS = { fresh, add, remove, nogroups, groups };

// Every frame, by key ("fresh.3"), with its scenario.
export const FRAMES = Object.fromEntries(Object.values(SCENARIOS).flatMap((s) => s.frames.map((f) => [f.key, { ...f, scenario: s.id }])));

// ---- counts, for the tallies and the facts ----

const countMoves = (moves) => Object.values(moves).reduce((n, ms) => n + ms.length, 0);

export function tally(board) {
  const t = Object.fromEntries(NODES.map((n) => [n, { primary: 0, replica: 0 }]));
  for (const p of PARTITIONS) for (const s of STATES) for (const n of board[p][s]) t[n][s]++;
  return t;
}
export { countMoves };

// ---- where a score's terms come from, on the board ----

// For decision d (of scenario scn), made on board `board` (as it was
// before d): per node, the chips each term counts, as [partition,
// node, state]: `count`, the node's chips in d's state; `spread`, the
// partitions already given to it in this pass, in this state, whose
// primary node (at their decision) was d's; `fill`, all its chips;
// `sticky`, the chip of d's own partition it holds in d's state.
// (The tests check these against blance's own terms.)
export function sourcesOf(scn, d, board) {
  const out = {};
  const earlier = scn.frames.filter((f) => !f.sub && f.decision && f.decision.k < d.k && f.decision.state === d.state && f.decision.topPriorityNode === d.topPriorityNode && f.decision.k > lastBegin(scn, d));
  for (const n of NODES) {
    const chips = (states) => PARTITIONS.flatMap((p) => states.filter((s) => board[p][s].includes(n)).map((s) => [p, n, s]));
    out[n] = {
      count: chips([d.state]),
      spread: earlier.filter((f) => f.decision.chosen.includes(n)).map((f) => [f.decision.partition, n, d.state]),
      fill: chips(STATES),
      sticky: board[d.partition][d.state].includes(n) ? [[d.partition, n, d.state]] : [],
    };
  }
  return out;
}

// The last decision before d's state began (its pass's first decision
// of that state comes after it).
function lastBegin(scn, d) {
  const ds = scn.frames.filter((f) => !f.sub && f.decision).map((f) => f.decision);
  const first = ds.find((x) => x.state === d.state);
  return first ? first.k - 1 : 0;
}
