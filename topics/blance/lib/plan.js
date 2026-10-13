// A port of blance's planner, PlanNextMapEx (blance v0.1.6, plan.go),
// kept line for line close to the Go so it can be read beside it, and
// checked against the real thing by golden cases (tools/plan-golden,
// test/plan.test.mjs).
//
// Maps are plain objects; Go's nil (a map or slice) is null or
// undefined. The port is deterministic where the Go iterates maps, as
// blance's results don't depend on that order; and its sorts end in a
// unique key (a partition's name, a node's position), so they don't
// depend on the sort algorithm either.
//
// It also records what it did, for the explainer: with `trace`, every
// decision (which partition, which state, the candidates, their score
// terms, and who won), in order.

export const MAX_ITERATIONS_PER_PLAN = 10;

// ---- string helpers (misc.go) ----

export function stringsRemoveStrings(arr, remove) {
  const r = new Set(remove || []);
  return (arr || []).filter((s) => !r.has(s));
}

export function stringsIntersectStrings(a, b) {
  const bs = new Set(b || []);
  const seen = new Set();
  const rv = [];
  for (const s of a || []) {
    if (bs.has(s) && !seen.has(s)) { seen.add(s); rv.push(s); }
  }
  return rv;
}

function stringsDeduplicate(a) {
  const seen = new Set();
  return a.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
}

// ---- partition maps ----

const copyNodesByState = (nbs) => Object.fromEntries(Object.entries(nbs || {}).map(([s, ns]) => [s, [...(ns || [])]]));
const copyMap = (m) => Object.fromEntries(Object.entries(m).map(([k, p]) => [k, { name: p.name, nodesByState: copyNodesByState(p.nodesByState) }]));
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function removeNodesFromNodesByState(nbs, removeNodes, cb) {
  const rv = {};
  for (const [stateName, nodes] of Object.entries(nbs || {})) {
    if (cb) cb(stateName, stringsIntersectStrings(nodes, removeNodes));
    rv[stateName] = stringsRemoveStrings(nodes, removeNodes);
  }
  return rv;
}

const flattenNodesByState = (nbs) => Object.values(nbs || {}).flat();

function countStateNodes(partitionMap, partitionWeights) {
  const rv = {};
  for (const [partitionName, partition] of Object.entries(partitionMap)) {
    for (const [stateName, nodes] of Object.entries(partition.nodesByState || {})) {
      const s = (rv[stateName] ||= {});
      for (const node of nodes || []) {
        const w = partitionWeights && partitionName in partitionWeights ? partitionWeights[partitionName] : 1;
        s[node] = (s[node] || 0) + w;
      }
    }
  }
  return rv;
}

function adjustStateNodeCounts(stateNodeCounts, stateName, nodes, amt) {
  for (const node of nodes) {
    const s = (stateNodeCounts[stateName] ||= {});
    s[node] = (s[node] || 0) + amt;
  }
}

// State names by priority, then name (stateNameSorter, as blance has it).
export function sortStateNames(model) {
  const less = (i, j) => {
    if (model[i] && model[j] && model[i].priority < model[j].priority) return true;
    return i < j;
  };
  return Object.keys(model).sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0));
}

// ---- which partitions go first (partitionSorter) ----

const pad10 = (n) => String(n).padStart(10, ' ');

export function partitionScore(p, { stateName = '', prevMap = null, nodesToRemove = null, nodesToAdd = null, partitionWeights = null }) {
  const name = p.name;
  let nameStr = name;
  // a name that looks like a non-negative integer is padded, to sort by number
  if (/^[+-]?\d+$/.test(name) && Number(name) >= 0) nameStr = pad10(Number(name));
  const w = partitionWeights && name in partitionWeights ? partitionWeights[name] : 1;
  const wStr = pad10(999999999 - w);
  // first, partitions on nodes that are leaving
  if (prevMap && nodesToRemove && nodesToRemove.length > 0) {
    const lp = prevMap[name].nodesByState[stateName];
    if (lp && stringsIntersectStrings(lp, nodesToRemove).length > 0) return ['0', wStr, nameStr];
  }
  // then, partitions not yet on any newly added node
  if (nodesToAdd) {
    if (stringsIntersectStrings(flattenNodesByState(p.nodesByState), nodesToAdd).length <= 0) return ['1', wStr, nameStr];
  }
  return ['2', wStr, nameStr];
}

