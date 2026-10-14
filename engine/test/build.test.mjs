import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, splitHighlightedLines } from '../build/build.mjs';

test('splitHighlightedLines keeps spans balanced per line', () => {
  const lines = splitHighlightedLines('a<span class="c">/* x\ny */</span>b\nc');
  assert.deepEqual(lines, ['a<span class="c">/* x</span>', '<span class="c">y */</span>b', 'c']);
});

test('build emits one self-contained HTML file per narrative', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bx-'));
  try {
    const written = await build({ outDir: out });
    assert.ok(written.length >= 1);
    for (const w of written) {
      const html = readFileSync(w.file, 'utf8');
      assert.ok(html.length < 2 * 1024 * 1024, 'stays small enough to email');
      assert.ok(!/<script[^>]+src=/.test(html), 'no external scripts');
      // (the template's placeholders; the code shown may have its own "{{")
      for (const ph of ['{{TITLE}}', '{{DESCRIPTION}}', '{{FONTS}}', '{{DATA}}', '/*{{CSS}}*/', '/*{{JS}}*/']) {
        assert.ok(!html.includes(ph), `placeholder ${ph} filled`);
      }
      const json = html.match(/<script type="application\/json" id="bx-data">([\s\S]*?)<\/script>/)[1];
      const data = JSON.parse(json);
      assert.ok(data.narrative.chapters.length > 0);
      for (const ch of data.narrative.chapters) for (const st of ch.steps) {
        for (const c of st.code || []) assert.ok(data.snippets[c], `snippet ${c} embedded`);
      }
      assert.equal(data.topic.href, 'index.html', 'links up to its topic index');
    }
    // each topic's index lists its explainers, and links up to the root index
    for (const t of new Set(written.map((w) => w.topic))) {
      const html = readFileSync(join(out, t, 'index.html'), 'utf8');
      assert.ok(html.includes('href="../index.html"'));
      for (const w of written.filter((x) => x.topic === t)) assert.ok(html.includes(`href="${w.name}.html"`), `${t}/index.html links ${w.name}`);
    }
    const root = readFileSync(join(out, 'index.html'), 'utf8');
    for (const w of written) assert.ok(root.includes(`href="${w.topic}/${w.name}.html"`), `index.html links ${w.topic}/${w.name}`);
    // a draft is stamped in the indexes, and no page links it as the next to read
    const drafts = new Set(written.filter((w) => w.draft).map((w) => `${w.topic}/${w.name}.html`));
    for (const d of drafts) assert.match(root, new RegExp(`is-draft"><span class="draft-stamp">Draft</span>\\s*<span class="num">[^<]*</span>\\s*<div><a class="title" href="${d}"`), `${d} stamped as a draft`);
    for (const w of written) {
      const data = JSON.parse(readFileSync(w.file, 'utf8').match(/<script type="application\/json" id="bx-data">([\s\S]*?)<\/script>/)[1]);
      if (data.next) assert.ok(!drafts.has(`${w.topic}/${data.next.href}`), `${w.topic}/${w.name} links the draft ${data.next.href} as next`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
