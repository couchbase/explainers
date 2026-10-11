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
