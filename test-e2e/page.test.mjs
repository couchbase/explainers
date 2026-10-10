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
  // The controls appear once the story brings them in.
  await page.evaluate(() => document.getElementById('together--running').scrollIntoView());
  await page.waitForTimeout(600);
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

test('a deep-linked step shows its lids, bubble and one callout', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + file + '#persister--detail');
  await page.waitForFunction(() => window.bleveExplainer && window.bleveExplainer.ctl.model);
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => ({
    step: window.bleveExplainer.steps[window.bleveExplainer.ctl.current].id,
    openLids: [...document.querySelectorAll('.lid')].filter((l) => l.style.visibility === 'hidden').length,
    bubble: Number(document.querySelector('.bubble').getAttribute('opacity')),
    callouts: document.querySelectorAll('.overlay .callout').length,
    trace: window.bleveExplainer.ctl.model.trace.stage,
  }));
  assert.equal(state.step, 'detail');
  assert.equal(state.openLids, 5); // kv, cbft, scorch, introducer, persister
  assert.ok(state.bubble > 0.99, `bubble opacity ${state.bubble}`);
  assert.equal(state.callouts, 1);
  assert.equal(state.trace, 'persisting');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the view changes continuously with scrolling, not in jumps', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('file://' + file);
  await page.waitForFunction(() => window.bleveExplainer && window.bleveExplainer.ctl.model);
  // cbft/zoom moves the camera from the overview to the top.
  const vbAt = async (frac) => {
    await page.evaluate((frac) => {
      const el = document.getElementById('cbft--zoom');
      const H = innerHeight, enterY = H * 0.82, settleY = H * 0.42;
      const top = enterY - frac * (enterY - settleY);
      window.scrollTo(0, el.getBoundingClientRect().top + scrollY - top);
    }, frac);
    await page.waitForTimeout(150);
    return page.evaluate(() => document.querySelector('.diagram').getAttribute('viewBox').split(' ').map(Number));
  };
  const a = await vbAt(0.02), m = await vbAt(0.5), b = await vbAt(0.98);
  assert.ok(m[3] < a[3] && m[3] > b[3], `height should shrink smoothly: ${a[3]} > ${m[3]} > ${b[3]}`);
  const tokenOpacity = await page.evaluate(() => Number(document.querySelector('.token').getAttribute('opacity')));
  assert.equal(tokenOpacity, 0, 'no marker before we start following a batch');
  await page.close();
});

test('our batch\'s marker stays in view at every step that shows it', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('file://' + file);
  await page.waitForFunction(() => window.bleveExplainer && window.bleveExplainer.ctl.model);
  const n = await page.evaluate(() => window.bleveExplainer.steps.length);
  let checked = 0;
  for (let i = 0; i < n; i++) {
    for (const frac of [0.5, 1.2]) {
      await page.evaluate(([i, frac]) => {
        const el = document.querySelector(`.step[data-index="${i}"]`);
        const H = innerHeight, enterY = H * 0.82, settleY = H * 0.42;
        window.scrollTo(0, el.getBoundingClientRect().top + scrollY - (enterY - frac * (enterY - settleY)));
      }, [i, frac]);
      await page.waitForTimeout(60);
      const r = await page.evaluate(() => {
        const tok = document.querySelector('.token');
        if (Number(tok.getAttribute('opacity')) < 0.5) return null;
        const vp = document.querySelector('.viewport').getBoundingClientRect();
        const b = tok.querySelector('rect').getBoundingClientRect();
        return { inside: b.left >= vp.left && b.right <= vp.right && b.top >= vp.top && b.bottom <= vp.bottom,
          step: window.bleveExplainer.steps[window.bleveExplainer.ctl.current].id };
      });
      if (!r) continue;
      checked++;
      assert.ok(r.inside, `marker out of view at step ${r.step} (progress ${frac})`);
    }
  }
  assert.ok(checked > 20, `only checked ${checked} frames`);
  await page.close();
});

test('the charts column takes no room until the controls appear', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('file://' + file);
  await page.waitForFunction(() => window.bleveExplainer && window.bleveExplainer.ctl.model);
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => document.querySelector('.charts').getBoundingClientRect().width);
  await page.evaluate(() => document.getElementById('together--running').scrollIntoView());
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector('.charts').getBoundingClientRect().width);
  assert.ok(before < 1, `charts column is ${before}px wide while hidden`);
  assert.ok(after > 200, `charts column is only ${after}px wide when shown`);
  await page.close();
});
