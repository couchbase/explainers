// The 02-groups explainer's page (01-planning's, told for server groups): every step, in light and dark, mid-
// transition and settled, with no page errors; the board shows each
// step's frame once settled; and deep links land, web fonts and all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openPage, scrollToStep, stepCount, builtPage } from '../../../../engine/test-e2e/helpers.mjs';

const planning = builtPage('blance/02-groups').shared;
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

for (const scheme of ['light', 'dark']) {
  test(`groups page (${scheme}): every step, mid-transition and settled, without errors`, async () => {
    const { page, errors } = await openPage(browser, { page: planning, scheme });
    const n = await stepCount(page);
    assert.ok(n > 6, `only ${n} steps`);
    for (let i = 0; i < n; i++) {
      await scrollToStep(page, i, 0.5, 20);
      await scrollToStep(page, i, 1.2, 20);
      // settled, the board shows the step's frame: its chips, where the
      // frame says they are
      const ok = await page.evaluate((i) => {
        const x = window.explainer;
        const f = x.scenes[i].frame;
        const want = Object.values(f.board).reduce((k, b) => k + b.primary.length + b.replica.length, 0);
        const shown = [...document.querySelectorAll('.diagram .chip')].filter((c) => +c.parentNode.getAttribute('opacity') > 0.99).length;
        return { want, shown, current: x.ctl.current };
      }, i);
      assert.equal(ok.current, i);
      assert.equal(ok.shown, ok.want, `step ${i}: ${ok.shown} chips shown, ${ok.want} in its frame`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('groups page: deep links land on their step', async () => {
  for (const hash of ['groups--tree', 'decision--scored', 'decision--pick']) {
    const { page, errors } = await openPage(browser, { page: planning, hash });
    await page.waitForTimeout(500);
    const id = await page.evaluate(() => { const s = window.explainer.steps[window.explainer.ctl.current]; return `${s.chapterId}--${s.id}`; });
    assert.equal(id, hash);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test('groups page: its header links up to the blance topic index', async () => {
  const { page } = await openPage(browser, { page: planning });
  assert.equal(await page.evaluate(() => document.querySelector('a.eyebrow').getAttribute('href')), 'index.html');
  assert.equal(await page.evaluate(() => document.querySelector('a.eyebrow').textContent), 'blance');
  await page.close();
});
