// The compiler's real run (../lib/compile.json), as the explainer reads
// it: the filter's source pairs line for line with intermed's version;
// each emitted line is tagged with a group, in the order the compiler
// prints them; and both engines give the same rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPILE, EMITTED, SHOWN, GROUPS, funcNamed, statements, pairs } from '../../lib/compile.js';
import { ITEMS } from '../layout.js';

test('intermed: one statement per source line, for the filter and the project', () => {
  for (const name of ['OpFilter', 'OpProject']) {
    const f = funcNamed(name);
    assert.equal(statements(f.intermed).length, f.src.length, name);
  }
});

test('intermed: early-bound lines kept as they are; late-bound ones Emitted', () => {
  for (const r of pairs('OpFilter')) {
    if (r.kind === 'early' && r.inter) assert.equal(r.inter.trim(), r.src.trim(), r.src);
    if (r.kind === 'late') assert.match(r.inter, /^Emit\(`/, r.src);
    if (r.kind === 'hide') assert.equal(r.inter, 'Emit(``)', r.src);
    if (r.kind === 'captured') assert.match(r.inter, /^EmitCaptured\(/, r.src);
  }
});

test('emitted: groups come in the compiler\'s order, and every line\'s shown', () => {
  // (in Run's body: the project's scope, around the filter's, around
  // its holes' code and the scan's loop; above it, the lifted vars)
  const runs = (es) => es.map((e) => e.group).filter((g, i, a) => i === 0 || g !== a[i - 1]);
  const top = EMITTED.findIndex((e) => e.text === 'if true {');
  assert.deepEqual(runs(EMITTED.slice(top)), ['project', 'filter', 'expr', 'filter', 'fuse', 'filter', 'scan', 'filter', 'project']);
  assert.deepEqual(runs(EMITTED.slice(0, top)), ['project', 'expr']);
  assert.deepEqual([...new Set(EMITTED.map((e) => e.group))].sort(), [...GROUPS].sort());
  assert.deepEqual(SHOWN.flatMap((r) => r.raw), EMITTED.map((e) => e.i));
  // (each hole, right before its group's code)
  for (const h of ['expr', 'fuse']) {
    const k = ITEMS.findIndex((it) => it.hole === h);
    assert.ok(k >= 0 && ITEMS[k + 1].group === h, h);
  }
});

test('both engines: the same rows', () => {
  assert.deepEqual(COMPILE.compiled, COMPILE.interpreted);
  assert.equal(COMPILE.compiled.length, 3);
});
