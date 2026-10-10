// A simulation of one cbft pindex: DCP feed -> cbft batch workers ->
// app herder -> scorch Batch() -> introducer / persister / merger, plus
// queries pinning snapshots. Each process mirrors a real goroutine; the
// comments name the Go functions they model so readers can cross-check
// (see content/coderefs.yaml for links).
//
// It is a model, not an emulator: doc ids aren't tracked, only counts,
// and costs are parameterized assumptions (see config.js). But the
// control flow, channel capacities, refcounting and the
// persister/merger/herder interplay follow the real code.

import { Kernel, Chan, Cond, Sem, WaitGroup } from './des.js';
import { plan as mergePlan } from './mergeplan.js';
import { makeConfig, applyConfig, MB } from './config.js';

export const zapFileName = (id) => id.toString(16).padStart(12, '0') + '.zap';

// ---------------------------------------------------------------
// Segments and snapshots

class Segment {
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
class Snapshot {
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

// ---------------------------------------------------------------

export class Model {
  constructor({ seed = 1, config } = {}) {
    this.cfg = makeConfig(config);
    this.k = new Kernel({ seed });
    this.seed = seed;
    this.nextSegmentID = 1;
    this.nextEpoch = 1;
    this.liveSnapshots = new Set();

    this.stats = {
      // scorch
      TotBatches: 0, TotBatchesEmpty: 0, TotIntroducedItems: 0, TotIntroducedSegmentsBatch: 0,
      TotIntroducedSegmentsMerge: 0, TotPersistedItems: 0, TotPersistedSegments: 0,
      TotPersistLoopBeg: 0, TotPersistLoopProgress: 0, TotPersistLoopWait: 0,
      TotPersisterNapPauseCompleted: 0, TotPersisterMergerNapBreak: 0,
      TotPersisterSlowMergerPause: 0, TotPersisterSlowMergerResume: 0,
      TotMemMergeDone: 0, TotMemMergeSegments: 0,
      TotFileMergePlan: 0, TotFileMergePlanNone: 0, TotFileMergePlanTasks: 0,
      TotFileMergeSegments: 0, TotFileMergeWrittenBytes: 0,
      TotFileMergeIntroductionsDone: 0, TotFileMergeIntroductionsObsoleted: 0,
      TotSnapshotsRemovedFromMetaStore: 0, TotFilesRemoved: 0,
      CurRootEpoch: 0, LastPersistedEpoch: 0, LastMergedEpoch: 0,
      MaxBatchIntroTime: 0, TotBatchIntroTime: 0,
      // cbft
      TotBatchesFlushedOnMaxOps: 0, TotBatchesFlushedOnTimer: 0, TotBatchesNew: 0,
      TotBatchesMerged: 0, NumBatchesIntroduced: 0, BatchBytesAdded: 0, BatchBytesRemoved: 0,
      TotHerderWaitingIn: 0, TotHerderWaitingOut: 0, TotHerderQueriesRejected: 0,
      // DCP
      TotDcpMutations: 0, TotDcpSnapshots: 0, DcpFlowControlPausedMs: 0,
      // queries
      TotQueries: 0, TotQueriesTimedOut: 0,
    };

    // Disk: zap files and root.bolt's snapshots (newest first).
    this.files = new Map(); // name -> {name, bytes, seg, createdAt}
    this.zombies = new Map(); // unlinked-but-open: name -> {bytes, seg}
    this.bolt = []; // [{epoch, time, files: Set<name>}]
    this.ineligibleForRemoval = new Set();
    this.eligibleForRemoval = [];
    this.diskActiveWriters = 0;

    // DCP and cbft state.
    this.dcpBufUsed = 0;
    this.kvPausedSince = null;
    this.dcpQueue = [];
    this.expectedLiveDocs = 0; // for the doc-conservation invariant
    this.pendingBatchBytes = 0; // BatchBytesAdded - BatchBytesRemoved
    this.analysisBytes = 0;
    this.inflightMemBytes = 0; // built segments not yet introduced
    this.numEventsBlocking = 0;
    this.queries = new Map();
    this.nextQueryId = 1;
    this.events = []; // recent notable events for the log
    this.series = []; // sampled time series
    this.flags = {}; // misc. scenario/visual flags

    this._buildProcs();
  }

  // ---- public API ----

  // Advances simulated time by ms.
  advance(ms) { this.k.runUntil(this.k.now + ms); }
  get now() { return this.k.now; }

  set(overrides) {
    applyConfig(this.cfg, overrides);
    this.log('config', `config: ${Object.entries(overrides).map(([k, v]) => `${k}=${fmtVal(v)}`).join(', ')}`);
    this.dcpSpace.broadcast();
    this.herderCond.broadcast();
  }

  // Starts a query that pins the current root snapshot.
  startQuery({ durationMs = 50, timeoutMs = 10000, label } = {}) {
    const id = this.nextQueryId++;
    const m = this;
    this.k.spawn(`query-${id}`, function* (p) { yield* m._queryProc(p, id, durationMs, timeoutMs, label); }, { group: 'query', queryId: id });
    return id;
  }

