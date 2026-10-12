// The charts column: small sparklines of the simulation's stats, each
// with a leader line to what it measures in the diagram.

import { h } from './util/dom.js';
import { fmtBytes } from '../sim/fmt.js';

// Minimal SVG sparkline: area + line, optional dashed reference line
// (e.g. a quota), drawn in a 100x40 viewBox scaled to its container.
function sparkline(ts, vals, { ref = null, t0, t1 } = {}) {
  const W = 100, H = 40;
  let max = Math.max(1, ...vals, ref || 0);
  max *= 1.08;
  const x = (t) => ((t - t0) / (t1 - t0)) * W;
  const y = (v) => H - (v / max) * H;
  let d = '';
  ts.forEach((t, i) => { d += `${i ? 'L' : 'M'}${x(t).toFixed(2)},${y(vals[i]).toFixed(2)}`; });
  const area = `${d}L${x(ts[ts.length - 1]).toFixed(2)},${H}L${x(ts[0]).toFixed(2)},${H}Z`;
  const refLine = ref ? `<line class="ref" x1="0" x2="${W}" y1="${y(ref).toFixed(2)}" y2="${y(ref).toFixed(2)}"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
    `<line class="grid" x1="0" x2="${W}" y1="${H}" y2="${H}"/>` +
    `<path class="area" d="${area}"/><path class="line" d="${d}"/>${refLine}</svg>`;
}

// ---- the charts column ----

// Each chart measures something in the diagram, at `anchor`.
const CHARTS = [
  { id: 'dcpBuf', title: 'DCP unacked', anchor: 'bufferR', key: 'dcpBuf', fmt: fmtBytes, ref: () => 20 * 1024 * 1024 },
  { id: 'memUsed', title: 'memory vs quota', anchor: 'memGaugeR', key: 'memUsed', fmt: fmtBytes, ref: (s) => s.indexQuota },
  { id: 'segments', title: 'segments in root', anchor: 'rootR', key: (s) => s.memSegs + s.fileSegs, sub: (s) => `${s.memSegs} mem · ${s.fileSegs} file` },
  { id: 'files', title: 'files on disk', anchor: 'diskR', key: 'filesOnDisk', fmt: (v) => `${v}` },
];

export class ChartsPanel {
  constructor(col) {
    this.col = col;
    this.charts = CHARTS.map((c) => {
      const val = h('b');
      const plot = h('div', { class: 'plot' });
      const el = h('div', { class: 'chart card' }, h('div', { class: 'chart-head' }, h('span', { text: c.title }), val), plot);
      col.append(el);
      return { ...c, el, val, plot };
    });
  }

  emphasize(id) { for (const c of this.charts) c.el.classList.toggle('emph', c.id === id); }

  // Plots the last minute of the model's samples.
  update(m) {
    const series = m.series.filter((p) => p.t >= m.now - 60000);
    if (!series.length) return;
    const last = series[series.length - 1];
    for (const c of this.charts) {
      const vals = series.map((p) => (typeof c.key === 'function' ? c.key(p) : p[c.key]));
      c.val.textContent = c.sub ? c.sub(last) : c.fmt(vals[vals.length - 1]);
      c.plot.innerHTML = sparkline(series.map((p) => p.t), vals, { ref: c.ref ? c.ref(last) : null, t0: m.now - 60000, t1: m.now });
    }
  }

  // Leader lines from each chart to what it measures, when that's in
  // view; charts whose subject isn't visible are dimmed.
  drawLeaders(overlay, diagram, camera, opacity) {
    const shown = opacity > 0.02 && getComputedStyle(this.col).display !== 'none';
    for (const c of this.charts) {
      const a = diagram.anchor(c.anchor);
      const sp = a && camera.toScreen(a.p);
      const show = shown && a && a.visible && camera.inViewport(sp);
      c.el.classList.toggle('dim', !show);
      if (!show) continue;
      const r = c.el.getBoundingClientRect();
      overlay.leader(r.left - 6, r.top + 36, sp, opacity);
    }
  }
}
