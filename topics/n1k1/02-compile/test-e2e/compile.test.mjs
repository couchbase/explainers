// The 02-compile explainer's page: every step, in light and dark, mid-
// transition and settled, with no page errors; settled, the diagram is
// in the step's state; and deep links land.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openPage, scrollToStep, stepCount, builtPage } from '../../../../engine/test-e2e/helpers.mjs';

const compile = builtPage('n1k1/02-compile').shared;
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

for (const scheme of ['light', 'dark']) {
  test(`compile page (${scheme}): every step, mid-transition and settled, without errors`, async () => {
    const { page, errors } = await openPage(browser, { page: compile, scheme });
    const n = await stepCount(page);
    assert.ok(n > 15, `only ${n} steps`);
    for (let i = 0; i < n; i++) {
      await scrollToStep(page, i, 0.5, 20);
      await scrollToStep(page, i, 1.2, 20);
      const s = await page.evaluate(() => {
        const x = window.explainer;
        return { current: x.ctl.current, want: x.scenes[x.ctl.current].at, got: x.diagram.cur.key };
      });
      assert.equal(s.current, i);
      assert.equal(s.got, s.want, `step ${i}`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('compile page: deep links land on their step', async () => {
  for (const hash of ['source--seams', 'compile--expr', 'same--rows']) {
    const { page, errors } = await openPage(browser, { page: compile, hash });
    await page.waitForTimeout(500);
    const id = await page.evaluate(() => { const s = window.explainer.steps[window.explainer.ctl.current]; return `${s.chapterId}--${s.id}`; });
    assert.equal(id, hash);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
