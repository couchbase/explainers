// Part of the 01-planning diagram (diagram.js), whose Diagram takes
// these methods. A pass's sort, over four frames (scenarios.js): its
// rules, in a panel over the area under the board; each row's group,
// under the row's name, sliding in from the right row by row from the
// top; the rows moving into order (the board does that, setRows); and
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
    const { x, y, h } = SORT_PANEL;
    P.box = el('rect', { x, y, height: h, rx: 12, class: 'sort-panel' }, P.g);
    txt(P.g, x + 18, y + 30, 'before each pass, the planner sorts the partitions:', 'sort-title');
    txt(P.g, x + 18, y + 58, 'ORDER BY group', 'sort-code');
    // a line per group: its number, its rule, and which nodes it means here
    P.lines = Object.keys(SORT_RULES).map((grp, i) => {
      const ly = y + 82 + i * 22;
      const lg = el('g', { class: `sort-line bsort-g${grp}` }, P.g);
      txt(lg, x + 42, ly, String(+grp + 1), 'sort-num');
      txt(lg, x + 62, ly, SORT_RULES[grp], 'sort-rule');
      return { g: lg, which: txt(lg, x + 270, ly, '', 'sort-which') };
    });
    txt(P.g, x + 18, y + 82 + 3 * 22 + 6, 'THEN heavier partitions first, THEN by name', 'sort-code');
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
      P.lines.forEach((l, i) => {
        setText(l.which, pass.labels.which[i] ? `(${pass.labels.which[i]})` : '');
        // (a group with no partition in it, this pass, dimmed)
        op(l.g, counts[i] ? 1 : 0.4);
      });
    }
    P.box.setAttribute('width', (this.boardW || BOARD.x1 - BOARD.x0 + 10).toFixed(1));
    P.g.setAttribute('transform', `translate(0 ${((1 - po) * 10).toFixed(1)})`);
    op(P.g, po);
    // the groups, under the rows' names: in from the right, row by row
    // from the top; out, all together
    const appearing = !on(FA, GROUPS) && on(FB, GROUPS);
    const top = (FB.order || PARTITIONS);
    for (const p of PARTITIONS) {
      const t = this.rowLabels[p].tag;
      if (pass) {
        const grp = pass.groups[p];
        setText(t.num, String(+grp + 1));
        setText(t.text, SORT_RULES[grp]);
        t.g.setAttribute('class', `bsort-g${grp}`);
      }
      let u = lerp(on(FA, GROUPS), on(FB, GROUPS), eq);
      if (appearing) u = easeQuad(clamp01((q - (top.indexOf(p) / PARTITIONS.length) * 0.6) / 0.4));
      t.g.setAttribute('transform', `translate(${((1 - u) * 36).toFixed(1)} 0)`);
      op(t.g, u);
    }
  }
}
