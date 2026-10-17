// The 02-compile explainer's geometry, with no DOM, so the build can
// check the narrative's references (anchors) against it.
//
// The picture: the plan (top left); a code panel (right): first the
// filter's source, which turns into intermed's version of it; then, in
// its place, the Go the compiler emits for the whole plan, which grows
// as the compiler walks the plan. Down the left: the kinds of line, the
// project's code waiting for a place, and both engines' rows.

import { pairs, SHOWN, GROUPS } from '../lib/compile.js';

export const FILTER = pairs('OpFilter');

export const CANVAS = [0, 0, 1000, 1330];

// the plan: three operators, top to bottom
export const PLAN = { x: 20, y: 78, w: 210, h: 58, gap: 14 };
export const planY = (k) => PLAN.y + k * (PLAN.h + PLAN.gap);

// the code panel, and a row's y in it
export const CODE = { x: 250, y: 30, w: 740, head: 30, top: 54, dy: 14.6, edy: 13.2 };
export const srcRowY = (i) => CODE.y + CODE.top + i * CODE.dy;
export const emitRowY = (i) => CODE.y + CODE.top + i * CODE.edy;
export const CHAR = { src: 10 * 0.6, emit: 9.5 * 0.6 };

// down the left: the kinds of line; the project's code, held; the rows
export const KEY = { x: 20, y: 330, dy: 22 };
export const HELD = { x: 20, y: 470, w: 210, h: 74 };
export const ROWS = { x: 20, y: 1000, w: 210, h: 210 };

// The emitted rows, with the filter's two holes where their code goes:
// each item, a row of SHOWN or a hole.
export const ITEMS = [];
for (const [k, r] of SHOWN.entries()) {
  const hole = r.group === 'expr' && /^_, _, _ =/.test(r.text) ? 'expr' : r.group === 'fuse' && /^lzValsOut := /.test(r.text) ? 'fuse' : null;
  if (hole) ITEMS.push({ hole });
  ITEMS.push({ row: k, ...r });
}
export const groupShown = (s, g) => GROUPS.indexOf(g) < s.emit;
// whether an item shows, in a state
export const itemOn = (s, it) => s.panel === 'emit' && (it.hole ? groupShown(s, 'filter') && !groupShown(s, it.hole) : groupShown(s, it.group));
// an item's slot (its place among those showing), in a state
export function slotOf(s, k) {
  let n = 0;
  for (let j = 0; j < k; j++) if (itemOn(s, ITEMS[j])) n++;
  return n;
}

// the camera, by state: the code just added, in view
export function cameraOf(s) {
  if (s.done) return [0, 0, 1000, 1330];
  if (s.rows) return [0, 640, 1000, 1310];
  if (s.panel !== 'emit' || s.emit < 3) return [0, 20, 1000, 690];
  const g = GROUPS[s.emit - 1];
  const ks = ITEMS.map((it, k) => k).filter((k) => !ITEMS[k].hole && ITEMS[k].group === g && /^(?!var )/.test(ITEMS[k].text));
  const y0 = emitRowY(slotOf(s, ks[0])), y1 = emitRowY(slotOf(s, ks[ks.length - 1]));
  const top = Math.max(0, Math.min(y0 - 160, y1 + 120 - 670));
  return [0, top, 1000, top + 670];
}

export const LIDS = {};
export const BUBBLES = {};
export const CAMERAS = {
  overview: { rect: [0, 20, 1000, 690], label: '', section: null },
};

export const ANCHORS = {
  plan: { p: [PLAN.x, PLAN.y - 22], needs: [] },
  'op.project': { p: [PLAN.x, planY(0) + 16], needs: [] },
  'op.filter': { p: [PLAN.x, planY(1) + 16], needs: [] },
  'op.scan': { p: [PLAN.x, planY(2) + 16], needs: [] },
  code: { p: [CODE.x, CODE.y + 18], needs: [] },
  key: { p: [KEY.x, KEY.y - 4], needs: [] },
  held: { p: [HELD.x, HELD.y + 18], needs: [] },
  rows: { p: [ROWS.x, ROWS.y + 18], needs: [] },
};
// callout ends the page works out: a source line, by kind; an emitted
// row, by what it says
export const DYNAMIC_ANCHORS = ['src.early', 'src.late', 'src.hide', 'src.captured', 'emit.lift', 'emit.hole', 'emit.expr', 'emit.fuse', 'emit.scan', 'emit.200', 'emit.yield'];

export const SECTION_COLORS = ['src', 'build', 'compile', 'out', 'neutral'];
