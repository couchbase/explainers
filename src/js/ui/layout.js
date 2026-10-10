// Geometry of the diagram canvas, with no DOM, so the build can
// validate narrative references (cameras, lids, anchors) against it.
//
// The canvas is one fixed drawing; the page shows a region of it (the
// camera). Sections have colored frames whose borders always stay
// visible; their insides start covered by lids. Three panels inside
// scorch have their own lids, and two of them can flip over to show a
// more detailed back side.

export const CW = 1000;
export const CH = 1560;

// Section frames: [x, y, w, h]. `color` is a CSS custom property.
export const SECTIONS = {
  kv: { label: 'KV', frame: [300, 20, 400, 150], color: 'kv' },
  cbft: { label: 'cbft', frame: [120, 206, 760, 262], color: 'cbft' },
  scorch: { label: 'scorch · bleve', frame: [30, 500, 940, 712], color: 'scorch' },
  disk: { label: 'disk', frame: [50, 1250, 900, 292], color: 'disk' },
};

// Panels inside scorch that have their own lids.
export const PANELS = {
  introducer: { frame: [350, 602, 300, 100], parent: 'scorch' },
  persister: { frame: [80, 952, 400, 200], parent: 'scorch', flippable: true },
  merger: { frame: [520, 952, 400, 200], parent: 'scorch', flippable: true },
};

export const LIDS = {
  kv: { title: 'KV', sub: 'streams mutations over DCP', section: 'kv' },
  cbft: { title: 'cbft', sub: 'turns DCP mutations into batches', section: 'cbft' },
  scorch: { title: 'scorch', sub: 'turns batches into searchable, durable segments', section: 'scorch' },
  disk: { title: 'disk', sub: 'zap segment files and root.bolt', section: 'disk' },
  introducer: { title: 'introducer', sub: 'the one goroutine that swaps the root', panel: 'introducer', parent: 'scorch' },
  persister: { title: 'persister', sub: 'makes in-memory segments durable', panel: 'persister', parent: 'scorch' },
  merger: { title: 'merger', sub: 'compacts file segments', panel: 'merger', parent: 'scorch' },
};

export const FLIPPABLE = Object.keys(PANELS).filter((k) => PANELS[k].flippable);

// Named camera regions: [x0, y0, x1, y1] plus a "where am I" label.
export const CAMERAS = {
  overview: { rect: [0, 0, CW, CH], label: 'the whole picture', section: null },
  top: { rect: [80, 0, 920, 490], label: 'KV and cbft', section: 'cbft' },
  kv: { rect: [260, 0, 740, 190], label: 'KV', section: 'kv' },
  cbft: { rect: [100, 190, 900, 480], label: 'cbft', section: 'cbft' },
  scorch: { rect: [20, 490, 980, 1222], label: 'scorch', section: 'scorch' },
  scorchTop: { rect: [280, 500, 920, 740], label: 'scorch: Batch() and the introducer', section: 'scorch' },
  introducer: { rect: [300, 580, 700, 720], label: 'scorch: the introducer', section: 'scorch' },
  root: { rect: [60, 700, 940, 930], label: 'scorch: the root snapshot', section: 'scorch' },
  persister: { rect: [40, 740, 560, 1170], label: 'scorch: the persister', section: 'scorch' },
  merger: { rect: [440, 740, 960, 1170], label: 'scorch: the merger', section: 'scorch' },
  lower: { rect: [20, 720, 980, 1552], label: 'scorch and disk', section: 'scorch' },
  disk: { rect: [30, 1220, 970, 1552], label: 'disk', section: 'disk' },
};

// Named anchor points for story callouts and chart leaders. `needs`
// lists lids that must be open for the anchor to be visible; `flipped`
// names a panel that must be flipped.
export const ANCHORS = {
  kvLid: { p: [306, 70], needs: [] },
  cbftLid: { p: [126, 300], needs: [] },
  scorchLid: { p: [36, 820], needs: [] },
  diskLid: { p: [56, 1360], needs: [] },

  kv: { p: [390, 68], needs: ['kv'] },
  buffer: { p: [410, 129], needs: ['kv'] },
  bufferR: { p: [690, 129], needs: ['kv'] },

  dcp: { p: [390, 253], needs: ['cbft'] },
  workers: { p: [390, 361], needs: ['cbft'] },
  gate: { p: [140, 432], needs: ['cbft'] },
  memGaugeR: { p: [860, 446], needs: ['cbft'] },

  batch: { p: [390, 545], needs: ['scorch'] },
  analysis: { p: [640, 545], needs: ['scorch'] },
  introducer: { p: [350, 652], needs: ['scorch'] },
  select: { p: [366, 652], needs: ['scorch', 'introducer'] },
  root: { p: [80, 827], needs: ['scorch'] },
  rootR: { p: [920, 827], needs: ['scorch'] },
  queries: { p: [680, 726], needs: ['scorch'] },
  persister: { p: [80, 1052], needs: ['scorch'] },
  persisterInside: { p: [96, 1032], needs: ['scorch', 'persister'] },
  persisterBack: { p: [96, 1000], needs: ['scorch', 'persister'], flipped: 'persister' },
  merger: { p: [520, 1052], needs: ['scorch'] },
  mergerInside: { p: [536, 1032], needs: ['scorch', 'merger'] },
  mergerBack: { p: [536, 1000], needs: ['scorch', 'merger'], flipped: 'merger' },
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

export function isAnchorVisible(id, open, flipped, dynamicNeeds) {
  const a = ANCHORS[id];
  const needs = a ? a.needs : dynamicNeeds || [];
  if (!needs.every((n) => open.has(n))) return false;
  if (a && a.flipped && !flipped.has(a.flipped)) return false;
  return true;
}
