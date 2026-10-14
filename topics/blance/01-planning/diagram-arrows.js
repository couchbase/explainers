// Part of the 01-planning diagram (diagram.js), whose Diagram takes
// these methods. The arrows: where each term of a score comes from, and the pick's.

import { svgEl as el } from '../../../engine/js/ui/util/dom.js';
import { clamp01 } from '../../../engine/js/ui/util/anim.js';
import { NODES, PARTITIONS, SCENARIOS, sourcesOf } from './scenarios.js';
import { STRIP, colX, rowY, chipX, TALLY_Y, scoreY } from './layout.js';
import { op, through, pickOf, flight, grown, PICK, within, arcWidth, dashesTo } from './diagram-shared.js';
import { Diagram } from './diagram.js';

export class ArrowsPart {
  // ---- arrows: where each term comes from ----

  _arc(key, from, to, bow, cls, width = 1.8) {
    let a = this.arcs.get(key);
    if (!a) {
      const [x0, y0] = from, [x1, y1] = to;
      const d = `M${x0},${y0} C${x0 + bow},${y0 + (y1 - y0) * 0.35} ${x1 + bow},${y1 - (y1 - y0) * 0.35} ${x1},${y1}`;
      // (a halo under it, in the background's color, so it shows even
      // over a bar of its own color)
      const halo = el('path', { d, class: 'sarc-halo', 'stroke-width': (width + 2.6).toFixed(2) }, this.arcG);
      const path = el('path', { d, class: `sarc ${cls}`, 'stroke-width': width.toFixed(2) }, this.arcG);
      // a triangle, pointing along the path (see _drawArcs)
      // (as big as the arrow is thick)
      const hl = 6 + 1.6 * width, hw = 3 + 0.9 * width;
      const head = el('path', { d: `M0,0 L${-hl},${-hw} L${-hl},${hw} Z`, class: `sarc-head ${cls}` }, this.arcG);
      // (styled as the part of the bar it adds to: solid for the count
      // and the tie-breaker, dashed for the hatched spread and the dashed
      // stickiness line; the pick's, up, solid)
      a = { halo, path, head, len: path.getTotalLength(), solid: /sarc-(count|fill|pick)/.test(cls) };
      this.arcs.set(key, a);
    }
    return a;
  }

  // Decision d at stage s (0..5): each stage's arrows draw along their
  // path as it goes, stay while it's settled, and fade in the next.
  _drawArcs(scnId, d, s, o) {
    const shown = new Set();
    if (d && o > 0.001) {
      const scn = SCENARIOS[scnId];
      const src = sourcesOf(scn, d, d.before);
      const W = STRIP.barW;
      const stageArcs = [];
      const L = pickOf(d);
      const at = (n, term) => d.seq.findIndex((x) => x.node === n && x.term === term);
      for (const n of NODES) {
        const c = d.scored.find((x) => x.node === n);
        if (!c) continue;
        const b = Diagram.barAt(d, L, n);
        const w = c.weight, np = PARTITIONS.length;
        const chipAt = ([p, nn, st]) => [chipX(nn, st), rowY(p) + 12];
        // each lands on the top of the bar as it is when it arrives
        const cn = src[n].count.length, sn = src[n].spread.length, fn = src[n].fill.length;
        // (counter-clockwise, every arrow down bows west, as the pick's
        // up bows east, by more for each so they don't overlap)
        src[n].count.forEach((ch, i) => stageArcs.push([at(n, 'count'), i, cn, `c:${ch}`, chipAt(ch), [colX(n), scoreY(i / w) - 3], -44 - 12 * i, `sarc-count sarc-${d.state}`]));
        src[n].spread.forEach((ch, i) => stageArcs.push([at(n, 'spread'), i, sn, `s:${n}:${ch}`, chipAt(ch), [colX(n), scoreY(b.count + i / np / w) - 3], -38 - 10 * i, 'sarc-spread']));
        src[n].fill.forEach((ch, i) => stageArcs.push([at(n, 'fill'), i, fn, `f:${ch}`, chipAt(ch), [colX(n), scoreY(b.spread) - 3], -30 - 8 * i, 'sarc-fill']));
        src[n].sticky.forEach((ch) => stageArcs.push([at(n, 'sticky'), 0, 1, `k:${ch}`, chipAt(ch), [colX(n) + W / 2 + 6, scoreY(b.fill) - 2], -56, `sarc-sticky pick-${d.state}`]));
        // A term with nothing to count still gets its beat: an arrow from
        // the node's tallies ("0 P · 0 R") down to its bar, adding 0.
        const fromTally = [colX(n) - 22, TALLY_Y + 36];
        if (!cn) stageArcs.push([at(n, 'count'), 0, 1, `zc:${n}`, fromTally, [colX(n), scoreY(0) - 3], -30, `sarc-count sarc-${d.state} sarc-zero`]);
        if (!sn) stageArcs.push([at(n, 'spread'), 0, 1, `zs:${n}`, fromTally, [colX(n), scoreY(b.count) - 3], -30, 'sarc-spread sarc-zero']);
        if (!fn) stageArcs.push([at(n, 'fill'), 0, 1, `zf:${n}`, fromTally, [colX(n), scoreY(b.spread) - 3], -30, 'sarc-fill sarc-zero']);
      }
      // pick: from the winner's bar up to where its chip goes
      const wn = d.chosen[0], wb = Diagram.barAt(d, L, wn);
      stageArcs.push([L, -1, 1, `p:${d.partition}:${wn}`, [colX(wn), scoreY(Math.max(wb.fillShown, wb.score, 0.3)) - 12], [chipX(wn, d.state), rowY(d.partition) + 14], 40, `sarc-pick pick-${d.state}`]);
      for (const [j, i, n, key0, from, to, bow, cls] of stageArcs) {
        if (j < 0) continue;
        const key = `${d.k}:${key0}`;
        const u = through(s, j);
        // its flight: the ith of n, one at a time (the pick's, after the ring)
        const t = i < 0 ? within(u, PICK.flight) : flight(u, i, n);
        // (they stay while their stage is settled, and fade in the next)
        const fade = s <= j ? 1 : clamp01(1 - (s - j) * 2);
        if (t <= 0.001 || fade <= 0.001) continue;
        const a = this._arc(key, from, to, bow, cls, arcWidth(cls));
        // drawn up to its head
        a.path.setAttribute('stroke-dasharray', a.solid ? `${(a.len * t).toFixed(1)} ${(a.len + 10).toFixed(1)}` : dashesTo(a.len * t, a.len));
        a.halo.setAttribute('stroke-dasharray', `${(a.len * t).toFixed(1)} ${(a.len + 10).toFixed(1)}`);
        const h = a.path.getPointAtLength(a.len * t);
        const b = a.path.getPointAtLength(Math.max(0, a.len * t - 2));
        const angle = Math.atan2(h.y - b.y, h.x - b.x) * 180 / Math.PI;
        a.head.setAttribute('transform', `translate(${h.x.toFixed(1)} ${h.y.toFixed(1)}) rotate(${angle.toFixed(1)})`);
        // once it lands and its part has grown, it's absorbed: its head
        // goes, and its line stays only as a faint trace of the source
        const absorbed = i < 0 ? 0 : grown(u, i, n);
        op(a.path, o * fade * (1 - 0.75 * absorbed)); op(a.halo, o * fade * (1 - 0.75 * absorbed));
        op(a.head, o * fade * (1 - absorbed));
        shown.add(key);
      }
    }
    for (const [key, a] of this.arcs) if (!shown.has(key)) { op(a.path, 0); op(a.head, 0); op(a.halo, 0); }
  }
}
