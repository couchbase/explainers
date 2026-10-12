// Builds each narrative into one self-contained HTML file in dist/:
// CSS, JS, narrative data and highlighted code snippets are all
// inlined, so the file can be opened from disk, emailed or Slacked.
//
//   npm run build          # dist/<narrative-id>.html + dist/index.html
//   npm run dev            # rebuild on change

import { readFileSync, writeFileSync, mkdirSync, readdirSync, watch } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import go from 'highlight.js/lib/languages/go';
import * as esbuild from 'esbuild';
import { validateNarrative } from './schema.mjs';
import { shownChapters, isStop } from '../src/js/story/timeline.js';
import { CONFIG_DOCS, DEFAULT_CONFIG } from '../src/js/sim/config.js';

hljs.registerLanguage('go', go);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Splits highlight.js HTML into lines, closing and reopening spans
// that cross line boundaries so each line is well-formed on its own.
export function splitHighlightedLines(html) {
  const lines = [];
  let open = []; // stack of opening tags
  let cur = '';
  const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { open.push(m[1]); cur += m[1]; }
    else if (m[2]) { open.pop(); cur += m[2]; }
    else if (m[3]) {
      lines.push(cur + '</span>'.repeat(open.length));
      cur = open.join('');
    } else cur += m[4];
  }
  lines.push(cur + '</span>'.repeat(open.length));
  return lines;
}

function renderSnippet(s) {
  const html = hljs.highlight(s.code, { language: 'go' }).value;
  return { ...s, lines: splitHighlightedLines(html), code: undefined };
}

marked.use({ gfm: true, breaks: false });

function renderMarkdown(md) {
  // [[phrase]] marks the one phrase a step's callout line starts from.
  const html = marked.parse(md.replace(/\[\[(.+?)\]\]/g, '<span class="hl">$1</span>'));
  // External links open in a new tab.
  return html.replace(/<a href="(https?:[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"');
}

function loadNarratives(coderefs) {
  const dir = join(ROOT, 'content/narratives');
  const out = [];
  const errs = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.yaml')).sort()) {
    const n = yaml.load(readFileSync(join(dir, f), 'utf8'));
    errs.push(...validateNarrative(n, { coderefs, file: f }));
    out.push(n);
  }
  if (errs.length) throw new Error('narrative errors:\n  ' + errs.join('\n  '));
  return out;
}

function escapeJsonForScript(json) {
  return json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export async function build({ outDir = join(ROOT, 'dist') } = {}) {
  const coderefs = yaml.load(read('content/coderefs.yaml'));
  const snippets = JSON.parse(read('content/snippets.json'));
  const sources = yaml.load(read('content/sources.yaml'));
  const narratives = loadNarratives(coderefs);

  const bundle = await esbuild.build({
    entryPoints: [join(ROOT, 'src/js/ui/main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    write: false,
    legalComments: 'none',
  });
  const js = bundle.outputFiles[0].text;
  const css = read('src/css/style.css');
  const template = read('src/index.html');
  const builtAt = new Date().toISOString().slice(0, 10);
  // Which version this is, so readers can tell builds apart: `git
  // describe --long` of the sources, plus "-dirty" if built with
  // uncommitted changes. The build's own output (dist/) doesn't count,
  // so committing a built page doesn't change the stamp it carries.
  let version = '';
  try {
    const git = (args) => execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    version = git('describe --long --always');
    if (git("status --porcelain -- . ':!dist'")) version += '-dirty';
  } catch { /* not a git checkout */ }

  mkdirSync(outDir, { recursive: true });
  const written = [];
  // A narrative with a `stop` also gets a <id>-drafts.html with every
  // chapter, for reviewing the drafts (and for the browser tests).
  const variants = narratives.flatMap((n) => (shownChapters(n).length < n.chapters.length
    ? [{ n, chs: shownChapters(n), suffix: '' }, { n, chs: n.chapters.filter((ch) => !isStop(ch)), suffix: '-drafts' }]
    : [{ n, chs: n.chapters, suffix: '' }]));
  for (const { n, chs, suffix } of variants) {
    const used = new Set();
    const chapters = chs.map((ch) => ({
      ...ch,
      steps: ch.steps.map((st) => {
        for (const c of st.code || []) used.add(c);
        return { ...st, html: renderMarkdown(st.text), text: undefined };
      }),
    }));
    const data = {
      narrative: { ...n, chapters, subtitleHtml: n.subtitle ? renderMarkdown(n.subtitle) : '' },
      snippets: Object.fromEntries([...used].map((id) => [id, renderSnippet(snippets[id])])),
      sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { github: v.github, commit: v.commit, version: v.version }])),
      configDocs: CONFIG_DOCS,
      defaultConfig: DEFAULT_CONFIG,
      builtAt,
      version,
    };
    const html = template
      .replaceAll('{{TITLE}}', n.title.replace(/[<&"]/g, ''))
      .replace('{{DESCRIPTION}}', (n.subtitle || '').replace(/[<&"]/g, '').trim())
      .replace('/*{{CSS}}*/', () => css)
      .replace('{{DATA}}', () => escapeJsonForScript(JSON.stringify(data)))
      .replace('/*{{JS}}*/', () => js.replace(/<\/script/gi, '<\\/script'));
    const file = join(outDir, `${n.id}${suffix}.html`);
    writeFileSync(file, html);
    if (!suffix) written.push({ file, bytes: html.length, id: n.id, title: n.title });
  }
  // With one narrative, index.html is that narrative.
  if (written.length === 1) {
    writeFileSync(join(outDir, 'index.html'), readFileSync(written[0].file));
  } else {
    const links = written.map((w) => `<li><a href="${w.id}.html">${w.title}</a></li>`).join('\n');
    writeFileSync(join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>cbft explainers</title><ul>${links}</ul>`);
  }
  return written;
}

async function main() {
  const t0 = Date.now();
  const written = await build();
  for (const w of written) console.log(`wrote ${w.file} (${(w.bytes / 1024).toFixed(0)}KB)`);
  console.log(`built in ${Date.now() - t0}ms`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--watch')) {
    let timer = null;
    const rebuild = () => {
      clearTimeout(timer);
      timer = setTimeout(() => main().catch((e) => console.error(e.message)), 100);
    };
    rebuild();
    for (const d of ['src', 'content']) watch(join(ROOT, d), { recursive: true }, rebuild);
    console.log('watching src/ and content/ ...');
  } else {
    main().catch((e) => { console.error(e.message); process.exit(1); });
  }
}
