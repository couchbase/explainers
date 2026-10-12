// The zap-format explainer's story vocabulary, for the engine. There's
// no simulation: a step's state is where the reader is (its `focus`),
// which says what's highlighted, where the reader marker sits, and
// which bytes it reads. The bytes read so far stay lit on the strip.
// Facts about the example segment, for `expect`, are checked against
// the real data by the tests.

import { SEG, REGIONS, LENSES } from './layout.js';
import { SCENE } from './scene.js';

// No simulation: no makeModel, so narratives have no `sim` directives.
export const TRACE_STAGES = [];
export const FOLLOW_MODES = [];
export const applyConfig = () => {};
export const makeConfig = () => ({});

const cellPt = (c) => [c.x - 12, c.y + c.h / 2];
const cellBox = (c) => [c.x, c.y, c.w, c.h];
const findCell = (cells, key) => cells.find((c) => c.key === key);

// Where the reader is, step by step: {lens, p (marker and callout
// point), read: [start, end) bytes read there, or null, box: what's
// highlighted, [x, y, w, h]}.
function foci() {
  const S = SCENE;
  const out = {};
  // (the reader, and the callout, sit just above the box)
  const add = (id, lens, p, read = null, box = null) => {
    const bx = box || [p[0] + 6, p[1] - 16, 60, 32];
    out[id] = { id, lens, p: [bx[0] + Math.min(bx[2] / 2, 30), bx[1] - 8], read, box: bx };
  };
  const addCell = (id, lens, c, read) => add(id, lens, cellPt(c), read, cellBox(c));
  // the strip itself
  for (const r of REGIONS) add(`region.${r.id}`, null, [r.x + 8, 70 + 26], null, [r.x, 70, r.w, 52]);
  // footer
  for (const c of S.footer.cells) if (c.size) addCell(`footer.${c.key}`, 'footer', c, [c.start, c.start + c.size]);
  // sections index and field info
  for (const c of S.sections.head) addCell(`sections.${c.key}`, 'sections', c, [c.start, c.start + c.size]);
  for (const inf of S.sections.infos) {
    const last = inf.cells[inf.cells.length - 1];
    add(`info.${inf.key}`, 'sections', cellPt(inf.cells[0]), [inf.start, inf.end], [inf.cells[0].x, inf.cells[0].y, last.x + last.w - inf.cells[0].x, last.h]);
    const text = inf.cells.find((c) => c.type === 0);
    add(`info.${inf.key}.text`, 'sections', [text.x + text.w + 12, text.y + text.h / 2], null, cellBox(text));
  }
  // description's record
  for (const c of S.record.cells) addCell(`record.${c.key}`, 'record', c, [S.record.start, S.record.end]);
  // city's FST (an illustration: nothing is read for the query)
  const root = S.fst.trie[0], [lx, ly, lw, lh] = LENSES.fst.box;
  for (const k of ['trie', 'min', 'outputs']) add(`fst.${k}`, 'fst', [root.x - 26, root.y], null, [lx + 20, ly + 50, lw - 40, lh - 70]);
  // the walk for "quiet": only the states on its path are read, out of
  // the FST's bytes; the strip lights the FST as a whole, faintly
  S.walk.steps.forEach((s, i) => add(`walk.${i}`, 'walk', [s.x - 34, s.y], [S.walk.fstStart, S.walk.fstStart + S.walk.fstLen], [s.x - 24, s.y - 24, 48, 48]));
  const lastW = S.walk.steps[S.walk.steps.length - 1];
  add('walk.value', 'walk', [lastW.x - 70, lastW.y + 72], null, [lastW.x - 316, lastW.y + 54, 330, 36]);
  // postings
  const P = S.postings;
  const hb = P.header[0], he = P.header[2];
  add('postings.header', 'postings', cellPt(hb), [P.start, P.bitmapStart], [hb.x, hb.y, he.x + he.w - hb.x, hb.h]);
  addCell('postings.bitmap', 'postings', findCell(P.header, 'bitmap'), [P.bitmapStart, P.bitmapEnd]);
  const chipsBox = [P.docs[0].x - 4, P.docs[0].y - 18, 9 * 50, 36];
  add('postings.docs', 'postings', [P.docs[0].x - 14, P.docs[0].y], null, chipsBox);
  add('postings.deleted', 'postings', [P.docs[2].x - 14, P.deletedY], null, [P.docs[2].x - 18, P.deletedY - 14, 210, 28]);
  add('postings.live', 'postings', [P.docs[0].x - 14, P.docs[0].y], null, chipsBox);
  // freq/norm
  const F = S.freq;
  add('freq.chunk', 'freq', [F.head.x - 12, F.head.y], [F.start, F.end], [F.head.x - 4, F.head.y - 16, 460, 26]);
  for (const r of F.rows) add(`freq.${r.key}`, 'freq', [r.x - 12, r.y], null, [r.x - 4, r.y - 16, 460, 26]);
  // AND
  const A = S.and;
  const hotel = A.hotel;
  const rowBox = (r) => [r.chips[0].x - 4, r.chips[0].y - 18, 9 * 50, 36];
  add('and.quiet', 'and', [A.rows[0].chips[0].x - 14, A.rows[0].chips[0].y], null, rowBox(A.rows[0]));
  add('and.hotel', 'and', [A.rows[1].chips[0].x - 14, A.rows[1].chips[0].y], [hotel.postingsStart, hotel.bitmapStart + hotel.bitmapLen], rowBox(A.rows[1]));
  add('and.result', 'and', [A.rows[2].chips[0].x - 14, A.rows[2].chips[0].y], null, rowBox(A.rows[2]));
  // stored fields
  const T = S.stored;
  addCell('stored.index', 'stored', T.index[0], [T.idx.start, T.idx.start + T.idx.size]);
  const r0 = T.rec[0], rl = T.rec[T.rec.length - 1];
  add('stored.record', 'stored', cellPt(r0), null, [r0.x, r0.y, rl.x + rl.w - r0.x, r0.h]);
  addCell('stored.id', 'stored', findCell(T.rec, 'id'), [T.start, T.end - SEG.stored[0].snappyLen]);
  addCell('stored.snappy', 'stored', findCell(T.rec, 'snappy'), [T.end - SEG.stored[0].snappyLen, T.end]);
  add('stored.fields', 'stored', [T.fields[0].x - 14, T.fields[0].y - 4], null, [T.fields[0].x - 6, T.fields[0].y - 18, 340, 70]);
  return out;
}
export const FOCI = foci();

