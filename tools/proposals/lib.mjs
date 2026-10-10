// Shared SVG helpers and styles for the design sketches.

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const f = (n) => +n.toFixed(1);
export const rect = (x, y, w, h, cls = '', rx = 4, extra = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}" class="${cls}" ${extra}/>`;
export const text = (x, y, s, cls = '', anchor = 'start') => `<text x="${f(x)}" y="${f(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
export const line = (x1, y1, x2, y2, cls = 'wire') => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" class="${cls}"/>`;
export const path = (d, cls = 'wire', extra = '') => `<path d="${d}" class="${cls}" ${extra}/>`;
export const circle = (x, y, r, cls) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" class="${cls}"/>`;

export function node(x, y, w, h, title, sub, state = 'wait', extra = '') {
  return `<g class="node s-${state} ${extra}">${rect(x, y, w, h, 'box', 5)}` +
    circle(x + 14, y + 17, 4.5, 'dot') +
    text(x + 26, y + 21, title, 'n-title') +
    (sub ? text(x + 14, y + h - 12, sub, 'n-sub') : '') + '</g>';
}

// A stack of identical panels seen slightly from the front: the first
// is fully drawn, the rest peek out behind it, fading with depth.
export function stack(x, y, w, h, n, title, sub, state, { dx = 9, dy = -9, badge } = {}) {
  let s = '';
  for (let i = n - 1; i >= 1; i--) {
    s += `<g class="node s-wait behind" style="opacity:${f(0.7 - i * 0.17)}">${rect(x + dx * i, y + dy * i, w, h, 'box', 5)}</g>`;
  }
  s += node(x, y, w, h, title, sub, state);
  if (badge) s += `<g>${rect(x + w - 34 + dx * (n - 1), y + dy * (n - 1) - 9, 40, 18, 'badge', 9)}${text(x + w - 14 + dx * (n - 1), y + dy * (n - 1) + 4, badge, 'badge-text', 'middle')}</g>`;
  return s;
}

// Rounded orthogonal polyline through points, e.g. for flows.
export function rounded(pts, r = 18) {
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = x1 - ((x1 - x0) / l1) * rr, ay = y1 - ((y1 - y0) / l1) * rr;
    const bx = x1 + ((x2 - x1) / l2) * rr, by = y1 + ((y2 - y1) / l2) * rr;
    d += ` L${f(ax)},${f(ay)} Q${f(x1)},${f(y1)} ${f(bx)},${f(by)}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${f(last[0])},${f(last[1])}`;
}

export function memCells(x, y, cols, rows, n, { ours = -1 } = {}) {
  let s = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    s += rect(x + c * 14, y + r * 14, 10, 10, i < n ? 'mem' : 'slot-empty', 2);
  }
  if (ours >= 0) s += rect(x + (ours % cols) * 14 - 2.5, y + Math.floor(ours / cols) * 14 - 2.5, 15, 15, 'ours-ring', 3);
  return s;
}

export function fileSlots(x, y, slots, w, h, sizes, dels) {
  let s = '';
  const max = Math.log(Math.max(...sizes) + 1);
  for (let i = 0; i < slots; i++) {
    const sx = x + i * (w + 4);
    if (i >= sizes.length) { s += rect(sx, y, w, h, 'slot-empty', 2); continue; }
    const bh = Math.max(6, (Math.log(sizes[i] + 1) / max) * h);
    s += rect(sx, y + h - bh, w, bh, 'file', 2);
    if (dels[i] > 0) s += rect(sx, y + h - bh, w, bh * dels[i], 'deleted', 2);
  }
  return s;
}

export function diskGrid(x, y, cols, rows, kinds) {
  let s = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = kinds[r * cols + c] || 'slot-empty';
    s += rect(x + c * 15, y + r * 15, 11, 11, k === 'new' ? 'file-new' : k, 2);
  }
  return s;
}

export const DEFS = `<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker>
  <marker id="arrow-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead-up"/></marker>
  <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="4" class="hatch"/></pattern>
</defs>`;

