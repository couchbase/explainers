// The page's DOM: the story column (title card, chapter headings, step
// cards with code chips), the stage (toolbar and diagram viewport), the
// charts column, and the overlay for callout lines.

import { h, svgEl } from './util/dom.js';

const shortCommit = (c) => (c || '').slice(0, 12);
const repoLink = (s) => `<a href="${s.github}/tree/${s.commit}" target="_blank" rel="noopener">${shortCommit(s.commit)}</a>`;

export function buildPage(app, data, codeDrawer) {
  const { narrative, snippets, sources } = data;
  const layout = h('div', { class: 'layout' });
  const story = h('main', { class: 'story' });
  const stage = h('section', { class: 'stage', 'aria-label': 'Diagram' });
  const chartsCol = h('aside', { class: 'charts', 'aria-label': 'Charts' });
  const overlay = svgEl('svg', { class: 'overlay', 'aria-hidden': 'true' });
  layout.append(story, stage, chartsCol);
  app.append(layout, overlay);

  // ---- story ----
  story.append(h('header', { class: 'hero card' },
    h('div', { class: 'eyebrow', text: 'cbft / bleve / scorch' }),
    h('h1', { text: narrative.title }),
    h('div', { class: 'subtitle', html: narrative.subtitleHtml }),
    h('div', { class: 'meta', html:
      `Modeled on bleve ${repoLink(sources.bleve)}, zapx ${repoLink(sources.zapx)} and cbft ${repoLink(sources.cbft)} · built ${data.builtAt}` }),
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

  // ---- stage: toolbar + diagram viewport ----
  const btn = (text, title) => h('button', { class: 'btn', type: 'button', text, ...(title ? { title } : {}) });
  const ui = {
    crumbDot: h('span', { class: 'crumb-dot' }),
    crumbText: h('span', { class: 'crumb-text' }),
    clock: h('span', { class: 'clock' }),
    playBtn: btn('Play', 'Pause or resume the simulation (space)'),
    speedSel: h('select', { class: 'btn', id: 'speed', 'aria-label': 'Simulation speed' },
      ...[['auto', 'speed: auto'], ['0.1', '0.1×'], ['0.25', '0.25×'], ['0.5', '0.5×'], ['1', '1×'], ['2', '2×'], ['4', '4×']]
        .map(([value, text]) => h('option', { value, text }))),
    replayBtn: btn('Replay', 'Rebuild this step’s simulation from scratch'),
    knobsBtn: btn('Knobs'),
    codeBtn: btn('Code'),
    zoomHint: h('span', { class: 'zoom-hint', text: 'drag to pan · ⌘/⌥ + scroll or pinch to zoom · double-click to zoom in' }),
  };
  ui.crumb = h('span', { class: 'crumb', title: 'Where you are in the diagram' }, ui.crumbDot, ui.crumbText);
  ui.controls = h('span', { class: 'controls' }, ui.clock, ui.playBtn, ui.speedSel, ui.replayBtn, ui.knobsBtn);
  // The hint and the controls share one slot and cross-fade.
  const toolbar = h('div', { class: 'toolbar' }, ui.crumb, h('span', { class: 'spacer' }), h('span', { class: 'tools' }, ui.zoomHint, ui.controls), ui.codeBtn);

  const svg = svgEl('svg', { class: 'diagram', preserveAspectRatio: 'xMidYMid meet', role: 'img',
    'aria-label': 'Diagram of cbft and scorch goroutines, segments and files' });
  const zbtn = (text, label) => h('button', { class: 'zbtn', type: 'button', text, 'aria-label': label, title: label });
  ui.zoomIn = zbtn('+', 'Zoom in');
  ui.zoomOut = zbtn('−', 'Zoom out');
  ui.recenter = zbtn('⟲', 'Recenter on the story');
  const viewport = h('div', { class: 'viewport' }, svg, h('div', { class: 'zoom' }, ui.zoomIn, ui.zoomOut, ui.recenter));
  stage.append(toolbar, viewport);

  return { layout, story, stepEls, stage, toolbar, viewport, svg, chartsCol, overlay, ui };
}
