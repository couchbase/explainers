// Geometry of the diagram canvas, with no DOM, so the build can
// validate narrative references (cameras, lids, anchors) against it.
//
// The canvas is one fixed drawing; the page shows a region of it (the
// camera). Frames show containment: KV is its own process, across a
// network hop; the cbft process contains the bleve library, whose
// scorch index has three goroutine panels; disk sits outside both.
// Lids cover frame and panel insides until the story opens them.
// Detail bubbles pop out of a panel into the gutters on either side.

export const CW = 1000; // main diagram width; gutters extend past 0 and CW
export const CH = 1560;
export const CANVAS = [-460, 0, 1460, 1560]; // x0, y0, x1, y1 incl. the left gutter

export const SECTIONS = {
  kv: { label: 'KV process', frame: [20, 20, 960, 132], color: 'kv' },
  cbft: { label: 'cbft process', frame: [20, 206, 960, 1012], color: 'cbft' },
  scorch: { label: 'bleve / scorch', frame: [40, 498, 920, 700], color: 'scorch' },
  disk: { label: 'disk', frame: [50, 1250, 900, 292], color: 'disk' },
};

// Panels inside scorch that have their own lids.
export const PANELS = {
  introducer: { frame: [350, 602, 300, 100], parent: 'scorch' },
  persister: { frame: [80, 952, 400, 200], parent: 'scorch' },
  merger: { frame: [520, 952, 400, 200], parent: 'scorch' },
};

export const LIDS = {
  kv: { title: 'KV', sub: 'streams mutations over DCP', section: 'kv' },
  cbft: { title: 'cbft', sub: 'the search service process', section: 'cbft' },
  scorch: { title: 'bleve / scorch', sub: 'the index library: turns batches into segments', section: 'scorch', parent: 'cbft' },
  disk: { title: 'disk', sub: 'zap segment files and root.bolt', section: 'disk' },
  introducer: { title: 'introducer', sub: 'the one goroutine that swaps the root', panel: 'introducer', parent: 'scorch' },
  persister: { title: 'persister', sub: 'makes in-memory segments durable', panel: 'persister', parent: 'scorch' },
  merger: { title: 'merger', sub: 'compacts file segments', panel: 'merger', parent: 'scorch' },
};

// Detail bubbles: a box beside or below its panel, with a tail
// pointing at the panel.
export const BUBBLES = {
  persister: { box: [-440, 870, 420, 280], tail: [80, 1052], parent: 'persister', title: 'persisterLoop(), one cycle' },
  merger: { box: [500, 1176, 440, 268], tail: [720, 1152], parent: 'merger', title: 'mergeplan.Plan(): the tier staircase' },
};

// Named camera regions: [x0, y0, x1, y1] plus a "where am I" label.
export const CAMERAS = {
  overview: { rect: [0, 0, CW, CH], label: '', section: null },
  top: { rect: [80, 0, 920, 490], label: 'KV and cbft', section: 'cbft' },
  kv: { rect: [0, 0, 1000, 190], label: 'KV', section: 'kv' },
  cbft: { rect: [100, 190, 900, 480], label: 'cbft', section: 'cbft' },
  process: { rect: [0, 180, CW, 1240], label: 'the cbft process', section: 'cbft' },
  scorch: { rect: [20, 490, 980, 1222], label: 'bleve / scorch', section: 'scorch' },
  scorchTop: { rect: [280, 500, 920, 740], label: 'scorch: Batch() and the introducer', section: 'scorch' },
  introducer: { rect: [300, 580, 700, 720], label: 'scorch: the introducer', section: 'scorch' },
  root: { rect: [60, 700, 940, 930], label: 'scorch: the root snapshot', section: 'scorch' },
  persister: { rect: [40, 740, 560, 1170], label: 'scorch: the persister', section: 'scorch' },
  persisterDetail: { rect: [-450, 860, 490, 1170], label: 'scorch: inside the persister', section: 'scorch' },
  merger: { rect: [440, 740, 960, 1170], label: 'scorch: the merger', section: 'scorch' },
  mergerDetail: { rect: [440, 770, 980, 1452], label: 'scorch: inside the merger', section: 'scorch' },
  lower: { rect: [20, 720, 980, 1552], label: 'scorch and disk', section: 'scorch' },
  disk: { rect: [30, 1220, 970, 1552], label: 'disk', section: 'disk' },
};

