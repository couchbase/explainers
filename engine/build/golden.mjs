// Runs the golden tools: programs, beside an explainer (or a topic's
// shared lib/), that run the real code an explainer models and write
// what it did, for that explainer's tests to check its model against.
//
//   topics/<topic>/<dir>/tools/<name>-golden/
//     golden.yaml   how to run it: `args` (for `go run .`), and `stdout`
//                   (a file to write its output to), both optional,
//                   paths relative to the tool's directory
//
//   npm run golden                  # run them all
//   npm run golden -- blance zap    # just those whose path has any of these
//
// They're Go programs, run with GOTOOLCHAIN=local and GOFLAGS=-mod=mod:
// the go on PATH must be new enough for the code each one runs.

import { readdirSync, existsSync, readFileSync, openSync, closeSync, renameSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { ROOT } from './explainers.mjs';

const dirs = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(p, d.name)) : []);

export function listGoldenTools() {
  const out = [];
  for (const t of dirs(join(ROOT, 'topics'))) {
    for (const d of dirs(t)) {
      for (const tool of dirs(join(d, 'tools'))) {
        if (tool.endsWith('-golden') && existsSync(join(tool, 'golden.yaml'))) {
          out.push({ dir: tool, rel: relative(ROOT, tool), ...(yaml.load(readFileSync(join(tool, 'golden.yaml'), 'utf8')) || {}) });
        }
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const filters = process.argv.slice(2);
let failed = false;
for (const t of listGoldenTools()) {
  if (filters.length && !filters.some((f) => t.rel.includes(f))) continue;
  console.log(`${t.rel}: go run . ${(t.args || []).join(' ')}${t.stdout ? ` > ${t.stdout}` : ''}`);
  // (its output replaces the old only if it succeeds)
  const out = t.stdout && join(t.dir, t.stdout);
  const fd = out ? openSync(`${out}.tmp`, 'w') : 'inherit';
  const r = spawnSync('go', ['run', '.', ...(t.args || [])], {
    cwd: t.dir,
    stdio: ['ignore', fd, 'inherit'],
    env: { ...process.env, GOTOOLCHAIN: 'local', GOFLAGS: '-mod=mod' },
  });
  if (typeof fd === 'number') closeSync(fd);
  if (r.status !== 0) {
    console.error(`${t.rel}: failed (${r.error ? r.error.message : `exit ${r.status}`})`);
    failed = true;
    if (out) rmSync(`${out}.tmp`, { force: true });
  } else if (out) renameSync(`${out}.tmp`, out);
}
if (failed) process.exit(1);
