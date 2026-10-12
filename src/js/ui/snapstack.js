// The stack of live root snapshots, with no DOM. The current root is
// the front sheet; older snapshots that someone still holds a ref on
// (the persister, the merger, a query) sit behind it, offset down and
// to the right, newest first. Snapshots aren't linked to each other in
// scorch: each is its own refcounted list of segments, so the stack is
// just "every live snapshot, ordered by epoch".

export const SHEET_DX = 10;
export const SHEET_DY = 8;
export const MAX_BACK = 3; // older sheets drawn behind the front one
export const READERS = ['persister', 'merger', 'query'];

// What the stack holds for a model: epochs, front first, and which
// epoch the persister, the merger and the (first) query each hold a
// ref on, or null.
export function stackOf(m) {
  const older = [...m.liveSnapshots].filter((s) => s !== m.root).map((s) => s.epoch).sort((a, b) => b - a);
  return {
    epochs: [m.root.epoch, ...older],
    persister: m.persisterSnapshot ? m.persisterSnapshot.epoch : null,
    merger: m.mergerSnapshot ? m.mergerSnapshot.epoch : null,
    query: m.queries.size ? [...m.queries.values()][0].epoch : null,
  };
}

const lerp = (a, b, q) => a + (b - a) * q;

// Where things are partway (q) from stack A to stack B. A snapshot
// that stays live slides from its old depth to its new one: when the
// introducer swaps in a new root, a still-held old root slides back
// out from behind the front sheet. Freed snapshots fade where they
// were. Returns {sheets: [{epoch, k, o}] back to front, readers}.
export function stackFrame(A, B, q) {
  const ka = new Map(A.epochs.map((e, i) => [e, i]));
  const kb = new Map(B.epochs.map((e, i) => [e, i]));
  const vis = (k) => (k <= MAX_BACK ? 1 : 0);
  const sheets = [];
  for (const e of new Set([...A.epochs, ...B.epochs])) {
    const a = ka.get(e), b = kb.get(e);
    let k, o;
    if (a !== undefined && b !== undefined) { k = lerp(a, b, q); o = lerp(vis(a), vis(b), q); } else if (a !== undefined) { k = a; o = vis(a) * (1 - q); } else { k = b; o = vis(b) * q; }
    k = Math.min(k, MAX_BACK);
    if (k > 0.001 && o > 0.001) sheets.push({ epoch: e, k, o });
  }
  sheets.sort((x, y) => y.k - x.k);

  const readers = {};
  for (const who of READERS) {
    const ea = A[who], eb = B[who];
    const depth = (S, e) => Math.min(Math.max(0, S.epochs.indexOf(e)), MAX_BACK);
    if (ea !== null && eb !== null) {
      readers[who] = { k: lerp(depth(A, ea), depth(B, eb), q), o: 1, epoch: q < 0.5 ? ea : eb };
    } else if (ea !== null) {
      readers[who] = { k: depth(A, ea), o: 1 - q, epoch: ea };
    } else if (eb !== null) {
      readers[who] = { k: depth(B, eb), o: q, epoch: eb };
    } else {
      readers[who] = { k: 0, o: 0, epoch: null };
    }
  }
  return { sheets, readers };
}

export const stackKey = (S) => `${S.epochs.join(',')}|${S.persister}|${S.merger}|${S.query}`;

// How the introducer swaps in a new root, one change at a time, in the
// order introduceSegment() and introduceMerge() do it. A story can stop
// at any phase (view `swap: <phase>`); otherwise a swap plays every
// phase within one step's scroll.
//   cover:  a new, empty root (dashed, see-through) over the old one
//   peel:   it lifts off the stack, up and to the left
//   copy:   it gets a copy of the old root's segment list (and epoch)
//   add:    the new segment goes in
//   drop:   segments it replaces drop out
//   epoch:  just before the swap, it gets the next epoch
//   solid:  it's swapped in: now it's the root
//   settle: the whole stack shifts back, the new root in front
export const SWAP_PHASES = ['cover', 'peel', 'copy', 'add', 'drop', 'epoch', 'solid', 'settle'];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// How far through phase `name` a swap at s (0..SWAP_PHASES.length) is.
export const swapPart = (s, name) => clamp01(s - SWAP_PHASES.indexOf(name));

// Where the new root sits, in sheets (negative: lifted up and left).
export const swapLift = (s) => easeQuad(swapPart(s, 'settle')) - easeQuad(swapPart(s, 'peel'));
export const swapShift = (s) => [SHEET_DX * swapLift(s), SHEET_DY * swapLift(s)];

// How the persister's commit shows, one change at a time (view
// `commit: <phase>`): a new root.bolt record slides in on top; our zap
// file, now listed, turns solid; the persister lets go of its root;
// and the newly persisted epoch wakes the merger.
export const COMMIT_PHASES = ['bolt', 'listed', 'release', 'wake'];

// The marker's share of the 'add' phase: it travels, then the segment
// it carries appears.
export const ADD_TRAVEL = 0.55;
export const swapTravel = (s) => clamp01(swapPart(s, 'add') / ADD_TRAVEL);