function sortPartitions(arr, opts) {
  const keyed = arr.map((p) => ({ p, k: partitionScore(p, opts) }));
  keyed.sort((x, y) => {
    for (let i = 0; i < x.k.length && i < y.k.length; i++) {
      if (x.k[i] < y.k[i]) return -1;
      if (x.k[i] > y.k[i]) return 1;
    }
    if (x.k.length !== y.k.length) return x.k.length - y.k.length;
    return byName(x.p.name, y.p.name);
  });
  return keyed.map((x) => x.p);
}

// ---- which nodes are best (nodeSorter) ----

// A node's score for a partition and state: lower is better. Returns
// its terms too, for the explainer.
export function nodeScore(node, c) {
  let lowerPriorityBalanceFactor = 0;
  if (c.nodeToNodeCounts && c.numPartitions > 0) {
    const m = c.nodeToNodeCounts[c.topPriorityNode];
    if (m) lowerPriorityBalanceFactor = (m[node] || 0) / c.numPartitions;
  }
  let filledFactor = 0;
  if (c.nodePartitionCounts && c.numPartitions > 0 && node in c.nodePartitionCounts) {
    filledFactor = (0.001 * c.nodePartitionCounts[node]) / c.numPartitions;
  }
  let currentFactor = 0;
  if (c.partition) {
    for (const sn of c.partition.nodesByState[c.stateName] || []) if (sn === node) currentFactor = c.stickiness;
  }
  let count = 0;
  if (c.stateNodeCounts && c.stateNodeCounts[c.stateName]) count = c.stateNodeCounts[c.stateName][node] || 0;
  let r = count;
  r = r + lowerPriorityBalanceFactor;
  r = r + filledFactor;
  let weight = 1;
  if (c.nodeWeights && node in c.nodeWeights) {
    const w = c.nodeWeights[node];
    if (w > 0) { r = r / w; weight = w; }
    // (a negative weight is for cbgt's NodeScoreBooster, not ported)
  }
  r = r - currentFactor;
  return { node, score: r, count, lowerPriorityBalanceFactor, filledFactor, weight, currentFactor };
}

function sortNodes(nodes, c) {
  const scored = nodes.map((n) => nodeScore(n, c));
  scored.sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : c.nodePositions[a.node] - c.nodePositions[b.node]));
  return scored;
}

// ---- hierarchy (rack/zone/server group awareness) ----

function mapParentsToMapChildren(mapParents) {
  const rv = {};
  for (const child of Object.keys(mapParents || {}).sort()) {
    (rv[mapParents[child]] ||= []).push(child);
  }
  return rv;
}

function findAncestor(node, mapParents, level) {
  for (; level > 0; level--) node = (mapParents || {})[node] ?? '';
  return node;
}

function findLeaves(node, mapChildren) {
  const children = mapChildren[node] || [];
  if (children.length <= 0) return [node];
  return children.flatMap((c) => findLeaves(c, mapChildren));
}

export function includeExcludeNodes(node, includeLevel, excludeLevel, mapParents, mapChildren) {
  const inc = findLeaves(findAncestor(node, mapParents, includeLevel), mapChildren);
  const exc = findLeaves(findAncestor(node, mapParents, excludeLevel), mapChildren);
  return stringsRemoveStrings(inc, exc);
}

function includeExcludeNodesIntersect(nodes, includeLevel, excludeLevel, mapParents, mapChildren) {
  let rv = [];
  for (const node of nodes) {
    const res = includeExcludeNodes(node, includeLevel, excludeLevel, mapParents, mapChildren);
    if (rv.length === 0) { rv = res; continue; }
    rv = stringsIntersectStrings(rv, res);
  }
  return rv;
}

// ---- the planner ----

