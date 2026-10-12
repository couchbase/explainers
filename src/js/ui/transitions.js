// What's shown partway between step i-1 and step i, as pure functions
// of the scroll progress p (0..1) through step i's transition. The page
// records, for each visited step, where the batch marker and the
// goroutine boxes were; these interpolate between those records.

import { STATIONS, BOXES, CORRIDOR_XS, CORRIDOR_YS, BOX_GAP } from './layout.js';
import { along, clamp01, ease, lerp } from './util/anim.js';
import { swapShift, swapTravel, swapPart, ADD_TRAVEL } from './snapstack.js';

// ---- the batch marker's route ----
//
// The rule: inside a box, the marker moves vertically until it's out
// (down if its destination is lower, up if higher); between boxes it
// travels the gaps, turning only where it won't cut through a box; and
// it enters its destination's box vertically.

const boxes = Object.values(BOXES);
const inside = (b, [x, y]) => x > b[0] && x < b[0] + b[2] && y > b[1] && y < b[1] + b[3];
const boxOf = (pt) => {
  // the smallest box containing pt
  let best = null;
  for (const b of boxes) if (inside(b, pt) && (!best || b[2] * b[3] < best[2] * best[3])) best = b;
  return best;
};

// Does the axis-aligned segment p-q pass through any box (other than
// those in `except`)?
function blocked(p, q, except) {
  const [x0, x1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])];
  const [y0, y1] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
  return boxes.some((b) => !except.includes(b) &&
    x1 > b[0] && x0 < b[0] + b[2] && y1 > b[1] && y0 < b[1] + b[3]);
}
const clear = (pts, except) => pts.every((p, k) => k === 0 || !blocked(pts[k - 1], p, except));

// From a to b, both outside boxes: the clear path with the fewest
// turns (and then the shortest), trying a straight line, one corner
// either way round, then detours along the corridors.
function gapPath(a, b) {
  const cands = [[a, b], [a, [a[0], b[1]], b], [a, [b[0], a[1]], b]];
  const xs = [...CORRIDOR_XS, a[0], b[0]], ys = [...CORRIDOR_YS, a[1], b[1]];
  for (const x of xs) cands.push([a, [x, a[1]], [x, b[1]], b]);
  for (const y of ys) cands.push([a, [a[0], y], [b[0], y], b]);
  for (const x1 of xs) for (const y of ys) for (const x2 of xs) {
    cands.push([a, [x1, a[1]], [x1, y], [x2, y], [x2, b[1]], b]);
  }
  let best = null, bestTurns = Infinity, bestLen = Infinity;
  for (const raw of cands) {
    const pts = raw.filter((p, k) => k === 0 || p[0] !== raw[k - 1][0] || p[1] !== raw[k - 1][1]);
    if (!pts.every((p, k) => k === 0 || p[0] === pts[k - 1][0] || p[1] === pts[k - 1][1])) continue;
    if (!clear(pts, [])) continue;
    const turns = pts.length - 2;
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]);
    if (turns < bestTurns || (turns === bestTurns && len < bestLen)) { best = pts; bestTurns = turns; bestLen = len; }
  }
  return best || [a, [a[0], b[1]], b];
}

// The point just outside box `box`, straight above or below pt.
const edge = (box, pt, down) => [pt[0], down ? box[1] + box[3] + BOX_GAP : box[1] - BOX_GAP];

function leg(a, b) {
  const down = b[1] >= a[1];
  const boxA = boxOf(a), boxB = boxOf(b);
  if (boxA && boxA === boxB) return a[0] === b[0] || a[1] === b[1] ? [a, b] : [a, [a[0], b[1]], b];
  const out = boxA ? edge(boxA, a, down) : a; // leave a's box vertically
  const into = boxB ? edge(boxB, b, !down) : b; // enter b's box vertically
  const mid = gapPath(out, into);
  return [...(boxA ? [a] : []), ...mid, ...(boxB ? [b] : [])];
}

// Trips that pass through a station on the way.
const VIA = {
  // a segment becomes a file via the persister, then the introducer
  'cell>bar': ['persisting', 'written', 'fileIntroducing'],
  'merging>mergeIntroducing': ['mergeWritten'],
};

// The marker's path from place a to place b ({st, p, key}).
const viaOf = (a, b) => VIA[`${a.st}>${b.st}`] || (VIA[`${b.st}>${a.st}`] || []).slice().reverse();

// Whether the route from a to b includes a hop along a drawn arrow
// (which may enter a box from the side, as the arrow does).
export function usesArrowHop(a, b) {
  const names = [a.st, ...viaOf(a, b), b.st];
  return names.some((n, i) => i > 0 && (HOPS[`${names[i - 1]}>${n}`] || HOPS[`${n}>${names[i - 1]}`]));
}

export function route(a, b) {
  if (a.st === b.st && a.key === b.key) return [a.p, b.p];
  const via = viaOf(a, b);
  const names = [a.st, ...via, b.st];
  const pts = [a.p, ...via.map((v) => STATIONS[v]), b.p];
  let out = [a.p];
  for (let i = 1; i < pts.length; i++) out = [...out, ...hop(names[i - 1], pts[i - 1], names[i], pts[i]).slice(1)];
  return out;
}

// Hops that follow a drawn arrow instead of the general rule: our new
// file rides the persister's "introduce ↑" arrow to the introducer,
// straight on across to its 'merges' channel, then drops just below it.
const HOPS = {
  'written>fileIntroducing': () => [STATIONS.introducing, [STATIONS.fileIntroducing[0], STATIONS.introducing[1]]],
  // the merger's result, up its arrow on the right, into the introducer
  'mergeWritten>mergeIntroducing': () => [[668, 752], [STATIONS.mergeIntroducing[0], 752]],
};

