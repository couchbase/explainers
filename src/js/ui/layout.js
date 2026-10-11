// Geometry of the diagram canvas, with no DOM, so the build can
// validate narrative references (cameras, lids, anchors) against it.
//
// The canvas is one fixed drawing; the page shows a region of it (the
// camera). Frames show containment: KV is its own process, across a
// network hop; the cbft process contains the bleve library, whose
// scorch index has three goroutine panels; disk sits outside both.
// Lids cover frame and panel insides until the story opens them.
// Scorch's frame has a notch cut from its top-right corner, where
// bleve's analysis queue sits beside Scorch.Batch(): a utility that
// bleve offers its index implementations, not a layer above them.
// Detail bubbles pop out of a panel into the gutters on either side.

import { stairScene } from './stairs-scene.js';

export const CW = 1000; // main diagram width; gutters extend past 0 and CW
export const CH = 1660;
export const CANVAS = [-460, 0, 1460, 1660]; // x0, y0, x1, y1 incl. the left gutter

export const SECTIONS = {
  kv: { label: 'KV process', frame: [20, 20, 960, 132], color: 'kv' },
  cbft: { label: 'cbft process', frame: [20, 206, 960, 1112], color: 'cbft' },
  bleve: { label: 'bleve library', frame: [40, 498, 920, 800], color: 'bleve' },
  // notch: [x, y], the top-right corner beyond x and above y is cut away.
  scorch: { label: 'scorch index', frame: [60, 592, 880, 690], color: 'scorch', notch: [680, 692] },
  disk: { label: 'disk', frame: [50, 1350, 900, 292], color: 'disk' },
};

// Panels inside scorch that have their own lids.
export const PANELS = {
  introducer: { frame: [350, 702, 300, 100], parent: 'scorch' },
  persister: { frame: [80, 1052, 400, 200], parent: 'scorch' },
  merger: { frame: [520, 1052, 400, 200], parent: 'scorch' },
};

export const LIDS = {
  kv: { title: 'KV', sub: 'streams mutations over DCP', section: 'kv' },
  cbft: { title: 'cbft', sub: 'the search service process', section: 'cbft' },
  bleve: { title: 'bleve', sub: 'the indexing library, linked into cbft', section: 'bleve', parent: 'cbft' },
  scorch: { title: 'scorch', sub: "bleve's index: turns batches into segments", section: 'scorch', parent: 'bleve' },
  disk: { title: 'disk', sub: 'zap segment files and root.bolt', section: 'disk' },
  introducer: { title: 'introducer', sub: 'the one goroutine that swaps the root', panel: 'introducer', parent: 'scorch' },
  persister: { title: 'persister', sub: 'makes in-memory segments durable', panel: 'persister', parent: 'scorch' },
  merger: { title: 'merger', sub: 'compacts file segments', panel: 'merger', parent: 'scorch' },
};

// Detail bubbles: a box beside or below its panel, with a tail
// pointing at the panel.
export const BUBBLES = {
  analysis: { box: [960, 490, 350, 300], tail: [940, 640], parent: 'bleve', title: 'analysis: one field, through an analyzer' },
  persister: { box: [-440, 970, 420, 280], tail: [80, 1152], parent: 'persister', title: 'persisterLoop(), one cycle' },
  merger: { box: [500, 1276, 440, 300], tail: [720, 1252], parent: 'merger', title: 'mergeplan.Plan(): the tier staircase' },
};