function planNextMapInner(prevMap, partitionsToAssign, nodesAll, nodesToRemove, nodesToAdd, model, opts, trace) {
  const partitionWarnings = {};
  const nodePositions = {};
  nodesAll.forEach((n, i) => { nodePositions[n] = i; });
  const nodesNext = stringsRemoveStrings(nodesAll, nodesToRemove);
  const hierarchyChildren = mapParentsToMapChildren(opts.nodeHierarchy);

  let nextPartitions = Object.values(copyMap(partitionsToAssign));
  for (const p of nextPartitions) p.nodesByState = removeNodesFromNodesByState(p.nodesByState, nodesToRemove, null);
  nextPartitions = sortPartitions(nextPartitions, {});

  const stateNodeCounts = countStateNodes(prevMap, opts.partitionWeights);
  const numPartitions = Object.keys(prevMap).length;

  let topPriorityStateName = '';
  for (const [sn, st] of Object.entries(model)) {
    if (topPriorityStateName === '' || st.priority < model[topPriorityStateName].priority) topPriorityStateName = sn;
  }

  function findBestNodes(partition, stateName, constraints, nodeToNodeCounts) {
    // (as in blance, StateStickiness only counts when PartitionWeights
    // isn't nil, and a partition's weight, if it has one, is its
    // stickiness)
    let stickiness = 1.5;
    if (opts.partitionWeights) {
      if (partition.name in opts.partitionWeights) stickiness = opts.partitionWeights[partition.name];
      else if (opts.stateStickiness && stateName in opts.stateStickiness) stickiness = opts.stateStickiness[stateName];
    }
    const nodePartitionCounts = {};
    for (const nodeCounts of Object.values(stateNodeCounts)) {
      for (const [node, n] of Object.entries(nodeCounts)) nodePartitionCounts[node] = (nodePartitionCounts[node] || 0) + n;
    }
    const tops = partition.nodesByState[topPriorityStateName] || [];
    const topPriorityNode = tops.length > 0 ? tops[0] : '';
    const statePriority = model[stateName].priority;

    const excludeHigherPriorityNodes = (remaining) => {
      for (const [sn, sNodes] of Object.entries(partition.nodesByState)) {
        if (model[sn] && model[sn].priority < statePriority) remaining = stringsRemoveStrings(remaining, sNodes);
      }
      return remaining;
    };

    const config = (nodes) => ({
      stateName, partition, numPartitions, topPriorityNode, stateNodeCounts, nodeToNodeCounts,
      nodePartitionCounts, nodePositions, nodeWeights: opts.nodeWeights, stickiness, nodes,
    });

    let candidates = excludeHigherPriorityNodes([...nodesNext]);
    const scored = sortNodes(candidates, config(candidates));
    candidates = scored.map((s) => s.node);
    const hierarchyPicks = [];

    if (opts.hierarchyRules) {
      const hierarchyNodes = [];
      for (const rule of opts.hierarchyRules[stateName] || []) {
        let h = topPriorityNode;
        if (h === '' && hierarchyNodes.length > 0) h = hierarchyNodes[0];
        for (let i = 0; i < constraints; i++) {
          let hc = includeExcludeNodesIntersect([h, ...hierarchyNodes], rule.includeLevel, rule.excludeLevel, opts.nodeHierarchy, hierarchyChildren);
          hc = stringsIntersectStrings(hc, nodesNext);
          hc = excludeHigherPriorityNodes(hc);
          hc = sortNodes(hc, config(hc)).map((s) => s.node);
          if (hc.length > 0) { hierarchyNodes.push(hc[0]); hierarchyPicks.push({ rule, from: h, candidates: hc, pick: hc[0] }); }
          else if (candidates.length > 0) { hierarchyNodes.push(candidates[0]); hierarchyPicks.push({ rule, from: h, candidates: [], pick: candidates[0] }); }
        }
      }
      candidates = stringsDeduplicate([...hierarchyNodes, ...candidates]);
    }

    if (candidates.length >= constraints) candidates = candidates.slice(0, constraints);
    else {
      (partitionWarnings[partition.name] ||= []).push(
        `could not meet constraints: ${constraints}, stateName: ${stateName}, partitionName: ${partition.name}`);
    }

    for (const n of candidates) {
      const m = (nodeToNodeCounts[topPriorityNode] ||= {});
      m[n] = (m[n] || 0) + 1;
    }
    if (trace) trace.push({ partition: partition.name, state: stateName, topPriorityNode, stickiness, scored, hierarchyPicks, chosen: [...candidates] });
    return candidates;
  }

  function assignStateToPartitions(stateName, constraints) {
    const sorted = sortPartitions([...nextPartitions], {
      stateName, prevMap, nodesToRemove, nodesToAdd, partitionWeights: opts.partitionWeights,
    });
    const nodeToNodeCounts = {};
    for (const partition of sorted) {
      const w = opts.partitionWeights && partition.name in opts.partitionWeights ? opts.partitionWeights[partition.name] : 1;
      const dec = (sn, nodes) => adjustStateNodeCounts(stateNodeCounts, sn, nodes, -w);
      const nodesToAssign = findBestNodes(partition, stateName, constraints, nodeToNodeCounts);
      partition.nodesByState = removeNodesFromNodesByState(partition.nodesByState, partition.nodesByState[stateName] || [], dec);
      partition.nodesByState = removeNodesFromNodesByState(partition.nodesByState, nodesToAssign, dec);
      partition.nodesByState[stateName] = nodesToAssign;
      adjustStateNodeCounts(stateNodeCounts, stateName, nodesToAssign, w);
    }
  }

  for (const stateName of sortStateNames(model)) {
    let constraints = model[stateName] ? model[stateName].constraints : 0;
    if (opts.modelStateConstraints && stateName in opts.modelStateConstraints) constraints = opts.modelStateConstraints[stateName];
    if (constraints > 0) {
      if (trace) trace.push({ state: stateName, constraints, begin: true });
      assignStateToPartitions(stateName, constraints);
    }
  }

  const rv = {};
  for (const p of nextPartitions) rv[p.name] = p;
  return { nextMap: rv, warnings: partitionWarnings };
}

