// Where the explainers are, and what each one is made of.
//
//   topics/<topic>/
//     topic.yaml           the topic's title, label and subtitle
//     sources.yaml         the pinned source repos its explainers link into
//     <name>/              one explainer, built to dist/<topic>/<name>.html:
//       narrative.yaml     the story
//       coderefs.yaml      the code it shows (snippets.json: resolved)
//       domain.js          what the engine reads (see engine/js/domain.js)
//       entry.js           the page's entry point, for the bundle
//       style.css          its styles, after the engine's
//
// Code shared by a topic's explainers would go in topics/<topic>/,
// and code shared across topics in engine/.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const readYaml = (p) => yaml.load(readFileSync(p, 'utf8'));

// Every explainer, in topic and then name order: {topic, name, id
// ('<topic>/<name>'), dir (absolute), rel (from ROOT)}.
export function listExplainers() {
  const topics = join(ROOT, 'topics');
  const out = [];
  for (const t of readdirSync(topics, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    for (const d of readdirSync(join(topics, t), { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
      const dir = join(topics, t, d);
      if (existsSync(join(dir, 'narrative.yaml'))) out.push({ topic: t, name: d, id: `${t}/${d}`, dir, rel: `topics/${t}/${d}` });
    }
  }
  return out;
}

// A topic's title, label (a short name, for its explainers' headers),
// subtitle (markdown, for its index page) and pinned sources.
export function loadTopic(topic) {
  const dir = join(ROOT, 'topics', topic);
  const meta = existsSync(join(dir, 'topic.yaml')) ? readYaml(join(dir, 'topic.yaml')) : {};
  return { topic, title: meta.title || topic, label: meta.label || topic, subtitle: meta.subtitle || '', sources: existsSync(join(dir, 'sources.yaml')) ? readYaml(join(dir, 'sources.yaml')) : {} };
}

// An explainer's narrative, code refs and snippets (each may be empty).
export function loadExplainer(x) {
  const at = (f) => join(x.dir, f);
  return {
    ...x,
    narrative: readYaml(at('narrative.yaml')),
    coderefs: existsSync(at('coderefs.yaml')) ? readYaml(at('coderefs.yaml')) || {} : {},
    snippets: existsSync(at('snippets.json')) ? JSON.parse(readFileSync(at('snippets.json'), 'utf8')) : {},
    sources: loadTopic(x.topic).sources,
  };
}
