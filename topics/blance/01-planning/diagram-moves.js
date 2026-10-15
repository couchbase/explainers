// Part of the 01-planning diagram (diagram.js), whose Diagram takes
// these methods. The moves (on the board, and each node's counts), the server groups'
// rule, and a partition's moves traced across its row.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { NODES, PARTITIONS, STATES, SCENARIOS } from './scenarios.js';
import { BOARD, STRIP, colX, rowY, chipX, MOVE_UNIT, MOVES_ZERO_Y } from './layout.js';
import { op, boardW } from './diagram-shared.js';
import { Diagram } from './diagram.js';

export class MovesPart {
  // ---- the moves: on the board, and each node's counts below ----

  _buildMoves(g) {
    const M = { g: el('g', { opacity: 0 }, g), cols: {} };
    // (its own baseline: a little higher than the scores', which make
    // room for a two-line title)
    const Z = MOVES_ZERO_Y;
    M.title = txt(M.g, BOARD.x0, STRIP.titleY, '', 'ptitle');
    M.note = txt(M.g, BOARD.x0, STRIP.titleY + 26, '', 'pnote');
    M.axis = el('line', { x1: BOARD.col0, y1: MOVES_ZERO_Y, x2: BOARD.x1, y2: MOVES_ZERO_Y, class: 'paxis' }, M.g);
    for (const n of NODES) {
      const x = colX(n);
      const cg = el('g', {}, M.g);
      M.cols[n] = {
        g: cg,
        add: el('rect', { x: x - 18, width: 16, y: MOVES_ZERO_Y, height: 0, class: 'mbar-add' }, cg),
        del: el('rect', { x: x + 2, width: 16, y: MOVES_ZERO_Y, height: 0, class: 'mbar-del' }, cg),
        label: txt(cg, x, Z + 22, '', 'pscore', 'middle'),
      };
    }
    // the key, left of the bars, where there's room
    [['mbar-add', 'partitions added'], ['mbar-del', 'partitions deleted']].forEach(([cls, label], i) => {
      const ky = Z - 52 + i * 24;
      el('rect', { x: BOARD.x0, y: ky - 9, width: 14, height: 10, class: cls }, M.g);
      txt(M.g, BOARD.x0 + 20, ky, label, 'pkey');
    });
    return M;
  }

  // The moves from frame f's scenario's map before to f's: per chip,
  // built or deleted.
  static movesOf(f) {
    const scn = SCENARIOS[f.scenario];
    const has = (b, p, s, n) => b[p][s].includes(n);
    const built = [], deleted = [];
    for (const p of PARTITIONS) for (const s of STATES) {
      for (const n of f.board[p][s]) if (!has(scn.prev, p, s, n)) built.push([p, s, n]);
      for (const n of scn.prev[p][s]) if (!has(f.board, p, s, n)) deleted.push([p, s, n]);
    }
    return { built, deleted };
  }

  _drawMoves(F, o) {
    const M = this.movesArea;
    op(M.g, o);
    const scn = SCENARIOS[F.scenario];
    const { built, deleted } = Diagram.movesOf(F);
    // (a copy moving from one node to another in the same state is two
    // moves, an add and a del, as CalcPartitionMoves counts them; one
    // changing state on its node, a promote or demote, one)
    const moved = new Set([...built, ...deleted].map(([p]) => p));
    setText(M.title, `the moves: ${scn.title}`);
    setText(M.note, built.length + deleted.length ? `${built.length + deleted.length} moves: ${built.length} partitions added, ${deleted.length} deleted, over ${moved.size} partitions` : 'none yet');
    M.axis.setAttribute('x2', (BOARD.x0 + (this.boardW || BOARD.x1 - BOARD.x0)).toFixed(1));
    // (as its node's column: faded and moved with it)
    const colShown = (n) => this.present[n] ?? 1;
    for (const n of NODES) {
      const c = M.cols[n];
      const a = built.filter((x) => x[2] === n).length, d = deleted.filter((x) => x[2] === n).length;
      c.add.setAttribute('y', (MOVES_ZERO_Y - a * MOVE_UNIT).toFixed(1)); c.add.setAttribute('height', (a * MOVE_UNIT).toFixed(1));
      c.del.setAttribute('y', (MOVES_ZERO_Y - d * MOVE_UNIT).toFixed(1)); c.del.setAttribute('height', (d * MOVE_UNIT).toFixed(1));
      setText(c.label, a || d ? `+${a} −${d}` : '');
      op(c.g, colShown(n));
    }
    // on the board: copies built ringed green, deleted ones left as ghosts
    const shown = new Set();
    const mark = ([p, s, n], kind) => {
      // (a leaving node's copies are ghosts already: _drawLeft)
      if (kind === 'deleted' && scn.leaving.includes(n)) return;
      const key = `${kind}:${p}:${s}:${n}`;
      let m = this.moveMarks.get(key);
      if (!m) {
        // (a deleted copy's ghost keeps its P or R)
        m = el('g', {}, this.movesOnBoard);
        el('rect', { x: -21, y: -16, width: 42, height: 32, rx: 9, class: `mmark-${kind}` }, m);
        if (kind === 'deleted') txt(m, 0, 5, s === 'primary' ? 'P' : 'R', 'lghost-label', 'middle');
        this.moveMarks.set(key, m);
      }
      m.setAttribute('transform', `translate(${chipX(n, s).toFixed(1)} ${rowY(p)})`);
      op(m, o * colShown(n));
      shown.add(key);
    };
    built.forEach((x) => mark(x, 'built'));
    deleted.forEach((x) => mark(x, 'deleted'));
    for (const [key, m] of this.moveMarks) if (!shown.has(key)) op(m, 0);
  }

