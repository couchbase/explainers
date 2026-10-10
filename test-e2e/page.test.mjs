// End-to-end checks of the built single-file page in headless Chrome:
// it loads without errors, every step activates as you scroll, the
// drawers work, and nothing overflows horizontally on a phone.
//
// Needs `npm run build` first, and Chrome (or set CHROME_PATH).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const file = fileURLToPath(new URL('../dist/index.html', import.meta.url));
let browser;

before(async () => {
  assert.ok(existsSync(file), 'run `npm run build` first');
  browser = process.env.CHROME_PATH
    ? await chromium.launch({ executablePath: process.env.CHROME_PATH })
    : await chromium.launch({ channel: 'chrome' });
});
after(async () => { await browser?.close(); });

async function open(viewport, scheme = 'light') {
  const page = await browser.newPage({ viewport, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + file + '?debug=1');
  await page.waitForFunction(() => window.bleveExplainer && window.bleveExplainer.ctl.model);
  return { page, errors };
}

test('desktop: scrolling activates every step without errors', async () => {
  const { page, errors } = await open({ width: 1440, height: 900 });
  const n = await page.evaluate(() => window.bleveExplainer.steps.length);
  const seen = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((i) => {
      const el = document.querySelector(`.step[data-index="${i}"]`);
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.4);
    }, i);
    await page.waitForFunction((i) => window.bleveExplainer.ctl.current === i, i, { timeout: 5000 });
    await page.waitForTimeout(150);
    seen.push(i);
  }
  assert.equal(seen.length, n);
  assert.deepEqual(errors, []);
  // Scrolling back up rebuilds an earlier state deterministically.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.bleveExplainer.ctl.current === 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('code drawer shows highlighted, linked source', async () => {
  const { page, errors } = await open({ width: 1440, height: 900 });
  await page.evaluate(() => document.getElementById('persister--open').scrollIntoView());
  await page.waitForTimeout(300);
  await page.locator('#persister--open .code-chip').first().click();
  const drawer = page.locator('.drawer:not(.knobs)');
  await page.waitForFunction(() => document.querySelector('.drawer:not(.knobs)').classList.contains('open'));
  const href = await drawer.locator('.where a').getAttribute('href');
  assert.match(href, /^https:\/\/github\.com\/blevesearch\/bleve\/blob\/9d2da23a5c58\/index\/scorch\/persister\.go#L\d+-L\d+$/);
  assert.ok(await drawer.locator('.ln.hl').count() > 0, 'has highlighted lines');
  assert.ok(await drawer.locator('.hljs-keyword').count() > 0, 'is syntax highlighted');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  await page.close();
});

test('knobs change the live simulation', async () => {
  const { page, errors } = await open({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Knobs' }).click();
  await page.fill('#knob-ingestDocsPerSec', '1234');
  await page.dispatchEvent('#knob-ingestDocsPerSec', 'change');
  const rate = await page.evaluate(() => window.bleveExplainer.ctl.model.cfg.ingestDocsPerSec);
  assert.equal(rate, 1234);
  assert.deepEqual(errors, []);
  await page.close();
});

for (const scheme of ['light', 'dark']) {
  test(`phone width (${scheme}): no horizontal overflow`, async () => {
    const { page, errors } = await open({ width: 400, height: 860 }, scheme);
    for (const id of ['picture--layers', 'slowdisk--kv', 'query--zombies']) {
      await page.evaluate((id) => document.getElementById(id).scrollIntoView(), id);
      await page.waitForTimeout(400);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `${id}: page scrolls sideways by ${over}px`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('a deep-linked step shows its lids, flips and one callout', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + file + '#persister--flip');
  await page.waitForFunction(() => window.bleveExplainer && window.bleveExplainer.ctl.model);
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    flipped: document.querySelectorAll('.panel.flipped').length,
    openLids: document.querySelectorAll('.lid.open').length,
    callouts: document.querySelectorAll('.overlay .callout').length,
    trace: window.bleveExplainer.ctl.model.trace.stage,
  }));
  assert.equal(state.flipped, 1);
  assert.equal(state.openLids, 5); // kv, cbft, scorch, introducer, persister
  assert.equal(state.callouts, 1);
  assert.equal(state.trace, 'persisting');
  assert.deepEqual(errors, []);
  await page.close();
});
