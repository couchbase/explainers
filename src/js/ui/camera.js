// The camera: which region of the diagram canvas is shown, and where.
//
// The story asks for a region per step (layout.js CAMERAS); the camera
// fits it into the "free area" (on wide screens, between the story
// column and the charts column, below the toolbar), then extends the
// viewBox to the whole viewport at the same scale, so the diagram also
// draws under the transparent columns. On top of that sits the reader's
// own pan/zoom, which eases back to the story's view on request.

import { CAMERAS, CANVAS } from '../domain.js';
import { lerpRect, ease } from './util/anim.js';

export class Camera {
  constructor({ viewport, svg, story, chartsCol, toolbar, reduceMotion }) {
    Object.assign(this, { viewport, svg, story, chartsCol, toolbar, reduceMotion });
    this.user = { dx: 0, dy: 0, z: 1 }; // the reader's pan (canvas units) and zoom
    this.relaxing = false;
    this.free = null; // the region shown in the free area
    this.view = null; // the whole viewBox
  }

  freeArea() {
    const r = this.viewport.getBoundingClientRect();
    if (window.innerWidth <= 900) return { left: r.left, top: r.top, width: r.width, height: r.height };
    const L = Math.min(r.width * 0.7, Math.max(0, this.story.getBoundingClientRect().right + 24 - r.left));
    const cw = this.chartsCol.getBoundingClientRect().width;
    const R = cw > 1 ? Math.min(r.width * 0.3, cw + 16) : 0;
    const T = Math.max(0, this.toolbar.getBoundingClientRect().bottom + 8 - r.top);
    return { left: r.left + L, top: r.top + T, width: Math.max(100, r.width - L - R), height: r.height - T };
  }

  // A named region (or [x0, y0, x1, y1]) fitted to the free area's
  // shape, not zoomed in too far, and kept on the canvas.
  fit(camera) {
    const [x0, y0, x1, y1] = typeof camera === 'string' ? CAMERAS[camera].rect : camera;
    const f = this.freeArea();
    const aspect = f.width / Math.max(1, f.height);
    let w = Math.max(x1 - x0, f.width < 600 ? 360 : 560), h = y1 - y0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    const [X0, Y0, X1, Y1] = CANVAS;
    const keep = (v, size, lo, hi) => (size >= hi - lo ? lo + (hi - lo - size) / 2 : Math.min(Math.max(v, lo), hi - size));
    return { x: keep(cx - w / 2, w, X0, X1), y: keep(cy - h / 2, h, Y0, Y1), w, h };
  }

  // Partway (p) from one step's region to the next.
  between(from, to, p) {
    const b = this.fit(to);
    return p >= 1 || !from ? b : lerpRect(this.fit(from), b, ease(p));
  }

  // Shifts region c just enough to keep point pt inside, with a margin.
  follow(c, pt) {
    if (!pt) return c;
    const [x, y] = pt;
    const mx = Math.min(80, c.w * 0.12), my = Math.min(70, c.h * 0.1);
    let dx = 0, dy = 0;
    if (x < c.x + mx) dx = x - (c.x + mx);
    else if (x > c.x + c.w - mx) dx = x - (c.x + c.w - mx);
    if (y < c.y + my) dy = y - (c.y + my);
    else if (y > c.y + c.h - my) dy = y - (c.y + c.h - my);
    return { ...c, x: c.x + dx, y: c.y + dy };
  }

  // Shows region c (plus the reader's pan/zoom) in the free area.
  show(c) {
    const u = this.user;
    const w = c.w / u.z, h = c.h / u.z;
    const free = { x: c.x + (c.w - w) / 2 + u.dx, y: c.y + (c.h - h) / 2 + u.dy, w, h };
    this.free = free;
    const r = this.viewport.getBoundingClientRect(), f = this.freeArea();
    const s = f.width / free.w;
    const v = { x: free.x - (f.left - r.left) / s, y: free.y - (f.top - r.top) / s, w: r.width / s, h: r.height / s };
    this.view = v;
    this.svg.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
  }

  // Canvas point -> screen (client) point.
  toScreen([x, y]) {
    const r = this.viewport.getBoundingClientRect(), v = this.view;
    const s = Math.min(r.width / v.w, r.height / v.h);
    return [r.left + (r.width - v.w * s) / 2 + (x - v.x) * s, r.top + (r.height - v.h * s) / 2 + (y - v.y) * s];
  }

  inViewport([sx, sy]) {
    const r = this.viewport.getBoundingClientRect();
    return sx >= r.left - 1 && sx <= r.right + 1 && sy >= r.top - 1 && sy <= r.bottom + 1;
  }

  // ---- the reader's pan and zoom ----

  // Zooms by `factor`, keeping the canvas point under (sx, sy) still.
  zoomAt(factor, sx, sy) {
    const u = this.user, f = this.freeArea(), c = this.free;
    const s = f.width / c.w;
    const px = sx ?? f.left + f.width / 2, py = sy ?? f.top + f.height / 2;
    const cx = c.x + (px - f.left) / s, cy = c.y + (py - f.top) / s;
    const fx = (cx - c.x) / c.w, fy = (cy - c.y) / c.h;
    const bw = c.w * u.z, bh = c.h * u.z; // the story camera's size
    const bx = c.x - (bw - c.w) / 2 - u.dx, by = c.y - (bh - c.h) / 2 - u.dy;
    const z = Math.max(0.5, Math.min(8, u.z * factor));
    const w = bw / z, h = bh / z;
    u.dx = cx - fx * w - bx - (bw - w) / 2;
    u.dy = cy - fy * h - by - (bh - h) / 2;
    u.z = z;
    this.relaxing = false;
  }

  panBy(dxPx, dyPx) {
    const s = this.freeArea().width / this.free.w;
    this.user.dx -= dxPx / s;
    this.user.dy -= dyPx / s;
    this.relaxing = false;
  }

  // Ease the reader's pan/zoom back to the story's view (call per frame).
  recenter() { this.relaxing = true; }
  tick() {
    if (!this.relaxing) return;
    const u = this.user, k = this.reduceMotion ? 0 : 0.85;
    u.dx *= k; u.dy *= k; u.z = 1 + (u.z - 1) * k;
    if (Math.abs(u.dx) < 0.5 && Math.abs(u.dy) < 0.5 && Math.abs(u.z - 1) < 0.002) {
      this.user = { dx: 0, dy: 0, z: 1 };
      this.relaxing = false;
    }
  }
}
