// A page's look: the engine's styles, then its topic's (and then, for
// an explainer, its own); and its fonts, from Google Fonts.
//
// A topic names its fonts in topic.yaml, as Google Fonts families
// (`fonts: ["Fraunces:opsz,wght@9..144,400;9..144,600", ...]`), and
// sets the engine's --font-body, --font-display and --font-mono to them
// in its style.css. With none, it's the engine's: IBM Plex.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from './explainers.mjs';

export const DEFAULT_FONTS = [
  'IBM Plex Mono:wght@400;500',
  'IBM Plex Sans:ital,wght@0,400;0,500;0,600;1,400',
  'IBM Plex Sans Condensed:wght@500;600',
];

// The <link>s that load `fonts`.
export function fontLinks(fonts = DEFAULT_FONTS) {
  if (!fonts.length) return '';
  const families = fonts.map((f) => `family=${encodeURI(f).replace(/%20/g, '+')}`).join('&');
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">`,
  ].join('\n');
}

// A stylesheet, with its `@import "<relative path>";` lines replaced by
// those files (so an explainer can share another's styles, as one page
// is self-contained).
export function readCss(file, seen = new Set()) {
  if (seen.has(file)) throw new Error(`${file}: @import cycle`);
  seen.add(file);
  return readFileSync(file, 'utf8').replace(/^@import\s+(?:url\()?["']([^"']+)["']\)?\s*;[^\n]*$/gm, (_, rel) => {
    if (/^[a-z]+:/i.test(rel)) throw new Error(`${file}: only local @imports, not ${rel}`);
    return readCss(join(dirname(file), rel), new Set(seen));
  });
}

// The engine's styles, then the topic's (topics/<topic>/style.css), if any.
export function topicCss(topic) {
  const own = join(ROOT, 'topics', topic, 'style.css');
  return readFileSync(join(ROOT, 'engine/css/style.css'), 'utf8') + (existsSync(own) ? '\n' + readFileSync(own, 'utf8') : '');
}
