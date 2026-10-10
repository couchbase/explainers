// Slide-out drawer showing highlighted source for a step's code refs,
// with links to the exact lines on GitHub at the pinned commit.

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
};

export class CodeDrawer {
  constructor(parent, snippets) {
    this.snippets = snippets;
    this.ids = [];
    this.title = h('h2');
    this.tabs = h('div', { class: 'tabs', role: 'tablist' });
    this.where = h('div', { class: 'where' });
    this.pre = h('pre', { class: 'code' });
    this.body = h('div', { class: 'body' }, this.where, this.pre);
    this.el = h('div', { class: 'drawer', role: 'dialog', 'aria-label': 'Source code', 'aria-hidden': 'true' },
      h('header', {}, this.title, h('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => this.close() })),
      this.tabs, this.body);
    parent.append(this.el);
  }

  setDefault(ids) { this.defaultIds = ids; }

  open(ids, selected) {
    this.ids = ids || this.defaultIds || [];
    if (this.ids.length === 0) return;
    this.tabs.replaceChildren(...this.ids.map((id) => h('button', {
      class: 'btn', type: 'button', role: 'tab', 'data-id': id,
      text: this.snippets[id].title.split(' — ')[0],
      onclick: () => this.show(id),
    })));
    this.show(selected || this.ids[0]);
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    this.tabs.querySelector('[aria-selected="true"]')?.focus();
  }

  close() {
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
  }

  show(id) {
    const s = this.snippets[id];
    for (const t of this.tabs.children) t.setAttribute('aria-selected', String(t.dataset.id === id));
    this.title.textContent = s.title;
    const link = h('a', { href: s.url, target: '_blank', rel: 'noopener', text: 'View on GitHub ↗' });
    this.where.replaceChildren(h('span', { text: `${s.repo}/${s.path}:${s.start}–${s.end}` }), link);
    const hl = new Set(s.highlight);
    const frag = document.createDocumentFragment();
    s.lines.forEach((html, i) => {
      const n = s.start + i;
      const ln = document.createElement('div');
      ln.className = hl.has(n) ? 'ln hl' : 'ln';
      ln.innerHTML = `<span class="n">${n}</span><span>${html || ' '}</span>`;
      frag.append(ln);
    });
    this.pre.replaceChildren(frag);
    const first = this.pre.querySelector('.hl');
    this.body.scrollTop = 0;
    if (first) this.body.scrollTop = Math.max(0, first.offsetTop - 80);
  }
}
