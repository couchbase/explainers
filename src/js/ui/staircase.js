// Draws stairs-scene.js scenes into the merger's bubble, scrubbing
// between two of them: items with the same key move and resize; the
// others fade (bars also grow from or shrink to their base). Text
// fades sequentially, the old out before the new comes in, so lines
// never overlap.

import { svgEl as el, setText, setCls } from './util/dom.js';
import { lerp } from './util/anim.js';

const TAG = { bar: 'rect', slot: 'rect', hl: 'rect', line: 'line', text: 'text' };
const BASE_CLS = { bar: 'fbar', slot: 'stair-slot', hl: '', line: 'tier-line', text: 'back-note' };

export class Staircase {
  constructor(parent) {
    this.g = el('g', { class: 'staircase' }, parent);
    // Layers, back to front.
    this.layers = { slot: el('g', {}, this.g), line: el('g', {}, this.g), bar: el('g', {}, this.g), hl: el('g', {}, this.g), text: el('g', {}, this.g) };
    this.els = new Map();
    this.drawn = '';
  }

  _el(it) {
    let e = this.els.get(it.key);
    if (!e) {
      e = el(TAG[it.kind], {}, this.layers[it.kind]);
      if (it.anchor) e.setAttribute('text-anchor', it.anchor);
      this.els.set(it.key, e);
    }
    return e;
  }

  // Draws the change from scene a to scene b at progress q in 0..1.
  draw(a, b, q, key) {
    const k = `${key}|${q.toFixed(3)}`;
    if (k === this.drawn) return;
    this.drawn = k;
    const A = new Map(a.items.map((it) => [it.key, it]));
    const B = new Map(b.items.map((it) => [it.key, it]));
    const seen = new Set();
    for (const [key2, ib] of B) { seen.add(key2); this._item(A.get(key2), ib, q); }
    for (const [key2, ia] of A) if (!seen.has(key2)) { seen.add(key2); this._item(ia, null, q); }
    for (const [key2, e] of this.els) if (!seen.has(key2)) e.setAttribute('opacity', 0);
  }

  _item(ia, ib, q) {
    const it = ib || ia;
    const e = this._el(it);
    // A missing side: a bar sits at its base with no height; anything
    // else is just transparent there.
    const gone = (x) => (x.kind === 'bar' ? { ...x, y: x.y + x.h, h: 0, o: 0 } : { ...x, o: 0 });
    const a = ia || gone(ib), b = ib || gone(ia);
    let o = lerp(a.o, b.o, q);
    if (it.kind === 'text' && !(ia && ib && ia.s === ib.s)) {
      o = ia ? a.o * (1 - Math.min(1, q * 2)) : b.o * Math.max(0, q * 2 - 1);
    }
    e.setAttribute('opacity', o.toFixed(3));
    const cls = `${BASE_CLS[it.kind]} ${(q < 0.5 ? a : b).cls || ''}`.trim();
    setCls(e, cls);
    const x = lerp(a.x, b.x, q), y = lerp(a.y, b.y, q);
    if (it.kind === 'text') {
      e.setAttribute('x', x.toFixed(1)); e.setAttribute('y', y.toFixed(1));
      setText(e, it.s);
    } else if (it.kind === 'line') {
      const w = lerp(a.w, b.w, q), h = lerp(a.h, b.h, q);
      e.setAttribute('x1', x.toFixed(1)); e.setAttribute('y1', y.toFixed(1));
      e.setAttribute('x2', (x + w).toFixed(1)); e.setAttribute('y2', (y + h).toFixed(1));
    } else {
      e.setAttribute('x', x.toFixed(1)); e.setAttribute('y', y.toFixed(1));
      e.setAttribute('width', Math.max(0, lerp(a.w, b.w, q)).toFixed(1));
      e.setAttribute('height', Math.max(0, lerp(a.h, b.h, q)).toFixed(1));
      e.setAttribute('rx', it.kind === 'bar' ? 2 : 3);
    }
  }
}
