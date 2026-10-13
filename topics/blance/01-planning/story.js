// The 01-planning explainer's story vocabulary, for the engine. There's
// no simulation: a step's state is a frame of one of the scenarios
// (`at`: the partition map after that many of the planner's decisions)
// and what the panel shows (`panel`). Facts, for `expect`, come from the
// same scenarios, run through the port of blance's planner that its
// golden cases check against the real blance.

import { FRAMES, SCENARIOS, STICKINESS, GROUPS, NODES, PARTITIONS, tally, countMoves } from './scenarios.js';

export const PANELS = ['none', 'score', 'moves', 'tree', 'stick'];
// the regions a step's `focus` can box: the board, the tallies, the
// area under them (the strip), or one node's column, chips to bar
export const FOCUS_REGIONS = ['board', 'tallies', 'strip', ...NODES.map((n) => `col.${n}`)];

export const VIEW_KEYS = {
  // the frame shown; carried over, and each move counts as the step's change
  // (it opens on the map the first scenario ends with, to read first)
  at: { values: Object.keys(FRAMES), sticky: true, initial: 'fresh.end', counts: () => true },
  // what the area under the board shows
  panel: { values: PANELS, sticky: true, initial: 'none', counts: () => true },
  // a box around what to look at, for this step only: a reading aid, so
  // not the step's one change
  focus: { values: FOCUS_REGIONS },
};

// ---- facts, for `expect: ["fact:<name>=<value>"]` ----

const fmt = (x) => x.toFixed(4);
const counts = (s, board) => {
  const t = tally(board);
  return NODES.filter((n) => s.nodes.includes(n) && !s.leaving.includes(n)).map((n) => `${n}${t[n].primary}/${t[n].replica}`).join(' ');
};
const sameGroup = (board) => PARTITIONS.filter((p) => GROUPS[board[p].primary[0]] === GROUPS[board[p].replica[0]]).length;
const movesText = (ms) => ms.map((m) => (m.op === 'del' ? `del ${m.node}` : `${m.op} ${m.node}:${m.state}`)).join(', ');

function facts() {
  const out = {};
  for (const [key, f] of Object.entries(FRAMES)) {
    const s = SCENARIOS[f.scenario];
    if (f.sub) continue;
    out[`${key}.counts`] = counts(s, f.board);
    if (!f.decision) continue;
    // a decision: its partition, state, winner, and each candidate's score
    out[`${key}.partition`] = f.decision.partition;
    out[`${key}.state`] = f.decision.state;
    out[`${key}.winner`] = f.decision.chosen.join(',');
    for (const c of f.decision.scored) {
      out[`${key}.${c.node}`] = fmt(c.score);
      // before stickiness: the count, spread and tie-breaker
      out[`${key}.${c.node}.pre`] = fmt((c.count + c.lowerPriorityBalanceFactor + c.filledFactor) / c.weight);
      out[`${key}.${c.node}.count`] = c.count;
    }
  }
  for (const s of Object.values(SCENARIOS)) {
    out[`${s.id}.iterations`] = s.iterations;
    out[`${s.id}.moves`] = countMoves(s.moves);
    out[`${s.id}.moved`] = PARTITIONS.filter((p) => s.moves[p].length).length;
    for (const p of PARTITIONS) out[`${s.id}.moves.${p}`] = movesText(s.moves[p]);
    out[`${s.id}.sameGroup`] = sameGroup(s.result);
  }
  for (const x of STICKINESS) out[`stick.${x.key}`] = x.moves;
  return out;
}
export const FACTS = facts();

export const EXPECTATION_PARAMS = {
  fact: {
    valid: (arg) => /^[\w.]+=.+$/.test(arg) && arg.split('=')[0] in FACTS,
    check: (_m, arg) => {
      const [k, v] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
      return String(FACTS[k]) === v;
    },
  },
};

// For the tests: what `expect` is checked against, with no simulation.
export const factModel = () => ({});

// ---- what the diagram shows at step i (pure, so tests can check it) ----

export function sceneAt(views, i) {
  const v = views[i];
  const f = FRAMES[v.at];
  return { at: v.at, frame: f, scenario: SCENARIOS[f.scenario], panel: v.panel, focus: v.focus };
}

// The frames from a to b, in order, when b is later in the same
// scenario (a step that plays several decisions over its scroll);
// otherwise just [a, b].
export function framePath(a, b) {
  const fa = FRAMES[a], fb = FRAMES[b];
  if (!fa || fa.scenario !== fb.scenario || fb.i <= fa.i) return [a, b];
  return SCENARIOS[fa.scenario].frames.filter((f) => f.i >= fa.i && f.i <= fb.i).map((f) => f.key);
}

// Callout ends the page works out: the winner's bar in the score strip,
// and each node's; the chip the winner gets on the board; and the row
// being decided.
export const DYNAMIC_ANCHORS = ['winner', 'chosen', 'deciding', ...NODES.map((n) => `bar.${n}`)];
