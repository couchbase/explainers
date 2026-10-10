// Small DOM helpers shared by the page, the diagram and the drawers.

export const SVG_NS = 'http://www.w3.org/2000/svg';

// HTML element: h('div', {class, text, html, onclick, ...attrs}, ...kids)
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

// SVG element, optionally appended to a parent.
export function svgEl(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

export function svgText(parent, x, y, s, cls, anchor) {
  const t = svgEl('text', { x, y, class: cls || '' }, parent);
  if (anchor) t.setAttribute('text-anchor', anchor);
  t.textContent = s;
  return t;
}

// Setters that skip no-op DOM writes (they run every frame).
export const setText = (e, s) => { if (e.textContent !== s) e.textContent = s; };
export const setCls = (e, cls) => { if (e.getAttribute('class') !== cls) e.setAttribute('class', cls); };

export const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
