// Act 3's plumbing: the deal as a seating chart, then as a network of
// pipes, and the max-flow that fills them. The network is vbmap's
// second flow graph (buildRFlowGraph, vbmap_balance.go) for the story's
// cluster, simplified by one layer: vbmap routes each node's replicas
// through a vertex per (node, other rack) first, which here, with one
// other rack, changes nothing.
//
//   source -> each node:              its actives x replicas (8)
//   node -> each node in another rack: at most 8 / (nodes it backs up), 4
//   each node -> sink:                 the replicas it holds (8)
//
// The flow (../lib/flow.js, as vbmap's graph.go finds it) must match
// vbmap's own R matrix (test/plumbing.test.mjs).

import { maxflow } from '../lib/flow.js';
import { NODES, rackOf } from './layout.js';
import { MAPS } from './deals.js';

export const LEFT = NODES;
// (the right column: the other rack first, so the threads run in two
// parallel bands instead of crossing)
export const RIGHT = ['c', 'd', 'a', 'b'];

const actives = (n) => MAPS.vbmap.filter((c) => c[0] === n).length;
const slaves = (n) => NODES.filter((m) => rackOf(m) !== rackOf(n)).length;
export const EDGES = [
  ...LEFT.map((n) => ({ from: 'S', to: `L.${n}`, cap: actives(n) })),
  ...LEFT.flatMap((i) => RIGHT.filter((j) => rackOf(i) !== rackOf(j)).map((j) => ({ from: `L.${i}`, to: `R.${j}`, cap: Math.ceil(actives(i) / slaves(i)) }))),
  ...RIGHT.map((n) => ({ from: `R.${n}`, to: 'T', cap: actives(n) })),
];
export const VERTICES = ['S', ...LEFT.map((n) => `L.${n}`), ...RIGHT.map((n) => `R.${n}`), 'T'];
export const FLOW = maxflow(VERTICES, EDGES, 'S', 'T');
export const PATHS = FLOW.paths;
// the flow on each edge after the first k paths
export function flowAfter(k) {
  const f = Object.fromEntries(EDGES.map((e) => [`${e.from}>${e.to}`, 0]));
  for (const p of PATHS.slice(0, k)) for (let i = 1; i < p.vertices.length; i++) f[`${p.vertices[i - 1]}>${p.vertices[i]}`] += p.push;
  return f;
}
// R: how many of node i's actives have their replica on node j, by the flow
export const R_FLOW = Object.fromEntries(LEFT.map((i) => [i, Object.fromEntries(NODES.map((j) => [j, FLOW.flow[`L.${i}>R.${j}`] || 0]))]));
