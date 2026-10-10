// End-to-end checks of the built single-file page in headless Chrome:
// it loads without errors, every step activates as you scroll, the
// drawers work, and nothing overflows horizontally on a phone.
//
// Needs `npm run build` first, and Chrome (or set CHROME_PATH).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openPage, scrollToStep, viewBox, stepCount } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
const open = (viewport, scheme) => openPage(browser, { viewport, scheme });

test('desktop: scrolling activates every step without errors', async () => {
  const { page, errors } = await open({ width: 1440, height: 900 });
  const n = await stepCount(page);
  const seen = [];
  for (let i = 0; i < n; i++) {
    await scrollToStep(page, i, 1.05, 0);
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
  await scrollToStep(page, 'together--running', 1.2, 600);
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
  const { page, errors } = await openPage(browser, { hash: 'persister--detail' });
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
  const { page } = await openPage(browser);
  // cbft/zoom moves the camera from the overview to the top.
  const vbAt = async (p) => { await scrollToStep(page, 'cbft--zoom', p); return viewBox(page); };
  const a = await vbAt(0.02), m = await vbAt(0.5), b = await vbAt(0.98);
  assert.ok(m[3] < a[3] && m[3] > b[3], `height should shrink smoothly: ${a[3]} > ${m[3]} > ${b[3]}`);
  const tokenOpacity = await page.evaluate(() => Number(document.querySelector('.token').getAttribute('opacity')));
  assert.equal(tokenOpacity, 0, 'no marker before we start following a batch');
  await page.close();
});

test('our batch\'s marker stays in view at every step that shows it', async () => {
  const { page } = await openPage(browser);
  const n = await stepCount(page);
  let checked = 0;
  for (let i = 0; i < n; i++) {
    for (const frac of [0.5, 1.2]) {
      await scrollToStep(page, i, frac, 60);
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
  const { page } = await openPage(browser);
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => document.querySelector('.charts').getBoundingClientRect().width);
  await scrollToStep(page, 'together--running', 1.2, 300);
  const after = await page.evaluate(() => document.querySelector('.charts').getBoundingClientRect().width);
  assert.ok(before < 1, `charts column is ${before}px wide while hidden`);
  assert.ok(after > 200, `charts column is only ${after}px wide when shown`);
  await page.close();
});

test('map-style gestures zoom and pan the diagram', async () => {
  const { page } = await openPage(browser, { hash: 'scorch--our-segment' });
  await page.waitForTimeout(600);
  const vb = () => viewBox(page);
  const box = await page.locator('.viewport').boundingBox();
  const cx = box.x + box.width * 0.75, cy = box.y + box.height * 0.5;
  const w0 = (await vb())[2];
  await page.mouse.move(cx, cy);
  for (const mod of ['Meta', 'Alt', 'Control']) {
    const before = (await vb())[2];
    await page.keyboard.down(mod);
    await page.mouse.wheel(0, -100);
    await page.keyboard.up(mod);
    await page.waitForTimeout(50);
    assert.ok((await vb())[2] < before, `${mod} + scroll zooms in`);
  }
  const sy = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 200); // plain scroll moves the story, not the zoom
  await page.waitForTimeout(100);
  assert.ok((await page.evaluate(() => scrollY)) > sy, 'plain scrolling scrolls the page');
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(100);
  const z1 = (await vb())[2];
  await page.mouse.dblclick(cx, cy);
  await page.waitForTimeout(50);
  assert.ok((await vb())[2] < z1, 'double-click zooms in');
  const before = await vb();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy - 60, { steps: 4 });
  await page.mouse.up();
  const after = await vb();
  assert.ok(after[0] > before[0] && after[1] > before[1], 'dragging pans');
  await page.locator('button[aria-label="Recenter on the story"]').click();
  await page.waitForTimeout(800);
  assert.ok(Math.abs((await vb())[2] - w0) < 2, 'recenter returns to the story camera');
  await page.close();
});

test('goroutine labels fit without clipping', async () => {
  const { page } = await openPage(browser);
  const clipped = new Set();
  for (const id of ['cbft--cbft-open', 'cbft--to-worker', 'scorch--built', 'persister--persisting', 'merger--merged', 'together--running', 'slowdisk--herder']) {
    await scrollToStep(page, id, 1.2, 700);
    for (const t of await page.evaluate(() => [...document.querySelectorAll('.glabel')].map((e) => e.textContent))) {
      if (t.includes('…')) clipped.add(t);
    }
  }
  assert.deepEqual([...clipped], []);
  await page.close();
});

test('goroutine labels never overlap mid-transition', async () => {
  const { page } = await openPage(browser);
  const n = await stepCount(page);
  let overlaps = 0;
  for (let i = 0; i < n; i++) {
    for (const p of [0.3, 0.5, 0.7]) {
      await scrollToStep(page, i, p, 20);
      overlaps += await page.evaluate(() => [...document.querySelectorAll('.gnode')].filter((g) =>
        [...g.querySelectorAll('.glabel')].filter((t) => Number(t.getAttribute('opacity') ?? 1) > 0.01).length > 1).length);
    }
  }
  assert.equal(overlaps, 0);
  await page.close();
});

test('contents: jumps straight to a chapter, settled', async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 400, height: 800 }]) {
    const { page, errors } = await openPage(browser, { viewport });
    await page.click('.toc-btn');
    assert.equal(await page.isVisible('.toc-panel'), true);
    await page.click('.toc-item:has-text("The merger")');
    await page.waitForFunction(() => window.bleveExplainer.steps[window.bleveExplainer.ctl.current].chapterId === 'merger');
    const s = await page.evaluate(() => window.bleveExplainer.scrollState());
    assert.equal(s.p, 1);
    assert.equal(await page.isVisible('.toc-panel'), false);
    assert.equal(await page.getAttribute('.toc-item.current', 'href'), '#merger--zoom');
    assert.deepEqual(errors, []);
    await page.close();
  }
});
