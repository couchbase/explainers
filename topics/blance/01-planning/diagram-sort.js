// Part of the 01-planning diagram (diagram.js), whose Diagram takes
// these methods. A pass's sort, over four frames (scenarios.js): its
// rules, in a panel over the area under the board; each row's number
// from the rules, and the rule, under the row's name, sliding in from
// the right row by row from the top; the rows moving into order (the board does that, setRows); and
// the panel and the groups fading.

import { svgEl as el, svgText as txt, setText } from '../../../engine/js/ui/util/dom.js';
import { lerp, clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { PARTITIONS, SORT_RULES } from './scenarios.js';
import { BOARD, SEP_Y, SORT_PANEL } from './layout.js';
import { op } from './diagram-shared.js';

// which of a sort's frames show its panel, and its groups
const PANEL = ['rules', 'keys', 'sorted'], GROUPS = ['keys', 'sorted'];

export class SortPart {
  _buildSort(g) {
    const P = { g: el('g', { opacity: 0 }, g) };
    const { x, y, h } = SORT_PANEL, dy = 40;
    P.box = el('rect', { x, y, height: h, rx: 14, class: 'sort-panel' }, P.g);
    txt(P.g, x + 28, y + 50, 'first, the planner sorts the partitions:', 'sort-title');
    txt(P.g, x + 28, y + 104, 'ORDER BY', 'sort-code');
    // (as a SQL comment: which nodes are leaving and joining, here)
    P.nodes = txt(P.g, x + 220, y + 104, '', 'sort-comment');
    // a line per rule: the number a partition matching it gets first,
    // the rule, and as a comment, how many partitions it catches
    P.lines = Object.keys(SORT_RULES).map((grp, i) => {
      const ly = y + 104 + (i + 1) * dy;
      const lg = el('g', { class: `sort-line bsort-g${grp}` }, P.g);
      txt(lg, x + 64, ly, `${+grp + 1}:`, 'sort-num');
      txt(lg, x + 100, ly, `if ${SORT_RULES[grp]}`, 'sort-rule');
      return { g: lg, count: txt(lg, x + 440, ly, '', 'sort-comment') };
    });
    txt(P.g, x + 64, y + 104 + 4 * dy + 12, 'then heavier partitions first,', 'sort-code');
    txt(P.g, x + 64, y + 104 + 5 * dy + 12, 'then by partition name', 'sort-code');
    return P;
  }

  _drawSort(FA, FB, q) {
    const P = this.sortPanel, eq = easeQuad(q);
    const on = (f, which) => (which.includes(f.sort) ? 1 : 0);
    // the panel: popping open (rising a little as it fades in), and
    // fading out once the rows are in order
    const po = lerp(on(FA, PANEL), on(FB, PANEL), eq);
    const pass = (q < 0.5 ? FA.pass || FB.pass : FB.pass || FA.pass);
    if (pass) {
      const counts = Object.fromEntries(Object.keys(SORT_RULES).map((g) => [g, Object.values(pass.groups).filter((x) => x === g).length]));
      setText(P.nodes, `-- ${pass.labels.nodes}`);
      P.lines.forEach((l, i) => {
        setText(l.count, `-- ${counts[i]} partition${counts[i] === 1 ? '' : 's'}`);
        // (a group with no partition in it, this pass, dimmed)
        op(l.g, counts[i] ? 1 : 0.4);
      });
    }
    // (as wide as the board and a bit, or as its widest line, if wider)
    let w = (this.boardW || BOARD.x1 - BOARD.x0 + 10) + SORT_PANEL.wider;
    if (po > 0) for (const t of P.g.querySelectorAll('text')) w = Math.max(w, t.getBBox().x + t.getComputedTextLength() - SORT_PANEL.x + 28);
    P.box.setAttribute('width', w.toFixed(1));
    P.g.setAttribute('transform', `translate(0 ${((1 - po) * 10).toFixed(1)})`);
    op(P.g, po);
    // (and while it's up, what's under it goes: the tallies, and the
    // scores, moves or tree under them)
    for (const c of Object.values(this.cols)) for (const e of [c.pBar, c.rBar, c.tText]) op(e, 1 - po);
    for (const e of [this.strip.g, this.movesArea.g, this.treeArea.g]) op(e, +(e.getAttribute('opacity') ?? 1) * (1 - po));
    // the groups, under the rows' names: in from the right, row by row
    // from the top; out, all together
    const appearing = !on(FA, GROUPS) && on(FB, GROUPS);
    const top = (FB.order || PARTITIONS);
    for (const p of PARTITIONS) {
      const t = this.rowLabels[p].tag;
      if (pass) {
        const grp = pass.groups[p];
        setText(t.text, `${+grp + 1}: if ${SORT_RULES[grp]}`);
        t.g.setAttribute('class', `bsort-g${grp}`);
      }
      let u = lerp(on(FA, GROUPS), on(FB, GROUPS), eq);
      if (appearing) u = easeQuad(clamp01((q - (top.indexOf(p) / PARTITIONS.length) * 0.6) / 0.4));
      t.g.setAttribute('transform', `translate(${((1 - u) * 36).toFixed(1)} 0)`);
      op(t.g, u);
    }
  }
}
