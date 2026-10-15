// Showcase pictures: for each explainer whose narrative lists
// `showcase` scenes, a thumbnail of each, in light and dark, for the
// index pages. A scene with `play` is a short looping clip.
//
//   npm run showcase [-- <filter>]
//
// It shoots the built pages (dist/, so run npm run build first), with
// Chrome, like npm run shoot: each scene's step with the story column,
// toolbar and callouts hidden, settled; or, with `play: [from, to]`,
// at FRAMES points of the step's scroll from `from` to `to` (0 to 1,
// and a long step's settling, to 2). A scene's `rect` (in the
// diagram's own units, [x, y, width, height]) is what's kept; without
// one, the diagram's view, right of the story column.
//
// Each picture is a sprite: its frames stacked top to bottom in one
// JPEG (a still has one), which the index plays with CSS. They go to
// topics/<topic>/<explainer>/showcase/: <n>-light.jpg, <n>-dark.jpg and
// <n>.json (frames, and a frame's size), to commit; the build copies
// them into dist/. Rerun it when a showcased scene changes.
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, listExplainers, loadExplainer } from '../build/explainers.mjs';

const filter = process.argv[2] || '';
const explainers = listExplainers().map(loadExplainer).filter((e) => e.narrative.showcase && e.id.includes(filter));
if (!explainers.length) { console.log(`no explainer with a showcase${filter ? ` matching "${filter}"` : ''}`); process.exit(0); }

// what's hidden in a picture: all but the diagram
const HIDE = '.story, .overlay, .toolbar, .zoom, .draft-corner, .charts, .target-ring { visibility: hidden !important; }';
const VIEWPORT = { width: 1500, height: 900 };
// a clip's frames, and a frame's width at most (a thumbnail's, 1.6 times over)
const FRAMES = 20, WIDTH = 420;

const browser = await chromium.launch({ channel: 'chrome' });
let failed = false;
for (const e of explainers) {
  const file = join(ROOT, 'dist', e.topic, `${e.name}.html`);
  if (!existsSync(file)) { console.error(`${e.id}: no ${file} (run npm run build)`); failed = true; continue; }
  const dir = join(ROOT, 'topics', e.topic, e.name, 'showcase');
  mkdirSync(dir, { recursive: true });
  // (pictures of scenes no longer listed go)
  for (const f of readdirSync(dir)) if (/^\d+[-.]/.test(f) && parseInt(f) > e.narrative.showcase.length) rmSync(join(dir, f));
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: VIEWPORT, colorScheme: scheme });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`file://${file}`);
    await page.waitForFunction(() => window.explainer && window.explainer.ctl.current >= 0);
    await page.addStyleTag({ content: HIDE });
    for (const [n, scene] of e.narrative.showcase.entries()) {
      const at = (p) => page.evaluate(([id, p]) => {
        const x = window.explainer;
        const i = x.steps.findIndex((s) => `${s.chapterId}--${s.id}` === id);
        if (i < 0) return false;
        const scrub = document.getElementById(id).classList.contains('step-scrub');
        window.scrollTo(0, x.scrollYFor(i, p ?? (scrub ? 1.5 : 1)) + 2);
        if (x.snap) x.snap();
        return true;
      }, [scene.step, p]);
      if (!(await at(null))) { console.error(`${e.id}: no step ${scene.step}`); failed = true; continue; }
      await page.waitForTimeout(900);
      // what to keep, on screen: the rect, through the diagram's camera
      // (where the step settles); or the diagram's view
      const clip = await page.evaluate((rect) => {
        const vw = innerWidth, vh = innerHeight;
        if (!rect) {
          const left = document.querySelector('.story').getBoundingClientRect().right + 24;
          const top = document.querySelector('.toolbar').getBoundingClientRect().bottom + 12;
          return { x: left, y: top, width: vw - left - 16, height: vh - top - 16 };
        }
        const m = document.querySelector('svg.diagram').getScreenCTM();
        const pt = (x, y) => new DOMPoint(x, y).matrixTransform(m);
        const a = pt(rect[0], rect[1]), b = pt(rect[0] + rect[2], rect[1] + rect[3]);
        const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y));
        return { x, y, width: Math.min(vw, Math.max(a.x, b.x)) - x, height: Math.min(vh, Math.max(a.y, b.y)) - y };
      }, scene.rect || null);
      // the frames: settled, or across the scene's range
      const ps = scene.play ? Array.from({ length: FRAMES }, (_, k) => scene.play[0] + ((scene.play[1] - scene.play[0]) * k) / (FRAMES - 1)) : [null];
      const frames = [];
      for (const p of ps) {
        if (p !== null) { await at(p); await page.waitForTimeout(120); }
        frames.push((await page.screenshot({ clip, type: 'png' })).toString('base64'));
      }
      // stacked into one sprite, each frame scaled to WIDTH at most
      const scale = Math.min(1, WIDTH / clip.width), w = Math.round(clip.width * scale), h = Math.round(clip.height * scale);
      const sprite = await spriteOf(frames, w, h);
      writeFileSync(join(dir, `${n + 1}-${scheme}.jpg`), sprite);
      writeFileSync(join(dir, `${n + 1}.json`), JSON.stringify({ frames: frames.length, width: w, height: h }) + '\n');
      console.log(`${e.id}: showcase ${n + 1} (${scheme}): ${frames.length} frame(s) of ${w}x${h}, ${(sprite.length / 1024).toFixed(0)}KB`);
    }
    if (errors.length) { console.error(`${e.id} (${scheme}): page errors:\n  ${errors.join('\n  ')}`); failed = true; }
    await page.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);

// Frames (base64 PNGs) stacked top to bottom, as one JPEG.
async function spriteOf(frames, w, h) {
  const page = await browser.newPage();
  const data = await page.evaluate(async ([frames, w, h]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h * frames.length;
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    for (const [k, f] of frames.entries()) {
      const img = new Image();
      img.src = `data:image/png;base64,${f}`;
      await img.decode();
      g.drawImage(img, 0, k * h, w, h);
    }
    return canvas.toDataURL('image/jpeg', 0.72).split(',')[1];
  }, [frames, w, h]);
  await page.close();
  return Buffer.from(data, 'base64');
}
