import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLocal, srcEnvVar } from '../build/snippets.mjs';

test('srcEnvVar names an override for any source', () => {
  assert.equal(srcEnvVar('cbgt'), 'EXPLAINERS_SRC_CBGT');
  assert.equal(srcEnvVar('my-lib.v2'), 'EXPLAINERS_SRC_MY_LIB_V2');
});

test('findLocal: the env override wins over `local`, if it exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bx-src-'));
  const v = srcEnvVar('somelib');
  try {
    const src = { local: [dir] };
    assert.equal(findLocal(src, 'somelib'), dir);
    process.env[v] = join(dir, 'missing');
    assert.equal(findLocal(src, 'somelib'), null);
    process.env[v] = dir;
    assert.equal(findLocal({ local: ['/nowhere'] }, 'somelib'), dir);
  } finally {
    delete process.env[v];
    rmSync(dir, { recursive: true, force: true });
  }
});
