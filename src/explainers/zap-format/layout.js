// The zap-format explainer's diagram geometry, with no DOM, so the
// build can validate narrative references (cameras, lids, anchors)
// against it. Positions come from the example segment (segment.json,
// built by tools/zap-golden with the real zapx), so the regions and
// the structures in the lenses sit where the real bytes do.
//
// The picture: down the left, the file as one column of bytes, offset
// 0 at the top, its regions in file order. Lids cover each region until
// the story opens it. To the right, lenses (the engine's bubbles) open
// onto the structures inside a region, each beside its region and
// tethered to it, so a lens's camera shows its bytes on the strip too.

import SEG from './segment.json' with { type: 'json' };

export { SEG };

// ---- the strip, and the lenses beside it ----

export const STRIP = { x0: 120, x1: 360, y0: 90 };
const LENS_X = 440;
const GAP = 40; // between lens rows, and between bands
const MIN_H = 60; // a region's least height

const REGION_LABELS = {
  storedData: 'stored fields',
  storedIndex: 'stored index',
  nestedEdges: 'nested docs',
  sectionBodies: 'sections: postings, FSTs, doc values',
  sectionsInfo: 'field info',
  sectionsIndex: 'sections index',
  footer: 'footer',
};

// Each lens's size, and the region it opens onto.
const LENS_DEFS = {
  stored: { size: [430, 330], region: 'storedData', title: 'stored fields, doc 0' },
  record: { size: [450, 170], region: 'sectionBodies', title: 'description: its inverted-index record' },
  fst: { size: [900, 470], region: 'sectionBodies', title: 'city\'s term dictionary: a vellum FST' },
  walk: { size: [1200, 230], region: 'sectionBodies', title: 'looking up "quiet" in description\'s FST' },
  postings: { size: [540, 230], region: 'sectionBodies', title: '"quiet": its postings list' },
  freq: { size: [640, 230], region: 'sectionBodies', title: '"quiet": freq/norm, chunked' },
  and: { size: [1200, 170], region: 'sectionBodies', title: 'quiet AND hotel' },
  sections: { size: [540, 330], region: 'sectionsIndex', title: 'the sections index, and each field\'s info' },
  footer: { size: [640, 200], region: 'footer', title: 'the footer: 40 bytes, read first' },
};

// Bands, top to bottom: some regions, and the lenses beside them, one
// per row. A band is as tall as its lenses (or its regions' least
// heights), and its regions share that height by the square root of
// their sizes, with a minimum, so a 1-byte region shows and a 4KB one
// doesn't swamp it. (Not to scale: the lenses set the heights.)
const BANDS = [
  { regions: ['storedData'], lenses: ['stored'] },
  { regions: ['storedIndex', 'nestedEdges'], lenses: [] },
  { regions: ['sectionBodies'], lenses: ['record', 'fst', 'walk', 'postings', 'freq', 'and'] },
  { regions: ['sectionsInfo', 'sectionsIndex'], lenses: ['sections'] },
  { regions: ['footer'], lenses: ['footer'] },
];

function geometry() {
  const regions = [], lenses = {};
  let y = STRIP.y0;
  for (const b of BANDS) {
    const rs = b.regions.map((id) => SEG.regions.find((r) => r.id === id));
    const lensH = b.lenses.reduce((a, id) => a + LENS_DEFS[id].size[1], 0) + Math.max(0, b.lenses.length - 1) * GAP;
    const h = Math.max(lensH + (b.lenses.length ? GAP : 0), MIN_H * rs.length);
    const free = h - MIN_H * rs.length;
    const total = rs.reduce((a, r) => a + Math.sqrt(r.end - r.start), 0);
    let ry = y;
    for (const r of rs) {
      const rh = MIN_H + free * Math.sqrt(r.end - r.start) / total;
      regions.push({ ...r, x: STRIP.x0, w: STRIP.x1 - STRIP.x0, y: ry, h: rh, label: REGION_LABELS[r.id], bytes: r.end - r.start });
      ry += rh;
    }
    let ly = y + GAP / 2;
    for (const id of b.lenses) {
      const { size: [w, lh], ...rest } = LENS_DEFS[id];
      lenses[id] = { ...rest, box: [LENS_X, ly, w, lh] };
      ly += lh + GAP;
    }
    y += h;
  }
  return { regions, lenses, y1: y };
}
const G = geometry();
export const REGIONS = G.regions;
export const LENSES = G.lenses;
STRIP.y1 = G.y1;
export const regionOf = (id) => REGIONS.find((r) => r.id === id);

export const CANVAS = [0, 0, LENS_X + 1200 + 40, STRIP.y1 + 60];

// Where byte offset `off` sits on the strip (linear within its region).
export function byteY(off) {
  const r = REGIONS.find((g) => off >= g.start && off < g.end) || REGIONS[REGIONS.length - 1];
  return r.y + (r.h * (Math.min(off, r.end) - r.start)) / Math.max(1, r.bytes);
}

// Where the reader marker runs between lenses: down the gap between
// the strip and the lenses.
export const LANE_X = LENS_X - 30;

// ---- the engine's names ----

export const SECTIONS = {};
export const PANELS = {};

export const LIDS = Object.fromEntries(REGIONS.map((r) => [r.id, { title: r.label }]));

// Bubbles are the lenses; each needs its region's lid open.
export const BUBBLES = Object.fromEntries(Object.entries(LENSES).map(([id, l]) => [id, { box: l.box, parent: l.region, title: l.title }]));

// A lens's camera: the lens, and the strip beside it.
const lensCam = (id, pad = 30) => {
  const [x, y, w, h] = LENSES[id].box;
  return [STRIP.x0 - 100, y - pad, x + w + pad, y + h + pad];
};
export const CAMERAS = {
  overview: { rect: CANVAS, label: '', section: null },
  // the whole file, top to bottom
  whole: { rect: [0, 20, STRIP.x1 + 120, STRIP.y1 + 20], label: 'the whole file', section: null },
  // the top of the file; the camera follows the story down it
  file: { rect: [0, 0, 900, 1300], label: 'the file', section: null },
  ...Object.fromEntries(Object.keys(LENSES).map((id) => [id, { rect: lensCam(id), label: LENSES[id].title, section: null }])),
};

export const SECTION_COLORS = ['file', 'dict', 'postings', 'stored', 'neutral'];
export const CHART_IDS = [];
export const TOKEN_MODES = ['auto', 'hide'];

// ---- the reader marker, and routing ----

export const STATIONS = {};
export const BOXES = {};
export const CORRIDOR_XS = [];
export const CORRIDOR_YS = [];
export const BOX_GAP = 10;
