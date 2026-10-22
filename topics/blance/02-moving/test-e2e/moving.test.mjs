// The 02-moving explainer's page: every step, in light and dark, mid-
// transition and settled, with no page errors; settled, the diagram is
// at the step's moment; and deep links land.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openPage, scrollToStep, stepCount, builtPage } from '../../../../engine/test-e2e/helpers.mjs';

const moving = builtPage('blance/02-moving').shared;
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

for (const scheme of ['light', 'dark']) {
  test(`moving page (${scheme}): every step, mid-transition and settled, without errors`, async () => {
    const { page, errors } = await openPage(browser, { page: moving, scheme });
    const n = await stepCount(page);
    assert.ok(n > 15, `only ${n} steps`);
    for (let i = 0; i < n; i++) {
      await scrollToStep(page, i, 0.5, 20);
      await scrollToStep(page, i, 1.2, 20);
      const s = await page.evaluate(() => {
        const x = window.explainer;
        const sc = x.scenes[x.ctl.current];
        return { current: x.ctl.current, want: [sc.run, sc.t, sc.panel, sc.split], got: [x.diagram.cur.run, Math.round(x.diagram.cur.t), x.diagram.cur.panel, x.diagram.cur.split] };
      });
      assert.equal(s.current, i);
      assert.deepEqual(s.got, s.want, `step ${i}`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('moving page: deep links land on their step', async () => {
  for (const hash of ['movers--bottleneck', 'more--four-waits', 'fewer--min-gap']) {
    const { page, errors } = await openPage(browser, { page: moving, hash });
    await page.waitForTimeout(500);
    const id = await page.evaluate(() => { const s = window.explainer.steps[window.explainer.ctl.current]; return `${s.chapterId}--${s.id}`; });
    assert.equal(id, hash);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
