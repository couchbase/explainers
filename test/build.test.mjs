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
      assert.ok(!html.includes('{{') && !html.includes('/*{{'), 'all placeholders filled');
      const json = html.match(/<script type="application\/json" id="bx-data">([\s\S]*?)<\/script>/)[1];
      const data = JSON.parse(json);
      assert.ok(data.narrative.chapters.length > 0);
      for (const ch of data.narrative.chapters) for (const st of ch.steps) {
        for (const c of st.code || []) assert.ok(data.snippets[c], `snippet ${c} embedded`);
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