  log(kind, msg) {
    this.events.push({ t: this.k.now, kind, msg });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  // ---- memory and disk accounting ----

  // Approximates cbft.FetchCurMemoryUsed() for this process.
  memUsed() {
    return this.cfg.baseMemBytes + this.reachableMemSegBytes() + this.pendingBatchBytes +
      this.analysisBytes + this.inflightMemBytes + this.queries.size * this.cfg.queryMemBytes;
  }

  // In-memory segments are GC-managed: alive while any live snapshot
  // (root, a query's, the persister's or merger's) references them.
  reachableMemSegBytes() {
    const seen = new Set();
    let total = 0;
    for (const snap of this.liveSnapshots) {
      for (const ss of snap.segs) {
        if (ss.seg.kind === 'mem' && !seen.has(ss.seg)) {
          seen.add(ss.seg);
          total += ss.seg.bytes;
        }
      }
    }
    return total;
  }

  numFilesOnDisk() { return this.files.size + 1; } // +1 for root.bolt
  diskBytes() { let b = 0; for (const f of this.files.values()) b += f.bytes; return b; }
  zombieBytes() { let b = 0; for (const z of this.zombies.values()) b += z.bytes; return b; }

  // Mirrors index_bgthreads_active / the herder's scorchSize()==0 check.
  dcpPausedMs() {
    return this.stats.DcpFlowControlPausedMs + (this.kvPausedSince === null ? 0 : this.k.now - this.kvPausedSince);
  }

  bgThreadsActive() {
    const s = this.stats;
    return !(s.CurRootEpoch === s.LastPersistedEpoch && s.CurRootEpoch === s.LastMergedEpoch);
  }

  indexQuota() { return this.cfg.memQuotaBytes * this.cfg.memIndexingFraction; }
  overIndexQuota() { return this.memUsed() > this.indexQuota(); }

  // ---------------------------------------------------------------

  _buildProcs() {
    const m = this, k = this.k, cfg = this.cfg;

    // scorch channels (scorch.go Open)
    this.introductions = new Chan(k, 'introductions', 0);
    this.persists = new Chan(k, 'persists', 0);
    this.merges = new Chan(k, 'merges', 0);
    this.introducerNotifier = new Chan(k, 'introducerNotifier', 1);
    this.persisterNotifier = new Chan(k, 'persisterNotifier', 1);

    // cbft
    this.workerChs = [];
    for (let i = 0; i < cfg.numBatchWorkers; i++) this.workerChs.push(new Chan(k, `batchCh-${i}`, 1));
    this.dcpReady = new Cond(k, 'dcpReady');
    this.dcpSpace = new Cond(k, 'dcpSpace');
    this.herderCond = new Cond(k, 'herder.waitCond');
    this.analysisQueue = new Sem(k, 'analysisQueue', cfg.numCPUs);

    // Empty initial root, epoch 1 (as a freshly created index).
    this.root = new Snapshot(this, this.nextEpoch++, []);
    this.stats.CurRootEpoch = this.root.epoch;
    this.stats.LastPersistedEpoch = 0;
    this.stats.LastMergedEpoch = 0;

    k.spawn('kv', function* (p) { yield* m._kvProducer(p); }, { group: 'kv' });
    k.spawn('dcp', function* (p) { yield* m._dcpConsumer(p); }, { group: 'cbft' });
    for (let i = 0; i < cfg.numBatchWorkers; i++) {
      k.spawn(`batchWorker-${i}`, function* (p) { yield* m._batchWorker(p, i); }, { group: 'cbft', worker: i });
    }
    k.spawn('introducer', function* (p) { yield* m._introducerLoop(p); }, { group: 'scorch' });
    k.spawn('persister', function* (p) { yield* m._persisterLoop(p); }, { group: 'scorch' });
    k.spawn('merger', function* (p) { yield* m._mergerLoop(p); }, { group: 'scorch' });
    k.spawn('sampler', function* (p) { yield* m._sampler(p); }, { hidden: true });
    // cbft also wakes herder waiters when memory usage drops
    // (init_mem.go); model that as a periodic re-check.
    k.spawn('memChecker', function* () {
      for (;;) { yield k.sleep(250, 'memory check'); m._herderWake(); }
    }, { hidden: true });
  }

  // ---------------------------------------------------------------
  // KV + DCP

  // The KV engine's DCP producer: sends snapshots of mutations for
  // random vbuckets, subject to DCP flow control (buffer-ack).
  * _kvProducer(p) {
    const k = this.k;
    for (;;) {
      const rate = this.cfg.ingestDocsPerSec;
      if (rate <= 0) {
        yield k.sleep(100, 'idle: no mutations');
        continue;
      }
      const mean = Math.max(1, this.cfg.dcpSnapshotMeanDocs);
      const n = Math.max(1, Math.round(-Math.log(1 - k.rng()) * mean));
      const bytes = n * this.cfg.docBytes;
      if (this.dcpBufUsed + bytes > this.cfg.dcpBufferBytes && this.dcpBufUsed > 0) {
        this.kvPausedSince = k.now;
        this.log('dcp', `KV: DCP buffer full (${fmtBytes(this.dcpBufUsed)} unacked), pausing`);
        while (this.dcpBufUsed + bytes > this.cfg.dcpBufferBytes && this.dcpBufUsed > 0) {
          yield this.dcpSpace.wait('flow control: DCP buffer full, not acked');
        }
        this.stats.DcpFlowControlPausedMs += k.now - this.kvPausedSince;
        this.kvPausedSince = null;
      }
      this.dcpBufUsed += bytes;
      this.dcpQueue.push({ vb: Math.floor(k.rng() * this.cfg.numVBuckets), n, bytes });
      this.dcpReady.broadcast();
      yield k.work(n / rate * 1000, 'sending mutations');
    }
  }

  // gocbcore's DCP callback goroutine calling cbgt Dest ->
  // BleveDestPartition.DataUpdate / SnapshotStart (pindex_bleve.go).
  * _dcpConsumer(p) {
    const k = this.k;
    let batch = null;
    for (;;) {
      while (this.dcpQueue.length === 0) yield this.dcpReady.wait('waiting for DCP mutations');
      const snap = this.dcpQueue.shift();
      this.stats.TotDcpSnapshots++;
      // Within a snapshot: batch.Index() per doc, flush at maxOps;
      // flush at snapshot end (seq >= seqSnapEnd).
      let remaining = snap.n;
      while (remaining > 0) {
        if (!batch) batch = this._newBatch(snap.vb);
        const chunk = Math.min(remaining, Math.max(1, this.cfg.maxOpsPerBatch - batch.ops));
        // batch.Index fires EventKindIndexStart -> herder checkAndBlockIndex
        yield* this._herderBlock(p, 'IndexStart: over index quota');
        yield k.work(chunk * this.cfg.mapUsPerDoc / 1000, 'batch.Index: MapDocument');
        this._addToBatch(batch, chunk);
        remaining -= chunk;
        this.stats.TotDcpMutations += chunk;
        if (batch.ops >= this.cfg.maxOpsPerBatch) {
          yield* this._submitBatch(batch);
          batch = null;
        }
      }
      if (batch) {
        yield* this._submitBatch(batch);
        batch = null;
      }
      // Processed; ack the bytes (simplified: immediate buffer-ack).
      this.dcpBufUsed -= snap.bytes;
      this.dcpSpace.broadcast();
    }
  }

  _newBatch(vb) { return { vb, ops: 0, inserts: 0, updates: 0, deletes: 0, bytes: 0 }; }

  _addToBatch(batch, n) {
    const rng = this.k.rng;
    for (let i = 0; i < n; i++) {
      const r = rng();
      if (r < this.cfg.deleteFraction) batch.deletes++;
      else if (r < this.cfg.deleteFraction + this.cfg.updateFraction) batch.updates++;
      else batch.inserts++;
    }
    const bytes = (n - 0) * this.cfg.docBytes;
    batch.ops += n;
    batch.bytes += bytes;
    this.pendingBatchBytes += bytes;
    this.stats.BatchBytesAdded += bytes;
  }

  // submitAsyncBatchRequestLOCKED: send to worker vb % N; blocks while
  // that worker's capacity-1 channel is full.
  * _submitBatch(batch) {
    const ch = this.workerChs[batch.vb % this.workerChs.length];
    yield ch.send(batch, `${ch.name} <- batch (cap 1, worker busy)`);
  }

  // runBatchWorker: merge incoming batches, execute at maxOps or on the
  // flush ticker.
  * _batchWorker(p, i) {
    const k = this.k;
    const ch = this.workerChs[i];
    let target = null;
    let nextTick = k.now + this.cfg.batchFlushMs;
    for (;;) {
      const wait = Math.max(0, nextTick - k.now);
      const r = yield k.select([ch.recvCase(), k.timeoutCase(wait)], { label: 'waiting for batches / ticker' });
      if (r.index === 1) {
        nextTick = Math.max(nextTick + this.cfg.batchFlushMs, k.now + 1);
        if (target) {
          this.stats.TotBatchesFlushedOnTimer++;
          yield* this._execute(p, target);
          target = null;
        }
        continue;
      }
      const b = r.value;
      if (!target) {
        target = b;
        this.stats.TotBatchesNew++;
      } else {
        target.ops += b.ops; target.inserts += b.inserts; target.updates += b.updates;
        target.deletes += b.deletes; target.bytes += b.bytes;
        this.stats.TotBatchesMerged++;
      }
      if (target.ops >= this.cfg.maxOpsPerBatch) {
        this.stats.TotBatchesFlushedOnMaxOps++;
        yield* this._execute(p, target);
        target = null;
      }
    }
  }

  // execute(): bindex.Batch(batch), synchronously.
  * _execute(p, batch) {
    yield* this._scorchBatch(p, batch);
    this.pendingBatchBytes -= batch.bytes;
    this.stats.BatchBytesRemoved += batch.bytes;
    this.stats.NumBatchesIntroduced++;
  }

  // ---------------------------------------------------------------
  // cbft app herder (cmd/cbft/app_herder.go)

  * _herderBlock(p, label, isBatch) {
    if (!this.cfg.herderEnabled) return;
    // MB-29504: let batches through if everything's persisted+merged.
    if (isBatch && !this.bgThreadsActive()) return;
    if (!this.overIndexQuota()) return;
    this.numEventsBlocking++;
    while (this.overIndexQuota() && !(isBatch && !this.bgThreadsActive())) {
      this.stats.TotHerderWaitingIn++;
      yield this.herderCond.wait(`herder: ${label}`);
      this.stats.TotHerderWaitingOut++;
    }
    this.numEventsBlocking--;
  }

  _herderWake() { this.herderCond.broadcast(); }

  // ---------------------------------------------------------------
  // scorch Batch() (scorch.go)

  * _scorchBatch(p, batch) {
    const k = this.k, cfg = this.cfg;
    const t0 = k.now;
    // fireEvent(EventKindBatchIntroductionStart) -> herder checkAndBlockBatch
    yield* this._herderBlock(p, 'BatchIntroductionStart: over index quota', true);
    this.stats.TotBatches++;

    const numDocs = batch.inserts + batch.updates;
    let seg = null;
    if (numDocs > 0) {
      // Analysis fan-out onto the shared analysis queue (NumCPU workers).
      const abytes = numDocs * cfg.docBytes;
      this.analysisBytes += abytes;
      yield* this._analyze(p, numDocs);
      // NewUsing(): encode an in-memory zap segment.
      yield k.work(numDocs * cfg.buildUsPerDoc / 1000, 'NewUsing: building in-memory segment');
      this.analysisBytes -= abytes;
      seg = new Segment(this, { kind: 'mem', docs: numDocs, bytes: numDocs * cfg.memBytesPerDoc, origin: 'batch' });
      this.inflightMemBytes += seg.bytes;
    } else {
      this.stats.TotBatchesEmpty++;
    }
    // prepareSegment(): obsoletes computed against every root segment.
    const obsoleting = batch.updates + batch.deletes;
    if (obsoleting > 0) {
      yield k.work(this.root.segs.length * obsoleting * 0.0005, 'prepareSegment: computing obsoletes');
    }
    const intro = {
      seg, updates: batch.updates, deletes: batch.deletes, inserts: batch.inserts,
      applied: new Chan(k, 'applied', 0),
      persisted: cfg.unsafeBatch ? null : new Chan(k, 'persisted', 1),
    };
    yield this.introductions.send(intro, 'introductions <- segment');
    yield intro.applied.recv('waiting for introduction to be applied');
    if (seg) this.inflightMemBytes -= seg.bytes;
    if (intro.persisted) yield intro.persisted.recv('waiting for persistence (safe batch)');
    const dt = k.now - t0;
    this.stats.TotBatchIntroTime += dt;
    this.stats.MaxBatchIntroTime = Math.max(this.stats.MaxBatchIntroTime, dt);
  }

  * _analyze(p, numDocs) {
    const k = this.k, cfg = this.cfg;
    const n = Math.min(cfg.numCPUs, numDocs);
    const wg = new WaitGroup(k);
    const per = numDocs / n;
    const q = this.analysisQueue;
    for (let i = 0; i < n; i++) {
      wg.add(1);
      k.spawn(`analyze`, function* () {
        yield q.acquire('analysis queue full');
        yield k.work(per * cfg.analyzeUsPerDoc / 1000, 'analyzing');
        q.release();
        wg.done();
      }, { hidden: true });
    }
    yield wg.wait('waiting for analysis');
  }

  // ---------------------------------------------------------------
  // Introducer (introducer.go)

  * _introducerLoop(p) {
    const k = this.k;
    let watchers = [];
    for (;;) {
      const r = yield k.select([
        this.introducerNotifier.recvCase(),
        this.merges.recvCase(),
        this.introductions.recvCase(),
        this.persists.recvCase(),
      ], { label: 'select: introductions / persists / merges' });
      switch (r.index) {
        case 0: watchers.push(r.value); break;
        case 1: yield* this._introduceMerge(p, r.value); break;
        case 2: yield* this._introduceSegment(p, r.value); break;
        case 3: yield* this._introducePersist(p, r.value); break;
      }
      const epoch = this.root.epoch;
      const still = [];
      for (const w of watchers) {
        if (w.epoch < epoch) w.notifyCh.close();
        else still.push(w);
      }
      watchers = still;
    }
  }

  _swapRoot(next) {
    const prev = this.root;
    this.root = next;
    this.stats.CurRootEpoch = next.epoch;
    prev.decRef();
  }

  * _introduceSegment(p, intro) {
    const k = this.k;
    yield k.work(this.cfg.introduceMs + this.root.segs.length * 0.002, 'introduceSegment');
    // Obsolete older versions of updated/deleted docs, spread across
    // existing segments weighted by live docs (we don't track ids).
    const prevSegs = this.root.segs;
    const deltas = this._pickVictims(prevSegs, intro.updates + intro.deletes);
    const segs = [];
    prevSegs.forEach((ss, i) => {
      const deleted = ss.deleted + deltas[i];
      if (ss.seg.docs - deleted > 0) {
        ss.seg.addRef();
        segs.push({ seg: ss.seg, deleted });
      } else if (ss.seg.kind === 'file') {
        this.log('drop', `introducer: dropped fully-deleted ${ss.seg.fileName}`);
      }
    });
    if (intro.seg) {
      segs.push({ seg: intro.seg, deleted: 0 });
      this.stats.TotIntroducedSegmentsBatch++;
      this.stats.TotIntroducedItems += intro.seg.docs;
    }
    this.expectedLiveDocs += (intro.seg ? intro.seg.docs : 0) - deltas.reduce((a, b) => a + b, 0);
    const next = new Snapshot(this, this.nextEpoch++, segs);
    if (intro.persisted) (this.rootPersisted ||= []).push(intro.persisted);
    this._swapRoot(next);
    intro.applied.close();
  }

  _pickVictims(segs, n) {
    const deltas = segs.map(() => 0);
    if (n <= 0 || segs.length === 0) return deltas;
    const lives = segs.map((ss) => ss.seg.docs - ss.deleted);
    let total = lives.reduce((a, b) => a + b, 0);
    const rng = this.k.rng;
    // Split n proportionally, with a random remainder; cap at live.
    for (let i = 0; i < segs.length && total > 0; i++) {
      const want = n * lives[i] / total;
      let d = Math.floor(want) + (rng() < want - Math.floor(want) ? 1 : 0);
      d = Math.min(d, lives[i]);
      deltas[i] = d;
    }
    return deltas;
  }

  * _introducePersist(p, persist) {
    yield this.k.work(this.cfg.introduceMs, 'introducePersist');
    const segs = [];
    for (const ss of this.root.segs) {
      const f = persist.persisted.get(ss.seg.id);
      if (f) {
        segs.push({ seg: f, deleted: ss.deleted }); // takes the open ref
        persist.used.add(f);
      } else {
        ss.seg.addRef();
        segs.push({ seg: ss.seg, deleted: ss.deleted });
      }
    }
    this._swapRoot(new Snapshot(this, this.nextEpoch++, segs));
    persist.applied.close();
  }

  * _introduceMerge(p, merge) {
    yield this.k.work(this.cfg.introduceMs + this.root.segs.length * 0.002, 'introduceMerge');
    const segs = [];
    let newDeleted = 0;
    const seen = new Set();
    for (const ss of this.root.segs) {
      const old = merge.old.get(ss.seg.id);
      if (old) {
        // deletes that arrived while merging, remapped to the new segment
        newDeleted += ss.deleted - old.deleted;
        seen.add(ss.seg.id);
      } else {
        ss.seg.addRef();
        segs.push({ seg: ss.seg, deleted: ss.deleted });
      }
    }
    // Sources that left root mid-merge (fully deleted): all their docs
    // that were live at merge start are deleted in the output.
    for (const [id, old] of merge.old) {
      if (!seen.has(id)) newDeleted += old.seg.docs - old.deleted;
    }
    let introduced = false;
    if (merge.newSeg && merge.newSeg.docs > newDeleted) {
      segs.push({ seg: merge.newSeg, deleted: newDeleted });
      introduced = true;
    }
    this._swapRoot(new Snapshot(this, this.nextEpoch++, segs));
    if (merge.fileMerge) {
      if (introduced) this.stats.TotFileMergeIntroductionsDone++;
      else this.stats.TotFileMergeIntroductionsObsoleted++;
      this.stats.TotIntroducedSegmentsMerge++;
    }
    if (!introduced && merge.newSeg) merge.newSeg.decRef();
    merge.introduced = introduced;
    merge.notifyCh.close();
  }

  // ---------------------------------------------------------------
  // Persister (persister.go)

  * _persisterLoop(p) {
    const k = this.k;
    let watchers = [];
    let lastPersistedEpoch = 0, lastMergedEpoch = 0;
    for (;;) {
      this.stats.TotPersistLoopBeg++;
      let r = yield k.select([this.persisterNotifier.recvCase()], { default: true });
      if (r.index === 0) {
        watchers.push(r.value);
        if (r.value.epoch > lastMergedEpoch) lastMergedEpoch = r.value.epoch;
      }

      // pausePersisterForMergerCatchUp
      ({ lastMergedEpoch, watchers } = yield* this._pausePersister(p, lastPersistedEpoch, lastMergedEpoch, watchers));

      if (this.root.epoch > lastPersistedEpoch) {
        const ourSnapshot = this.root.addRef();
        this.persisterSnapshot = ourSnapshot;
        const ourPersisted = this.rootPersisted || [];
        this.rootPersisted = null;
        const t0 = k.now;
        yield* this._persistSnapshot(p, ourSnapshot);
        for (const ch of ourPersisted) ch.close();
        this.stats.LastPersistedEpoch = ourSnapshot.epoch;
        lastPersistedEpoch = ourSnapshot.epoch;
        for (const w of watchers) w.notifyCh.close();
        watchers = [];
        this.persisterSnapshot = null;
        ourSnapshot.decRef();
        this._herderWake(); // EventKindPersisterProgress
        this.log('persist', `persister: epoch ${ourSnapshot.epoch} persisted in ${fmtMs(k.now - t0)}`);
        if (this.root.epoch !== lastPersistedEpoch) {
          this.stats.TotPersistLoopProgress++;
          continue;
        }
      }

      // Tell the introducer we're waiting for changes.
      const w = { epoch: lastPersistedEpoch, notifyCh: new Chan(k, 'persisterWatcher', 1) };
      yield this.introducerNotifier.send(w, 'introducerNotifier <- watcher');
      yield* this._removeOldData(p); // might as well cleanup while waiting
      this.stats.TotPersistLoopWait++;
      r = yield k.select([w.notifyCh.recvCase(), this.persisterNotifier.recvCase()],
        { label: 'waiting for a new root epoch' });
      if (r.index === 1) watchers.push(r.value);
    }
  }

  * _pausePersister(p, lastPersistedEpoch, lastMergedEpoch, watchers) {
    const k = this.k, cfg = this.cfg;
    watchers = this._notifyMergeWatchers(lastPersistedEpoch, watchers);
    let numFiles = this.numFilesOnDisk();
    if (numFiles < cfg.persisterNapUnderNumFiles && cfg.persisterNapMs > 0 && this.numEventsBlocking === 0) {
      const r = yield k.select([k.timeoutCase(cfg.persisterNapMs), this.persisterNotifier.recvCase()],
        { state: 'sleep', label: `nap ${cfg.persisterNapMs}ms: letting segments pile up` });
      if (r.index === 0) {
        this.stats.TotPersisterNapPauseCompleted++;
      } else {
        watchers.push(r.value);
        lastMergedEpoch = r.value.epoch;
        watchers = this._notifyMergeWatchers(lastPersistedEpoch, watchers);
        this.stats.TotPersisterMergerNapBreak++;
      }
      return { lastMergedEpoch, watchers };
    }
    if (numFiles > cfg.persisterNapUnderNumFiles) {
      yield* this._removeOldData(p);
      numFiles = this.numFilesOnDisk();
    }
    while (cfg.persisterNapUnderNumFiles > 0 && numFiles >= cfg.persisterNapUnderNumFiles &&
      lastMergedEpoch < lastPersistedEpoch) {
      this.stats.TotPersisterSlowMergerPause++;
      this.log('pause', `persister: ${numFiles} files ≥ ${cfg.persisterNapUnderNumFiles}, pausing for merger`);
      const r = yield k.select([this.persisterNotifier.recvCase()],
        { label: `paused: ${numFiles} files, waiting for merger to catch up` });
      watchers.push(r.value);
      lastMergedEpoch = r.value.epoch;
      this.stats.TotPersisterSlowMergerResume++;
      watchers = this._notifyMergeWatchers(lastPersistedEpoch, watchers);
      numFiles = this.numFilesOnDisk();
    }
    return { lastMergedEpoch, watchers };
  }

  _notifyMergeWatchers(lastPersistedEpoch, watchers) {
    const next = [];
    for (const w of watchers) {
      if (w.epoch < lastPersistedEpoch) w.notifyCh.close();
      else next.push(w);
    }
    return next;
  }

  * _persistSnapshot(p, snap) {
    if (this.numEventsBlocking < this.cfg.memoryPressurePauseThreshold) {
      const ok = yield* this._persistSnapshotMaybeMerge(p, snap);
      if (ok) return;
    }
    yield* this._persistSnapshotDirect(p, snap);
  }

  * _persistSnapshotMaybeMerge(p, snap) {
    const k = this.k, cfg = this.cfg;
    const unpersisted = snap.segs.filter((ss) => ss.seg.kind === 'mem');
    if (unpersisted.length < 2) return false;

    const flushSet = [];
    if (cfg.numPersisterWorkers <= 1 && cfg.maxSizeInMemoryMergePerWorker <= 0) {
      flushSet.push(unpersisted);
    } else {
      let cur = [], running = 0;
      for (const ss of unpersisted) {
        cur.push(ss);
        running += ss.seg.bytes;
        if (running >= cfg.maxSizeInMemoryMergePerWorker && cur.length >= 2) {
          flushSet.push(cur);
          cur = [];
          running = 0;
        }
      }
      if (cur.length > 0) flushSet.push(cur);
    }

    // mergeAndPersistInMemorySegments: up to NumPersisterWorkers at once.
    const m = this;
    const sem = new Sem(k, 'persisterWorkers', Math.max(1, cfg.numPersisterWorkers));
    const wg = new WaitGroup(k);
    const newFiles = [];
    let skipped = false;
    flushSet.forEach((flushable, wi) => {
      wg.add(1);
      k.spawn(`persisterWorker-${wi}`, function* (wp) {
        yield sem.acquire('waiting for a persister worker slot');
        const liveDocs = flushable.reduce((a, ss) => a + ss.seg.docs - ss.deleted, 0);
        const inBytes = flushable.reduce((a, ss) => a + ss.seg.bytes, 0);
        const fileBytes = liveDocs * cfg.fileBytesPerDoc;
        const seg = new Segment(m, { kind: 'file', docs: liveDocs, bytes: fileBytes, origin: 'memmerge', sources: flushable.map((ss) => ss.seg.id) });
        m.ineligibleForRemoval.add(seg.fileName);
        yield k.work((inBytes + fileBytes) / MB / cfg.memMergeMBps * 1000, `MergeUsing: ${flushable.length} mem segs → ${seg.fileName}`);
        yield* m._writeFile(wp, seg);
        m.stats.TotMemMergeDone++;
        m.stats.TotMemMergeSegments += flushable.length;
        const notifyCh = new Chan(k, 'mergeNotify', 1);
        const old = new Map(flushable.map((ss) => [ss.seg.id, { seg: ss.seg, deleted: ss.deleted }]));
        const mergeMsg = { old, newSeg: seg, fileMerge: false, notifyCh, introduced: false };
        yield m.merges.send(mergeMsg, 'merges <- in-memory merge result');
        yield notifyCh.recv('waiting for merge introduction');
        if (mergeMsg.introduced) newFiles.push(seg);
        else skipped = true;
        sem.release();
        wg.done();
      }, { group: 'scorch', persisterWorker: wi });
    });
    yield wg.wait(`waiting for ${flushSet.length} in-memory merge(s)`);
    if (skipped) {
      this.log('memmerge', 'persister: in-memory merge result obsoleted; falling back');
      return false;
    }
    this.log('memmerge', `persister: merged ${unpersisted.length} mem segs → ${newFiles.length} file(s)`);
    // Persist an "equivalent" snapshot: same epoch, all files.
    const names = new Set(snap.segs.filter((ss) => ss.seg.kind === 'file').map((ss) => ss.seg.fileName));
    for (const f of newFiles) names.add(f.fileName);
    this.stats.TotPersistedItems += unpersisted.reduce((a, ss) => a + ss.seg.docs, 0);
    this.stats.TotPersistedSegments += newFiles.length;
    yield* this._boltCommit(p, snap.epoch, names);
    return true;
  }

  * _persistSnapshotDirect(p, snap) {
    const k = this.k;
    const persisted = new Map();
    for (const ss of snap.segs) {
      if (ss.seg.kind !== 'mem') continue;
      const f = new Segment(this, { kind: 'file', docs: ss.seg.docs, bytes: ss.seg.docs * this.cfg.fileBytesPerDoc, origin: 'persist', sources: [ss.seg.id] });
      // Persisted segments keep the id of the in-memory segment.
      this.nextSegmentID--;
      f.id = ss.seg.id;
      f.fileName = zapFileName(f.id);
      this.ineligibleForRemoval.add(f.fileName);
      yield* this._writeFile(p, f);
      persisted.set(ss.seg.id, f);
      this.stats.TotPersistedItems += f.docs;
      this.stats.TotPersistedSegments++;
    }
    if (persisted.size > 0) {
      const persist = { persisted, used: new Set(), applied: new Chan(k, 'persistApplied', 0) };
      yield this.persists.send(persist, 'persists <- new files');
      yield persist.applied.recv('waiting for persist introduction');
      for (const f of persisted.values()) if (!persist.used.has(f)) f.decRef();
    }
    const names = new Set();
    for (const ss of snap.segs) names.add(ss.seg.kind === 'file' ? ss.seg.fileName : zapFileName(ss.seg.id));
    yield* this._boltCommit(p, snap.epoch, names);
  }

  // zapx PersistSegmentBase / merge output: write, fsync, then mmap.
  * _writeFile(p, seg) {
    const k = this.k, cfg = this.cfg;
    this.diskActiveWriters++;
    const share = cfg.diskWriteMBps / this.diskActiveWriters;
    this.files.set(seg.fileName, { name: seg.fileName, bytes: 0, seg, createdAt: k.now });
    yield k.work(seg.bytes / MB / share * 1000, `writing ${seg.fileName} (${fmtBytes(seg.bytes)})`);
    this.files.get(seg.fileName).bytes = seg.bytes;
    yield k.work(cfg.fsyncMs, `fsync ${seg.fileName}`);
    this.diskActiveWriters--;
  }

  * _boltCommit(p, epoch, names) {
    const k = this.k;
    yield k.work(this.cfg.boltCommitMs, `root.bolt: commit snapshot ${epoch}`);
    yield k.work(this.cfg.fsyncMs, 'root.bolt: fsync');
    this.bolt.unshift({ epoch, time: k.now, files: names });
    for (const n of names) this.ineligibleForRemoval.delete(n);
  }

  // ---- cleanup (removeOldData) ----

  _addEligibleForRemoval(epoch) {
    if (this.root && epoch === this.root.epoch) return;
    this.eligibleForRemoval.push(epoch);
  }

  * _removeOldData(p) {
    const removed = this._removeOldBoltSnapshots();
    if (removed > 0) {
      yield this.k.work(this.cfg.boltCommitMs + this.cfg.fsyncMs, `root.bolt: removed ${removed} old snapshot(s)`);
    }
    this._removeOldZapFiles();
  }

  liveBoltSnapshots() {
    const cfg = this.cfg, meta = this.bolt;
    if (meta.length === 0) return [];
    if (!(cfg.rollbackSamplingIntervalMs > 0)) return meta.slice(0, cfg.numSnapshotsToKeep);
    const extra = cfg.numSnapshotsToKeep - 1;
    if (extra <= 0) return [meta[0]];
    const cutoff = this.k.now - extra * cfg.rollbackSamplingIntervalMs;
    return [meta[0], ...meta.slice(1).filter((s) => s.time >= cutoff)];
  }

  // getProtectedSnapshots + getTimeSeriesSnapshots
  protectedEpochs(live) {
    const cfg = this.cfg;
    const rv = new Set();
    const maxPoints = cfg.numSnapshotsToKeep - 1;
    const interval = cfg.rollbackSamplingIntervalMs;
    if (interval > 0 && live.length > 0 && maxPoints > 0) {
      let ptr = live.length - 1;
      rv.add(live[ptr].epoch);
      let n = 1;
      for (let i = ptr - 1; i >= 0 && n < maxPoints; i--) {
        const since = live[i].time - live[ptr].time;
        if (since >= interval) {
          const idx = since > interval ? i + 1 : i;
          if (!rv.has(live[idx].epoch)) {
            rv.add(live[idx].epoch);
            ptr = idx;
            n++;
          }
        }
      }
    }
    if (live.length > 0) rv.add(live[0].epoch);
    for (let i = 1; i < live.length && rv.size < cfg.numSnapshotsToKeep; i++) rv.add(live[i].epoch);
    return rv;
  }

  _removeOldBoltSnapshots() {
    const live = this.liveBoltSnapshots();
    if (live.length === 0) return 0;
    const prot = this.protectedEpochs(live);
    this.protected = prot;
    const toRemove = new Set();
    const keep = [];
    for (const e of this.eligibleForRemoval) {
      if (prot.has(e)) keep.push(e);
      else toRemove.add(e);
    }
    this.eligibleForRemoval = keep;
    const before = this.bolt.length;
    this.bolt = this.bolt.filter((s) => !toRemove.has(s.epoch));
    const n = before - this.bolt.length;
    this.stats.TotSnapshotsRemovedFromMetaStore += n;
    return n;
  }

  _removeOldZapFiles() {
    const live = new Set();
    for (const s of this.bolt) for (const n of s.files) live.add(n);
    for (const [name, f] of this.files) {
      if (live.has(name) || this.ineligibleForRemoval.has(name)) continue;
      this.files.delete(name);
      this.stats.TotFilesRemoved++;
      if (f.seg.open) {
        // os.Remove() on a file that's still mmapped by some snapshot:
        // the name is gone, the blocks aren't.
        this.zombies.set(name, { name, bytes: f.bytes, seg: f.seg, since: this.k.now });
        this.log('zombie', `removeOldZapFiles: unlinked ${name} but it is still open (refs=${f.seg.refs})`);
      }
    }
  }

  _closeFileSegment(seg) {
    seg.open = false;
    if (this.zombies.delete(seg.fileName)) {
      this.log('zombie', `${seg.fileName} closed; its ${fmtBytes(seg.bytes)} are finally freed`);
    }
  }

  // ---------------------------------------------------------------
  // Merger (merge.go)

  * _mergerLoop(p) {
    const k = this.k;
    let lastEpochMergePlanned = 0;
    for (;;) {
      const ourSnapshot = this.root.addRef();
      if (ourSnapshot.epoch !== lastEpochMergePlanned) {
        this.mergerSnapshot = ourSnapshot;
        const t0 = k.now;
        yield* this._planMergeAtSnapshot(p, ourSnapshot);
        this.mergerSnapshot = null;
        lastEpochMergePlanned = ourSnapshot.epoch;
        this.stats.LastMergedEpoch = ourSnapshot.epoch;
        this._herderWake(); // EventKindMergerProgress
        if (k.now - t0 > 1) this.log('merge', `merger: planned epoch ${ourSnapshot.epoch} in ${fmtMs(k.now - t0)}`);
      }
      ourSnapshot.decRef();
      const ew = { epoch: lastEpochMergePlanned, notifyCh: new Chan(k, 'mergerWatcher', 1) };
      yield this.persisterNotifier.send(ew, 'persisterNotifier <- watcher');
      yield ew.notifyCh.recv('waiting for persister to persist a newer epoch');
    }
  }

  * _planMergeAtSnapshot(p, snap) {
    const k = this.k, cfg = this.cfg;
    const fileSegs = snap.segs.filter((ss) => ss.seg.kind === 'file');
    const input = fileSegs.map((ss) => ({
      id: ss.seg.id,
      ss,
      fullSize: ss.seg.docs,
      liveSize: ss.seg.docs - ss.deleted,
      fileSize: ss.seg.bytes,
      liveFileSize: ss.seg.docs > 0 ? Math.floor(ss.seg.bytes * (ss.seg.docs - ss.deleted) / ss.seg.docs) : 0,
    }));
    this.stats.TotFileMergePlan++;
    const pl = mergePlan(input, cfg.mergePlan);
    this.lastMergePlan = { epoch: snap.epoch, budget: pl.budget, numSegs: input.length, tasks: pl.tasks.length };
    if (pl.tasks.length === 0) {
      this.stats.TotFileMergePlanNone++;
      return;
    }
    this.stats.TotFileMergePlanTasks += pl.tasks.length;
    for (const task of pl.tasks) {
      const srcs = task.segments.map((x) => x.ss);
      const liveDocs = srcs.reduce((a, ss) => a + ss.seg.docs - ss.deleted, 0);
      const inBytes = srcs.reduce((a, ss) => a + ss.seg.bytes, 0);
      let newSeg = null;
      const label = `merging ${srcs.length} files (${fmtBytes(inBytes)})`;
      this.currentMerge = { srcs: srcs.map((ss) => ss.seg.id), label };
      if (liveDocs > 0) {
        const bytes = liveDocs * cfg.fileBytesPerDoc;
        newSeg = new Segment(this, { kind: 'file', docs: liveDocs, bytes, origin: 'filemerge', sources: srcs.map((ss) => ss.seg.id) });
        this.currentMerge.out = newSeg.id;
        this.ineligibleForRemoval.add(newSeg.fileName);
        yield k.work((inBytes + bytes) / MB / cfg.fileMergeMBps * 1000, `MergeUsing: ${label} → ${newSeg.fileName}`);
        yield* this._writeFile(p, newSeg);
        this.stats.TotFileMergeWrittenBytes += bytes;
      }
      this.stats.TotFileMergeSegments += srcs.length;
      const notifyCh = new Chan(k, 'mergeNotify', 1);
      const old = new Map(srcs.map((ss) => [ss.seg.id, { seg: ss.seg, deleted: ss.deleted }]));
      yield this.merges.send({ old, newSeg, fileMerge: true, notifyCh }, 'merges <- file merge result');
      yield notifyCh.recv('waiting for merge introduction');
      this.currentMerge = null;
      this.log('merge', `merger: ${srcs.length} files → ${newSeg ? newSeg.fileName : '(nothing live)'}`);
    }
  }

  // ---------------------------------------------------------------
  // Queries

  * _queryProc(p, id, durationMs, timeoutMs, label) {
    const k = this.k;
    // Reader() -> currentSnapshot(): AddRef root for the whole query.
    const snap = this.root.addRef();
    const q = { id, epoch: snap.epoch, snap, startedAt: k.now, durationMs, timeoutMs, label: label || '' };
    this.queries.set(id, q);
    this.stats.TotQueries++;
    const runFor = Math.min(durationMs, timeoutMs);
    yield k.work(runFor, `searching snapshot epoch ${snap.epoch}`);
    if (durationMs > timeoutMs) {
      this.stats.TotQueriesTimedOut++;
      this.log('query', `query ${id}: timed out after ${fmtMs(timeoutMs)} (context deadline exceeded)`);
    }
    this.queries.delete(id);
    snap.decRef(); // indexReader.Close()
    this._herderWake();
  }

  // ---------------------------------------------------------------
  // Sampling for charts

  * _sampler(p) {
    for (;;) {
      this.series.push(this.sample());
      if (this.series.length > 1200) this.series.splice(0, this.series.length - 1200);
      yield this.k.sleep(100, 'sampling');
    }
  }

  sample() {
    const root = this.root;
    let memSegs = 0, fileSegs = 0;
    for (const ss of root.segs) (ss.seg.kind === 'mem' ? memSegs++ : fileSegs++);
    return {
      t: this.k.now,
      memUsed: this.memUsed(),
      indexQuota: this.indexQuota(),
      memSegs, fileSegs,
      filesOnDisk: this.numFilesOnDisk(),
      diskBytes: this.diskBytes(),
      zombieBytes: this.zombieBytes(),
      dcpBuf: this.dcpBufUsed,
      mutations: this.stats.TotDcpMutations,
      introduced: this.stats.TotIntroducedItems,
      persisted: this.stats.TotPersistedItems,
      epochLag: this.stats.CurRootEpoch - this.stats.LastPersistedEpoch,
      blocked: this.numEventsBlocking,
    };
  }
}

// ---- formatting helpers (shared with the UI) ----

export function fmtBytes(b) {
  if (b >= 1024 * MB) return (b / 1024 / MB).toFixed(1) + 'GB';
  if (b >= MB) return (b / MB).toFixed(1) + 'MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + 'KB';
  return Math.round(b) + 'B';
}

export function fmtMs(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + 's';
  if (ms >= 1) return ms.toFixed(0) + 'ms';
  return (ms * 1000).toFixed(0) + 'µs';
}

function fmtVal(v) {
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
