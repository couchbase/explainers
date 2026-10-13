// The zap-format explainer's page: every step, in light and dark, with
// no page errors; and the reader ends up having read a little of the file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, openPage, scrollToStep, stepCount, builtPage } from '../../../../engine/test-e2e/helpers.mjs';

const zap = builtPage('cbft/02-zap-format').shared;
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

for (const scheme of ['light', 'dark']) {
  test(`zap page (${scheme}): every step, mid-transition and settled, without errors`, async () => {
    const { page, errors } = await openPage(browser, { page: zap, scheme });
    const n = await stepCount(page);
    assert.ok(n > 40, `only ${n} steps`);
    for (let i = 0; i < n; i++) {
      await scrollToStep(page, i, 0.5, 20);
      await scrollToStep(page, i, 1.2, 20);
    }
    assert.deepEqual(errors, []);
    // by the end, some bytes are lit on the strip, but not all of them
    const lit = await page.evaluate(() => document.querySelectorAll('.zread').length);
    assert.ok(lit >= 5, `${lit} byte ranges lit`);
    await page.close();
  });
}

test('zap page: a deep link lands on its step', async () => {
  const { page, errors } = await openPage(browser, { page: zap, hash: 'lookup--value' });
  await page.waitForTimeout(300);
  const id = await page.evaluate(() => window.explainer.steps[window.explainer.ctl.current].id);
  assert.equal(id, 'value');
  assert.deepEqual(errors, []);
  await page.close();
});

// Links to sibling pages (up to the topic's index, to the next
// explainer, and in a step's text) only where they'd lead somewhere:
// not from a stray copy.
test('zap page: links to sibling pages, except from a stray copy', async () => {
  const links = (page) => page.evaluate(() => ({
    up: !!document.querySelector('a.eyebrow[href="index.html"]'),
    end: !!document.querySelector('.next-card .up-link'),
    label: document.querySelector('.hero .eyebrow').textContent,
    // the first step's link to the first explainer
    sibling: !!document.querySelector('a[href="01-indexing.html"]'),
  }));
  const { page, errors } = await openPage(browser, { page: zap });
  assert.deepEqual(await links(page), { up: true, end: true, label: 'cbft / bleve / scorch', sibling: true });
  await page.close();

  const dir = mkdtempSync(join(tmpdir(), 'bx-stray-'));
  try {
    const stray = join(dir, '02-zap-format.html');
    copyFileSync(zap, stray);
    const { page: p2, errors: e2 } = await openPage(browser, { page: stray });
    assert.deepEqual(await links(p2), { up: false, end: false, label: 'cbft / bleve / scorch', sibling: false });
    assert.deepEqual([...errors, ...e2], []);
    await p2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
