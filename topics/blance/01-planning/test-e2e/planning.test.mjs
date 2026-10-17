// The 01-planning explainer's page: every step, in light and dark, mid-
// transition and settled, with no page errors; the board shows each
// step's frame once settled; and deep links land, web fonts and all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openPage, scrollToStep, stepCount, builtPage } from '../../../../engine/test-e2e/helpers.mjs';

const planning = builtPage('blance/01-planning').shared;
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

for (const scheme of ['light', 'dark']) {
  test(`planning page (${scheme}): every step, mid-transition and settled, without errors`, async () => {
    const { page, errors } = await openPage(browser, { page: planning, scheme });
    const n = await stepCount(page);
    assert.ok(n > 25, `only ${n} steps`);
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

test('planning page: deep links land on their step', async () => {
  for (const hash of ['replicas--spread', 'join--sticky', 'leave--no-promote', 'summary--loops']) {
    const { page, errors } = await openPage(browser, { page: planning, hash });
    await page.waitForTimeout(500);
    const id = await page.evaluate(() => { const s = window.explainer.steps[window.explainer.ctl.current]; return `${s.chapterId}--${s.id}`; });
    assert.equal(id, hash);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test('planning page: its header links up to the blance topic index', async () => {
  const { page } = await openPage(browser, { page: planning });
  assert.equal(await page.evaluate(() => document.querySelector('a.eyebrow').getAttribute('href')), 'index.html');
  assert.equal(await page.evaluate(() => document.querySelector('a.eyebrow').textContent), 'blance');
  await page.close();
});

test('planning page: the URL names the step in view, and none back at the top', async () => {
  const { page, errors } = await openPage(browser, { page: planning });
  await page.mouse.move(700, 400);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(100); }
  await page.waitForTimeout(400);
  assert.match(await page.evaluate(() => location.hash), /^#[\w-]+--[\w-]+$/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.deepEqual(errors, []);
  await page.close();
});