// Named camera regions: [x0, y0, x1, y1] plus a "where am I" label.
export const CAMERAS = {
  overview: { rect: [0, 0, CW, CH], label: '', section: null },
  top: { rect: [80, 0, 920, 490], label: 'KV and cbft', section: 'cbft' },
  kv: { rect: [0, 0, 1000, 190], label: 'KV', section: 'kv' },
  cbft: { rect: [100, 190, 900, 480], label: 'cbft', section: 'cbft' },
  process: { rect: [0, 180, CW, 1340], label: 'the cbft process', section: 'cbft' },
  bleve: { rect: [20, 470, 980, 1320], label: 'bleve', section: 'bleve' },
  scorch: { rect: [40, 580, 960, 1300], label: 'scorch index', section: 'scorch' },
  scorchTop: { rect: [280, 480, 960, 830], label: 'bleve: Batch() and analysis', section: 'bleve' },
  analysisDetail: { rect: [290, 470, 1330, 810], label: 'bleve: analysis', section: 'bleve' },
  introducer: { rect: [300, 680, 700, 820], label: 'scorch: the introducer', section: 'scorch' },
  root: { rect: [60, 800, 940, 1062], label: 'scorch: the root snapshot', section: 'scorch' },
  swap: { rect: [60, 690, 950, 1062], label: 'scorch: swapping in a new root', section: 'scorch' },
  persister: { rect: [40, 840, 560, 1270], label: 'scorch: the persister', section: 'scorch' },
  persisterDisk: { rect: [40, 880, 660, 1550], label: 'scorch: the persister, down to disk', section: 'scorch' },
  persisterDetail: { rect: [-450, 960, 490, 1270], label: 'scorch: inside the persister', section: 'scorch' },
  merger: { rect: [440, 840, 960, 1270], label: 'scorch: the merger', section: 'scorch' },
  mergerDetail: { rect: [440, 820, 980, 1590], label: 'scorch: inside the merger', section: 'scorch' },
  lower: { rect: [20, 820, 980, 1652], label: 'scorch and disk', section: 'scorch' },
  disk: { rect: [30, 1320, 970, 1652], label: 'disk', section: 'disk' },
  diskDir: { rect: [30, 1350, 330, 1470], label: 'disk: the index directory', section: 'disk' },
};

// Named anchor points for story callouts and chart leaders. `needs`
// lists lids that must be open; `bubble` names a bubble that must show.
export const ANCHORS = {
  kvLid: { p: [26, 70], needs: [] },
  cbftLid: { p: [26, 400], needs: [] },
  bleveLid: { p: [46, 900], needs: ['cbft'] },
  scorchLid: { p: [66, 940], needs: ['cbft', 'bleve'] },
  diskLid: { p: [56, 1460], needs: [] },

  kv: { p: [390, 68], needs: ['kv'] },
  buffer: { p: [410, 129], needs: ['kv'] },
  bufferR: { p: [690, 129], needs: ['kv'] },
  network: { p: [130, 180], needs: [] },

  dcp: { p: [390, 253], needs: ['cbft'] },
  slot: { p: [488, 298], needs: ['cbft'] },
  workers: { p: [390, 361], needs: ['cbft'] },
  gate: { p: [140, 432], needs: ['cbft'] },
  memGaugeR: { p: [860, 446], needs: ['cbft'] },

  bleveNote: { p: [62, 548], needs: ['cbft', 'bleve'] },
  analysis: { p: [700, 640], needs: ['cbft', 'bleve'] },
  analysisDetail: { p: [970, 560], needs: ['cbft', 'bleve'], bubble: 'analysis' },
  batch: { p: [390, 637], needs: ['cbft', 'bleve', 'scorch'] },
  introducer: { p: [350, 752], needs: ['cbft', 'bleve', 'scorch'] },
  select: { p: [366, 752], needs: ['cbft', 'bleve', 'scorch', 'introducer'] },
  root: { p: [80, 927], needs: ['cbft', 'bleve', 'scorch'] },
  rootR: { p: [890, 927], needs: ['cbft', 'bleve', 'scorch'] },
  olderEpoch: { p: [901, 866], needs: ['cbft', 'bleve', 'scorch'] },
  rootEpoch: { p: [280, 857], needs: ['cbft', 'bleve', 'scorch'] },
  rootMem: { p: [90, 900], needs: ['cbft', 'bleve', 'scorch'] },
  olderRoots: { p: [896, 1020], needs: ['cbft', 'bleve', 'scorch'] },
  queries: { p: [600, 826], needs: ['cbft', 'bleve', 'scorch'] },
  persister: { p: [80, 1152], needs: ['cbft', 'bleve', 'scorch'] },
  persisterInside: { p: [96, 1132], needs: ['cbft', 'bleve', 'scorch', 'persister'] },
  persisterDetail: { p: [-440, 1060], needs: ['cbft', 'bleve', 'scorch', 'persister'], bubble: 'persister' },
  merger: { p: [520, 1152], needs: ['cbft', 'bleve', 'scorch'] },
  mergerInside: { p: [536, 1132], needs: ['cbft', 'bleve', 'scorch', 'merger'] },
  mergerDetail: { p: [500, 1350], needs: ['cbft', 'bleve', 'scorch', 'merger'], bubble: 'merger' },
  writes: { p: [270, 1286], needs: [] },
  ...stairAnchors(),

  disk: { p: [70, 1456], needs: ['disk'] },
  diskR: { p: [950, 1456], needs: ['disk'] },
  bolt: { p: [650, 1403], needs: ['disk'] },
  zombies: { p: [70, 1568], needs: ['disk'] },
  cleanup: { p: [70, 1612], needs: ['disk'] },
};

