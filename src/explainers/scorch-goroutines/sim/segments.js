// Segments and index snapshots, with the refcounting that decides when
// files can be closed (zapx Segment, scorch IndexSnapshot).

export const zapFileName = (id) => id.toString(16).padStart(12, '0') + '.zap';

// ---------------------------------------------------------------
// Segments and snapshots

export class Segment {
  constructor(m, { kind, docs, bytes, origin, sources }) {
    this.m = m;
    this.id = m.nextSegmentID++;
    this.kind = kind; // 'mem' (SegmentBase) | 'file' (mmapped zap Segment)
    this.docs = docs; // full doc count, Count()
    this.bytes = bytes; // in-memory bytes, or file bytes
    this.origin = origin; // 'batch' | 'persist' | 'memmerge' | 'filemerge'
    this.sources = sources || [];
    this.createdAt = m.k.now;
    this.refs = kind === 'file' ? 1 : 0; // zap OpenUsing starts refs at 1
    this.open = kind === 'file';
    this.fileName = kind === 'file' ? zapFileName(this.id) : null;
  }
  addRef() { if (this.kind === 'file') this.refs++; }
  decRef() {
    if (this.kind !== 'file') return; // SegmentBase: no-op, GC-managed
    this.refs--;
    if (this.refs === 0) this.m._closeFileSegment(this);
    if (this.refs < 0) throw new Error(`segment ${this.id} refs < 0`);
  }
}

// IndexSnapshot: an immutable list of {seg, deleted} with a refcount.
export class Snapshot {
  constructor(m, epoch, segs) {
    this.m = m;
    this.epoch = epoch;
    this.segs = segs; // [{seg, deleted}]
    this.refs = 1;
    this.createdAt = m.k.now;
    m.liveSnapshots.add(this);
  }
  addRef() {
    if (this.refs <= 0) throw new Error(`addRef on dead snapshot ${this.epoch}`);
    this.refs++;
    return this;
  }
  decRef() {
    this.refs--;
    if (this.refs < 0) throw new Error(`snapshot ${this.epoch} refs < 0`);
    if (this.refs === 0) {
      this.m.liveSnapshots.delete(this);
      for (const ss of this.segs) ss.seg.decRef();
      this.m._addEligibleForRemoval(this.epoch);
    }
  }
  liveDocs() { return this.segs.reduce((a, ss) => a + ss.seg.docs - ss.deleted, 0); }
}
