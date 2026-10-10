// Minimal SVG sparkline: area + line, optional dashed reference line
// (e.g. a quota), drawn in a 100x40 viewBox scaled to its container.

export function sparkline(ts, vals, { ref = null, t0, t1 } = {}) {
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
