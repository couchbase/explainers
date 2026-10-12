// The tier staircase in the merger's detail bubble, as data with no
// DOM: what to draw for each phase of the story's walk through
// mergeplan.Plan(), so the page can scrub between phases and the build
// can check the narrative's anchors against it.
//
// The x axis is files sorted biggest first, as Plan() sorts them. Bar
// heights are log scale. The budget is drawn as a staircase of empty
// slots, one per file the budget allows: the biggest tier on the left,
// stepping down to the floor tier on the right. Files past the last
// stair are over budget.

import { plan, DefaultMergePlanOptions } from '../sim/mergeplan.js';
import { fmtBytes } from '../sim/fmt.js';
import { MB } from '../sim/config.js';

// The phases the story steps through (view.plan), and 'live', which
// shows the running simulation's own files.
export const PLAN_PHASES = ['live', 'budget', 'files', 'over', 'pick', 'merged'];

// An illustrative index: a few big files from earlier merges, then the
// small fresh ones the persister keeps writing. Sizes in MB.
const EXAMPLE_MB = [420, 310, 190, 140, 90, 48, 26, 22, 21, 20, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3];
export const EXAMPLE_OPTS = { floorSegmentFileSize: 20 * MB }; // as cbft sets it

const PITCH = 17, BAR = 12, MAX_COLS = 21;
const H = 170; // plot height for 4GB

// Geometry inside the bubble box [x, y, w, h].
function stairFrame(box) {
  const [x, y, w, h] = box;
  return { x0: x + 20, base: y + h - 46, right: x + w - 16, status: [x + 18, y + 50], caption: [x + 18, y + h - 22] };
}

export function barH(bytes) {
  const mb = Math.max(1, bytes / MB);
  return Math.max(3, Math.min(1, Math.log2(mb) / 12) * H);
}

// The budget's tiers, as CalcBudget() walks them: [{size, count}],
// smallest tier first. The counts add up to the budget.
function budgetTiers(totalSize, firstTierSize, o) {
  let tierSize = Math.max(1, firstTierSize);
  const tiers = [];
  while (totalSize > 0) {
    const n = totalSize / tierSize;
    if (n < o.maxSegmentsPerTier) { tiers.push({ size: tierSize, count: Math.ceil(n) }); break; }
    tiers.push({ size: tierSize, count: o.maxSegmentsPerTier });
    totalSize -= o.maxSegmentsPerTier * tierSize;
    tierSize = Math.floor(tierSize * o.tierGrowth);
  }
  return tiers;
}

// Files as Plan() sees them: {id, fullSize, liveSize, fileSize, liveFileSize}.
export function exampleFiles() {
  return EXAMPLE_MB.map((mb, i) => ({ id: `ex${i}`, fullSize: mb * 1000, liveSize: mb * 1000, fileSize: mb * MB, liveFileSize: mb * MB }));
}

// The plan and budget for a set of files, as Plan() computes them,
// plus the staircase. Only file-size budgets are drawn (cbft's case).
export function planOf(files, opts) {
  const o = { ...DefaultMergePlanOptions, ...opts };
  const sorted = [...files].sort((a, b) => b.liveFileSize - a.liveFileSize);
  const eligible = sorted.filter((x) => x.liveSize < o.maxSegmentSize / 2);
  const total = eligible.reduce((s, x) => s + x.liveFileSize, 0);
  const minSize = sorted.length ? sorted[sorted.length - 1].liveFileSize : 0;
  const tiers = budgetTiers(total, Math.max(minSize, o.floorSegmentFileSize || 1), o);
  const pl = plan(files, o);
  return { sorted, total, tiers, budget: pl.budget, tasks: pl.tasks, o };
}

// Tier sizes read better round: 20MB, 200MB, 1.95GB.
export function sizeLabel(bytes) {
  const mb = bytes / MB;
  return mb < 1000 ? `${Math.round(mb)}MB` : `${+(mb / 1024).toFixed(2)}GB`;
}

const colX = (f, i) => f.x0 + i * PITCH;

// Items: {key, kind: 'bar'|'slot'|'hl'|'line'|'text', x, y, w, h, o, cls, s}.
function staircase(f, tiers, keyPrefix) {
  const items = [];
  let i = 0;
  for (const t of [...tiers].reverse()) {
    for (let j = 0; j < t.count; j++, i++) {
      const h = barH(t.size);
      items.push({ key: `${keyPrefix}slot${i}`, kind: 'slot', x: colX(f, i) - 2, y: f.base - h, w: BAR + 4, h, o: 1 });
    }
  }
  return { items, end: colX(f, i) - 2 };
}

function tierLines(f, o) {
  const floor = o.floorSegmentFileSize || 20 * MB;
  return [0, 1, 2].map((i) => {
    const bytes = floor * Math.pow(o.tierGrowth, i);
    const y = f.base - barH(bytes);
    return [
      { key: `tier${i}`, kind: 'line', x: f.x0 - 6, y, w: f.right - f.x0 + 6, h: 0, o: 1 },
      { key: `tierT${i}`, kind: 'text', x: f.right, y: y - 3, o: 1, s: sizeLabel(bytes), cls: 'back-note', anchor: 'end' },
    ];
  }).flat();
}

function bars(f, sorted, keyPrefix) {
  return sorted.slice(0, MAX_COLS).map((file, i) => {
    const h = barH(file.liveFileSize);
    return { key: `${keyPrefix}${file.id}`, kind: 'bar', x: colX(f, i), y: f.base - h, w: BAR, h, o: 1, file };
  });
}

