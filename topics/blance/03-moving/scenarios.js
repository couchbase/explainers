// The runs the 03-moving explainer tells: node d joining (01-planning's
// second plan), moved by the simulation of blance's OrchestrateMoves
// (../lib/orchestrate.js, checked against the real orchestrator by its
// golden cases, these runs among them), with partitions of different
// sizes. A step's `at` names a run and a moment in it, "one@270": the
// board, the moves in flight and the movers then.
//
// Pure (no DOM), so the build, the tests and the page all see the same.

import { planNextMap } from '../lib/plan.js';
import { orchestrateMoves } from '../lib/orchestrate.js';

export const NODES = ['a', 'b', 'c', 'd'];
export const PARTITIONS = ['0', '1', '2', '3', '4', '5', '6', '7'];
export const STATES = ['primary', 'replica'];
const MODEL = { primary: { priority: 0, constraints: 1 }, replica: { priority: 1, constraints: 1 } };

// 01-planning's maps: from scratch on a, b, c; then with d
const empty = () => Object.fromEntries(PARTITIONS.map((p) => [p, { name: p, nodesByState: {} }]));
const abc = ['a', 'b', 'c'];
const m0 = planNextMap(empty(), empty(), abc, [], abc, MODEL).nextMap;
const m1 = planNextMap(m0, m0, NODES, [], ['d'], MODEL).nextMap;
const nbs = (m) => Object.fromEntries(PARTITIONS.map((p) => [p, Object.fromEntries(STATES.map((s) => [s, [...(m[p].nodesByState[s] || [])]]))]));
export const BEGIN = nbs(m0);
export const END = nbs(m1);

// How long a move takes, in ms: a copy of a bigger partition longer
// (the same as tools/orchestrate-golden's story cases)
export const duration = (p, op) => ({ add: 270 + 27 * +p, del: 18 + 9 * +p, promote: 12, demote: 12 })[op];

const RUN_DEFS = {
  one: { title: 'one move at a time per node', maxConcurrent: 1, favorMinNodes: false },
  four: { title: 'up to four at a time', maxConcurrent: 4, favorMinNodes: false },
  min: { title: 'deletes first (FavorMinNodes)', maxConcurrent: 1, favorMinNodes: true },
};

function run(id) {
  const def = RUN_DEFS[id];
  const r = orchestrateMoves({ states: STATES, nodesAll: NODES, begMap: BEGIN, endMap: END, duration, ...def });
  const batches = [...r.batches].sort((x, y) => x.start - y.start || (x.node < y.node ? -1 : 1));
  // the moments worth stopping at: when anything starts or ends
  const times = [...new Set([0, ...batches.flatMap((b) => [b.start, b.end])])].sort((x, y) => x - y);
  return { id, ...def, batches, rounds: r.rounds, plans: r.plans, end: r.end, times };
}
export const RUNS = Object.fromEntries(Object.keys(RUN_DEFS).map((id) => [id, run(id)]));

// Every moment, by key ("one@270").
export const MOMENTS = Object.fromEntries(Object.values(RUNS).flatMap((r) => r.times.map((t) => [`${r.id}@${t}`, { run: r.id, t }])));

// ---- the board at time t ----

function applyMove(board, p, node, state, op) {
  const nb = board[p];
  if (op === 'del') { for (const s of STATES) nb[s] = nb[s].filter((n) => n !== node); return; }
  for (const s of STATES) nb[s] = nb[s].filter((n) => n !== node);
  nb[state].push(node);
}

// {board (moves done by t applied), flying: [{p, node, state, op,
// progress}], done: per partition, how many of its moves are done}
export function stateAt(runId, t) {
  const r = RUNS[runId];
  const board = JSON.parse(JSON.stringify(BEGIN));
  const done = Object.fromEntries(PARTITIONS.map((p) => [p, 0]));
  const flying = [];
  for (const b of [...r.batches].sort((x, y) => x.end - y.end)) {
    b.partitions.forEach((p, i) => {
      if (b.end <= t) { applyMove(board, p, b.node, b.states[i], b.ops[i]); done[p]++; }
      else if (b.start <= t) flying.push({ p, node: b.node, state: b.states[i], op: b.ops[i], progress: (t - b.start) / (b.end - b.start), batch: b });
    });
  }
  return { board, flying, done };
}

// When each partition had no primary, in a run: {p: [from, to]}.
export function noPrimary(runId) {
  const r = RUNS[runId];
  const out = {};
  for (const t of r.times) {
    const { board } = stateAt(runId, t);
    for (const p of PARTITIONS) {
      if (!board[p].primary.length && !out[p]) out[p] = [t, null];
      if (board[p].primary.length && out[p] && out[p][1] === null) out[p][1] = t;
    }
  }
  return out;
}

// How long each node's mover was busy, in a run.
export const busy = (runId) => Object.fromEntries(NODES.map((n) => [n, RUNS[runId].batches.filter((b) => b.node === n).reduce((s, b) => s + b.end - b.start, 0)]));
