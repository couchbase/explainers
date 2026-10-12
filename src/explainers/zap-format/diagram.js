// The zap-format explainer's diagram: the file as a column of bytes,
// lids over its regions, lenses (tethered to their byte ranges) onto
// the structures inside, the bytes read so far lit on the strip, and
// the reader marker. Built once; main.js sets lid and lens openness,
// the marker, and the scene partway between two steps.

import { svgEl as el, svgText as txt, setText, setCls } from '../../js/ui/util/dom.js';
import { easeQuad, lerp } from '../../js/ui/util/anim.js';
import { isAnchorVisible } from '../../js/ui/anchors.js';
import { SEG, STRIP, REGIONS, LENSES, CANVAS, byteY, regionOf } from './layout.js';
import { SCENE } from './scene.js';
import { FOCI, ANCHORS } from './story.js';

const bytes = Uint8Array.from(atob(SEG.bytes), (c) => c.charCodeAt(0));
const hex = (b) => b.toString(16).padStart(2, '0');

export class Diagram {
  constructor(svg) {
    this.svg = svg;
    const [x0, y0, x1, y1] = CANVAS;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    const defs = el('defs', {}, svg);
    const mk = el('marker', { id: 'zarrowhead', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrowhead' }, mk);
    const g = el('g', {}, svg);
    this.lids = {};
    this.lenses = {};
    this._strip(g);
    const tethers = el('g', {}, g);
    for (const [id, l] of Object.entries(LENSES)) this._lens(g, tethers, id, l);
    this.focusA = el('rect', { class: 'zfocus', rx: 5, opacity: 0 }, g);
    this.focusB = el('rect', { class: 'zfocus', rx: 5, opacity: 0 }, g);
    this.target = el('circle', { r: 11, class: 'target-ring', cx: -9999, cy: 0 }, g);
    this._reader(g);
    this.open = new Set();
    this.shownBubbles = new Set();
  }

  // ---- the strip: regions, their lids, offsets, reads ----

  _strip(g) {
    const { x0 } = STRIP;
    txt(g, x0, STRIP.y0 - 30, `one zap file: ${SEG.size.toLocaleString()} bytes, mmapped`, 'zstrip-title');
    this.readG = el('g', {}, g);
    this.regionEls = {};
    for (const r of REGIONS) {
      const rg = el('g', {}, g);
      el('rect', { x: x0, y: r.y, width: r.w, height: r.h, class: `zregion zr-${r.id}` }, rg);
      txt(rg, x0 + 10, r.y + 21, r.label, 'zregion-label');
      txt(rg, x0 + 10, r.y + 40, `${r.bytes.toLocaleString()} B`, 'zregion-bytes');
      this.regionEls[r.id] = rg;
      // its lid: a plain cover, labeled with nothing but "?"
      const lg = el('g', { class: 'zlid' }, g);
      el('rect', { x: x0 + 1, y: r.y + 1, width: r.w - 2, height: r.h - 2, class: 'zlid-bg' }, lg);
      txt(lg, x0 + r.w / 2, r.y + r.h / 2 + 5, '?', 'zlid-q', 'middle');
      this.lids[r.id] = lg;
    }
    // the offsets at region boundaries, left of the strip
    const offs = [...new Set(REGIONS.flatMap((r) => [r.start, r.end]))];
    for (const o of offs) {
      const yy = o === SEG.size ? STRIP.y1 : byteY(o);
      el('line', { x1: x0 - 6, x2: x0, y1: yy, y2: yy, class: 'ztick' }, g);
      txt(g, x0 - 10, yy + 4, String(o), 'ztick-label', 'end');
    }
  }

  // ---- lenses ----

  _lens(g, tethers, id, l) {
    const [x, y, w, h] = l.box;
    // tethered to its region, beside it
    const r = regionOf(l.region);
    const tg = el('g', { opacity: 0 }, tethers);
    const ty0 = Math.max(r.y, y), ty1 = Math.min(r.y + r.h, y + h);
    el('path', { d: `M${STRIP.x1},${ty0} L${x},${y} M${STRIP.x1},${ty1} L${x},${y + h}`, class: 'ztether' }, tg);
    const lg = el('g', { opacity: 0 }, g);
    el('rect', { x, y, width: w, height: h, rx: 10, class: 'zlens' }, lg);
    txt(lg, x + 16, y + 24, l.title, 'zlens-title');
    const body = el('g', {}, lg);
    this.lenses[id] = { g: lg, tether: tg, cx: STRIP.x1, cy: (ty0 + ty1) / 2, body };
    this[`_draw_${id}`](body);
  }

  _cell(parent, c, extra = '') {
    const cg = el('g', {}, parent);
    el('rect', { x: c.x, y: c.y, width: Math.max(2, c.w - 3), height: c.h, rx: 4, class: `zcell ${extra}` }, cg);
    if (c.label) txt(cg, c.x + 6, c.y + 14, c.label, 'zcell-label');
    if (c.value !== undefined) txt(cg, c.x + 6, c.y + c.h - 9, c.value, 'zcell-value');
    return cg;
  }

  _draw_footer(g) {
    const F = SCENE.footer;
    for (const c of F.cells) if (c.size) this._cell(g, c);
    // each field's bytes, as hex, under it
    for (const c of F.cells) {
      for (let k = 0; k < c.size; k++) {
        txt(g, c.x + ((k + 0.5) * (c.w - 3)) / c.size, F.hexY, hex(bytes[c.start + k]), 'zhex', 'middle');
      }
    }
    txt(g, F.cells[0].x, F.hexY + 26, 'big-endian; read backwards from the end of the file', 'znote');
  }

  _draw_sections(g) {
    const S = SCENE.sections;
    for (const c of S.head) this._cell(g, c);
    for (const inf of S.infos) {
      for (const c of inf.cells) this._cell(g, c, c.type === 0 ? 'zcell-text' : c.addr === 0 && c.type !== undefined ? 'zcell-empty' : '');
      // where it starts, as the index says
      const last = inf.cells[inf.cells.length - 1];
      txt(g, last.x + last.w + 6, last.y + last.h / 2 + 4, `@${inf.start}`, 'znote');
    }
  }

  _draw_record(g) {
    const R = SCENE.record;
    for (const c of R.cells) this._cell(g, c);
    txt(g, R.note[0], R.note[1], `→ at ${R.cells[2].value}: the FST's length (${R.fstLen} B), then the FST`, 'znote');
  }

  _draw_stored(g) {
    const T = SCENE.stored;
    this._cell(g, T.index[0]);
    txt(g, T.index[0].x, T.index[0].y + 66, `→ the record at ${T.start}:`, 'znote');
    for (const c of T.rec) this._cell(g, c, c.key === 'snappy' ? 'zcell-snappy' : c.key === 'id' ? 'zcell-id' : '');
    this.storedFields = el('g', { opacity: 0 }, g);
    txt(this.storedFields, T.fields[0].x - 10, T.fields[0].y - 26, 'snappy, decompressed:', 'znote');
    for (const f of T.fields) txt(this.storedFields, f.x, f.y, f.text.length > 52 ? `${f.text.slice(0, 51)}…` : f.text, 'zstored-field');
  }

  _draw_fst(g) {
    const F = SCENE.fst;
    this.fstEdges = F.edges.map((e) => {
      const eg = el('g', {}, g);
      return { e, line: el('line', { class: 'zedge' }, eg), label: txt(eg, 0, 0, e.ch, 'zedge-label', 'middle'),
        out: txt(eg, 0, 0, e.out ? `+${e.out}` : '', 'zedge-out', 'middle') };
    });
    this.fstNodes = F.trie.map((n) => {
      const ng = el('g', {}, g);
      return { n, c: el('circle', { r: 11, class: `znode${n.final ? ' final' : ''}` }, ng), ng };
    });
    this.fstCaption = txt(g, LENSES.fst.box[0] + 20, LENSES.fst.box[1] + LENSES.fst.box[3] - 18, '', 'znote');
  }

  _draw_walk(g) {
    const W = SCENE.walk;
    this.walkEls = W.steps.map((s, i) => {
      const sg = el('g', { opacity: 0.25 }, g);
      // the other ways out of this state, faintly
      const others = s.letters.filter((ch) => !s.next || ch !== s.next.ch);
      others.forEach((ch, k) => {
        const sx = s.x + (k - (others.length - 1) / 2) * 9;
        el('line', { x1: s.x, y1: s.y + 16, x2: sx, y2: s.y + 46, class: 'zstub' }, sg);
        txt(sg, sx, s.y + 58, ch, 'zstub-label', 'middle');
      });
      el('circle', { cx: s.x, cy: s.y, r: 16, class: `znode${s.final ? ' final' : ''}` }, sg);
      txt(sg, s.x, s.y - 26, `sum ${s.sum}`, 'zsum', 'middle');
      let edge = null;
      if (s.next) {
        const nx = W.steps[i + 1].x;
        edge = el('g', { opacity: 0.25 }, g);
        el('line', { x1: s.x + 16, y1: s.y, x2: nx - 18, y2: s.y, class: 'zedge', 'marker-end': 'url(#zarrowhead)' }, edge);
        txt(edge, (s.x + nx) / 2, s.y - 8, s.next.ch, 'zedge-label big', 'middle');
        txt(edge, (s.x + nx) / 2, s.y + 18, s.next.out ? `+${s.next.out}` : '+0', 'zedge-out', 'middle');
      }
      return { g: sg, edge };
    });
    const last = W.steps[W.steps.length - 1];
    this.walkValue = el('g', { opacity: 0 }, g);
    txt(this.walkValue, last.x - 306, last.y + 77, `value ${W.value}: top bits 00, an offset`, 'zvalue');
    txt(this.walkValue, LENSES.walk.box[0] + 20, LENSES.walk.box[1] + LENSES.walk.box[3] - 16,
      `(${SEG.fields.find((f) => f.name === 'description').fstStates.length} states in all; the walk touches ${W.steps.length})`, 'znote');
  }

  _chips(g, chips, key) {
    return chips.map((c) => {
      const cg = el('g', {}, g);
      const r = el('rect', { x: c.x - 4, y: c.y - 16, width: 42, height: 32, rx: 5, class: 'zchip' }, cg);
      txt(cg, c.x + 17, c.y + 5, String(c.doc), 'zchip-label', 'middle');
      return { c, cg, r, key };
    });
  }

  _draw_postings(g) {
    const P = SCENE.postings;
    for (const c of P.header) this._cell(g, c, c.key === 'bitmap' ? 'zcell-bitmap' : '');
    this.containerTxt = txt(g, P.container.x, P.container.y + 4, P.container.text, 'znote strong');
    this.postingsChips = this._chips(g, P.docs, 'p');
    this.deletedTxt = txt(g, P.docs[2].x - 8, P.deletedY, '↑ deleted: from root.bolt, not this file', 'zdeleted');
  }

  _draw_freq(g) {
    const F = SCENE.freq;
    txt(g, F.head.x, F.head.y + 4, F.head.text, 'znote strong');
    this.freqRows = F.rows.map((r) => {
      const rg = el('g', {}, g);
      const norm = (1 / Math.sqrt(r.fieldLen)).toFixed(3);
      txt(rg, r.x, r.y + 4, `doc ${r.doc}: freq ${r.freq}, locations ${r.hasLocs ? 'yes' : 'no'}, length ${r.fieldLen} → norm 1/√${r.fieldLen} = ${norm}`, `zhit${r.deleted ? ' deleted' : ''}`);
      if (r.deleted) txt(rg, r.x, r.y + 20, '(deleted: skipped, but its bytes are stepped over)', 'znote');
      return rg;
    });
  }

  _draw_and(g) {
    const A = SCENE.and;
    this.andRows = A.rows.map((r) => {
      const rg = el('g', { opacity: 0 }, g);
      txt(rg, A.labelX, r.chips[0].y + 5, r.label, 'znote strong');
      return { r, rg, chips: this._chips(rg, r.chips, r.key) };
    });
  }

  // ---- the reader marker ----

  _reader(g) {
    this.reader = el('g', { opacity: 0 }, g);
    // a pointer, just above what's being read
    el('path', { d: 'M-8,-12 L8,-12 L0,0 Z', class: 'zreader' }, this.reader);
    this.readerLabel = txt(this.reader, 12, -2, 'reader', 'zreader-label');
  }

  setReader(p, o) {
    if (!p || o <= 0.001) { this.reader.setAttribute('opacity', 0); return; }
    this.reader.setAttribute('opacity', o.toFixed(3));
    this.reader.setAttribute('transform', `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`);
  }

  // ---- what the engine's page logic calls ----

  setView(open, bubbles) { this.open = open; this.shownBubbles = bubbles; }

  setLid(id, t) {
    const l = this.lids[id];
    l.style.opacity = (1 - t).toFixed(3);
    l.style.visibility = t >= 0.999 ? 'hidden' : '';
  }

  setBubble(id, t) {
    const L = this.lenses[id];
    const s = 0.15 + 0.85 * t;
    L.g.setAttribute('opacity', t.toFixed(3));
    L.g.setAttribute('transform', `translate(${L.cx} ${L.cy}) scale(${s.toFixed(3)}) translate(${-L.cx} ${-L.cy})`);
    L.g.style.visibility = t <= 0.001 ? 'hidden' : '';
    L.tether.setAttribute('opacity', (t * 0.9).toFixed(3));
  }

  setTarget(p) {
    if (!p) { this.target.setAttribute('cx', -9999); return; }
    this.target.setAttribute('cx', p[0]);
    this.target.setAttribute('cy', p[1]);
  }

  anchor(id) {
    if (id === 'reader') return this.readerAt ? { p: this.readerAt, visible: true } : null;
    const a = ANCHORS[id];
    if (!a) return null;
    return { p: a.p, visible: isAnchorVisible(id, this.open, this.shownBubbles) };
  }

  // The scene partway (q) from A to B (see sceneAt in story.js).
  drawScene(A, B, q) {
    const b = B || A, a = A || B;
    if (!b) return;
    const k = easeQuad(q);
    // reads: those new in B fade in
    const seenA = new Set((a.reads || []).map((r) => r.join('-')));
    this.readG.replaceChildren();
    for (const r of b.reads) {
      const y0 = byteY(r[0]), y1 = Math.max(y0 + 4, byteY(r[1] - 1) + 1);
      el('rect', { x: STRIP.x0 - 6, y: y0, width: STRIP.x1 - STRIP.x0 + 12, height: y1 - y0, rx: 3, class: 'zread',
        opacity: seenA.has(r.join('-')) ? 1 : k.toFixed(3) }, this.readG);
    }
    // the focus highlight: A's fades out as B's fades in
    const box = (s, rect, o) => {
      const f = s && s.focus && FOCI[s.focus];
      if (!f) { rect.setAttribute('opacity', 0); return; }
      const [x, y, w, h] = f.box;
      for (const [k2, v] of Object.entries({ x: x - 4, y: y - 4, width: w + 8, height: h + 8 })) rect.setAttribute(k2, v);
      rect.setAttribute('opacity', o.toFixed(3));
    };
    const same = a.focus === b.focus;
    box(a, this.focusA, same ? 0 : 1 - k);
    box(b, this.focusB, same ? 1 : k);
    this._drawFst(a, b, k);
    this._drawWalk(a, b, k);
    this._drawPostings(a, b, k);
    this._drawAnd(a, b, k);
    this.storedFields.setAttribute('opacity', lerp(a.storedStage >= 4 ? 1 : 0, b.storedStage >= 4 ? 1 : 0, k).toFixed(3));
  }

  // The trie, merging into the FST, and then its outputs.
  _drawFst(a, b, k) {
    const m = lerp(Math.min(1, a.fstStage), Math.min(1, b.fstStage), k);
    const outO = lerp(a.fstOutputs ? 1 : 0, b.fstOutputs ? 1 : 0, k);
    const F = SCENE.fst;
    const pos = new Map();
    for (const { n, ng } of this.fstNodes) {
      const [fx, fy] = F.fstPos.get(n.state);
      const x = lerp(n.x, fx, easeQuad(m)), y = lerp(n.y, fy, easeQuad(m));
      pos.set(n.prefix, [x, y]);
      ng.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    }
    for (const { e, line, label, out } of this.fstEdges) {
      const [x1, y1] = pos.get(e.from), [x2, y2] = pos.get(e.to);
      line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      label.setAttribute('x', ((x1 + x2) / 2).toFixed(1)); label.setAttribute('y', ((y1 + y2) / 2 - 6).toFixed(1));
      // (nearer the transition's end, so the root's don't pile up)
      out.setAttribute('x', lerp(x1, x2, 0.72).toFixed(1)); out.setAttribute('y', (lerp(y1, y2, 0.72) + 14).toFixed(1));
      out.setAttribute('opacity', outO.toFixed(3));
    }
    setText(this.fstCaption, m < 0.5
      ? `a trie: one node per prefix, ${F.nodes} nodes for ${F.terms.length} terms`
      : `the FST: equal tails merged, ${F.states} states`);
  }

  _drawWalk(a, b, k) {
    this.walkEls.forEach(({ g, edge }, i) => {
      const on = (s) => (s.walkK >= i ? 1 : 0.25);
      g.setAttribute('opacity', lerp(on(a), on(b), k).toFixed(3));
      if (edge) edge.setAttribute('opacity', lerp(a.walkK > i ? 1 : 0.25, b.walkK > i ? 1 : 0.25, k).toFixed(3));
    });
    this.walkValue.setAttribute('opacity', lerp(a.walkValue ? 1 : 0, b.walkValue ? 1 : 0, k).toFixed(3));
  }

  _drawPostings(a, b, k) {
    const del = SEG.deleted;
    const delO = lerp(a.deletedShown ? 1 : 0, b.deletedShown ? 1 : 0, k);
    const liveO = lerp(a.liveShown ? 1 : 0, b.liveShown ? 1 : 0, k);
    for (const { c, r, cg } of this.postingsChips) {
      const dead = del.includes(c.doc) && c.on;
      setCls(r, `zchip${c.on ? ' on' : ''}${dead && delO > 0.5 ? ' dead' : ''}`);
      cg.setAttribute('opacity', dead ? (1 - 0.75 * liveO).toFixed(3) : 1);
    }
    this.deletedTxt.setAttribute('opacity', (delO * (1 - 0.6 * liveO)).toFixed(3));
  }

  _drawAnd(a, b, k) {
    this.andRows.forEach(({ rg, chips }, i) => {
      rg.setAttribute('opacity', lerp(a.andStage > i ? 1 : 0, b.andStage > i ? 1 : 0, k).toFixed(3));
      for (const { c, r } of chips) setCls(r, `zchip${c.on ? ' on' : ''}`);
    });
  }
}
