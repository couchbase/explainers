// The page's DOM: the story column (title card, chapter headings, step
// cards with code chips), the stage (toolbar and diagram viewport), the
// charts column, and the overlay for callout lines. With `simulation`,
// the toolbar also gets the simulation's controls (clock, play, speed,
// replay, knobs); the charts column is the explainer's to fill, and
// stays empty and zero-width otherwise.

import { h, svgEl } from './util/dom.js';

const shortCommit = (c) => (c || '').slice(0, 12);
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const repoLink = (s) => `<a href="${s.github}/tree/${s.commit}" target="_blank" rel="noopener">${shortCommit(s.commit)}</a>`;

// Whether this page's sibling pages (the topic's index, the next
// explainer) are beside it. Served, they are. Opened from disk, they are
// only if the page is still in its topic's directory, as in a build: a
// copy that was emailed or Slacked around lands on its own.
export function hasSiblings(loc, id) {
  if (loc.protocol !== 'file:') return true;
  const path = decodeURIComponent(loc.pathname);
  return path.endsWith(`/${id}.html`) || path.endsWith(`/${id}-drafts.html`);
}

export function buildPage(app, data, codeDrawer, { simulation = false } = {}) {
  const { narrative, snippets, sources } = data;
  // links to sibling pages, only where they'd lead somewhere
  const links = hasSiblings(window.location, narrative.id);
  const next = links && data.next;
  const layout = h('div', { class: 'layout' });
  const story = h('main', { class: 'story' });
  const stage = h('section', { class: 'stage', 'aria-label': 'Diagram' });
  const chartsCol = h('aside', { class: 'charts', 'aria-label': 'Charts' });
  const overlay = svgEl('svg', { class: 'overlay', 'aria-hidden': 'true' });
  layout.append(story, stage, chartsCol);
  app.append(layout, overlay);

  // ---- story ----
  story.append(h('header', { class: 'hero card' },
    links
      ? h('a', { class: 'eyebrow', href: data.topic.href, title: `All the explainers in “${data.topic.title}”`, text: data.topic.label })
      : h('div', { class: 'eyebrow', text: data.topic.label }),
    h('h1', { text: narrative.title }),
    h('div', { class: 'subtitle', html: narrative.subtitleHtml }),
    h('div', { class: 'meta', html:
      `Modeled on ${andList(Object.entries(sources).map(([k, s]) => `${k} ${repoLink(s)}`))} · built ${data.builtAt}${data.version ? ` · version ${data.version}` : ''}` }),
    h('p', { class: 'scroll-hint', text: 'Scroll to begin ↓' })));

  const stepEls = [];
  for (const ch of narrative.chapters) {
    story.append(h('h2', { class: `chapter-title card sec-${ch.color || 'neutral'}`, id: ch.id },
      h('span', { class: 'chapter-dot' }), h('span', { text: ch.title })));
    for (const st of ch.steps) {
      const card = h('div', { class: 'card' }, h('div', { class: 'step-body', html: st.html }));
      if (st.code && st.code.length) {
        card.append(h('div', { class: 'code-chips' }, ...st.code.map((id) => {
          const sn = snippets[id];
          return h('button', { class: 'code-chip', type: 'button', title: sn.title, onclick: () => codeDrawer.open(st.code, id) },
            h('span', { class: 'repo', text: `${sn.repo}/${sn.path.split('/').pop()} · ` }), sn.title.split(' — ')[0]);
        })));
      }
      const el = h('section', { class: 'step', id: `${ch.id}--${st.id}`, 'data-index': String(stepEls.length) }, card);
      story.append(el);
      stepEls.push(el);
    }
  }

  // at the end, the explainer to read next, or (with none, as in a page
  // read on its own) a word of thanks; and the way back up to the
  // topic's other explainers
  const end = h('div', { class: 'card next-card' });
  if (next) end.append(
    h('div', { class: 'eyebrow', text: 'Next' }),
    h('a', { class: 'next-link', href: next.href, text: `${next.title} →` }));
  else end.append(
    h('div', { class: 'eyebrow', text: 'The end' }),
    h('div', { class: 'end-note', text: 'Thanks for reading!' }));
  if (links) end.append(
    h('a', { class: 'up-link', href: data.topic.href, text: `All the explainers in “${data.topic.title}” ↑` }));
  // and back to the top of this one (a jump: no replaying every step)
  const top = h('a', { class: 'top-link', href: '#', text: 'Back to the top ↑' });
  top.addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  end.append(top);
  story.append(end);

  // and, without them, a step's links to sibling pages are just text
  if (!links) {
    for (const a of story.querySelectorAll('a[href]')) {
      if (/^[^:/?#]+\.html(#.*)?$/.test(a.getAttribute('href'))) a.replaceWith(...a.childNodes);
    }
  }

  // ---- stage: toolbar + diagram viewport ----
  const btn = (text, title) => h('button', { class: 'btn', type: 'button', text, ...(title ? { title } : {}) });
  const ui = {
    crumbDot: h('span', { class: 'crumb-dot' }),
    crumbText: h('span', { class: 'crumb-text' }),
    codeBtn: btn('Code'),
    zoomHint: h('span', { class: 'zoom-hint', text: 'drag to pan · ⌘/⌥ + scroll or pinch to zoom · double-click to zoom in' }),
  };
  if (simulation) Object.assign(ui, {
    clock: h('span', { class: 'clock' }),
    playBtn: btn('Play', 'Pause or resume the simulation (space)'),
    speedSel: h('select', { class: 'btn', id: 'speed', 'aria-label': 'Simulation speed' },
      ...[['auto', 'speed: auto'], ['0.1', '0.1×'], ['0.25', '0.25×'], ['0.5', '0.5×'], ['1', '1×'], ['2', '2×'], ['4', '4×']]
        .map(([value, text]) => h('option', { value, text }))),
    replayBtn: btn('Replay', 'Rebuild this step’s simulation from scratch'),
    knobsBtn: btn('Knobs'),
  });
  ui.crumb = h('span', { class: 'crumb', title: 'Where you are in the diagram' }, ui.crumbDot, ui.crumbText);
  // The hint and the controls share one slot and cross-fade.
  const tools = h('span', { class: 'tools' }, ui.zoomHint);
  if (simulation) tools.append(ui.controls = h('span', { class: 'controls' }, ui.clock, ui.playBtn, ui.speedSel, ui.replayBtn, ui.knobsBtn));
  const toolbar = h('div', { class: 'toolbar' }, ui.crumb, h('span', { class: 'spacer' }), tools, ui.codeBtn);

  const svg = svgEl('svg', { class: 'diagram', preserveAspectRatio: 'xMidYMid meet', role: 'img',
    'aria-label': `Diagram: ${narrative.title}` });
  const zbtn = (text, label) => h('button', { class: 'zbtn', type: 'button', text, 'aria-label': label, title: label });
  ui.zoomIn = zbtn('+', 'Zoom in');
  ui.zoomOut = zbtn('−', 'Zoom out');
  ui.recenter = zbtn('⟲', 'Recenter on the story');
  const viewport = h('div', { class: 'viewport' }, svg, h('div', { class: 'zoom' }, ui.zoomIn, ui.zoomOut, ui.recenter));
  stage.append(toolbar, viewport);

  return { layout, story, stepEls, stage, toolbar, viewport, svg, chartsCol, overlay, ui };
}
