// The zap-format explainer's page: every step, in light and dark, with
// no page errors; and the reader ends up having read a little of the file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, openPage, scrollToStep, stepCount } from './helpers.mjs';

const zap = fileURLToPath(new URL('../dist/zap-format.html', import.meta.url));
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
  const id = await page.evaluate(() => window.bleveExplainer.steps[window.bleveExplainer.ctl.current].id);
  assert.equal(id, 'value');
  assert.deepEqual(errors, []);
  await page.close();
});
