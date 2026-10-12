// The table of contents: a small sticky button in the top-left corner
// that pops out a list of chapters. Picking one jumps straight there.

import { h } from './util/dom.js';

export class Toc {
  // chapters: [{id, title, color, href}]; onJump(chapterIndex).
  constructor(parent, chapters, onJump) {
    this.btn = h('button', { class: 'toc-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'toc-panel', title: 'Contents' },
      h('span', { class: 'toc-icon', 'aria-hidden': 'true', text: '☰' }), h('span', { class: 'toc-label', text: 'Contents' }));
    this.items = chapters.map((ch, i) => {
      const a = h('a', { class: `toc-item sec-${ch.color || 'neutral'}`, href: ch.href },
        h('span', { class: 'chapter-dot' }), h('span', { text: ch.title }));
      a.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab etc.
        e.preventDefault();
        this.close();
        onJump(i);
      });
      return a;
    });
    this.panel = h('nav', { class: 'toc-panel card', id: 'toc-panel', 'aria-label': 'Contents', hidden: '' },
      h('div', { class: 'toc-head', text: 'Contents' }), ...this.items);
    this.el = h('div', { class: 'toc' }, this.btn, this.panel);
    parent.append(this.el);

    this.btn.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    document.addEventListener('pointerdown', (e) => { if (this.isOpen && !this.el.contains(e.target)) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) { this.close(); this.btn.focus(); }
    });
  }

  get isOpen() { return !this.panel.hidden; }
  open() {
    this.panel.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    (this.items.find((a) => a.classList.contains('current')) || this.items[0])?.focus();
  }
  close() {
    this.panel.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
  }

  // Marks the chapter the reader is in.
  setCurrent(i) {
    this.items.forEach((a, j) => {
      a.classList.toggle('current', j === i);
      if (j === i) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
  }
}
