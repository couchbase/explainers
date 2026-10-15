// Shared helpers for the browser tests.

import assert from 'node:assert/strict';
import { existsSync, cpSync, mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

// Launches Chrome. Its close() doesn't hang on a stray crash reporter.
//
// Chrome starts a crash reporter (chrome_crashpad_handler) that inherits
// Chrome's stderr, and now and then outlives Chrome, for minutes or
// for good. Playwright's close waits for Chrome's stdio to close, so
// then it never returns (the after hook times out, and the test file's
// process stays up, keeping the whole run waiting). So the browser is
// launched as a server, for its process: once Chrome itself has exited,
// close stops waiting on its stdio.
//
// (handleSIGTERM: false, so the test runner's SIGTERM, at a timeout,
// ends a test file's process rather than starting a close that may not
// finish.)
//
// (Now and then Chrome's launch itself never finishes, and Playwright
// waits 3 minutes for it: so each try gets 30s, and there are 3.)
export async function launch() {
  for (let tries = 1; ; tries++) {
    try {
      return await launchOnce();
    } catch (e) {
      if (tries >= 3) throw e;
    }
  }
}

async function launchOnce() {
  const server = await chromium.launchServer({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    handleSIGTERM: false,
    timeout: 30000,
  });
  let browser;
  try {
    browser = await chromium.connect(server.wsEndpoint(), { timeout: 30000 });
  } catch (e) {
    await server.kill().catch(() => {});
    throw e;
  }
  const disconnect = browser.close.bind(browser);
  let closing = null;
  browser.close = () => (closing ??= (async () => {
    await disconnect().catch(() => {});
    const proc = server.process();
    const closed = server.close();
    await exited(proc, 30000);
    // (kill() waits for the stdio, too)
    if (proc.exitCode === null && proc.signalCode === null) server.kill().catch(() => {});
    for (const s of proc.stdio) s?.destroy();
    await closed;
  })());
  return browser;
}

// Resolves when the process has exited (not waiting for its stdio), or
// after ms.
function exited(proc, ms) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    proc.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

export const DESKTOP = { width: 1600, height: 1000 };

// Opens the page (optionally at #hash) and waits for the explainer to
// be ready. Collects page errors and console errors in `errors`.
// The pages' web fonts (Google Fonts' stylesheets and font files), from
// a cache in tmp/font-cache, filled the first time they're fetched: so
// the tests see the real fonts (their text widths count) without the
// network, once they've run online. Offline with nothing cached, a
// stylesheet is empty, so its fonts aren't fetched (the text falls back
// to the pages' local fonts) and nothing fails or waits. (E2E_OFFLINE=1
// acts offline, to check that.)
const FONT_CACHE = fileURLToPath(new URL('../../tmp/font-cache/', import.meta.url));
async function useFontCache(page) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const url = route.request().url();
    const file = join(FONT_CACHE, createHash('sha1').update(url).digest('hex'));
    if (!process.env.E2E_OFFLINE && existsSync(file) && existsSync(`${file}.type`)) {
      return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': readFileSync(`${file}.type`, 'utf8'), 'access-control-allow-origin': '*' } });
    }
    try {
      if (process.env.E2E_OFFLINE) throw new Error('offline');
      const res = await route.fetch({ timeout: 10000 });
      const body = await res.body();
      if (res.ok()) {
        mkdirSync(FONT_CACHE, { recursive: true });
        // (written whole, then renamed: test files run at once)
        const tmp = `${file}.${process.pid}`;
        writeFileSync(tmp, body);
        writeFileSync(`${tmp}.type`, res.headers()['content-type'] || '');
        renameSync(`${tmp}.type`, `${file}.type`);
        renameSync(tmp, file);
      }
      return route.fulfill({ response: res, body });
    } catch {
      // (offline: an empty stylesheet asks for no font files)
      return route.fulfill({ status: 200, body: '', headers: { 'content-type': url.includes('googleapis') ? 'text/css' : 'font/woff2', 'access-control-allow-origin': '*' } });
    }
  });
}

export async function openPage(browser, { viewport = DESKTOP, scheme = 'light', hash = '', debug = true, page: which } = {}) {
  const page = await browser.newPage({ viewport, colorScheme: scheme });
  await useFontCache(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // (a busy machine can take a while for a first load: more than
  // Playwright's 30s, less than a test's 180)
  await page.goto('file://' + which + (debug ? '?debug=1' : '') + (hash ? '#' + hash : ''), { timeout: 90000 });
  await page.waitForFunction(() => window.explainer && window.explainer.ctl.current >= 0);
  return { page, errors };
}

// Scrolls so that step (index or element id) is at progress p of its
// transition; p > 1 is further into the step. Returns once the page has
// drawn a frame at that position (it draws in animation frames, which
// come late on a busy machine), and then settleMs more.
export async function scrollToStep(page, step, p = 1.2, settleMs = 150) {
  await page.evaluate(([step, p]) => {
    const i = typeof step === 'number' ? step : Number(document.getElementById(step).dataset.index);
    window.scrollTo(0, window.explainer.scrollYFor(i, p));
    // (no smoothing in tests: the page shows this scroll position now)
    if (window.explainer.snap) window.explainer.snap();
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, [step, p]);
  if (settleMs) await page.waitForTimeout(settleMs);
}

export const viewBox = (page) =>
  page.evaluate(() => document.querySelector('.diagram').getAttribute('viewBox').split(' ').map(Number));

export const stepCount = (page) => page.evaluate(() => window.explainer.steps.length);
