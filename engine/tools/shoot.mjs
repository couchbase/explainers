// Screenshots of a built page, for reviewing an explainer by eye.
//
//   npm run shoot -- <page> [options] <step>[@p,p,...] ...
//
// <page> is a built page, e.g. blance/01-planning (dist/<page>.html), or
// a path to any .html file. Each <step> is a step's id, chapter--step.
// With no @p, the step is shown settled, as a deep link lands; with
// @p, at those points of its transition (0 to 1; a scrubbing step, up
// to 2: past its settling).
//
// Options:
//   --dark          dark color scheme
//   --phone         a phone's viewport, 390x844
//   --size WxH      any viewport (default 1500x900)
//   --strip N       per step, N moments from 0 to its settled end, on
//                   one sheet: to see what a step plays, in order
//   --end           the page's end, scrolled to the bottom
//   --out DIR       where to write them (default tmp/shots)
//
// It prints each file it writes, and any page errors.
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const opt = { dark: false, size: [1500, 900], strip: 0, end: false, out: 'tmp/shots' };
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dark') opt.dark = true;
  else if (a === '--phone') opt.size = [390, 844];
  else if (a === '--size') opt.size = args[++i].split('x').map(Number);
  else if (a === '--strip') opt.strip = Number(args[++i]);
  else if (a === '--end') opt.end = true;
  else if (a === '--out') opt.out = args[++i];
  else rest.push(a);
}
const [pageArg, ...specs] = rest;
if (!pageArg || (!specs.length && !opt.end)) {
  console.error('usage: npm run shoot -- <page> [--dark] [--phone] [--size WxH] [--strip N] [--end] [--out DIR] <step>[@p,...] ...');
  process.exit(2);
}
const file = resolve(pageArg.endsWith('.html') ? pageArg : join('dist', `${pageArg}.html`));
if (!existsSync(file)) { console.error(`no such page: ${file} (run npm run build?)`); process.exit(2); }
mkdirSync(opt.out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const [w, h] = opt.size;
const scheme = opt.dark ? 'dark' : 'light';
const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`file://${file}`);
await page.waitForFunction(() => window.explainer && window.explainer.ctl.current >= 0);
await page.waitForTimeout(800);

const tag = `${scheme}${opt.size.join('x') === '1500x900' ? '' : `-${w}x${h}`}`;
const name = (s) => s.replace(/[^a-z0-9.@-]+/gi, '_');

// Scrolls to step id at p (null: settled), and lets the page draw.
async function at(id, p) {
  const ok = await page.evaluate(([id, p]) => {
    const x = window.explainer;
    const i = x.steps.findIndex((s) => `${s.chapterId}--${s.id}` === id);
    if (i < 0) return false;
    const scrub = document.getElementById(id).classList.contains('step-scrub');
    window.scrollTo(0, x.scrollYFor(i, p ?? (scrub ? 1.5 : 1)) + 2);
    if (x.snap) x.snap();
    return true;
  }, [id, p]);
  if (!ok) throw new Error(`no step ${id}`);
  await page.waitForTimeout(350);
}

const wrote = (f) => console.log(f);
for (const spec of specs) {
  const [id, ps] = spec.split('@');
  if (opt.strip) {
    // N moments of the step, on one sheet
    const scrub = await page.evaluate((id) => document.getElementById(id)?.classList.contains('step-scrub'), id);
    const end = scrub ? 1.5 : 1;
    const shots = [];
    for (let k = 0; k < opt.strip; k++) {
      const p = (end * k) / Math.max(1, opt.strip - 1);
      await at(id, p);
      shots.push({ p, png: (await page.screenshot()).toString('base64') });
    }
    const sheet = await browser.newPage({ viewport: { width: 1600, height: 100 } });
    const cols = Math.min(4, shots.length);
    await sheet.setContent(`<body style="margin:0;background:#888;font:12px monospace">
      <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;padding:4px">
      ${shots.map((s) => `<figure style="margin:0;background:#fff"><img style="width:100%;display:block" src="data:image/png;base64,${s.png}"><figcaption style="padding:2px 4px">${id} p=${s.p.toFixed(2)}</figcaption></figure>`).join('')}
      </div></body>`);
    const f = join(opt.out, `${tag}-${name(id)}-strip.png`);
    await sheet.screenshot({ path: f, fullPage: true });
    await sheet.close();
    wrote(f);
    continue;
  }
  for (const p of ps ? ps.split(',').map(Number) : [null]) {
    await at(id, p);
    const f = join(opt.out, `${tag}-${name(id)}${p === null ? '' : `@${p}`}.png`);
    await page.screenshot({ path: f });
    wrote(f);
  }
}
if (opt.end) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  const f = join(opt.out, `${tag}-end.png`);
  await page.screenshot({ path: f });
  wrote(f);
}
if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
await browser.close();