export const TOKENS = `
:root {
  --bg: #f3f5f7; --panel: #ffffff; --ink: #18222c; --muted: #5d6b78; --line: #cfd8df; --faint: #e6ebef;
  --accent: #c2410c; --flow: #7b8a97; --up: #6e5bd0;
  --busy: #1f8f58; --nap: #6e5bd0; --wait: #8b97a3; --stall: #cf4a26;
  --mem: #e8862a; --file: #2d6cc9; --garbage: #b3bdc6; --zombie: #d23a4e;
  --font-body: "IBM Plex Sans", system-ui, sans-serif; --font-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  --font-display: "IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0f1418; --panel: #161d23; --ink: #e2e8ed; --muted: #93a2ae; --line: #33404b; --faint: #222c35;
  --accent: #fb7a3c; --flow: #7f8f9c; --up: #9a8cf0; --busy: #3cc283; --nap: #9a8cf0; --wait: #6f7d89; --stall: #ff7a52;
  --mem: #f59e4a; --file: #5b93e8; --garbage: #4f5d69; --zombie: #ff5d72; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0f1418; --panel: #161d23; --ink: #e2e8ed; --muted: #93a2ae; --line: #33404b; --faint: #222c35;
  --accent: #fb7a3c; --flow: #7f8f9c; --up: #9a8cf0; --busy: #3cc283; --nap: #9a8cf0; --wait: #6f7d89; --stall: #ff7a52;
  --mem: #f59e4a; --file: #5b93e8; --garbage: #4f5d69; --zombie: #ff5d72; color-scheme: dark; }
`;

export const SVG_STYLE = `
svg.canvas-svg { display: block; font-family: var(--font-body); }
.canvas { fill: var(--bg); }
.box { fill: var(--panel); stroke: var(--line); stroke-width: 1; }
.node.s-busy .box { stroke: var(--busy); }
.node.s-sleep .box { stroke: var(--nap); }
.node.s-wait .box { stroke: var(--wait); stroke-dasharray: 4 3; }
.node.behind .box { stroke-dasharray: none; stroke: var(--line); }
.dot { fill: var(--wait); }
.s-busy .dot { fill: var(--busy); }
.s-sleep .dot { fill: var(--nap); }
.s-wait .dot { fill: none; stroke: var(--wait); stroke-width: 1.5; }
.node.focus .box { stroke: var(--accent); stroke-width: 2; stroke-dasharray: none; }
.n-title { font: 600 13px var(--font-mono); fill: var(--ink); }
.n-sub { font: 400 11px var(--font-mono); fill: var(--muted); }
.badge { fill: var(--ink); }
.badge-text { font: 600 10.5px var(--font-mono); fill: var(--panel); }
.flow { stroke: var(--flow); stroke-width: 1.4; fill: none; }
.flow-up { stroke: var(--up); stroke-width: 1.4; fill: none; stroke-dasharray: 5 3; }
.arrowhead { fill: var(--flow); }
.arrowhead-up { fill: var(--up); }
.ribbon-mem { fill: none; stroke: var(--mem); stroke-opacity: 0.32; stroke-linejoin: round; }
.ribbon-file { fill: none; stroke: var(--file); stroke-opacity: 0.28; stroke-linejoin: round; }
.ribbon-bytes { fill: none; stroke: var(--muted); stroke-opacity: 0.22; stroke-linejoin: round; }
.ribbon-label { font: 500 10.5px var(--font-mono); fill: var(--ink); paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
.zone { fill: var(--panel); stroke: var(--line); stroke-width: 1; }
.zone.strong { stroke: var(--ink); stroke-opacity: 0.35; }
.z-title { font: 600 11.5px var(--font-display); letter-spacing: 0.06em; text-transform: uppercase; fill: var(--muted); }
.z-small { font: 400 11px var(--font-mono); fill: var(--muted); paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
.z-in { font: 400 11px var(--font-mono); fill: var(--muted); }
.z-boundary { font: 600 10.5px var(--font-display); letter-spacing: 0.14em; fill: var(--muted); }
.boundary { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 6 4; }
.gate { stroke: var(--stall); stroke-width: 1.6; stroke-dasharray: 10 3 2 3; }
.gauge { fill: var(--faint); stroke: var(--line); }
.gauge-fill { fill: var(--file); }
.slot { fill: var(--panel); stroke: var(--line); }
.slot-full { fill: var(--accent); }
.slot-empty { fill: none; stroke: var(--faint); }
.cpu-busy { fill: var(--busy); }
.mem { fill: var(--mem); }
.file { fill: var(--file); }
.deleted { fill: var(--panel); fill-opacity: 0.55; }
.hatch { fill: var(--panel); opacity: 0.8; }
.garbage { fill: var(--garbage); }
.file-new { fill: none; stroke: var(--file); stroke-dasharray: 2 2; }
.zombie { fill: var(--zombie); }
.ours-ring { fill: none; stroke: var(--accent); stroke-width: 2; }
.query { fill: var(--panel); stroke: var(--busy); }
.pin { stroke: var(--busy); stroke-dasharray: 2 2; fill: none; }
.bolt { fill: var(--panel); stroke: var(--line); }
.bolt.latest { stroke: var(--file); }
.bolt.protected { stroke-width: 2.5; stroke: var(--muted); }
.b-label { font: 400 11px var(--font-mono); fill: var(--ink); }
.journey { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 1 5; stroke-linecap: round; }
.callout { fill: none; stroke: var(--accent); stroke-width: 1.5; }
.callout-end { fill: var(--accent); }
`;