// Anchors whose position comes from the simulation: where our followed
// batch (or its segment, or its file) currently is.
export const DYNAMIC_ANCHORS = ['ourBatch', 'ourSeg', 'ourFile', 'deletedFile'];

export const CHART_IDS = ['dcpBuf', 'memUsed', 'segments', 'files'];
export const SECTION_COLORS = ['kv', 'cbft', 'bleve', 'scorch', 'disk', 'neutral'];
export const UI_MODES = ['minimal', 'full'];
export const TOKEN_MODES = ['auto', 'file', 'hide'];

// Anchors on the merger bubble's staircase, one per story phase.
function stairAnchors() {
  const out = {};
  const name = { stairs: 'stairs', files: 'stairFiles', over: 'stairOver', pick: 'stairPick', merged: 'stairMerged' };
  for (const ph of ['budget', 'files', 'over', 'pick', 'merged']) {
    for (const [k, p] of Object.entries(stairScene(BUBBLES.merger.box, ph).anchors)) {
      out[name[k]] = { p, needs: ['cbft', 'bleve', 'scorch', 'merger'], bubble: 'merger' };
    }
  }
  return out;
}

export function isAnchorVisible(id, open, bubbles, dynamicNeeds) {
  const a = ANCHORS[id];
  const needs = a ? a.needs : dynamicNeeds || [];
  if (!needs.every((n) => open.has(n))) return false;
  if (a && a.bubble && !bubbles.has(a.bubble)) return false;
  return true;
}

// Where our batch's marker rests at each stage of its trip.
export const STATIONS = {
  dcp: [372, 253], channel: [500, 298], worker: [372, 361], herder: [478, 432],
  analysis: [372, 637], built: [372, 637], introducing: [332, 752], persisting: [68, 1171], merging: [932, 1167],
  // our new file: written (by the persister's 'introduce' row), then
  // handed up the introduce arrow to the introducer.
  written: [68, 1205], fileIntroducing: [542, 787], // just under the 'merges' chip
};

// The boxes the batch marker must not cut through: [x, y, w, h]. When
// it's inside one (a cell in the root snapshot, a file in the
// directory), it leaves vertically; between boxes, it travels the gaps.
export const BOXES = {
  kvEngine: [390, 42, 220, 52],
  dcp: [390, 228, 220, 50],
  workers: [390, 310, 244, 78], // the stack, including the panels behind
  analysis: [700, 600, 240, 80],
  batch: [390, 612, 220, 50],
  introducer: [350, 702, 300, 100],
  root: [80, 842, 840, 194], // incl. the older sheets behind it
  persister: [80, 1052, 400, 200],
  merger: [520, 1052, 400, 200],
  directory: [60, 1362, 560, 172],
  bolt: [650, 1386, 280, 152],
};

// Gaps the marker can use to get around boxes: vertical (x) and
// horizontal (y) lines that run between them.
export const CORRIDOR_XS = [500, 68, 932, 372];
export const CORRIDOR_YS = [300, 490, 682, 822, 1030, 1340];
// How far outside a box the marker travels when it goes around it.
export const BOX_GAP = 10;