// Named anchor points for story callouts and chart leaders. `needs`
// lists lids that must be open; `bubble` names a bubble that must show.
export const ANCHORS = {
  kvLid: { p: [26, 70], needs: [] },
  cbftLid: { p: [26, 400], needs: [] },
  scorchLid: { p: [46, 820], needs: ['cbft'] },
  diskLid: { p: [56, 1360], needs: [] },

  kv: { p: [390, 68], needs: ['kv'] },
  buffer: { p: [410, 129], needs: ['kv'] },
  bufferR: { p: [690, 129], needs: ['kv'] },
  network: { p: [130, 180], needs: [] },

  dcp: { p: [390, 253], needs: ['cbft'] },
  slot: { p: [488, 298], needs: ['cbft'] },
  workers: { p: [390, 361], needs: ['cbft'] },
  gate: { p: [140, 432], needs: ['cbft'] },
  memGaugeR: { p: [860, 446], needs: ['cbft'] },

  batch: { p: [390, 545], needs: ['cbft', 'scorch'] },
  analysis: { p: [640, 545], needs: ['cbft', 'scorch'] },
  introducer: { p: [350, 652], needs: ['cbft', 'scorch'] },
  select: { p: [366, 652], needs: ['cbft', 'scorch', 'introducer'] },
  root: { p: [80, 827], needs: ['cbft', 'scorch'] },
  rootR: { p: [920, 827], needs: ['cbft', 'scorch'] },
  queries: { p: [680, 726], needs: ['cbft', 'scorch'] },
  persister: { p: [80, 1052], needs: ['cbft', 'scorch'] },
  persisterInside: { p: [96, 1032], needs: ['cbft', 'scorch', 'persister'] },
  persisterDetail: { p: [-440, 960], needs: ['cbft', 'scorch', 'persister'], bubble: 'persister' },
  merger: { p: [520, 1052], needs: ['cbft', 'scorch'] },
  mergerInside: { p: [536, 1032], needs: ['cbft', 'scorch', 'merger'] },
  mergerDetail: { p: [500, 1250], needs: ['cbft', 'scorch', 'merger'], bubble: 'merger' },
  writes: { p: [270, 1186], needs: [] },

  disk: { p: [70, 1356], needs: ['disk'] },
  diskR: { p: [950, 1356], needs: ['disk'] },
  bolt: { p: [650, 1303], needs: ['disk'] },
  zombies: { p: [70, 1468], needs: ['disk'] },
  cleanup: { p: [70, 1512], needs: ['disk'] },
};

// Anchors whose position comes from the simulation: where our followed
// batch (or its segment, or its file) currently is.
export const DYNAMIC_ANCHORS = ['ourBatch', 'ourSeg', 'ourFile', 'deletedFile'];

export const CHART_IDS = ['dcpBuf', 'memUsed', 'segments', 'files'];
export const SECTION_COLORS = ['kv', 'cbft', 'scorch', 'disk', 'neutral'];
export const UI_MODES = ['minimal', 'full'];
export const TOKEN_MODES = ['auto', 'file', 'hide'];

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
  analysis: [372, 545], introducing: [332, 652], persisting: [60, 1067], merging: [940, 1067],
};

// The boxes the batch marker must not cut through: [x, y, w, h]. When
// it's inside one (a cell in the root snapshot, a file in the
// directory), it leaves vertically; between boxes, it travels the gaps.
export const BOXES = {
  kvEngine: [390, 42, 220, 52],
  dcp: [390, 228, 220, 50],
  workers: [390, 310, 244, 78], // the stack, including the panels behind
  batch: [390, 520, 220, 50],
  analysis: [640, 520, 200, 50],
  introducer: [350, 602, 300, 100],
  root: [80, 742, 840, 170],
  persister: [80, 952, 400, 200],
  merger: [520, 952, 400, 200],
  directory: [60, 1262, 560, 172],
  bolt: [650, 1286, 280, 152],
};

// Gaps the marker can use to get around boxes: vertical (x) and
// horizontal (y) lines that run between them.
export const CORRIDOR_XS = [500, 60, 940, 372];
export const CORRIDOR_YS = [300, 490, 590, 722, 930, 1240];
// How far outside a box the marker travels when it goes around it.
export const BOX_GAP = 10;