const text = (key, [x, y], s, cls = 'back-note') => ({ key, kind: 'text', x, y, o: 1, s, cls });

// The scene for one phase of the example, or for the live model's
// files (phase 'live', with `live` = {files, opts, merging}).
export function stairScene(box, phase, live) {
  const f = stairFrame(box);
  if (phase === 'live') return liveScene(f, live);
  const P = planOf(exampleFiles(), EXAMPLE_OPTS);
  const items = [...tierLines(f, P.o)];
  const st = staircase(f, P.tiers, 'ex');
  items.push(...st.items);
  const tierDesc = P.tiers.map((t) => `${t.count} × ${sizeLabel(t.size)}`).reverse().join(' + ');
  const anchors = { stairs: [colX(f, 0) - 2, f.base - barH(P.tiers[P.tiers.length - 1].size)] };

  if (phase === 'budget') {
    items.push(text('status-budget', f.status, `${fmtBytes(P.total)} live → budget ${P.budget}: ${tierDesc}`));
    items.push(text('cap-budget', f.caption, 'dashed: the budget, one stair per file it allows'));
    return { items, anchors };
  }
  const bs = bars(f, P.sorted, 'ex');
  anchors.files = [bs[0].x, bs[0].y];
  const over = bs.slice(P.budget);
  anchors.over = over.length ? [over[0].x, over[0].y - 6] : anchors.files;
  const task = P.tasks[0].segments;
  const picked = bs.filter((b) => task.includes(b.file));
  const pickedBytes = task.reduce((s, x) => s + x.liveFileSize, 0);
  anchors.pick = [picked[0].x - 3, picked[0].y - 4];

  if (phase === 'merged') {
    // The picked files slide together into one new file, which takes
    // its place in the sorted order.
    const merged = { id: 'merged', fullSize: pickedBytes / MB * 1000, liveSize: pickedBytes / MB * 1000, fileSize: pickedBytes, liveFileSize: pickedBytes };
    const after = [...P.sorted.filter((x) => !task.includes(x)), merged].sort((a, b) => b.liveFileSize - a.liveFileSize);
    const nb = bars(f, after, 'ex');
    const m = nb.find((b) => b.file === merged);
    for (const b of picked) items.push({ ...b, x: m.x, y: f.base - b.h, o: 0 });
    items.push(...nb);
    anchors.merged = [m.x - 3, m.y - 4];
    items.push(text('status-merged', f.status, `${after.length} files on a budget of ${P.budget}: within budget`));
    items.push(text('cap-merged', f.caption, `new file: ${sizeLabel(pickedBytes)}, one tier up`));
    return { items, anchors };
  }
  items.push(...bs);
  if (phase === 'files') {
    items.push(text('status-files', f.status, `${bs.length} files, biggest first`));
    items.push(text('cap-files', f.caption, 'file segments by live size (log scale)'));
  } else if (phase === 'over') {
    for (const b of over) items.push({ key: `hl-over-${b.key}`, kind: 'hl', x: b.x - 2, y: b.y - 2, w: BAR + 4, h: b.h + 2, o: 1, cls: 'stair-over' });
    items.push({ key: 'budgetEnd', kind: 'line', x: st.end, y: f.base - 150, w: 0, h: 150, o: 1, cls: 'stair-end' });
    items.push(text('status-over', f.status, `${bs.length} files on a budget of ${P.budget}: ${over.length} over`));
    items.push(text('cap-over', f.caption, 'past the last stair: over budget, so merge'));
  } else if (phase === 'pick') {
    const x0 = picked[0].x - 4, x1 = picked[picked.length - 1].x + BAR + 4;
    const top = Math.min(...picked.map((b) => b.y)) - 4;
    items.push({ key: 'hl-pick', kind: 'hl', x: x0, y: top, w: x1 - x0, h: f.base - top + 4, o: 1, cls: 'stair-pick' });
    items.push(text('status-pick', f.status, `best-scoring run: ${picked.length} files, ${sizeLabel(pickedBytes)} → 1 file`));
    items.push(text('cap-pick', f.caption, 'similar sizes score best; deletes help too'));
  }
  return { items, anchors };
}

function liveScene(f, live) {
  if (!live || !live.files.length) {
    return { items: [text('status-live-none', f.status, 'no file segments yet')], anchors: {} };
  }
  const P = planOf(live.files, live.opts);
  const items = [...tierLines(f, P.o), ...staircase(f, P.tiers, 'live').items];
  const bs = bars(f, P.sorted, 'live');
  items.push(...bs);
  for (const b of bs) {
    if (live.merging.has(b.file.id)) items.push({ key: `hl-m-${b.key}`, kind: 'hl', x: b.x - 2, y: b.y - 2, w: BAR + 4, h: b.h + 2, o: 1, cls: 'stair-pick' });
  }
  const more = P.sorted.length > MAX_COLS ? ` (${MAX_COLS} shown)` : '';
  const verdict = P.sorted.length > P.budget ? `${P.tasks.length} merge task(s)` : 'within budget';
  items.push(text('status-live', f.status, `ours: ${P.sorted.length} files${more}, budget ${P.budget}: ${verdict}`));
  items.push(text('cap-live', f.caption, 'outlined: being merged'));
  return { items, anchors: { live: [bs[0].x, bs[0].y] } };
}