  // ---- server groups: the rule, in words, under the board's brackets ----

  _buildTree(g) {
    const T = { g: el('g', { opacity: 0 }, g) };
    txt(T.g, BOARD.x0, STRIP.titleY, 'server groups, to blance: each node\'s parent', 'ptitle');
    const lines = [
      ['a, b → g1;  c, d → g2;  g1, g2 → dc', 'pnote'],
      ['a rule for replicas: include level 2, exclude level 1', 'pnote'],
      ['from a: up 2 levels, to dc: a, b, c, d', 'pterm'],
      ['minus up 1 level, to g1: a, b', 'pterm'],
      ['= c, d: the other group', 'pterm pterm-strong'],
    ];
    lines.forEach(([t, cls], i) => txt(T.g, BOARD.x0, STRIP.titleY + 34 + i * 26, t, cls));
    return T;
  }

  // ---- a partition's moves, as arrows across its row ----

  // Scene A's traced partition to scene B's, partway (q): each arrow
  // goes from a copy deleted to the copy built in its place, in the same
  // state, just under the chips, as a pick's "reassigned!" arrow does.
  setTrace(A, B, q) {
    const shown = new Map();
    const add = (sc, o) => {
      if (!sc || sc.trace === undefined || o <= 0.001) return;
      const p = String(sc.trace);
      const { built, deleted } = Diagram.movesOf(sc.frame);
      for (const s of STATES) {
        const from = deleted.filter((x) => x[0] === p && x[1] === s), to = built.filter((x) => x[0] === p && x[1] === s);
        from.forEach(([, , n0], k) => {
          if (!to[k]) return;
          const key = `${sc.frame.scenario}:${p}:${s}:${n0}:${to[k][2]}`;
          shown.set(key, Math.max(shown.get(key) || 0, o));
          if (!this.traces.has(key)) {
            const x0 = chipX(n0, s), x1 = chipX(to[k][2], s), y = rowY(p), dir = Math.sign(x1 - x0);
            const ya = y + 17, xa = x0 + dir * 10, xb = x1 - dir * 12;
            const g = el('g', { opacity: 0 }, this.traceG);
            el('path', { d: `M${x0},${y + 12} Q${x0},${ya} ${xa + dir * 6},${ya} L${xb},${ya}`, class: `varrow pick-${s}` }, g);
            el('path', { d: 'M0,0 L-10,-5 L-10,5 Z', class: `varrow-head pick-${s}`, transform: `translate(${xb + dir * 4} ${ya}) rotate(${dir > 0 ? 0 : 180})` }, g);
            this.traces.set(key, g);
          }
        });
      }
    };
    add(A, A && B && A.trace === B.trace && A.frame === B.frame ? 1 : 1 - q);
    add(B, A && B && A.trace === B.trace && A.frame === B.frame ? 1 : q);
    for (const [key, g] of this.traces) op(g, shown.get(key) || 0);
  }
}