// The bytes read up to and including step i's focus.
export function readsUpTo(views, i) {
  const out = [];
  for (let j = 0; j <= i; j++) {
    const f = views[j].focus && FOCI[views[j].focus];
    if (f && f.read && !out.some((r) => r[0] === f.read[0] && r[1] === f.read[1])) out.push(f.read);
  }
  return out;
}

export const VIEW_KEYS = {
  // where the reader is; carried over, and each move counts as the
  // step's one change
  focus: { values: Object.keys(FOCI), sticky: true, initial: null, counts: () => true },
};

// ---- facts, for `expect: ["fact:<name>=<value>"]` ----

const desc = SEG.fields.find((f) => f.name === 'description');
const term = (t) => desc.terms.find((x) => x.term === t);
const footer = (n) => SEG.footer.find((f) => f.name === n).value;
export const FACTS = {
  'file.size': SEG.size,
  'docs': SEG.docs.length,
  'fields': SEG.fields.map((f) => f.name).join(','),
  'footer.bytes': SEG.size - SEG.footer[0].start,
  'footer.version': footer('version'),
  'footer.numDocs': footer('numDocs'),
  'footer.storedIndexOffset': footer('storedIndexOffset'),
  'footer.sectionsIndexOffset': footer('sectionsIndexOffset'),
  'footer.chunkMode': footer('chunkMode'),
  'sections.nf': SEG.sectionsIndex.nf,
  'sections.perField': SEG.fields[0].sections.length,
  'description.dictOffset': desc.dictOffset,
  'description.fstLen': desc.fstLen,
  'description.terms': desc.terms.length,
  'description.fstStates': desc.fstStates.length,
  'city.terms': SEG.fields.find((f) => f.name === 'city').terms.length,
  'city.trieNodes': SCENE.fst.nodes,
  'city.fstStates': SCENE.fst.states,
  'quiet.value': SCENE.walk.value,
  'quaint.value': term('quaint').value,
  'quiet.docs': term('quiet').docs.join(','),
  'quiet.bitmapLen': term('quiet').bitmapLen,
  'quiet.chunks': term('quiet').numChunks,
  'hotel.docs': term('hotel').docs.join(','),
  'deleted': SEG.deleted.join(','),
  'deleted.id': SEG.deleted.map((d) => SEG.docs[d].id).join(','),
  'quiet.live': SCENE.and.rows[0].chips.filter((c) => c.on).map((c) => c.doc).join(','),
  'and.result': SCENE.and.result.join(','),
  'doc0.fieldLen': term('quiet').hits[0].fieldLen,
  'doc1.fieldLen': term('quiet').hits[1].fieldLen,
  'stored0.id': SEG.stored[0].id,
  'stored0.idLen': SEG.stored[0].idLen,
  'stored0.snappyLen': SEG.stored[0].snappyLen,
  'stored0.metaLen': SEG.stored[0].metaLen,
};

