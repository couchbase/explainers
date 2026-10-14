// Shared helpers for the browser tests.

import assert from 'node:assert/strict';
import { existsSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// An explainer's built pages ('<topic>/<name>'): `shared`, the page as
// shared (ending at the narrative's `stop`), and `file`, the one with
// every chapter, drafts included, when there is one.
//
// They're read from a snapshot of dist/, taken once per test file, so a
// rebuild while the tests run (npm run dev's, say) can't change a page
// under a test, or hand it half of one.
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
let snap = null;
function distSnapshot() {
  if (!snap) {
    snap = mkdtempSync(join(tmpdir(), 'explainers-dist-'));
    cpSync(DIST, snap, { recursive: true });
    process.on('exit', () => rmSync(snap, { recursive: true, force: true }));
  }
  return snap;
}
export function builtPage(id) {
  assert.ok(existsSync(join(DIST, `${id}.html`)), 'run `npm run build` first');
  const shared = join(distSnapshot(), `${id}.html`);
  const drafts = join(distSnapshot(), `${id}-drafts.html`);
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
    // (no smoothing in tests: the page shows this scroll position now)
    if (window.explainer.snap) window.explainer.snap();
  }, [step, p]);
  if (settleMs) await page.waitForTimeout(settleMs);
}

export const viewBox = (page) =>
  page.evaluate(() => document.querySelector('.diagram').getAttribute('viewBox').split(' ').map(Number));

export const stepCount = (page) => page.evaluate(() => window.explainer.steps.length);
