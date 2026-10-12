// Shared helpers for the browser tests.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// An explainer's built pages ('<topic>/<name>'): `shared`, the page as
// shared (ending at the narrative's `stop`), and `file`, the one with
// every chapter, drafts included, when there is one.
export function builtPage(id) {
  const shared = fileURLToPath(new URL(`../../dist/${id}.html`, import.meta.url));
  const drafts = fileURLToPath(new URL(`../../dist/${id}-drafts.html`, import.meta.url));
  assert.ok(existsSync(shared), 'run `npm run build` first');
  return { shared, file: existsSync(drafts) ? drafts : shared };
}

export async function launch() {
  return process.env.CHROME_PATH
    ? chromium.launch({ executablePath: process.env.CHROME_PATH })
    : chromium.launch({ channel: 'chrome' });
}

export const DESKTOP = { width: 1600, height: 1000 };

// Opens the page (optionally at #hash) and waits for the explainer to
// be ready. Collects page errors and console errors in `errors`.
export async function openPage(browser, { viewport = DESKTOP, scheme = 'light', hash = '', debug = true, page: which } = {}) {
  const page = await browser.newPage({ viewport, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + which + (debug ? '?debug=1' : '') + (hash ? '#' + hash : ''));
  await page.waitForFunction(() => window.explainer && window.explainer.ctl.current >= 0);
  return { page, errors };
}

// Scrolls so that step (index or element id) is at progress p of its
// transition; p > 1 is further into the step.
export async function scrollToStep(page, step, p = 1.2, settleMs = 150) {
  await page.evaluate(([step, p]) => {
    const i = typeof step === 'number' ? step : Number(document.getElementById(step).dataset.index);
    window.scrollTo(0, window.explainer.scrollYFor(i, p));
  }, [step, p]);
  if (settleMs) await page.waitForTimeout(settleMs);
}

export const viewBox = (page) =>
  page.evaluate(() => document.querySelector('.diagram').getAttribute('viewBox').split(' ').map(Number));

export const stepCount = (page) => page.evaluate(() => window.explainer.steps.length);
