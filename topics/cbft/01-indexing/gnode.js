// A goroutine box in the diagram, and the short labels it shows.

import { svgEl as el, svgText as txt, setText, setCls, clip } from '../../../engine/js/ui/util/dom.js';
import { easeQuad } from '../../../engine/js/ui/util/anim.js';

// Classifies a goroutine's state. "stall" means blocked by
// backpressure, as opposed to idly waiting for work.
const STALL = /herder|flow control|worker busy|paused|persistence \(safe/;
export function procState(p) {
  if (!p) return 'wait';
  if (p.state === 'busy' || p.state === 'running') return 'busy';
  if (p.state === 'sleep') return 'nap';
  if (p.state === 'blocked' && STALL.test(p.label)) return 'stall';
  return 'wait';
}

// A goroutine box: state dot, name, one line of live activity.
// With `header: true`, it's the title row of a bigger panel: the
// activity goes on the same line, after the name.
//
// A box draws a change from one state to another at a progress q in
// 0..1: the old and new borders and dots cross-fade (two overlaid
// copies), and the old label slides out to the left, then the new one
// slides in from the right. Who drives q depends on who owns time:
// scrolling (scrub) on paused story steps, or the clock (live) when the
// reader has pressed Play.
const SLIDE = 22;
const gist = (l) => l.replace(/[\d.,]+/g, '#'); // a changed number isn't a new activity

export class GNode {
  constructor(parent, x, y, w, h, title, { sub, header } = {}) {
    this.g = el('g', { class: 'gnode' }, parent);
    this.boxCls = header ? 'gbox gbox-header' : 'gbox';
    this.boxes = [0, 1].map(() => el('rect', { x, y, width: w, height: h, rx: 5, class: `${this.boxCls} s-wait` }, this.g));
    this.dots = [0, 1].map(() => el('circle', { cx: x + 14, cy: y + 17, r: 4.5, class: 'gdot s-wait' }, this.g));
    this.title = txt(this.g, x + 26, y + 21, title, 'gtitle');
    const lx = header ? x + 34 + title.length * 8.2 : x + 14;
    const ly = header ? y + 21 : y + h - 11;
    this.labels = [txt(this.g, lx, ly, '', 'glabel'), txt(this.g, lx, ly, '', 'glabel')];
    // characters that fit at the normal and the small label size
    const room = w - (lx - x) - (header ? 46 : 12);
    this.fit = [Math.floor(room / 6.7), Math.floor(room / 6.0)];
    this.since = txt(this.g, x + w - 10, y + 20, '', 'gsince', 'end');
    this.cur = { state: 'wait', label: sub || '' };
    this.tween = null;
    this.lastChange = -Infinity;
    this.drawn = '';
    this.draw(this.cur, this.cur, 1);
  }

  _label(t, st, x, o) {
    const small = st.label.length > this.fit[0];
    setText(t, clip(st.label, small ? this.fit[1] : this.fit[0]));
    setCls(t, `glabel s-${st.state}${small ? ' small' : ''}`);
    t.setAttribute('transform', x ? `translate(${x.toFixed(1)} 0)` : '');
    t.setAttribute('opacity', o.toFixed(3));
  }

  // Draws the change from state a to state b at progress q.
  draw(a, b, q) {
    const key = `${a.state}|${a.label}|${b.state}|${b.label}|${q.toFixed(3)}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const sameState = a.state === b.state;
    setCls(this.boxes[0], `${this.boxCls} s-${a.state}`);
    setCls(this.boxes[1], `${this.boxCls} s-${b.state}`);
    setCls(this.dots[0], `gdot s-${a.state}`);
    setCls(this.dots[1], `gdot s-${b.state}`);
    this.boxes[0].setAttribute('opacity', sameState ? 0 : (1 - q).toFixed(3));
    this.boxes[1].setAttribute('opacity', sameState ? 1 : q.toFixed(3));
    this.dots[0].setAttribute('opacity', sameState ? 0 : (1 - q).toFixed(3));
    this.dots[1].setAttribute('opacity', sameState ? 1 : q.toFixed(3));
    if (gist(a.label) === gist(b.label)) {
      this._label(this.labels[0], { state: b.state, label: b.label }, 0, 1);
      this.labels[1].setAttribute('opacity', 0);
    } else {
      // One after the other, never overlapping: the old label slides
      // out during the first half, the new one in during the second.
      const out = Math.min(1, q * 2), inn = Math.max(0, q * 2 - 1);
      this._label(this.labels[0], a, -SLIDE * out, 1 - out);
      this._label(this.labels[1], b, SLIDE * (1 - inn), inn);
    }
  }

  // Scroll-driven: the page says exactly where between a and b we are.
  scrub(a, b, q) {
    this.tween = null;
    this.cur = b;
    setText(this.since, '');
    this.draw(a, b, q);
  }

  // Clock-driven, for when the simulation is playing: tween to `want`,
  // holding each state for at least `dwell` ms so nothing flickers.
  live(want, wallNow, dwell) {
    setText(this.since, want.since || '');
    if (this.tween) {
      const q = (wallNow - this.tween.t0) / 400;
      if (q < 1) { this.draw(this.tween.a, this.tween.b, easeQuad(q)); return; }
      this.cur = this.tween.b;
      this.tween = null;
    }
    const c = this.cur;
    if (want.state === c.state && gist(want.label) === gist(c.label)) {
      this.cur = want;
      this.draw(want, want, 1);
      return;
    }
    if (wallNow - this.lastChange < dwell) { this.draw(c, c, 1); return; }
    this.lastChange = wallNow;
    this.tween = { a: c, b: want, t0: wallNow };
    this.draw(c, want, 0);
  }
}

// Short, plain activity labels for each goroutine box, so they fit
// without clipping. Raw labels come from the simulation's processes.
const SHORT = [
  [/^waiting for DCP mutations/, 'idle: waiting for DCP'],
  [/^batch\.Index/, 'batch.Index(): mapping docs'],
  [/^batchCh-(\d) <- batch/, 'stalled: worker $1 is busy'],
  [/^herder: IndexStart/, 'stalled by the app herder'],
  [/^herder: BatchIntroductionStart/, 'stalled by the app herder'],
  [/^waiting for batches/, 'idle: waiting for batches'],
  [/^holding a batch \((\d+) ops\)/, 'holding $1 ops till the tick'],
  [/^waiting for analysis/, 'waiting for analysis'],
  [/^Scorch\.Batch\(\)/, 'calling Scorch.Batch()'],
  [/^NewUsing/, 'building in-memory segment'],
  // prepareSegment() also computes obsoletes (deletion bitmaps for
  // older segments); the story doesn't cover those yet.
  [/^prepareSegment/, 'handing segment over'],
  [/^introductions <- segment/, 'handing segment over'],
  [/^waiting for introduction to be applied/, 'waiting for the introducer'],
  [/^waiting for persistence/, 'stalled: waiting for persist'],
  [/^select: introductions/, 'idle'],
  [/^introduceSegment/, 'introducing a segment'],
  [/^introducePersist/, 'swapping in files'],
  [/^introduceMerge/, 'introducing a merge'],
  [/^nap /, 'napping (≤2s)'],
  [/^waiting for (\d+) in-memory merge/, 'waiting on $1 workers'],
  [/^writing (\S+)/, 'writing $1'],
  [/^fsync (\S+\.zap)/, 'fsync $1'],
  [/^root\.bolt: commit/, 'committing root.bolt'],
  [/^root\.bolt: fsync/, 'fsync root.bolt'],
  [/^root\.bolt: removed/, 'removing old snapshots'],
  [/^introducerNotifier <- watcher/, 'idle'],
  [/^waiting for a new root epoch/, 'idle: waiting for a new epoch'],
  [/^paused: /, 'paused: waiting for the merger'],
  [/^persists <- new files/, 'introducing new files'],
  [/^waiting for persist introduction/, 'waiting for the introducer'],
  [/^waiting for persister/, 'waiting for the persister'],
  [/^persisterNotifier <- watcher/, 'notifying the persister'],
  [/^MergeUsing: merging (\d+) files/, 'merging $1 files'],
  [/^MergeUsing: (\d+) mem segs/, 'merging $1 segments'],
  [/^merges <- /, 'handing result over'],
  [/^waiting for merge introduction/, 'waiting for the introducer'],
  [/^analyzing/, 'analyzing'],
];
export function shortLabel(label) {
  for (const [re, out] of SHORT) {
    const mm = label.match(re);
    if (mm) return out.replace(/\$(\d)/g, (_, n) => mm[Number(n)]);
  }
  return label;
}
