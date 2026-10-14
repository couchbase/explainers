// A page's look: local @imports in a stylesheet are inlined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCss } from '../build/look.mjs';

test('readCss inlines local @imports, and rejects cycles and remote ones', () => {
  const d = mkdtempSync(join(tmpdir(), 'look-'));
  mkdirSync(join(d, 'a')); mkdirSync(join(d, 'b'));
  writeFileSync(join(d, 'a/style.css'), '.x { color: red; }\n');
  writeFileSync(join(d, 'b/style.css'), '/* b */\n@import "../a/style.css";\n.y { color: blue; }\n');
  assert.equal(readCss(join(d, 'b/style.css')), '/* b */\n.x { color: red; }\n\n.y { color: blue; }\n');
  writeFileSync(join(d, 'a/loop.css'), '@import "loop.css";\n');
  assert.throws(() => readCss(join(d, 'a/loop.css')), /cycle/);
  writeFileSync(join(d, 'a/remote.css'), '@import url("https://example.com/x.css");\n');
  assert.throws(() => readCss(join(d, 'a/remote.css')), /only local/);
});
