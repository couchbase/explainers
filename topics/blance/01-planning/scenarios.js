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

// The stages of one decision, as the page builds it up: its row
// outlined, then each node's score, term by term (the count, the
// spread, the tie-breaker, and stickiness off), then the pick.
export const STAGES = ['row', 'count', 'spread', 'fill', 'sticky', 'pick'];

// Runs a scenario: {id, title, nodes (all of them), joining, leaving,
// groups (shown), prev and result (boards), frames, moves (per
// partition, prev to result), iterations, decisions}.
//
// A frame: {key, i (its place in the scenario), board, decision, k
// (decisions made), stage (0..5, STAGES)}. Each decision has its stages'
// frames, "fresh.2~count", on the board as it was before it, and then
// its pick, "fresh.2", with it made. (The sticky stage only when some
// node holds the partition.)
function scenario(id, title, { prev, nodesAll, remove = [], add = [], opts = {}, groups = false }) {
  const r = planNextMap(mapOf(prev), mapOf(prev), nodesAll, remove, add, MODEL, opts, { trace: true });
  const frames = [{ key: `${id}.prev`, board: prev, decision: null, k: -1, i: 0 }];
  const push = (f) => frames.push({ ...f, i: frames.length });
  let board = without(prev, remove);
  push({ key: `${id}.0`, board, decision: null, k: 0 });
  let k = 0;
  for (const t of r.passes[0].trace) {
    if (t.begin) continue;
    const decision = { ...t, k: k + 1, before: board };
    for (const [si, stage] of STAGES.entries()) {
      if (stage === 'pick') break;
      if (stage === 'sticky' && !t.scored.some((c) => c.currentFactor)) continue;
      push({ key: `${id}.${k + 1}~${stage}`, board, decision, k, stage: si, sub: true });
    }
    board = apply(board, t);
    k++;
    push({ key: `${id}.${k}`, board, decision, k, stage: STAGES.indexOf('pick') });
  }
  const result = boardOf(r.nextMap);
  if (JSON.stringify(board) !== JSON.stringify(result)) throw new Error(`${id}: replaying the trace doesn't give the plan`);
  push({ key: `${id}.end`, board: result, decision: null, k: k + 1, done: true });
  const moves = Object.fromEntries(PARTITIONS.map((p) => [p, calcPartitionMoves(STATES, mapOf(prev)[p].nodesByState, r.nextMap[p].nodesByState, false)]));
  return {
    id, title, nodes: nodesAll, joining: add, leaving: remove, groups,
    prev, result, frames, moves, iterations: r.iterations, decisions: k, opts,
  };
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

// ---- stickiness, and its quirk: adding d to the fresh map ----

const countMoves = (moves) => Object.values(moves).reduce((n, ms) => n + ms.length, 0);
function addD(opts) {
  const r = planNextMap(mapOf(fresh.result), mapOf(fresh.result), NODES, [], ['d'], MODEL, opts);
  const m = mapOf(fresh.result);
  return countMoves(Object.fromEntries(PARTITIONS.map((p) => [p, calcPartitionMoves(STATES, m[p].nodesByState, r.nextMap[p].nodesByState)])));
}
const HIGH = { primary: 100000, replica: 100000 };
export const STICKINESS = [
  { key: 'default', label: 'defaults (stickiness 1.5)', opts: {}, moves: addD({}) },
  { key: 'nil', label: 'stickiness 100000, PartitionWeights nil', opts: { stateStickiness: HIGH }, moves: addD({ stateStickiness: HIGH }) },
  { key: 'empty', label: 'stickiness 100000, PartitionWeights {}', opts: { stateStickiness: HIGH, partitionWeights: {} }, moves: addD({ stateStickiness: HIGH, partitionWeights: {} }) },
  { key: 'zero', label: 'stickiness 0, PartitionWeights {}', opts: { stateStickiness: { primary: 0, replica: 0 }, partitionWeights: {} }, moves: addD({ stateStickiness: { primary: 0, replica: 0 }, partitionWeights: {} }) },
];

// ---- counts, for the tallies and the facts ----

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
