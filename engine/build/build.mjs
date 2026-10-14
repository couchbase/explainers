// Builds each explainer (topics/<topic>/<name>/, see explainers.mjs)
// into one self-contained HTML file, dist/<topic>/<name>.html: CSS, JS,
// narrative data and highlighted code snippets are all inlined, so the
// file can be opened from disk, emailed or Slacked. Plus an index page
// per topic, and dist/index.html over them all.
//
//   npm run build          # dist/<topic>/<name>.html, and the index pages
//   npm run dev            # rebuild on change

import { readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import go from 'highlight.js/lib/languages/go';
import * as esbuild from 'esbuild';
import { validateNarrative } from './schema.mjs';
import { ROOT, listExplainers, loadExplainer, loadTopic } from './explainers.mjs';
import { topicIndex, rootIndex } from './indexes.mjs';
import { fontLinks, topicCss, readCss, DEFAULT_FONTS } from './look.mjs';
import { useDomain } from '../js/domain.js';
import { shownChapters, isStop } from '../js/story/timeline.js';

hljs.registerLanguage('go', go);

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

// Every explainer, validated against its own domain. An explainer's
// id is '<topic>/<name>'; its page is dist/<topic>/<name>.html.
async function loadAll() {
  const out = [];
  const errs = [];
  for (const x of listExplainers()) {
    const e = loadExplainer(x);
    useDomain(await import(pathToFileURL(join(x.dir, 'domain.js')).href));
    errs.push(...validateNarrative(e.narrative, { coderefs: e.coderefs, sources: e.sources, file: `${x.rel}/narrative.yaml` }));
    out.push(e);
  }
  if (errs.length) throw new Error('narrative errors:\n  ' + errs.join('\n  '));
  return out;
}

function escapeJsonForScript(json) {
  return json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export async function build({ outDir = join(ROOT, 'dist') } = {}) {
  const explainers = await loadAll();
  // `next` names another explainer in the same topic; a draft isn't
  // linked as the next one to read
  const nextOf = (e) => {
    const n = e.narrative.next;
    if (!n) return null;
    const m = explainers.find((x) => x.topic === e.topic && x.name === n);
    if (!m) throw new Error(`${e.rel}: next "${n}" isn't an explainer in topics/${e.topic}/`);
    if (m.narrative.draft) return null;
    return { href: `${m.name}.html`, title: m.narrative.title };
  };

  // One bundle per explainer: the engine plus that explainer, from its
  // entry point.
  const jsFor = async (e) => {
    const bundle = await esbuild.build({
      entryPoints: [join(e.dir, 'entry.js')],
      bundle: true,
      format: 'iife',
      target: 'es2020',
      minify: true,
      write: false,
      legalComments: 'none',
    });
    return bundle.outputFiles[0].text;
  };
  // The engine's styles, then the topic's, then the explainer's own.
  const cssFor = (e) => topicCss(e.topic) + '\n' + readCss(join(e.dir, 'style.css'));
  const template = read('engine/page.html');
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
  for (const e of explainers) {
    const n = e.narrative;
    const js = await jsFor(e);
    const css = cssFor(e);
    const variants = shownChapters(n).length < n.chapters.length
      ? [{ chs: shownChapters(n), suffix: '' }, { chs: n.chapters.filter((ch) => !isStop(ch)), suffix: '-drafts' }]
      : [{ chs: n.chapters, suffix: '' }];
    for (const { chs, suffix } of variants) {
      const used = new Set();
      const chapters = chs.map((ch) => ({
        ...ch,
        steps: ch.steps.map((st) => {
          for (const c of st.code || []) used.add(c);
          return { ...st, html: renderMarkdown(st.text), text: undefined };
        }),
      }));
      const data = {
        narrative: { ...n, id: e.id, chapters, subtitleHtml: n.subtitle ? renderMarkdown(n.subtitle) : '' },
        snippets: Object.fromEntries([...used].map((id) => [id, renderSnippet(e.snippets[id])])),
        // the sources the page names, in its order (all, if it names none)
        sources: Object.fromEntries((n.sources || Object.keys(e.sources)).map((k) => [k, { github: e.sources[k].github, commit: e.sources[k].commit, version: e.sources[k].version }])),
        builtAt,
        version,
        // the explainer to read next, if the narrative names one
        next: nextOf(e),
        // the topic's index page, beside this one
        topic: (({ title, label }) => ({ href: 'index.html', title, label }))(loadTopic(e.topic)),
      };
      const html = template
        .replaceAll('{{TITLE}}', n.title.replace(/[<&"]/g, ''))
        .replace('{{FONTS}}', () => fontLinks(loadTopic(e.topic).fonts || DEFAULT_FONTS))
        .replace('{{DESCRIPTION}}', (n.subtitle || '').replace(/[<&"]/g, '').trim())
        .replace('/*{{CSS}}*/', () => css)
        .replace('{{DATA}}', () => escapeJsonForScript(JSON.stringify(data)))
        .replace('/*{{JS}}*/', () => js.replace(/<\/script/gi, '<\\/script'));
      mkdirSync(join(outDir, e.topic), { recursive: true });
      const file = join(outDir, e.topic, `${e.name}${suffix}.html`);
      writeFileSync(file, html);
      if (!suffix) written.push({ file, bytes: html.length, topic: e.topic, name: e.name, title: n.title, subtitleHtml: data.narrative.subtitleHtml, draft: !!n.draft });
    }
  }
  // The index pages: one per topic, and one over all of them.
  const topics = [...new Set(written.map((w) => w.topic))].map((t) => {
    const topic = loadTopic(t);
    return { topic: { ...topic, subtitleHtml: topic.subtitle ? renderMarkdown(topic.subtitle) : '' }, ws: written.filter((w) => w.topic === t) };
  });
  for (const { topic, ws } of topics) writeFileSync(join(outDir, topic.topic, 'index.html'), topicIndex(topic, ws));
  writeFileSync(join(outDir, 'index.html'), rootIndex(topics));
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
    // Each rebuild is a fresh process, so changes to the engine's own
    // build code (and the explainers' modules) take effect too.
    let timer = null;
    const rebuild = () => {
      clearTimeout(timer);
      timer = setTimeout(() => spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit' }), 100);
    };
    rebuild();
    for (const d of ['engine', 'topics']) watch(join(ROOT, d), { recursive: true }, rebuild);
    console.log('watching engine/ and topics/ ...');
  } else {
    main().catch((e) => { console.error(e.message); process.exit(1); });
  }
}
