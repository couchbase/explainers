// Interpolation and path helpers for scroll-driven animation.

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const lerp = (a, b, t) => a + (b - a) * t;

// Cubic ease-in-out, for camera moves and transitions.
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Gentler quadratic ease-in-out, for small things like labels and docs.
export const easeQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const lerpRect = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });

// The point at fraction t (0..1) of the way along a polyline.
export function along(pts, t) {
  const lens = [];
  let total = 0;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    lens.push(d);
    total += d;
  }
  if (total === 0) return pts[pts.length - 1];
  let want = t * total;
  for (let k = 0; k < lens.length; k++) {
    if (want <= lens[k] || k === lens.length - 1) {
      const f = lens[k] ? Math.min(1, want / lens[k]) : 1;
      return [lerp(pts[k][0], pts[k + 1][0], f), lerp(pts[k][1], pts[k + 1][1], f)];
    }
    want -= lens[k];
  }
  return pts[pts.length - 1];
}

// The callout/leader line shape: a horizontal run, a diagonal, then a
// horizontal run into (x1, y1). `run` is the length of the final run.
export function elbowPath(x0, y0, xTurn, x1, y1, run) {
  const dir = x1 >= xTurn ? 1 : -1;
  const f = (n) => n.toFixed(1);
  return `M${f(x0)},${f(y0)} H${f(xTurn)} L${f(x1 - dir * run)},${f(y1)} H${f(x1)}`;
}
