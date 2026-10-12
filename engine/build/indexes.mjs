// The index pages: dist/<topic>/index.html, listing a topic's
// explainers (each explainer page links up to it), and dist/index.html
// over all the topics. They use the engine's palette and fonts, so they
// read as part of the same set, in light and dark.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './explainers.mjs';

const esc = (t) => String(t).replace(/[<&"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '"': '&quot;' })[c]);

const css = () => readFileSync(join(ROOT, 'engine/css/style.css'), 'utf8') + `
.index { max-width: 44rem; margin: 0 auto; padding: 3rem 16px 6rem; }
.index h1 { font: 600 2.4rem/1.08 var(--font-display); margin: 0.5rem 0 1rem; text-wrap: balance; }
.index .subtitle { color: var(--muted); font-size: 1.15rem; line-height: 1.45; }
.index .subtitle p { margin: 0; }
.index h2 { font: 600 1.5rem/1.15 var(--font-display); margin: 3rem 0 0.5rem; }
.index h2 a { color: var(--ink); text-decoration: none; }
.index h2 a:hover { text-decoration: underline; }
.entries { list-style: none; margin: 2rem 0 0; padding: 0; display: grid; gap: 1rem; }
.entry { display: flex; gap: 1rem; align-items: baseline; }
.entry .num { font: 600 1.15rem var(--font-mono); color: var(--muted); }
.entry a.title { font: 600 1.25rem/1.2 var(--font-display); color: var(--ink); text-decoration: none; }
.entry a.title:hover { color: var(--accent); }
.entry p { margin: 0.4rem 0 0; color: var(--muted); }
@media (max-width: 900px) { .index h1 { font-size: 1.8rem; } }
`;

const page = (title, description, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans+Condensed:wght@500;600&display=swap">
<style>
${css()}
</style>
</head>
<body>
<main class="index">${body}</main>
</body>
</html>
`;

// `ws`: the explainers, as {name, title, subtitleHtml}; links are
// prefixed with `prefix` (the topic's directory, from the root index).
const entries = (ws, prefix) => `<ol class="entries">${ws.map((w) => `<li class="entry card">
<span class="num">${esc(w.name.match(/^\d+/)?.[0] || '·')}</span>
<div><a class="title" href="${prefix}${w.name}.html">${esc(w.title)}</a>${w.subtitleHtml}</div></li>`).join('')}</ol>`;

// `topic`: from loadTopic(), plus subtitleHtml.
export const topicIndex = (topic, ws) => page(topic.title, topic.subtitle || '',
  `<a class="eyebrow" href="../index.html">← All explainers</a>
<h1>${esc(topic.title)}</h1>
<div class="subtitle">${topic.subtitleHtml}</div>
${entries(ws, '')}`);

// `topics`: [{topic, ws}], as for topicIndex.
export const rootIndex = (topics) => page('Explainers', 'Scrollytelling explainers of how things work inside.',
  `<div class="eyebrow">Explainers</div>
<h1>How things work inside</h1>
${topics.map(({ topic, ws }) => `<h2><a href="${topic.topic}/index.html">${esc(topic.title)}</a></h2>
<div class="subtitle">${topic.subtitleHtml}</div>
${entries(ws, `${topic.topic}/`)}`).join('\n')}`);
