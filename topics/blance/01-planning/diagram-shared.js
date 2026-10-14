// Helpers shared by the 01-planning diagram's parts (diagram.js and
// diagram-*.js): small formatting, timing and layout functions.

import { clamp01 } from '../../../engine/js/ui/util/anim.js';
import { NODES, PARTITIONS, STATES, SCENARIOS } from './scenarios.js';
import { BOARD, colX } from './layout.js';

export const f4 = (x) => x.toFixed(4);
export const short = (x) => (Math.abs(x) >= 0.01 || x === 0 ? String(+x.toFixed(3)) : x.toFixed(4));
export const op = (e, o) => e.setAttribute('opacity', clamp01(o).toFixed(3));
// one frame's chips: {key, p, state, node}
export const chipsOf = (board) => PARTITIONS.flatMap((p) => STATES.flatMap((s) => board[p][s].map((node, i) => ({ key: `${p}:${s}:${i}`, p, state: s, node }))));
// a node's place in a scenario: not in the cluster, joining one that
// has partitions placed already, leaving (and, once dropped, gone), or in
export const placed = (board) => PARTITIONS.some((p) => STATES.some((s) => board[p][s].length));
export function nodeStatus(scn, node, frame) {
  if (!scn.nodes.includes(node) || (frame.departed && scn.leaving.includes(node))) return 'absent';
  if (scn.leaving.includes(node)) return frame.k < 0 ? 'leaving' : 'gone';
  if (scn.joining.includes(node) && placed(scn.prev)) return 'joining';
  return 'in';
}
// A decision's stages run from 0 to L (its seq's last, the pick); stage
// j plays over (j - 1, j], and u is how far through it.
export const through = (s, j) => clamp01(s - (j - 1));
export const pickOf = (d) => d.seq.length - 1;
// Cause, then effect, one at a time: within a stage (u from 0 to 1)
// with n arrows, the ith flies, lands, and only then grows its part of
// the bar, before the next one leaves.
export const FLY = 0.7;
export const flight = (u, i, n) => clamp01((u - i / n) / (FLY / n));
export const grown = (u, i, n) => clamp01((u - (i + FLY) / n) / ((1 - FLY) / n));
// the pick: the winner's ring, then its arrow up to the board, then its chip
// (a box around every candidate's score appears, then narrows onto the
// lowest, which is then marked; then its arrow flies, then its chip)
export const PICK = { wide: [0, 0.08], narrow: [0.12, 0.38], ring: [0.36, 0.42], flight: [0.42, 0.72], chip: [0.72, 0.92] };
export const within = (t, [a, b]) => clamp01((t - a) / (b - a));

// An arrow's thickness: the pick's, up to the chip it assigns, thick;
// the terms', down to the bars, a thin 1px.
export const arcWidth = (cls) => (cls.includes('sarc-pick') ? 3.2 : 1);

// A dash pattern that draws `drawn` px of a path of length `len` as
// dashes, and leaves the rest blank.
export const DASH = 6, GAP = 4;
export function dashesTo(drawn, len) {
  const out = [];
  let x = 0;
  while (x + DASH + GAP <= drawn) { out.push(DASH, GAP); x += DASH + GAP; }
  const last = Math.min(DASH, drawn - x);
  out.push(last.toFixed(1), (len + DASH).toFixed(1));
  return out.join(' ');
}

// the board's width, to its last node's column, in a scenario
export const boardW = (scn, f) => colX(NODES.filter((n) => nodeStatus(scn, n, f) !== 'absent').pop()) + BOARD.colW / 2 - BOARD.x0 + 10;
// each node's column slot in a frame: the nodes before it still shown
export const slotsOf = (f) => {
  const scn = SCENARIOS[f.scenario];
  let i = 0;
  return Object.fromEntries(NODES.map((n) => [n, nodeStatus(scn, n, f) === 'absent' ? i : i++]));
};
// what each stage of a decision adds to the strip
export const TERM_NOTE = {
  count: (st) => `+ the ${st === 'primary' ? 'primaries' : 'replicas'} it already holds`,
  spread: () => '+ how often it already backs the same primary',
  fill: () => '+ a tie-breaker: all the partitions it holds',
  sticky: () => '− stickiness: it holds this partition now',
};
export const stageNote = (d, x) => (x.stage === 'row' ? 'every node starts at 0, and they\'re scored one at a time'
  : x.stage === 'pick' ? (d.hierarchyPicks.length ? 'the lowest of the rule\'s candidates wins' : 'the lowest wins')
    : `node ${x.node}: ${TERM_NOTE[x.term](d.state)}`);
