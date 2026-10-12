// Resolves each explainer's coderefs.yaml against local checkouts of
// its topic's pinned source versions (topics/<topic>/sources.yaml) and
// writes its snippets.json, which the build inlines. The JSON is
// committed, so building doesn't require the sources; only refreshing
// snippets does. (A source's relative `local` paths are from the repo
// root.)
//
//   npm run snippets             # regenerate every snippets.json
//   npm run snippets -- --check  # verify they're up to date (exit 1 if not)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, listExplainers, loadExplainer } from './explainers.mjs';

function expand(p) {
  const s = p.replace(/\$(\w+)/g, (_, v) => (v === 'HOME' ? process.env.HOME : process.env[v] || '\0'));
  if (s.includes('\0')) return null; // unset env var
  return resolve(ROOT, s);
}

export function findLocal(source) {
  for (const cand of source.local || []) {
    const p = expand(cand);
    if (p && existsSync(p)) return p;
  }
  return null;
}

// Returns {start, end} (1-based, inclusive) for a ref within lines.
export function locate(lines, ref, id) {
  const hits = [];
  lines.forEach((l, i) => { if (l.includes(ref.anchor)) hits.push(i); });
  if (hits.length === 0) throw new Error(`${id}: anchor not found in ${ref.path}: ${ref.anchor}`);
  if (hits.length > 1) throw new Error(`${id}: anchor not unique in ${ref.path} (lines ${hits.map((h) => h + 1).join(', ')})`);
  const s = hits[0];
  let e;
  if (typeof ref.extent === 'number') {
    e = Math.min(lines.length - 1, s + ref.extent - 1);
  } else if (ref.extent === 'func' || ref.extent === 'block') {
    const enders = ref.extent === 'func' ? ['}'] : [')', '}'];
    e = -1;
    for (let i = s + 1; i < lines.length; i++) {
      if (enders.includes(lines[i].trimEnd())) { e = i; break; }
    }
    if (e < 0) throw new Error(`${id}: no end of ${ref.extent} found`);
  } else {
    throw new Error(`${id}: bad extent ${ref.extent}`);
  }
  return { start: s + 1, end: e + 1 };
}

export function resolveRef(id, ref, sources, fileCache) {
  const src = sources[ref.repo];
  if (!src) throw new Error(`${id}: unknown repo ${ref.repo}`);
  const base = findLocal(src);
  if (!base) throw new Error(`${id}: no local checkout of ${ref.repo}; looked in ${src.local.join(', ')}`);
  const file = join(base, ref.path);
  let lines = fileCache.get(file);
  if (!lines) {
    lines = readFileSync(file, 'utf8').split('\n');
    fileCache.set(file, lines);
  }
  const { start, end } = locate(lines, ref, id);
  const code = lines.slice(start - 1, end);
  const highlight = [];
  for (const h of ref.highlight || []) {
    const idx = code.findIndex((l) => l.includes(h));
    if (idx < 0) throw new Error(`${id}: highlight not found in snippet: ${h}`);
    highlight.push(idx + start);
  }
  return {
    id,
    repo: ref.repo,
    path: ref.path,
    title: ref.title || id,
    start,
    end,
    highlight: [...new Set(highlight)].sort((a, b) => a - b),
    url: `${src.github}/blob/${src.commit}/${ref.path}#L${start}-L${end}`,
    code: code.join('\n'),
  };
}

// An explainer's snippets, from its coderefs and its topic's sources.
export function resolveAll(e) {
  const cache = new Map();
  const out = {};
  const errors = [];
  for (const [id, ref] of Object.entries(e.coderefs)) {
    try { out[id] = resolveRef(id, ref, e.sources, cache); } catch (err) { errors.push(`${e.rel}: ${err.message}`); }
  }
  return { out, errors };
}

const toJson = (out) => JSON.stringify(out, null, 1) + '\n';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let failed = false;
  for (const x of listExplainers()) {
    const e = loadExplainer(x);
    const { out, errors } = resolveAll(e);
    if (errors.length) { console.error(errors.join('\n')); failed = true; continue; }
    const dest = join(x.dir, 'snippets.json');
    const json = toJson(out);
    if (check) {
      const cur = existsSync(dest) ? readFileSync(dest, 'utf8') : '';
      if (cur !== json) { console.error(`${x.rel}/snippets.json is stale; run \`npm run snippets\``); failed = true; }
      else console.log(`${x.rel}: snippets up to date (${Object.keys(out).length})`);
    } else {
      writeFileSync(dest, json);
      console.log(`${x.rel}: wrote ${Object.keys(out).length} snippets`);
    }
  }
  if (failed) process.exit(1);
}

export { toJson };
