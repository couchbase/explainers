// The zap-format explainer's diagram geometry, with no DOM, so the
// build can validate narrative references (cameras, lids, anchors)
// against it. Positions come from the example segment (segment.json,
// built by tools/zap-golden with the real zapx), so the regions and
// the structures in the lenses sit where the real bytes do.
//
// The picture: across the top, the file as one strip of bytes, its
// regions in file order. Lids cover each region until the story opens
// it. Below, lenses (the engine's bubbles) open onto the structures
// inside a region, each tethered to its byte range on the strip.

import SEG from './segment.json' with { type: 'json' };

export { SEG };

export const CANVAS = [0, 0, 2200, 1320];

// ---- the strip ----

export const STRIP = { x0: 40, x1: 2160, y: 70, h: 52 };

const REGION_LABELS = {
  storedData: 'stored fields',
  storedIndex: 'stored index',
  nestedEdges: 'nested docs',
  sectionBodies: 'sections: postings, FSTs, doc values',
  sectionsInfo: 'field info',
  sectionsIndex: 'sections index',
  footer: 'footer',
};

// Region widths: each gets a minimum, plus a share by the square root
// of its size, so a 1-byte region shows and a 4KB one doesn't swamp it.
function regionGeometry() {
  const min = 110;
  const free = STRIP.x1 - STRIP.x0 - min * SEG.regions.length;
  const total = SEG.regions.reduce((a, r) => a + Math.sqrt(r.end - r.start), 0);
  let x = STRIP.x0;
  return SEG.regions.map((r) => {
    const w = min + free * Math.sqrt(r.end - r.start) / total;
    const g = { ...r, x, w, label: REGION_LABELS[r.id], bytes: r.end - r.start };
    x += w;
    return g;
  });
}
export const REGIONS = regionGeometry();
export const regionOf = (id) => REGIONS.find((r) => r.id === id);

// Where byte offset `off` sits on the strip (linear within its region).
export function byteX(off) {
  const r = REGIONS.find((g) => off >= g.start && off < g.end) || REGIONS[REGIONS.length - 1];
  return r.x + (r.w * (Math.min(off, r.end) - r.start)) / Math.max(1, r.bytes);
}

// ---- the lenses: [x, y, w, h], each over a region ----

export const LENSES = {
  stored: { box: [40, 200, 430, 330], region: 'storedData', title: 'stored fields, doc 0' },
  record: { box: [490, 200, 450, 170], region: 'sectionBodies', title: 'description: its inverted-index record' },
  sections: { box: [960, 200, 540, 330], region: 'sectionsIndex', title: 'the sections index, and each field\'s info' },
  footer: { box: [1520, 200, 640, 200], region: 'footer', title: 'the footer: 40 bytes, read first' },
  fst: { box: [40, 600, 900, 470], region: 'sectionBodies', title: 'city\'s term dictionary: a vellum FST' },
  walk: { box: [960, 600, 1200, 230], region: 'sectionBodies', title: 'looking up "quiet" in description\'s FST' },
  postings: { box: [960, 860, 540, 230], region: 'sectionBodies', title: '"quiet": its postings list' },
  freq: { box: [1520, 860, 640, 230], region: 'sectionBodies', title: '"quiet": freq/norm, chunked' },
  and: { box: [960, 1120, 1200, 170], region: 'sectionBodies', title: 'quiet AND hotel' },
};

// ---- the engine's names ----

export const SECTIONS = {};
export const PANELS = {};

export const LIDS = Object.fromEntries(REGIONS.map((r) => [r.id, { title: r.label }]));

// Bubbles are the lenses; each needs its region's lid open.
export const BUBBLES = Object.fromEntries(Object.entries(LENSES).map(([id, l]) => [id, { box: l.box, parent: l.region, title: l.title }]));

// A lens's camera: the lens, and for those just under the strip, the
// strip too (lower lenses frame just themselves).
const lensCam = (id, pad = 30) => {
  const [x, y, w, h] = LENSES[id].box;
  return [x - pad, y < 400 ? STRIP.y - 40 : y - pad, x + w + pad, y + h + pad];
};
export const CAMERAS = {
  overview: { rect: CANVAS, label: '', section: null },
  file: { rect: [0, 0, 2200, 260], label: 'the file', section: null },
  ...Object.fromEntries(Object.keys(LENSES).map((id) => [id, { rect: lensCam(id), label: LENSES[id].title, section: null }])),
  lower: { rect: [940, 560, 2180, 1310], label: 'postings, scoring, AND', section: null },
};

export const SECTION_COLORS = ['file', 'dict', 'postings', 'stored', 'neutral'];
export const CHART_IDS = [];
export const TOKEN_MODES = ['auto', 'hide'];

// ---- the reader marker, and routing ----

export const STATIONS = {};
export const BOXES = {};
export const CORRIDOR_XS = [];
export const CORRIDOR_YS = [160, 570];
export const BOX_GAP = 10;