export const EXPECTATIONS = {};
export const EXPECTATION_PARAMS = {
  fact: {
    valid: (arg) => /^[\w.]+=.+$/.test(arg) && arg.split('=')[0] in FACTS,
    check: (_m, arg) => {
      const [k, v] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
      return String(FACTS[k]) === v;
    },
  },
};

// For the tests: what `expect` is checked against, with no simulation.
export const factModel = () => ({ reached: () => false });

// ---- what the diagram shows at step i (pure, so tests can check it) ----

const ORDER = Object.keys(FOCI);
const seen = (views, i, id) => views.slice(0, i + 1).some((v) => v.focus === id);
export function sceneAt(views, i) {
  if (i < 0) return null;
  const v = views[i];
  const focus = v.focus;
  const fstStage = seen(views, i, 'fst.outputs') ? 2 : seen(views, i, 'fst.min') ? 1 : 0;
  const walkK = Math.max(-1, ...[0, 1, 2, 3, 4, 5].filter((k) => seen(views, i, `walk.${k}`)));
  return {
    focus,
    reads: readsUpTo(views, i),
    fstStage,
    fstOutputs: fstStage >= 2,
    walkK,
    walkValue: seen(views, i, 'walk.value'),
    deletedShown: seen(views, i, 'postings.deleted'),
    liveShown: seen(views, i, 'postings.live'),
    andStage: seen(views, i, 'and.result') ? 3 : seen(views, i, 'and.hotel') ? 2 : seen(views, i, 'and.quiet') ? 1 : 0,
    storedStage: seen(views, i, 'stored.fields') ? 4 : seen(views, i, 'stored.snappy') ? 3 : seen(views, i, 'stored.id') ? 2 : seen(views, i, 'stored.record') ? 1 : 0,
    order: focus ? ORDER.indexOf(focus) : -1,
  };
}

// ---- callout anchors: every focus point, plus each lens ----

export const ANCHORS = {
  ...Object.fromEntries(Object.values(FOCI).map((f) => [f.id, {
    p: f.p, needs: f.lens ? [LENSES[f.lens].region] : [], ...(f.lens ? { bubble: f.lens } : {}),
  }])),
  ...Object.fromEntries(Object.entries(LENSES).map(([id, l]) => [`lens.${id}`, {
    p: [l.box[0], l.box[1] + 20], needs: [l.region], bubble: id,
  }])),
};
export const DYNAMIC_ANCHORS = ['reader'];