function hop(sa, pa, sb, pb) {
  const fwd = HOPS[`${sa}>${sb}`];
  if (fwd) {
    const [first, ...rest] = fwd();
    return [...leg(pa, first), ...rest, pb];
  }
  if (HOPS[`${sb}>${sa}`]) return hop(sb, pb, sa, pa).reverse();
  return leg(pa, pb);
}

// The marker at step i, progress p. `tokenAt` maps step index to the
// marker's place there (null if there was none; absent if unvisited).
// Returns {t, o} (place, opacity) plus, while travelling, `dest` and
// `arrived`; or `birth` (0..1) when a batch is born at the DCP goroutine.
// `win` limits the marker's move to part of the transition (in eased
// progress), so it can wait its turn while something else changes.
// `linear`: p is already the marker's own progress (not eased).
export function markerFrame(views, tokenAt, i, p, win = [0, 1], linear = false) {
  const cur = views[i].token === 'hide' ? null : tokenAt.get(i) || null;
  const prev = i > 0 && views[i - 1].token !== 'hide' ? tokenAt.get(i - 1) || null : null;
  const e = clamp01(((linear ? p : ease(p)) - win[0]) / (win[1] - win[0]));
  if (cur && prev) return between(prev, cur, e);
  // A batch is born at the DCP goroutine: docs flow in from KV and
  // condense into the marker.
  if (cur && cur.st === 'dcp' && i > 0 && tokenAt.has(i - 1)) {
    return { t: cur, o: clamp01((e - 0.72) / 0.25), birth: e };
  }
  const withSnap = (t) => ({ ...t, snapO: t.snap ? 1 : 0, sideMix: t.side === 'right' ? 1 : 0, belowMix: t.side === 'below' ? 1 : 0, barMix: t.st === 'bar' ? 1 : 0, h: hOf(t) });
  if (cur) return { t: withSnap(cur), o: i > 0 && !tokenAt.has(i - 1) ? 1 : e };
  if (prev) return { t: withSnap(prev), o: 1 - e };
  return null;
}

// A marker's height: a square, or on a bar, the bar's height (so it
// grows into its bar as it travels there).
const hOf = (t) => (t.st === 'bar' && t.barH ? t.barH : t.size);

// How far the marker has become its bar's outline: it does so as it
// lands on a bar, and stops as it leaves one.
function barMix(prev, cur, e) {
  const a = prev.st === 'bar', b = cur.st === 'bar';
  if (a === b) return a ? 1 : 0;
  return b ? clamp01((e - 0.9) / 0.1) : clamp01(1 - e / 0.1);
}

// The marker partway (e) from place prev to place cur.
function between(prev, cur, e) {
  const moving = prev.st !== cur.st || prev.key !== cur.key;
  const shown = e > 0.5 ? cur : prev;
  return {
    t: { p: along(route(prev, cur), e), size: lerp(prev.size, cur.size, e), kind: shown.kind, label: shown.label, sub: (cur.snap ? cur : prev).sub,
      snapO: lerp(prev.snap ? 1 : 0, cur.snap ? 1 : 0, e),
      sideMix: lerp(prev.side === 'right' ? 1 : 0, cur.side === 'right' ? 1 : 0, e),
      belowMix: lerp(prev.side === 'below' ? 1 : 0, cur.side === 'below' ? 1 : 0, e),
      barMix: barMix(prev, cur, e), h: lerp(hOf(prev), hOf(cur), e), labelCls: shown.labelCls },
    o: 1, dest: moving ? cur : null, arrived: e >= 0.97,
  };
}

// The marker while the introducer swaps in a new root (see
// SWAP_PHASES), from its place at step `base` (before the swap) to its
// place at step i: it waits for the 'add' phase, travels then, and a
// place on the root moves with the new root as it lifts and settles.
// Null if the marker isn't shown at both ends.
export function swapMarker(views, tokenAt, i, base, s) {
  const cur = views[i].token === 'hide' ? null : tokenAt.get(i) || null;
  const prev = views[base].token === 'hide' ? null : tokenAt.get(base) || null;
  if (!cur || !prev) return null;
  const [dx, dy] = swapShift(s);
  const onRoot = (t) => t.st === 'cell' || t.st === 'bar';
  const dest = onRoot(cur) ? { ...cur, p: [cur.p[0] + dx, cur.p[1] + dy] } : cur;
  const from = onRoot(prev) ? { ...prev, p: [prev.p[0] + dx, prev.p[1] + dy] } : prev;
  // Already in the root (a merge): it moves over to the merged segment
  // as the ones it replaces drop out, with the other bars as they close
  // up the gaps. Its label steps aside while the new root is built, and
  // comes back only when the merged chip, whose label it takes over,
  // gives way to the new root's bar.
  const hop = onRoot(prev) && onRoot(cur) && prev.key !== cur.key;
  const e = hop ? clamp01((swapPart(s, 'drop') - 0.6) / 0.4) : swapTravel(s);
  const f = between(from, dest, e);
  // Landing on a bar that's new in this root: its square gives way only
  // as the bar appears.
  if (!onRoot(prev) && onRoot(cur)) f.t.barMix = clamp01((swapPart(s, 'add') - ADD_TRAVEL) / (1 - ADD_TRAVEL));
  if (hop) f.t.labelO = swapPart(s, 'solid') > 0 ? swapPart(s, 'solid') : 1 - swapPart(s, 'cover');
  return f;
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
