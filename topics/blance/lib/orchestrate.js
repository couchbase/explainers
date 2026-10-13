// A simulation of blance's OrchestrateMoves (blance v0.1.6,
// orchestrate.go), in simulated time: the same goroutines' logic, made
// deterministic. Checked against the real orchestrator by golden cases
// (tools/orchestrate-golden), on cases whose real runs are stable.
//
// In the real code (the code's own analogy): each partition's moves,
// from CalcPartitionMoves, are a flight plan; each node is an airport
// with one runway (a mover goroutine, `runMover`); and one controller
// (`runSupplyMoves`) runs rounds: it finds every partition's next move,
// grouped by the node it's on; asks the app's FindMoveFunc for each
// node's best (up to MaxConcurrentPartitionMovesPerNode of them, as one
// batch); and offers each node's batch to its mover, through a helper
// goroutine per node (`runSupplyMove`). As soon as one helper's batch
// is done, the round ends: the other helpers give up (moves already
// handed to a mover keep going), and the next round starts.
//
// Two of the real thing's subtleties, kept:
// - a move in flight still counts as its partition's next move, so a
//   helper whose best moves include one waits for it, rather than
//   offering a new batch;
// - a helper whose best moves don't include the node's batch in flight
//   offers a new one, and waits for the mover to be free to take it.
//
// What's made deterministic: the real FindMoveFunc's ties (cbgt's
// LowestWeightPartitionMoveForNode takes the first in Go map order, in
// effect at random) go to the partition that sorts first; and moves
// that finish at the same moment are taken in node order. When two
// real moves finish together, which the controller hears of first is a
// race, and the real runs differ.

import { calcPartitionMoves } from './moves.js';

export const MOVE_OP_WEIGHT = { promote: 1, demote: 2, add: 3, del: 4 };

// The best of `moves` ({partition, op, ...}) for a node: the lowest
// weight op, ties to the partition that sorts first.
export function lowestWeightMove(moves) {
  let r = 0;
  moves.forEach((m, i) => {
    const wi = MOVE_OP_WEIGHT[m.op], wr = MOVE_OP_WEIGHT[moves[r].op];
    if (wi < wr || (wi === wr && m.partition < moves[r].partition)) r = i;
  });
  return r;
}

// begMap, endMap: partition -> nodesByState. states: most important
// first. duration(partition, op) -> time. Returns {batches: [{id, node,
// partitions, states, ops, start, end}], rounds: [{t, offers}], plans:
// partition -> moves, end: when the last move finished}.
export function orchestrateMoves({ states, nodesAll, begMap, endMap, maxConcurrent = 1, favorMinNodes = false, duration }) {
  const names = Object.keys(begMap).sort();
  const plans = Object.fromEntries(names.map((p) => [p, calcPartitionMoves(states, begMap[p], endMap[p], favorMinNodes)]));
  const nm = Object.fromEntries(names.map((p) => [p, { partition: p, moves: plans[p], next: 0, inflight: null }]));
  const movers = Object.fromEntries(nodesAll.map((n) => [n, null])); // node -> batch in flight
  const batches = [];
  const rounds = [];
  let t = 0;

  const startBatch = (node, chosen) => {
    const ms = chosen.map((x) => x.moves[x.next]);
    const b = {
      id: batches.length, node, partitions: chosen.map((x) => x.partition), states: ms.map((m) => m.state), ops: ms.map((m) => m.op),
      start: t, end: t + Math.max(...chosen.map((x) => duration(x.partition, x.moves[x.next].op))), done: false,
    };
    batches.push(b);
    movers[node] = b;
    for (const x of chosen) x.inflight = b;
    return b;
  };

  for (let guard = 0; guard < 10000; guard++) {
    // the next round's available moves, by node
    const avail = {};
    for (const p of names) {
      const x = nm[p];
      if (x.next < x.moves.length) (avail[x.moves[x.next].node] ||= []).push(x);
    }
    if (!Object.keys(avail).length) break;
    // each node's best moves, offered by a helper
    const helpers = [];
    for (const node of Object.keys(avail).sort()) {
      let arr = [...avail[node]];
      const chosen = [];
      for (let count = Math.min(Math.max(1, maxConcurrent), arr.length); count > 0; count--) {
        const i = lowestWeightMove(arr.map((x) => ({ partition: x.partition, op: x.moves[x.next].op })));
        chosen.push(arr[i]);
        arr = arr.filter((_, j) => j !== i);
      }
      const h = { node, chosen, waitOn: null, blocked: false };
      const flying = chosen.find((x) => x.inflight);
      if (flying) h.waitOn = flying.inflight;
      else if (!movers[node]) h.waitOn = startBatch(node, chosen);
      else h.blocked = true;
      helpers.push(h);
    }
    rounds.push({ t, offers: helpers.map((h) => ({ node: h.node, partitions: h.chosen.map((x) => x.partition), waiting: !!h.waitOn && h.waitOn.start < t, blocked: h.blocked })) });

    // until a helper's batch is done
    for (;;) {
      const won = helpers.filter((h) => h.waitOn && h.waitOn.done);
      if (won.length) {
        for (const h of won) {
          for (const x of h.chosen) if (x.inflight === h.waitOn) { x.inflight = null; x.next++; }
        }
        break;
      }
      // the next move to finish (ties in node order)
      const flying = Object.values(movers).filter(Boolean).sort((a, b) => a.end - b.end || (a.node < b.node ? -1 : 1));
      if (!flying.length) throw new Error('orchestrate: stuck, with nothing in flight');
      const b = flying[0];
      t = b.end;
      b.done = true;
      movers[b.node] = null;
      // a helper waiting to offer this node a batch: the mover takes it
      const queued = helpers.find((h) => h.blocked && h.node === b.node);
      if (queued) { queued.blocked = false; queued.waitOn = startBatch(b.node, queued.chosen); }
    }
  }
  // (the movers finish what they have)
  const end = Math.max(0, ...batches.map((b) => b.end));
  return { batches: batches.map(({ done, ...b }) => b), rounds, plans, end };
}
