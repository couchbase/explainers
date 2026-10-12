// Shared helpers for the browser tests.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// The page with every chapter, drafts included, when there is one;
// `shared` is the page as shared (ending at the narrative's `stop`).
export const shared = fileURLToPath(new URL('../dist/scorch-goroutines.html', import.meta.url));
const drafts = fileURLToPath(new URL('../dist/scorch-goroutines-drafts.html', import.meta.url));
export const file = existsSync(drafts) ? drafts : shared;

export async function launch() {
  assert.ok(existsSync(file), 'run `npm run build` first');
  return process.env.CHROME_PATH
    ? chromium.launch({ executablePath: process.env.CHROME_PATH })
    : chromium.launch({ channel: 'chrome' });
}

export const DESKTOP = { width: 1600, height: 1000 };

// Opens the page (optionally at #hash) and waits for the explainer to
// be ready. Collects page errors and console errors in `errors`.
export async function openPage(browser, { viewport = DESKTOP, scheme = 'light', hash = '', debug = true, page: which = file } = {}) {
  const page = await browser.newPage({ viewport, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + which + (debug ? '?debug=1' : '') + (hash ? '#' + hash : ''));
  await page.waitForFunction(() => window.bleveExplainer && window.bleveExplainer.ctl.current >= 0);
  return { page, errors };
}

// Scrolls so that step (index or element id) is at progress p of its
// transition; p > 1 is further into the step.
export async function scrollToStep(page, step, p = 1.2, settleMs = 150) {
  await page.evaluate(([step, p]) => {
    const i = typeof step === 'number' ? step : Number(document.getElementById(step).dataset.index);
    window.scrollTo(0, window.bleveExplainer.scrollYFor(i, p));
  }, [step, p]);
  if (settleMs) await page.waitForTimeout(settleMs);
}

export const viewBox = (page) =>
  page.evaluate(() => document.querySelector('.diagram').getAttribute('viewBox').split(' ').map(Number));

export const stepCount = (page) => page.evaluate(() => window.bleveExplainer.steps.length);
