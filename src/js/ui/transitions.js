// What's shown partway between step i-1 and step i, as pure functions
// of the scroll progress p (0..1) through step i's transition. The page
// records, for each visited step, where the batch marker and the
// goroutine boxes were; these interpolate between those records.

import { STATIONS, CORRIDORS as C } from './layout.js';
import { along, clamp01, ease, lerp } from './util/anim.js';

// ---- the batch marker's route ----

// Legs between stations, along the corridors. Each takes the start and
// end points and returns a polyline.
const LEGS = {
  'dcp>worker': (a, b) => [a, b],
  'dcp>channel': (a, b) => [a, [a[0], b[1]], b],
  'channel>worker': (a, b) => [a, [b[0], a[1]], b],
  'channel>herder': (a, b) => [a, [C.spineLeft, a[1]], [C.spineLeft, b[1]], b],
  'worker>herder': (a, b) => [a, [a[0], b[1]], b],
  'herder>analysis': (a, b) => [a, [a[0], C.intoBleve], [b[0], C.intoBleve], b],
  'worker>analysis': (a, b) => [a, [a[0], C.intoBleve], b],
  'analysis>introducing': (a, b) => [a, [a[0], C.aboveIntroducer], [b[0], C.aboveIntroducer], b],
  'introducing>cell': (a, b) => [a, [a[0], C.aboveRoot], [b[0], C.aboveRoot], b],
  'cell>persisting': (a, b) => [a, [b[0], a[1]], b],
  'persisting>bar': (a, b) => [a, [a[0], C.belowRoot], [b[0], C.belowRoot], b],
  'bar>merging': (a, b) => [a, [a[0], C.belowRoot], [b[0], C.belowRoot], b],
  'merging>bar': (a, b) => [a, [a[0], C.belowRoot], [b[0], C.belowRoot], b],
  'bar>icon': (a, b) => [a, [a[0], C.belowRoot], [C.betweenPanels, C.belowRoot], [C.betweenPanels, C.aboveDisk], [b[0], C.aboveDisk], b],
};

// Trips that pass through a station on the way.
const VIA = {
  'cell>bar': 'persisting', // a segment becomes a file via the persister
  'bar>bar': 'merging', // a file becomes a bigger file via the merger
  'cell>icon': 'bar',
};

function leg(a, b) {
  const k = `${a.st}>${b.st}`;
  if (LEGS[k]) return LEGS[k](a.p, b.p);
  const back = `${b.st}>${a.st}`;
  if (LEGS[back]) return LEGS[back](b.p, a.p).reverse();
  return null;
}

// The marker's path from place a to place b ({st, p, key}).
export function route(a, b) {
  if (a.st === b.st && a.key === b.key) return [a.p, b.p];
  const direct = leg(a, b);
  if (direct) return direct;
  const via = VIA[`${a.st}>${b.st}`] || VIA[`${b.st}>${a.st}`];
  if (via) {
    const mid = { st: via, p: STATIONS[via] || [a.p[0] + 20, C.fileBarY] };
    const x = leg(a, mid), y = leg(mid, b);
    if (x && y) return [...x, ...y.slice(1)];
  }
  // Fallback: vertical first, unless heading into a side gap.
  const [ax, ay] = a.p, [bx, by] = b.p;
  if (Math.abs(ax - bx) < 2 || Math.abs(ay - by) < 2) return [a.p, b.p];
  const outside = (x) => x < 80 || x > 920;
  return outside(bx) ? [a.p, [bx, ay], b.p] : [a.p, [ax, by], b.p];
}

// The marker at step i, progress p. `tokenAt` maps step index to the
// marker's place there (null if there was none; absent if unvisited).
// Returns {t, o} (place, opacity) plus, while travelling, `dest` and
// `arrived`; or `birth` (0..1) when a batch is born at the DCP goroutine.
export function markerFrame(views, tokenAt, i, p) {
  const cur = views[i].token === 'hide' ? null : tokenAt.get(i) || null;
  const prev = i > 0 && views[i - 1].token !== 'hide' ? tokenAt.get(i - 1) || null : null;
  const e = ease(p);
  if (cur && prev) {
    const moving = prev.st !== cur.st || prev.key !== cur.key;
    const shown = e > 0.5 ? cur : prev;
    return {
      t: { p: along(route(prev, cur), e), size: lerp(prev.size, cur.size, e), kind: shown.kind, label: shown.label },
      o: 1, dest: moving ? cur : null, arrived: e >= 0.97,
    };
  }
  // A batch is born at the DCP goroutine: docs flow in from KV and
  // condense into the marker.
  if (cur && cur.st === 'dcp' && i > 0 && tokenAt.has(i - 1)) {
    return { t: cur, o: clamp01((e - 0.72) / 0.25), birth: e };
  }
  if (cur) return { t: cur, o: i > 0 && !tokenAt.has(i - 1) ? 1 : e };
  if (prev) return { t: prev, o: 1 - e };
  return null;
}

// ---- goroutine boxes ----

// The boxes at step i, progress p, as {a, b, q} per box: boxes whose
// state differs from the previous step's change one at a time, in
// `order` (the order data meets them), each within its own slice of the
// transition; scrolling back undoes them in reverse.
export function boxFrames(stateAt, order, i, p, fallback) {
  const cur = stateAt.get(i) || fallback;
  const prev = i > 0 ? stateAt.get(i - 1) : null;
  const out = {};
  for (const k of order) if (cur[k]) out[k] = { a: cur[k], b: cur[k], q: 1 };
  if (!prev || p >= 1) return out;
  const changed = order.filter((k) => prev[k] && cur[k] &&
    (prev[k].state !== cur[k].state || prev[k].label !== cur[k].label));
  const t = ease(p);
  const w = Math.min(0.3, 0.7 / Math.max(1, changed.length));
  changed.forEach((k, n) => {
    const center = 0.15 + 0.7 * (n + 0.5) / changed.length;
    out[k] = { a: prev[k], b: cur[k], q: clamp01((t - (center - w / 2)) / w) };
  });
  return out;
}

// A value that's on (1) or off (0) at each step, at progress p.
export const toggleAt = (wasOn, isOn, p) => lerp(wasOn ? 1 : 0, isOn ? 1 : 0, ease(p));
