// A port of blance's CalcPartitionMoves (blance v0.1.6, moves.go): the
// steps that take one partition from its old nodes-by-state to its new
// one. Checked against the real thing by the golden cases.

import { stringsRemoveStrings, stringsIntersectStrings } from './plan.js';

const flatten = (nbs) => Object.values(nbs || {}).flat();

// The nodes that end in `state` and began in one of states[beg..end).
function findStateChanges(begStateIdx, endStateIdx, state, states, beg, end) {
  const rv = [];
  for (const node of end[state] || []) {
    for (let i = begStateIdx; i < endStateIdx; i++) {
      for (const n of beg[states[i]] || []) if (n === node) rv.push(node);
    }
  }
  return rv;
}

// `states`, most important first (e.g. ['primary', 'replica']). Returns
// [{node, state, op}], op one of add, del, promote, demote ('' state
// for a del).
export function calcPartitionMoves(states, beg, end, favorMinNodes = false) {
  const moves = [];
  const seen = new Set();
  const addMoves = (nodes, state, op) => {
    for (const node of nodes) {
      if (!seen.has(node)) { seen.add(node); moves.push({ node, state, op }); }
    }
  };
  beg = beg || {};
  end = end || {};
  const adds = stringsRemoveStrings(flatten(end), flatten(beg));
  const dels = stringsRemoveStrings(flatten(beg), flatten(end));
  const promotions = (si, state) => findStateChanges(si + 1, states.length, state, states, beg, end);
  const demotions = (si, state) => findStateChanges(0, si, state, states, beg, end);
  const cleanAdds = (state) => stringsIntersectStrings(stringsRemoveStrings(end[state], beg[state]), adds);
  const cleanDels = (state) => stringsIntersectStrings(stringsRemoveStrings(beg[state], end[state]), dels);

  if (!favorMinNodes) {
    states.forEach((state, si) => {
      addMoves(promotions(si, state), state, 'promote');
      addMoves(demotions(si, state), state, 'demote');
      addMoves(cleanAdds(state), state, 'add');
      addMoves(cleanDels(state), '', 'del');
    });
  } else {
    for (let si = states.length - 1; si >= 0; si--) {
      const state = states[si];
      addMoves(cleanDels(state), '', 'del');
      addMoves(demotions(si, state), state, 'demote');
      addMoves(promotions(si, state), state, 'promote');
      addMoves(cleanAdds(state), state, 'add');
    }
  }
  return moves;
}
