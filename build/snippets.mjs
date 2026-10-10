// Resolves content/coderefs.yaml against local checkouts of the pinned
// source versions (content/sources.yaml) and writes
// content/snippets.json, which the build inlines. The JSON is
// committed, so building the explainer doesn't require the sources;
// only refreshing snippets does.
//
//   npm run snippets           # regenerate content/snippets.json
//   npm run snippets -- --check  # verify it's up to date (exit 1 if not)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadYaml(rel) {
  return yaml.load(readFileSync(join(ROOT, rel), 'utf8'));
}

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

export function resolveAll() {
  const sources = loadYaml('content/sources.yaml');
  const refs = loadYaml('content/coderefs.yaml');
  const cache = new Map();
  const out = {};
  const errors = [];
  for (const [id, ref] of Object.entries(refs)) {
    try { out[id] = resolveRef(id, ref, sources, cache); } catch (e) { errors.push(e.message); }
  }
  return { out, errors, sources };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { out, errors } = resolveAll();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  const json = JSON.stringify(out, null, 1) + '\n';
  const dest = join(ROOT, 'content/snippets.json');
  if (check) {
    const cur = existsSync(dest) ? readFileSync(dest, 'utf8') : '';
    if (cur !== json) {
      console.error('content/snippets.json is stale; run `npm run snippets`');
      process.exit(1);
    }
    console.log(`snippets up to date (${Object.keys(out).length})`);
  } else {
    writeFileSync(dest, json);
    console.log(`wrote ${Object.keys(out).length} snippets to content/snippets.json`);
  }
}