const sameNodesByState = (a, b) => {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && a[k].length === b[k].length && a[k].every((n, i) => n === b[k][i]));
};

// PlanNextMapEx. `opts`: {modelStateConstraints, partitionWeights,
// stateStickiness, nodeWeights, nodeHierarchy, hierarchyRules}, each
// optional. Returns {nextMap, warnings, iterations, passes}: passes is
// each pass's {nextMap, trace} when `trace` is set.
export function planNextMap(prevMap, partitionsToAssign, nodesAll, nodesToRemove, nodesToAdd, model, opts = {}, { trace = false } = {}) {
  // (blance updates its callers' maps; the port works on copies)
  prevMap = copyMap(prevMap);
  partitionsToAssign = copyMap(partitionsToAssign);
  nodesToRemove = nodesToRemove || [];
  nodesToAdd = nodesToAdd || [];
  let nextMap = {}, warnings = {};
  const passes = [];
  let i = 0;
  for (; i < MAX_ITERATIONS_PER_PLAN; i++) {
    const t = trace ? [] : null;
    ({ nextMap, warnings } = planNextMapInner(prevMap, partitionsToAssign, nodesAll, nodesToRemove, nodesToAdd, model, opts, t));
    if (trace) passes.push({ nextMap: copyMap(nextMap), trace: t });
    const notMatch = Object.values(nextMap).some((p) => !(p.name in prevMap) || !sameNodesByState(p.nodesByState, prevMap[p.name].nodesByState));
    if (!notMatch) break;
    for (const p of Object.values(nextMap)) {
      prevMap[p.name] = copyMap({ x: p }).x;
      partitionsToAssign[p.name] = copyMap({ x: p }).x;
    }
    nodesAll = stringsRemoveStrings(nodesAll, nodesToRemove);
    nodesToRemove = [];
    nodesToAdd = [];
  }
  return { nextMap, warnings, iterations: Math.min(i + 1, MAX_ITERATIONS_PER_PLAN), passes };
}
